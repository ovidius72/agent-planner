import { randomUUID } from "node:crypto";
import { z } from "zod";
import { replaceChecklist } from "../checklist.js";
import { formatFeatureRef, formatPhaseRef, taskCompositeRef } from "../naming.js";
import { normalizeDescriptionRef } from "../payload-fallback.js";
import { findPhaseByRef, findTaskByRef, resolveFeatureRefStrict } from "../refs.js";
import { FeatureSchema, PhaseSchema, TaskSchema, TaskStatusSchema, needsMotivation } from "../schema.js";
import { readRegisteredBoard } from "./board.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import type { ProjectCaller } from "./project-access.js";
import { reconcileLeafMutation } from "./reconciliation.js";

export interface RegisteredEntityUpdate {
  kind: "feature" | "phase" | "task";
  ref: string;
  updates: Record<string, unknown>;
  requestId: string;
  sessionId: string;
  supervisor: boolean;
  discuss?: boolean | undefined;
}

const textList = z.array(z.string());
const discussionFields = {
  feature: ["description", "descriptionRef", "workDone", "workRemaining", "dependencies"],
  phase: ["goal", "goals", "summary", "scope", "descriptionRef", "nonGoals", "dependencies", "risks", "openQuestions", "completionCriteria"],
  task: ["description", "descriptionRef", "checklist"],
} as const;
const text = z.string().trim();
const base = z.object({
  description: text.optional(), descriptionRef: text.optional(), priority: z.number().int().nonnegative().optional(),
});
const featureFields = base.extend({
  name: text.min(1).optional(), startDate: text.optional(), endDate: text.optional(),
  workDone: text.optional(), workRemaining: text.optional(), dependsOn: textList.optional(),
});
const phaseFields = base.extend({
  title: text.min(1).optional(), summary: text.optional(), notes: text.optional(), featureId: text.optional(),
  goals: textList.optional(), nonGoals: textList.optional(), dependencies: textList.optional(),
  risks: textList.optional(), openQuestions: textList.optional(), completionCriteria: textList.optional(),
});
const taskFields = base.extend({
  title: text.min(1).optional(), notes: text.optional(), status: TaskStatusSchema.optional(), motivation: text.optional(),
  checklist: textList.optional(), subtasks: z.array(z.object({
    id: text.min(1).optional(), title: text.min(1), description: text.optional(), status: TaskStatusSchema.optional(),
  })).optional(),
});

