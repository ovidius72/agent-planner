import type { DeleteFeatureCascadeResult } from "../feature-delete.js";
import { featureNumberOfPhase, formatFeatureRef, formatPhaseRef, taskCompositeRef } from "../naming.js";
import type { PhaseDeleteFlowOutcome } from "../phase-flow.js";
import { findPhaseByRef, findTaskByRef, resolveFeatureRefStrict } from "../refs.js";
import type { DeleteTaskFlowOutcome } from "../task-flow.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectLists } from "./overview.js";
import type { ProjectCaller } from "./project-access.js";
import { reconcileLeafMutation } from "./reconciliation.js";
import { registeredSessionIsLive } from "./task-execution.js";

export interface RegisteredEntityDelete {
  kind: "feature" | "phase" | "task";
  ref: string;
  requestId: string;
  sessionId: string;
  cascade: boolean;
  confirmed: boolean;
}

type DeletionResult = { deleted: true } & (DeleteFeatureCascadeResult | PhaseDeleteFlowOutcome | DeleteTaskFlowOutcome);
type Phase = ReturnType<typeof readProjectLists>["phases"][number];

function guardTaskDeletion(driver: PersistenceDriver, projectId: string, taskIds: Set<string>): void {
  const claim = driver.prepare(`
    SELECT id FROM tasks WHERE project_id = ? AND id = ?
    AND (status = 'in-progress' OR active_owner_session <> '' OR pause_snapshot IS NOT NULL)
  `);
  const dependents = driver.prepare("SELECT task_id FROM task_dependencies WHERE depends_on = ?");
  const deviation = driver.prepare(`
    SELECT id FROM work_deviations WHERE project_id = ? AND (temporary_task_id = ? OR resume_task_id = ?) LIMIT 1
  `);
  for (const id of taskIds) {
    if (claim.get(projectId, id)) {
      throw new CommandRefusal("TASK_DELETE_EXECUTION_PENDING", "Finish or release active work and resolve any saved checkpoint before deleting the task.", { taskId: id });
    }
    const dependent = dependents.all(id).find((row) => !taskIds.has(String(row.task_id)));
    if (dependent) {
      throw new CommandRefusal("TASK_DELETE_DEPENDENCY_EXISTS", "Remove the incoming dependency before deleting the task.", {
        taskId: id, dependentTaskId: String(dependent.task_id),
      });
    }
    const linked = deviation.get(projectId, id, id);
    if (linked) {
      throw new CommandRefusal("TASK_DELETE_DEVIATION_EXISTS", "A preserved deviation references this task.", { taskId: id, deviationId: String(linked.id) });
    }
  }
}

function removeOwnedRecords(driver: PersistenceDriver, projectId: string, kind: RegisteredEntityDelete["kind"], id: string): void {
  driver.prepare("DELETE FROM entity_requirements WHERE entity_kind = ? AND entity_id = ?").run(kind, id);
  driver.prepare("DELETE FROM decisions WHERE project_id = ? AND owner_id = ?").run(projectId, id);
  driver.prepare(`
    UPDATE reconciliation_obligations SET status = 'resolved-applied', resolved_at = ?, resolution_evidence = ?
    WHERE project_id = ? AND entity_kind = ? AND entity_id = ? AND status = 'open'
  `).run(new Date().toISOString(), JSON.stringify({ reason: "Owning entity deleted" }), projectId, kind, id);
}

function deleteTasks(driver: PersistenceDriver, projectId: string, ids: Set<string>): void {
  const remove = driver.prepare("DELETE FROM tasks WHERE project_id = ? AND id = ?");
  for (const id of ids) {
    removeOwnedRecords(driver, projectId, "task", id);
    remove.run(projectId, id);
  }
}

