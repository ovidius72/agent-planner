import { randomUUID } from "node:crypto";
import { formatPhaseRef, taskCompositeRef } from "../naming.js";
import { findPhaseByRef, findTaskByRef } from "../refs.js";
import type { MoveTasksResult } from "../task-move.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectLists } from "./overview.js";
import type { ProjectCaller } from "./project-access.js";
import { reconcileLeafMutation } from "./reconciliation.js";

export interface RegisteredTaskMove {
  tasks: string[];
  targetPhase: string;
  requestId: string;
}

export function moveRegisteredTasks(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskMove) {
  const { projectId } = caller;
  return executeCommand(driver, { projectId, requestId: input.requestId, operation: "task.move", payload: input }, ({ recordRevision }) => {
    if (!input.tasks.length) throw new CommandRefusal("NO_TASKS_GIVEN", "Provide at least one task to move.");
    const model = readProjectLists(driver, projectId);
    const destination = findPhaseByRef(model.phases, model.features, input.targetPhase);
    if (!destination) throw new CommandRefusal("TARGET_PHASE_NOT_FOUND", "The destination phase could not be resolved.");
    const featureNumber = model.features.find(({ id }) => id === destination.featureId)?.number;
    const targetPhaseRef = formatPhaseRef(destination.number, featureNumber);
    if (["done", "canceled", "rejected"].includes(destination.status)) {
      throw new CommandRefusal("TARGET_PHASE_TERMINAL", `Destination phase ${targetPhaseRef} is ${destination.status}.`);
    }
    const located = new Map<string, NonNullable<ReturnType<typeof findTaskByRef<(typeof model.phases)[number]>>>>();
    for (const ref of input.tasks) {
      const entry = findTaskByRef(model.phases, model.features, ref);
      if (!entry) throw new CommandRefusal("TASK_NOT_FOUND", `Task not found: ${ref}`);
      if (entry.phase.id === destination.id) throw new CommandRefusal("SOURCE_EQUALS_TARGET", `Task ${ref} already belongs to ${targetPhaseRef}.`);
      located.set(entry.task.id, entry);
    }
    const move: MoveTasksResult = { targetPhaseRef, moves: [], sourcePhaseRefsWithHandoff: [] };
    const phaseWithHandoff = driver.prepare("SELECT id FROM phase_handoffs WHERE project_id = ? AND phase_id = ? AND archived = 0 LIMIT 1");
    const warnings = new Set<string>();
    const now = new Date().toISOString();
    const update = driver.prepare(`
      UPDATE tasks SET phase_id = ?, updated_at = ?, metadata = json_insert(
        json_set(metadata, '$.phaseId', ?, '$.statusLog', COALESCE(json_extract(metadata, '$.statusLog'), json('[]'))),
        '$.statusLog[#]', json(?)
      ) WHERE project_id = ? AND id = ?
    `);
    recordRevision();
    for (const { phase, task } of located.values()) {
      const oldRef = taskCompositeRef(task, phase, model.features);
      const newRef = taskCompositeRef(task, destination, model.features);
      const sourceFeature = model.features.find(({ id }) => id === phase.featureId);
      if (phaseWithHandoff.get(projectId, phase.id)) warnings.add(formatPhaseRef(phase.number, sourceFeature?.number));
      const entry = { id: randomUUID(), date: now, fromStatus: task.status, toStatus: task.status,
        title: `Moved ${oldRef} → ${newRef}`, description: "" };
      update.run(destination.id, now, destination.id, JSON.stringify(entry), projectId, task.id);
      move.moves.push({ taskId: task.id, shortId: task.shortId, title: task.title, status: task.status, oldRef, newRef });
    }
    for (const { phase, task } of located.values()) {
      const impact = reconcileLeafMutation(driver, {
        projectId, kind: "task.moved", taskId: task.id, previousPhaseId: phase.id, newPhaseId: destination.id,
      });
      publishEvent(driver, projectId, "task.moved", { taskId: task.id, previousPhaseId: phase.id, phaseId: destination.id, impact });
    }
    move.sourcePhaseRefsWithHandoff = [...warnings];
    return move;
  }, caller);
}