export function updateRegisteredEntity(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredEntityUpdate) {
  const { kind, discuss } = input;
  const receivedFields = discuss ? discussionFields[kind].filter((field) => input.updates[field] !== undefined) : [];
  const updates = discuss ? Object.fromEntries(receivedFields.map((field) => {
    const value = input.updates[field];
    return [field, Array.isArray(value) ? value.map((item: unknown) => typeof item === "string" ? item.trim() : item).filter((item: unknown) => item !== "") : value];
  })) as Record<string, unknown> : input.updates;
  if (discuss && input.updates.expectedUpdatedAt !== undefined) updates.expectedUpdatedAt = input.updates.expectedUpdatedAt;
  if (discuss && kind === "feature") updates.dependsOn = updates.dependencies;
  if (discuss && kind === "phase") {
    updates.description = updates.scope;
    if (updates.goals === undefined && typeof updates.goal === "string") updates.goals = [updates.goal.trim()].filter(Boolean);
  }
  const action = discuss ? "discussed" : "updated";
  return executeCommand(driver, {
    projectId: caller.projectId, requestId: input.requestId, operation: `${kind}.${discuss ? "discuss" : "update"}`, payload: input,
  }, ({ recordRevision }) => {
    const projectId = caller.projectId;
    const now = new Date().toISOString();
    const session = driver.prepare(`
      SELECT id FROM project_sessions WHERE project_id = ? AND workspace_id = ? AND principal_id = ?
      AND id = ? AND ended_at IS NULL AND expires_at > ?
    `).get(projectId, caller.workspaceId, caller.principalId, input.sessionId, now);
    if (!session) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required to update planner entities.");
    const reason = input.updates.contextReadyReason;
    const discussion = discuss ? {
      discussedAt: now, contextReady: true,
      contextReadyReason: typeof reason === "string" && reason.trim() ? reason.trim() : "Updated through the registered discussion command.",
    } : {};
    if (input.updates.acceptedDecisions !== undefined) throw new CommandRefusal("ACCEPTED_DECISION_RAW_REPLACEMENT_DISABLED", "Use the accepted decision operations.");
    if (input.updates.decisions !== undefined) throw new CommandRefusal("LEGACY_DECISIONS_ARRAY_READ_ONLY", "Legacy decision history is read-only.");
    if (kind !== "task" && updates.status !== undefined) throw new CommandRefusal("DERIVED_STATUS_READ_ONLY", "Status is derived from child work.");
    const board = readRegisteredBoard(driver, projectId, caller.workspaceId);
    if (!board) throw new CommandRefusal("PROJECT_ACCESS_DENIED", "The project workspace could not be loaded.");

    const check = (entity: { updatedAt: string }, fields: Record<string, unknown>) => {
      if (updates.expectedUpdatedAt !== undefined && updates.expectedUpdatedAt !== entity.updatedAt) {
        throw new CommandRefusal("PLAN_STALE_WRITE", "Reload the entity before applying these edits.");
      }
      const keys = Object.keys(fields).filter((key) => fields[key] !== undefined && key !== "motivation");
      if (keys.length === 0) throw new CommandRefusal("NO_MUTABLE_FIELDS_RECEIVED", "Supply at least one field to update.");
      return discuss ? receivedFields : keys;
    };
    if (kind === "feature") {
      const resolved = resolveFeatureRefStrict(board.features, input.ref);
      if (!resolved.ok) throw new CommandRefusal("FEATURE_NOT_FOUND", resolved.error);
      const parsed = featureFields.safeParse(updates);
      if (!parsed.success) throw new CommandRefusal("INVALID_FEATURE_UPDATE", "Feature fields are invalid.");
      const feature = resolved.feature;
      const updatedFields = check(feature, parsed.data);
      const description = parsed.data.description ?? feature.description;
      const descriptionRef = parsed.data.descriptionRef === undefined ? feature.descriptionRef : normalizeDescriptionRef(parsed.data.descriptionRef);
      const changed = description !== feature.description || descriptionRef !== feature.descriptionRef;
      const updated = FeatureSchema.parse({ ...feature, ...parsed.data, ...discussion, descriptionRef, descriptionUpdatedAt: changed ? now : feature.descriptionUpdatedAt, updatedAt: now });
      driver.prepare("UPDATE features SET name = ?, priority = ?, description_updated_at = ?, metadata = ?, updated_at = ? WHERE project_id = ? AND id = ?")
        .run(updated.name, updated.priority, updated.descriptionUpdatedAt, JSON.stringify(updated), now, projectId, updated.id);
      recordRevision();
      publishEvent(driver, projectId, `feature.${action}`, { featureId: updated.id, updatedFields });
      return { feature: { ...updated, status: feature.status }, ref: formatFeatureRef(feature.number), updatedFields };
    }
    if (kind === "phase") {
      const phase = findPhaseByRef(board.phases, board.features, input.ref);
      if (!phase) throw new CommandRefusal("PHASE_NOT_FOUND", "The phase could not be resolved.");
      const parsed = phaseFields.safeParse(updates);
      if (!parsed.success) throw new CommandRefusal("INVALID_PHASE_UPDATE", "Phase fields are invalid.");
      const updatedFields = check(phase, parsed.data);
      let featureId = phase.featureId;
      if (parsed.data.featureId !== undefined) {
        if (!parsed.data.featureId) featureId = undefined;
        else {
          const feature = resolveFeatureRefStrict(board.features, parsed.data.featureId);
          if (!feature.ok) throw new CommandRefusal("PHASE_FEATURE_NOT_FOUND", feature.error);
          featureId = feature.feature.id;
        }
      }
      const description = parsed.data.description ?? phase.description;
      const descriptionRef = parsed.data.descriptionRef === undefined ? phase.descriptionRef : normalizeDescriptionRef(parsed.data.descriptionRef);
      const changed = description !== phase.description || descriptionRef !== phase.descriptionRef;
      const updated = PhaseSchema.parse({ ...phase, ...parsed.data, ...discussion, featureId, descriptionRef, descriptionUpdatedAt: changed ? now : phase.descriptionUpdatedAt, updatedAt: now });
      driver.prepare("UPDATE phases SET feature_id = ?, title = ?, priority = ?, description_updated_at = ?, metadata = ?, updated_at = ? WHERE project_id = ? AND id = ?")
        .run(featureId ?? null, updated.title, updated.priority, updated.descriptionUpdatedAt, JSON.stringify({ ...updated, tasks: [], taskIds: [] }), now, projectId, updated.id);
      recordRevision();
      publishEvent(driver, projectId, `phase.${action}`, { phaseId: updated.id, featureId, updatedFields });
      const featureNumber = board.features.find((feature) => feature.id === featureId)?.number;
      return { phase: { ...updated, status: phase.status }, ref: formatPhaseRef(phase.number, featureNumber), updatedFields };
    }

    const found = findTaskByRef(board.phases, board.features, input.ref);
    if (!found) throw new CommandRefusal("TASK_NOT_FOUND", "The task could not be resolved.");
    const parsed = taskFields.safeParse(updates);
    if (!parsed.success) throw new CommandRefusal("INVALID_TASK_UPDATE", "Task fields are invalid.");
    const { task, phase } = found;
    const updatedFields = check(task, parsed.data);
    const status = parsed.data.status ?? task.status;
    const statusChanged = status !== task.status;
    if (statusChanged && (status === "done" || status === "in-progress" || task.status === "done")) {
      throw new CommandRefusal("TASK_LIFECYCLE_TRANSITION_REQUIRED", "Use the dedicated start, reopen or completion command.");
    }
    const motivation = parsed.data.motivation ?? "";
    if (statusChanged && !input.supervisor && needsMotivation(task.status, status) && !motivation) {
      throw new CommandRefusal("TASK_MOTIVATION_REQUIRED", "Give a reason for the status transition.");
    }
    if (statusChanged && task.status === "in-progress") {
      const owner = driver.prepare("SELECT active_owner_session FROM tasks WHERE project_id = ? AND id = ?").get(projectId, task.id)?.active_owner_session;
      if (owner && owner !== input.sessionId) throw new CommandRefusal("TASK_OWNED_BY_ANOTHER_SESSION", "The active task belongs to another session.");
    }
    const checklist = parsed.data.checklist === undefined ? undefined : replaceChecklist(task.checklist, parsed.data.checklist, task.id);
    const priorSubtasks = new Map(task.subtasks.map((entry) => [entry.id, entry]));
    const seenSubtasks = new Set<string>();
    const subtasks = parsed.data.subtasks?.map((entry) => {
      const previous = entry.id ? priorSubtasks.get(entry.id) : undefined;
      if (entry.id && (!previous || seenSubtasks.has(entry.id))) throw new CommandRefusal("SUBTASK_ID_INVALID", "Each existing subtask ID must belong to this task and appear once.");
      const id = entry.id ?? randomUUID();
      seenSubtasks.add(id);
      return { id, title: entry.title, description: entry.description ?? previous?.description ?? "",
        status: entry.status ?? previous?.status ?? "planned", createdAt: previous?.createdAt ?? now, updatedAt: now };
    }) ?? task.subtasks;
    const description = parsed.data.description ?? task.description;
    const descriptionRef = parsed.data.descriptionRef === undefined ? task.descriptionRef : normalizeDescriptionRef(parsed.data.descriptionRef);
    const descriptionChanged = description !== task.description || descriptionRef !== task.descriptionRef;
    const history = statusChanged ? [...task.statusLog, {
      id: randomUUID(), date: now, fromStatus: task.status, toStatus: status, title: `${task.status} → ${status}`, description: motivation,
    }] : task.statusLog;
    const updated = TaskSchema.parse({
      ...task, ...parsed.data, descriptionRef, descriptionUpdatedAt: descriptionChanged ? now : task.descriptionUpdatedAt,
      checklist: checklist?.items ?? task.checklist, subtasks, statusLog: history, updatedAt: now,
    });
    driver.prepare(`
      UPDATE tasks SET title = ?, priority = ?, metadata = json_set(?, '$.executionActivityAt',
        CASE WHEN active_owner_session = ? THEN ?
        ELSE COALESCE(json_extract(metadata, '$.executionActivityAt'), updated_at) END), updated_at = ?, status = ?,
      active_owner_session = CASE WHEN ? THEN '' ELSE active_owner_session END WHERE project_id = ? AND id = ?
    `).run(updated.title, updated.priority, JSON.stringify({ ...updated, checklist: [] }), input.sessionId, now, now, status, Number(statusChanged), projectId, updated.id);
    if (checklist) {
      driver.prepare("DELETE FROM task_checklists WHERE task_id = ?").run(updated.id);
      const add = driver.prepare("INSERT INTO task_checklists(task_id, item_id, text, checked) VALUES (?, ?, ?, ?)");
      for (const item of checklist.items) add.run(updated.id, item.id, item.title, Number(item.checked));
    }
    recordRevision();
    const impact = reconcileLeafMutation(driver, {
      projectId, kind: descriptionChanged ? "task.description" : "task.status", taskId: task.id, descriptionChanged,
    });
    publishEvent(driver, projectId, `task.${action}`, { taskId: task.id, updatedFields, impact });
    const ref = taskCompositeRef(task, phase, board.features);
    return { task: updated, ref, updatedFields, lostChecklistTicks: checklist?.lostTicks ?? [] };
  }, caller);
}