function deletePhases(driver: PersistenceDriver, projectId: string, phases: Phase[]): void {
  const handoff = driver.prepare("SELECT id FROM phase_handoffs WHERE project_id = ? AND phase_id = ? LIMIT 1");
  for (const phase of phases) {
    if (handoff.get(projectId, phase.id)) {
      throw new CommandRefusal("PHASE_DELETE_HANDOFF_EXISTS", "A preserved handoff references this phase.", { phaseId: phase.id });
    }
  }
  const taskIds = new Set(phases.flatMap((phase) => phase.tasks.map((task) => task.id)));
  guardTaskDeletion(driver, projectId, taskIds);
  deleteTasks(driver, projectId, taskIds);
  const remove = driver.prepare("DELETE FROM phases WHERE project_id = ? AND id = ?");
  for (const phase of phases) {
    removeOwnedRecords(driver, projectId, "phase", phase.id);
    remove.run(projectId, phase.id);
  }
}

export function deleteRegisteredEntity(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredEntityDelete) {
  const { projectId } = caller;
  return executeCommand<DeletionResult>(driver, {
    requestId: input.requestId, projectId, operation: `${input.kind}.delete`, payload: input,
  }, ({ recordRevision }) => {
    const now = new Date().toISOString();
    if (!registeredSessionIsLive(driver, caller, input.sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
    if (input.kind === "task" && !input.confirmed) {
      throw new CommandRefusal("TASK_DELETE_CONFIRMATION_REQUIRED", "Task deletion requires confirmed=true.");
    }
    const { features, phases } = readProjectLists(driver, projectId);
    if (input.kind === "task") {
      const found = findTaskByRef(phases, features, input.ref);
      if (!found) throw new CommandRefusal("TASK_NOT_FOUND", `Task not found: ${input.ref}`);
      const { task, phase } = found;
      const taskIds = new Set([task.id]);
      guardTaskDeletion(driver, projectId, taskIds);
      deleteTasks(driver, projectId, taskIds);
      recordRevision();
      const impact = reconcileLeafMutation(driver, { projectId, kind: "task.deleted", taskId: task.id, previousPhaseId: phase.id });
      publishEvent(driver, projectId, "task.deleted", { taskId: task.id, impact });
      return {
        deleted: true, taskId: task.id, ref: taskCompositeRef(task, phase, features), shortId: task.shortId,
        phaseId: phase.id, phaseRef: formatPhaseRef(phase.number, featureNumberOfPhase(phase, features)),
      };
    }
    if (input.kind === "phase") {
      const phase = findPhaseByRef(phases, features, input.ref);
      if (!phase) throw new CommandRefusal("PHASE_NOT_FOUND", `Phase not found: ${input.ref}`);
      deletePhases(driver, projectId, [phase]);
      recordRevision();
      publishEvent(driver, projectId, "phase.deleted", { phaseId: phase.id });
      return { deleted: true, phaseId: phase.id, ref: formatPhaseRef(phase.number, featureNumberOfPhase(phase, features)), shortId: phase.shortId };
    }
    const resolved = resolveFeatureRefStrict(features, input.ref);
    if (!resolved.ok) throw new CommandRefusal("FEATURE_NOT_FOUND", resolved.error);
    const { feature } = resolved;
    const owned = phases.filter((phase) => phase.featureId === feature.id);
    if (input.cascade) deletePhases(driver, projectId, owned);
    else driver.prepare("UPDATE phases SET feature_id = NULL, updated_at = ? WHERE project_id = ? AND feature_id = ?").run(now, projectId, feature.id);
    removeOwnedRecords(driver, projectId, "feature", feature.id);
    driver.prepare("DELETE FROM features WHERE project_id = ? AND id = ?").run(projectId, feature.id);
    recordRevision();
    const affected = owned.map(({ id }) => ({ id, action: input.cascade ? "deleted" as const : "unlinked" as const }));
    publishEvent(driver, projectId, "feature.deleted", { featureId: feature.id, phases: affected });
    return {
      deleted: true, ref: formatFeatureRef(feature.number), id: feature.id, name: feature.name,
      phaseCount: affected.length, cascade: input.cascade, phases: affected,
    };
  }, caller);
}
