import { createHash, randomUUID } from "node:crypto";
import { addChecklistItem, removeChecklistItem, toggleChecklistItem } from "../checklist.js";
import { checkExplicitTaskStart } from "../task-selection.js";
import { findTaskByRef } from "../refs.js";
import { taskCompositeRef } from "../naming.js";
import { evaluateTaskCompletionGate, taskCompletionChecklistRefusal, taskCompletionForceMotivationRequired, taskCompletionOverrideNote } from "../task-completion-gate.js";
import { TaskPauseSnapshotSchema, type TaskPauseSnapshot, type WorkDeviation } from "../schema.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectLists } from "./overview.js";
import { resolveProjectCaller, type ProjectCaller } from "./project-access.js";
import { reconcileLeafMutation } from "./reconciliation.js";
import { readRegisteredPhaseRequirements } from "./requirements.js";

const ACTIVE_DEVIATION_STATES = ["approved", "active"] as const satisfies readonly WorkDeviation["state"][];

export function executionIdleAfterMs(): number {
  const configured = Number(process.env.AGENT_PLAN_EXECUTION_IDLE_MS);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 2 * 60 * 60 * 1_000;
}

export function taskExecutionState(
  owner: { ended_at?: unknown; expires_at?: unknown } | undefined, activityAt: unknown, now: string,
): "unverified" | "abandoned" | "idle" | "active" {
  if (!owner) return "unverified";
  if (owner.ended_at || String(owner.expires_at) <= now) return "abandoned";
  const inactiveFor = Date.parse(now) - Date.parse(String(activityAt));
  return inactiveFor >= executionIdleAfterMs() ? "idle" : "active";
}

export function registeredSessionIsLive(driver: PersistenceDriver, caller: ProjectCaller, sessionId: string, now: string): boolean {
  return Boolean(driver.prepare(`
    SELECT id FROM project_sessions WHERE project_id = ? AND workspace_id = ?
    AND principal_id = ? AND id = ? AND ended_at IS NULL AND expires_at > ?
  `).get(caller.projectId, caller.workspaceId, caller.principalId, sessionId, now));
}

function taskContext(driver: PersistenceDriver, projectId: string, ref: string) {
  const plan = readProjectLists(driver, projectId);
  const target = findTaskByRef(plan.phases, plan.features, ref);
  if (!target) return undefined;
  const taskRef = taskCompositeRef(target.task, target.phase, plan.features);
  const taskRow = driver.prepare("SELECT * FROM tasks WHERE project_id = ? AND id = ?").get(projectId, target.task.id);
  const phase = driver.prepare("SELECT * FROM phases WHERE project_id = ? AND id = ?").get(projectId, target.phase.id);
  if (!taskRow || !phase) return undefined;
  const { active_owner_session: owner, ...task } = taskRow;
  const featureId = target.phase.featureId ?? "";
  const feature = featureId
    ? driver.prepare("SELECT * FROM features WHERE project_id = ? AND id = ?").get(projectId, featureId)
    : undefined;
  const project = driver.prepare("SELECT metadata FROM projects WHERE id = ?").get(projectId);
  const metadata = JSON.parse(String(project?.metadata ?? "{}")) as { projectGuidelines?: unknown };
  const decisions = driver.prepare(`
    SELECT id, owner_id, content, accepted_at FROM decisions
    WHERE project_id = ? AND owner_id IN (?, ?, ?, ?) AND superseded_by IS NULL ORDER BY id
  `).all(projectId, target.task.id, target.phase.id, featureId, projectId);
  const requirements = readRegisteredPhaseRequirements(driver, projectId, target.phase.id, target.phase.featureId);
  const checklist = driver.prepare(`
    SELECT item_id, text, checked FROM task_checklists WHERE task_id = ? ORDER BY rowid
  `).all(target.task.id);
  const context = {
    taskRef, task, phase, feature: feature ?? null, dependsOn: target.task.dependsOn,
    checklist: checklist.map((item, index) => ({
      id: String(item.item_id), number: index + 1, title: String(item.text), checked: Number(item.checked) === 1,
    })), decisions, requirements,
    projectGuidelines: metadata.projectGuidelines ?? null,
  };
  const serialized = JSON.stringify(context);
  return {
    plan, target, context, serialized, owner,
    fingerprint: createHash("sha256").update(JSON.stringify([owner, serialized])).digest("hex"),
  };
}

export function readTaskExecutionContext(
  driver: PersistenceDriver, caller: ProjectCaller, input: { ref: string; sessionId: string; maxChars: number },
) {
  return driver.runExclusive(() => {
    if (!resolveProjectCaller(driver, caller)) return { kind: "forbidden" } as const;
    if (!registeredSessionIsLive(driver, caller, input.sessionId, new Date().toISOString())) return { kind: "expired" } as const;
    const read = taskContext(driver, caller.projectId, input.ref);
    if (!read) return { kind: "missing" } as const;
    if (read.serialized.length > input.maxChars) {
      return { kind: "incomplete", requiredChars: read.serialized.length } as const;
    }
    driver.prepare(`
      INSERT INTO task_context_reads(session_id, task_id, fingerprint) VALUES (?, ?, ?)
      ON CONFLICT(session_id, task_id) DO UPDATE SET fingerprint=excluded.fingerprint
    `).run(input.sessionId, read.target.task.id, read.fingerprint);
    const priorTakeover = driver.prepare(`
      SELECT json_extract(checkpoint, '$.takenOverAt') AS takeover_at FROM work_deviations
      WHERE project_id = ? AND resume_task_id = ? AND owner_session = ?
      AND json_extract(checkpoint, '$.takenOverAt') IS NOT NULL ORDER BY updated_at DESC LIMIT 1
    `).get(caller.projectId, read.target.task.id, input.sessionId)?.takeover_at;
    return { kind: "context", context: read.context,
      ...(typeof priorTakeover === "string" ? { parkedTakeoverAt: priorTakeover } : {}),
    } as const;
  });
}

interface RegisteredTaskStart {
  ref: string;
  sessionId: string;
  requestId: string;
  confirmedTakeover?: boolean | undefined;
}

export function startRegisteredTask(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskStart) {
  return executeCommand(driver, {
    requestId: input.requestId, projectId: caller.projectId, operation: "task.start",
    payload: { ref: input.ref, sessionId: input.sessionId, ...(input.confirmedTakeover ? { confirmedTakeover: true } : {}) },
  }, ({ recordRevision }) => applyTaskStart(driver, caller, input, recordRevision), caller);
}

function applyTaskStart(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskStart, recordRevision: () => void) {
  const now = new Date().toISOString();
  if (!registeredSessionIsLive(driver, caller, input.sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
  const read = taskContext(driver, caller.projectId, input.ref);
  if (!read) throw new CommandRefusal("TASK_NOT_FOUND", "The task could not be resolved.");
  const { task } = read.target;
  const previousOwner = String(read.owner);
  const alreadyStarted = task.status === "in-progress";
  const ownsActive = alreadyStarted && previousOwner === input.sessionId;
  const details = JSON.parse(String(read.context.task.metadata)) as { startedAt?: string; executionActivityAt?: string; statusLog?: unknown[] };
  let tookOver = false;
  if (alreadyStarted && !ownsActive) {
    const owner = driver.prepare(`
      SELECT ended_at, expires_at FROM project_sessions WHERE project_id = ? AND id = ?
    `).get(caller.projectId, previousOwner);
    const state = taskExecutionState(owner, details.executionActivityAt ?? read.context.task.updated_at, now);
    if (state === "unverified") throw new CommandRefusal("TASK_OWNER_UNVERIFIED", "The existing task owner cannot be verified.");
    if (state === "active") {
      throw new CommandRefusal("TASK_OWNED_BY_ANOTHER_SESSION", "Another live session owns this task.");
    }
    if (state === "idle" && !input.confirmedTakeover) {
      throw new CommandRefusal("TASK_TAKEOVER_CONFIRMATION_REQUIRED", "The live owner is idle. Confirm takeover before retrying.");
    }
    tookOver = state === "idle";
  }
  if (task.status === "done") throw new CommandRefusal("TASK_DONE", `Task ${read.context.taskRef} is done and was not reopened.`);
  const receipt = driver.prepare("SELECT fingerprint FROM task_context_reads WHERE session_id = ? AND task_id = ?")
    .get(input.sessionId, task.id);
  if (receipt?.fingerprint !== read.fingerprint) {
    throw new CommandRefusal("CONTEXT_READ_REQUIRED", "Read the full scoped task context before starting or reclaiming the task.");
  }
  if (ownsActive) return { taskId: task.id, taskRef: read.context.taskRef, title: task.title, alreadyStarted: true, reclaimed: false };
  const other = driver.prepare(`
    SELECT id FROM tasks WHERE project_id = ? AND status = 'in-progress' AND active_owner_session = ? AND id <> ?
  `).get(caller.projectId, input.sessionId, task.id);
  if (other) throw new CommandRefusal("ACTIVE_TASK_CONFLICT", "This session already owns an active task.");

  if (!alreadyStarted) {
    const deviations = driver.prepare(`
      SELECT state FROM work_deviations WHERE project_id = ? AND owner_session = ? AND temporary_task_id = ?
      AND state IN (?, ?)
    `).all(caller.projectId, input.sessionId, task.id, ...ACTIVE_DEVIATION_STATES)
      .map((row) => ({ temporaryTaskId: task.id, state: row.state === "approved" ? "approved" as const : "active" as const }));
    const eligibility = checkExplicitTaskStart(read.plan.features, read.plan.phases, task.id, deviations);
    if (!eligibility.eligible) throw new CommandRefusal("START_NOT_ALLOWED", eligibility.reason);
  }

  const checkpoint = read.context.task.pause_snapshot
    ? TaskPauseSnapshotSchema.parse(JSON.parse(String(read.context.task.pause_snapshot)))
    : null;
  details.startedAt ||= now;
  details.executionActivityAt = now;
  if (!alreadyStarted) {
    details.statusLog = [...(details.statusLog ?? []), {
      id: randomUUID(), date: now, fromStatus: task.status, toStatus: "in-progress",
      title: `${task.status} → in-progress${checkpoint ? " (resume checkpoint)" : ""}`,
      description: checkpoint ? `Resumed from ${checkpoint.resumeLocation}. ${checkpoint.howToResume}` : "",
    }];
  }
  driver.prepare("UPDATE tasks SET status = 'in-progress', active_owner_session = ?, pause_snapshot = NULL, metadata = ?, updated_at = ? WHERE project_id = ? AND id = ?")
    .run(input.sessionId, JSON.stringify(details), now, caller.projectId, task.id);
  recordRevision();
  const impact = reconcileLeafMutation(driver, { projectId: caller.projectId, kind: "task.status", taskId: task.id });
  let parkedTakeover = false;
  if (checkpoint) {
    const taken = driver.prepare(`
      UPDATE work_deviations SET checkpoint = json_set(checkpoint, '$.takenOverAt', ?), updated_at = ?
      WHERE project_id = ? AND resume_task_id = ? AND owner_session NOT IN ('', ?)
      AND state IN ('active', 'resolved', 'resume-required') AND json_extract(checkpoint, '$.takenOverAt') IS NULL
      RETURNING id
    `).all(now, now, caller.projectId, task.id, input.sessionId);
    parkedTakeover = taken.length > 0;
    driver.prepare(`
      UPDATE work_deviations SET state = 'resumed', updated_at = ?
      WHERE project_id = ? AND resume_task_id = ? AND owner_session = ? AND state IN ('resolved', 'resume-required')
    `).run(now, caller.projectId, task.id, input.sessionId);
  }
  const event = parkedTakeover ? "task.parked-taken-over" : tookOver ? "task.taken-over"
    : alreadyStarted ? "task.reclaimed" : checkpoint ? "task.resumed" : "task.started";
  publishEvent(driver, caller.projectId, event, {
    taskId: task.id, impact,
  });
  const refreshed = taskContext(driver, caller.projectId, task.id);
  if (refreshed) driver.prepare("UPDATE task_context_reads SET fingerprint = ? WHERE session_id = ? AND task_id = ?")
    .run(refreshed.fingerprint, input.sessionId, task.id);
  return { taskId: task.id, taskRef: read.context.taskRef, title: task.title, alreadyStarted, reclaimed: alreadyStarted && !tookOver,
    ...(tookOver ? { tookOver: true } : {}), ...(parkedTakeover ? { parkedTakeover: true } : {}), ...(checkpoint ? { checkpoint } : {}) };
}

export interface RegisteredTaskCompletion {
  ref: string;
  sessionId: string;
  requestId: string;
  descriptionUpdate: string;
  force?: boolean | undefined;
  motivation?: string | undefined;
}

export function completeRegisteredTask(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskCompletion) {
  return executeCommand(driver, {
    requestId: input.requestId, projectId: caller.projectId, operation: "task.complete",
    payload: { ref: input.ref, sessionId: input.sessionId, descriptionUpdate: input.descriptionUpdate, force: input.force === true, motivation: input.motivation },
  }, ({ recordRevision }) => {
    const now = new Date().toISOString();
    if (!registeredSessionIsLive(driver, caller, input.sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
    const read = taskContext(driver, caller.projectId, input.ref);
    if (!read) throw new CommandRefusal("TASK_NOT_FOUND", "The task could not be resolved.");
    const { task, phase } = read.target;
    if (read.context.task.pause_snapshot) throw new CommandRefusal("TASK_CHECKPOINT_PENDING", "Resume checkpointed work before completing it.");
    if (task.status !== "in-progress") throw new CommandRefusal("TASK_NOT_IN_PROGRESS", "Only in-progress work can be completed through this command.");
    if (read.owner !== input.sessionId) throw new CommandRefusal("TASK_OWNED_BY_ANOTHER_SESSION", "Only the owning session can complete the task.");
    const summary = input.descriptionUpdate.trim();
    if (summary.length < 10) {
      throw new CommandRefusal("COMPLETION_EVIDENCE_REQUIRED", "Provide at least 10 characters of durable completion and verification evidence.");
    }
    const gate = evaluateTaskCompletionGate(read.context.checklist, input.force === true, input.motivation);
    if (!gate.allowed) {
      if (gate.errorCode === "FORCE_MOTIVATION_REQUIRED") {
        throw new CommandRefusal(gate.errorCode, taskCompletionForceMotivationRequired(gate.uncheckedItems));
      }
      throw new CommandRefusal("CHECKLIST_INCOMPLETE", taskCompletionChecklistRefusal(gate.uncheckedItems, "the checklist toggle operation"));
    }
    const override = taskCompletionOverrideNote(gate.overriddenItems, input.motivation);
    const evidence = override ? `${summary}\n\n${override}` : summary;
    const details = JSON.parse(String(read.context.task.metadata)) as {
      description?: string; startedAt?: string; completedAt?: string; descriptionUpdatedAt?: string; statusLog?: unknown[];
    };
    details.description = [details.description, `**Completion summary:**\n${evidence}`].filter(Boolean).join("\n\n---\n");
    details.startedAt ||= now;
    details.completedAt = now;
    details.descriptionUpdatedAt = now;
    details.statusLog = [...(details.statusLog ?? []), {
      id: randomUUID(), date: now, fromStatus: task.status, toStatus: "done", title: "in-progress → done", description: evidence,
    }];
    driver.prepare("UPDATE tasks SET status = 'done', active_owner_session = '', metadata = ?, updated_at = ? WHERE project_id = ? AND id = ?")
      .run(JSON.stringify(details), now, caller.projectId, task.id);
    const deviation = driver.prepare(`
      SELECT id, resume_task_id, checkpoint FROM work_deviations WHERE project_id = ? AND owner_session = ?
      AND temporary_task_id = ? AND state IN ('approved', 'active') ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(caller.projectId, input.sessionId, task.id);
    let resumeRequired: { taskId: string; taskRef: string; title: string; phaseId: string; snapshot: unknown } | undefined;
    if (deviation) {
      driver.prepare("UPDATE work_deviations SET state = 'resume-required', updated_at = ? WHERE id = ?")
        .run(now, String(deviation.id));
      const resume = findTaskByRef(read.plan.phases, read.plan.features, String(deviation.resume_task_id));
      if (resume) {
        const checkpoint = driver.prepare("SELECT pause_snapshot FROM tasks WHERE project_id = ? AND id = ?")
          .get(caller.projectId, resume.task.id)?.pause_snapshot;
        resumeRequired = {
          taskId: resume.task.id, taskRef: taskCompositeRef(resume.task, resume.phase, read.plan.features),
          title: resume.task.title, phaseId: resume.phase.id, snapshot: JSON.parse(String(checkpoint ?? deviation.checkpoint)),
        };
      }
    }

    recordRevision();
    const impact = reconcileLeafMutation(driver, { projectId: caller.projectId, kind: "task.description", taskId: task.id, descriptionChanged: true });
    const parentStatus = impact.affectedParents.find((parent) => parent.phaseId === phase.id)?.derivedPhaseStatus;
    const archived = parentStatus && ["done", "canceled", "rejected"].includes(parentStatus)
      ? driver.prepare("UPDATE phase_handoffs SET archived = 1, updated_at = ? WHERE project_id = ? AND phase_id = ? AND archived = 0")
        .run(now, caller.projectId, phase.id).changes
      : 0;
    publishEvent(driver, caller.projectId, "task.completed", { taskId: task.id, impact, handoffArchived: archived > 0 });
    return { completed: true, taskId: task.id, taskRef: read.context.taskRef, title: task.title, archivedHandoffs: archived, resumeRequired };
  }, caller);
}

export interface RegisteredTaskPause {
  ref: string;
  sessionId: string;
  requestId: string;
  checkpoint: Pick<TaskPauseSnapshot, "reason" | "whatWasBeingDone" | "resumeLocation" | "howToResume">;
}

export function pauseRegisteredTask(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskPause) {
  return executeCommand(driver, {
    requestId: input.requestId, projectId: caller.projectId, operation: "task.pause",
    payload: { ref: input.ref, sessionId: input.sessionId, checkpoint: input.checkpoint },
  }, ({ recordRevision }) => applyTaskPause(driver, caller, input, recordRevision), caller);
}

function applyTaskPause(
  driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskPause,
  recordRevision: () => void, switchTargetId?: string,
) {
  const now = new Date().toISOString();
  if (!registeredSessionIsLive(driver, caller, input.sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
  const read = taskContext(driver, caller.projectId, input.ref);
  if (!read) throw new CommandRefusal("TASK_NOT_FOUND", "The task could not be resolved.");
  const { task } = read.target;
  if (task.status !== "in-progress") throw new CommandRefusal("TASK_NOT_IN_PROGRESS", "Only in-progress work accepts a pause checkpoint.");
  if (read.owner !== input.sessionId) throw new CommandRefusal("TASK_OWNED_BY_ANOTHER_SESSION", "Only the owning session can pause the task.");
  const checkpoint = TaskPauseSnapshotSchema.parse({ ...input.checkpoint, id: randomUUID(), pausedAt: now, pausedBy: caller.principalId, relatedTaskId: switchTargetId ?? "" });
  const details = JSON.parse(String(read.context.task.metadata)) as { pauseHistory?: unknown[]; statusLog?: unknown[] };
  details.pauseHistory = [...(details.pauseHistory ?? []), checkpoint];
  details.statusLog = [...(details.statusLog ?? []), {
    id: randomUUID(), date: now, fromStatus: "in-progress", toStatus: "planned",
    title: "in-progress → planned (checkpoint saved)",
    description: [
      `Reason: ${checkpoint.reason}`, `What was being done: ${checkpoint.whatWasBeingDone}`,
      `Resume location: ${checkpoint.resumeLocation}`, `How to resume: ${checkpoint.howToResume}`,
    ].join("\n"),
  }];
  driver.prepare("UPDATE tasks SET status = 'planned', active_owner_session = '', pause_snapshot = ?, metadata = ?, updated_at = ? WHERE project_id = ? AND id = ?")
    .run(JSON.stringify(checkpoint), JSON.stringify(details), now, caller.projectId, task.id);
  if (!switchTargetId) driver.prepare("DELETE FROM task_context_reads WHERE session_id = ?").run(input.sessionId);
  const deviation = switchTargetId ? undefined : driver.prepare(`
    SELECT id, resume_task_id FROM work_deviations WHERE project_id = ? AND owner_session = ?
    AND temporary_task_id = ? AND state IN ('approved', 'active') ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(caller.projectId, input.sessionId, task.id);
  if (deviation) driver.prepare("UPDATE work_deviations SET state = 'resume-required', updated_at = ? WHERE id = ?")
    .run(now, String(deviation.id));
  const resume = deviation ? findTaskByRef(read.plan.phases, read.plan.features, String(deviation.resume_task_id)) : undefined;
  const resumeRequired = resume && {
    taskId: resume.task.id, title: resume.task.title, taskRef: taskCompositeRef(resume.task, resume.phase, read.plan.features),
  };
  recordRevision();
  const impact = reconcileLeafMutation(driver, { projectId: caller.projectId, kind: "task.status", taskId: task.id });
  publishEvent(driver, caller.projectId, "task.paused", { taskId: task.id, impact });
  return { paused: true, taskId: task.id, taskRef: read.context.taskRef, title: task.title, snapshot: checkpoint, resumeRequired };
}

export interface RegisteredTaskSwitch extends RegisteredTaskPause {
  toRef: string;
}

export function switchRegisteredTask(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskSwitch) {
  return executeCommand(driver, {
    requestId: input.requestId, projectId: caller.projectId, operation: "task.switch",
    payload: { from: input.ref, to: input.toRef, sessionId: input.sessionId, checkpoint: input.checkpoint },
  }, ({ recordRevision }) => {
    const now = new Date().toISOString();
    if (!registeredSessionIsLive(driver, caller, input.sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
    const source = taskContext(driver, caller.projectId, input.ref);
    const target = taskContext(driver, caller.projectId, input.toRef);
    if (!source || !target) throw new CommandRefusal("TASK_NOT_FOUND", "The source or target task could not be resolved.");
    if (source.target.task.id === target.target.task.id) throw new CommandRefusal("SWITCH_SAME_TASK", "Choose a different target task.");

    recordRevision();
    const paused = applyTaskPause(driver, caller, input, () => {}, target.target.task.id);
    const deviationId = randomUUID();
    driver.prepare(`
      INSERT INTO work_deviations
      (id, project_id, owner_session, state, temporary_task_id, resume_task_id, checkpoint, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(deviationId, caller.projectId, input.sessionId, target.target.task.id, source.target.task.id, JSON.stringify(paused.snapshot), now, now);
    const started = applyTaskStart(driver, caller, { ...input, ref: input.toRef }, () => {});
    driver.prepare("DELETE FROM task_context_reads WHERE session_id = ?").run(input.sessionId);
    publishEvent(driver, caller.projectId, "task.switched", { sourceTaskId: paused.taskId, targetTaskId: started.taskId, deviationId });
    return { switched: true, sourceRef: paused.taskRef, targetRef: started.taskRef, snapshot: paused.snapshot, deviationId,
      ...(started.parkedTakeover ? { parkedTakeover: true } : {}) };
  }, caller);
}

export interface RegisteredChecklistToggle {
  ref: string;
  sessionId: string;
  requestId: string;
  item: string;
  checked?: boolean | undefined;
}

export type RegisteredChecklistMutation = RegisteredChecklistToggle & { action?: "add" | "remove" | undefined };

export function mutateRegisteredChecklist(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredChecklistMutation) {
  const action = input.action ?? "toggle";
  return executeCommand(driver, {
    requestId: input.requestId, projectId: caller.projectId, operation: `task.checklist.${action}`,
    payload: { ref: input.ref, sessionId: input.sessionId, item: input.item, checked: input.checked },
  }, ({ recordRevision }) => {
    if (!registeredSessionIsLive(driver, caller, input.sessionId, new Date().toISOString())) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
    const read = taskContext(driver, caller.projectId, input.ref);
    if (!read) throw new CommandRefusal("TASK_NOT_FOUND", "The task could not be resolved.");
    const checklist = read.context.checklist;
    const taskId = read.target.task.id;
    const item = action === "add" ? addChecklistItem(checklist, taskId, input.item)
      : action === "remove" ? removeChecklistItem(checklist, input.item)
      : toggleChecklistItem(checklist, input.item, input.checked);
    if (!item) throw new CommandRefusal("CHECKLIST_ITEM_NOT_FOUND", `Checklist item not found: ${input.item}`);
    if (action === "add") {
      if (checklist.some(({ id }) => id === item.id)) item.id = randomUUID();
      driver.prepare("INSERT INTO task_checklists (task_id, item_id, text, checked) VALUES (?, ?, ?, 0)")
        .run(taskId, item.id, item.title);
    } else if (action === "remove") {
      driver.prepare("DELETE FROM task_checklists WHERE task_id = ? AND item_id = ?").run(taskId, item.id);
    } else {
      driver.prepare("UPDATE task_checklists SET checked = ? WHERE task_id = ? AND item_id = ?")
        .run(Number(item.checked), taskId, item.id);
    }
    const now = new Date().toISOString();
    driver.prepare(`
      UPDATE tasks SET updated_at = ?, metadata = CASE WHEN active_owner_session = ?
      THEN json_set(metadata, '$.executionActivityAt', ?) ELSE metadata END WHERE project_id = ? AND id = ?
    `).run(now, input.sessionId, now, caller.projectId, taskId);
    recordRevision();
    publishEvent(driver, caller.projectId, "task.checklist.changed", { taskId, itemId: item.id, checked: item.checked, action });
    const label = `C${item.number} "${item.title}"`;
    const message = action === "add" ? `Added ${label} (${checklist.length + 1} items)`
      : action === "remove" ? `Removed ${label} (${checklist.length} items left)`
      : `${label} → ${item.checked ? "done" : "open"}`;
    return { updated: true, taskId, item, message };
  }, caller);
}

export interface RegisteredTaskReopen {
  ref: string;
  sessionId: string;
  requestId: string;
  confirmed: boolean;
}

export function releaseRegisteredTask(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskReopen) {
  return executeCommand(driver, {
    requestId: input.requestId, projectId: caller.projectId, operation: "task.release",
    payload: { ref: input.ref, sessionId: input.sessionId, confirmed: input.confirmed },
  }, ({ recordRevision }) => {
    const now = new Date().toISOString();
    if (!registeredSessionIsLive(driver, caller, input.sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live browser session is required.");
    if (!input.confirmed) throw new CommandRefusal("TASK_RELEASE_CONFIRMATION_REQUIRED", "Confirm that you want to release this task.");
    const read = taskContext(driver, caller.projectId, input.ref);
    if (!read) throw new CommandRefusal("TASK_NOT_FOUND", "The task could not be resolved.");
    const { task } = read.target;
    if (task.status !== "in-progress") throw new CommandRefusal("TASK_NOT_IN_PROGRESS", "This task has no execution claim to release.");
    const ownerId = String(read.owner);
    const owner = driver.prepare("SELECT ended_at, expires_at FROM project_sessions WHERE project_id = ? AND id = ?")
      .get(caller.projectId, ownerId);
    const details = JSON.parse(String(read.context.task.metadata)) as { executionActivityAt?: string; statusLog?: unknown[] };
    const state = taskExecutionState(owner, details.executionActivityAt ?? read.context.task.updated_at, now);
    if (state !== "idle" && state !== "abandoned" && ownerId !== input.sessionId) {
      throw new CommandRefusal("TASK_RELEASE_OWNER_ACTIVE", "The other session's execution claim is still active.");
    }
    details.statusLog = [...(details.statusLog ?? []), {
      id: randomUUID(), date: now, fromStatus: "in-progress", toStatus: "planned",
      title: "in-progress → planned (claim released)",
      description: "The dashboard user explicitly released the execution claim.",
    }];
    driver.prepare("UPDATE tasks SET status = 'planned', active_owner_session = '', metadata = ?, updated_at = ? WHERE project_id = ? AND id = ?")
      .run(JSON.stringify(details), now, caller.projectId, task.id);
    driver.prepare("DELETE FROM task_context_reads WHERE task_id = ?").run(task.id);
    driver.prepare(`
      UPDATE work_deviations SET state = 'resume-required', updated_at = ? WHERE project_id = ? AND owner_session = ?
      AND temporary_task_id = ? AND state IN ('approved', 'active')
    `).run(now, caller.projectId, ownerId, task.id);
    recordRevision();
    const impact = reconcileLeafMutation(driver, { projectId: caller.projectId, kind: "task.status", taskId: task.id });
    publishEvent(driver, caller.projectId, "task.released", { taskId: task.id, impact });
    return { released: true, taskId: task.id, taskRef: read.context.taskRef };
  }, caller);
}

export function reopenRegisteredTask(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskReopen) {
  return executeCommand(driver, {
    requestId: input.requestId, projectId: caller.projectId, operation: "task.reopen",
    payload: { ref: input.ref, sessionId: input.sessionId, confirmed: input.confirmed },
  }, ({ recordRevision }) => {
    const now = new Date().toISOString();
    if (!registeredSessionIsLive(driver, caller, input.sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
    if (!input.confirmed) throw new CommandRefusal("TASK_REOPEN_CONFIRMATION_REQUIRED", "Task reopening requires explicit confirmation.");
    const read = taskContext(driver, caller.projectId, input.ref);
    if (!read) throw new CommandRefusal("TASK_NOT_FOUND", "The task could not be resolved.");
    const { task } = read.target;
    if (task.status !== "done") throw new CommandRefusal("TASK_REOPEN_NOT_DONE", "Only completed tasks can be reopened.");
    const other = driver.prepare(`
      SELECT id FROM tasks WHERE project_id = ? AND status = 'in-progress' AND active_owner_session = ?
    `).get(caller.projectId, input.sessionId);
    if (other) throw new CommandRefusal("ACTIVE_TASK_CONFLICT", "This session already owns an active task.");

    const details = JSON.parse(String(read.context.task.metadata)) as { completedAt?: string; executionActivityAt?: string; statusLog?: unknown[] };
    details.completedAt = "";
    details.executionActivityAt = now;
    details.statusLog = [...(details.statusLog ?? []), {
      id: randomUUID(), date: now, fromStatus: "done", toStatus: "in-progress",
      title: "done → in-progress (reopened)",
      description: "Reopened through the confirmed lifecycle operation; prior completion evidence is retained.",
    }];
    driver.prepare("UPDATE tasks SET status = 'in-progress', active_owner_session = ?, pause_snapshot = NULL, metadata = ?, updated_at = ? WHERE project_id = ? AND id = ?")
      .run(input.sessionId, JSON.stringify(details), now, caller.projectId, task.id);
    recordRevision();
    const impact = reconcileLeafMutation(driver, { projectId: caller.projectId, kind: "task.status", taskId: task.id });
    publishEvent(driver, caller.projectId, "task.reopened", { taskId: task.id, impact });
    return { reopened: true, taskId: task.id, taskRef: read.context.taskRef, title: task.title };
  }, caller);
}

export interface RegisteredTaskRecovery {
  ref: string;
  sessionId: string;
  requestId: string;
  confirmed: boolean;
}

export function recoverRegisteredTaskSession(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskRecovery) {
  return executeCommand(driver, {
    requestId: input.requestId, projectId: caller.projectId, operation: "task.session.recover",
    payload: { ref: input.ref, sessionId: input.sessionId, confirmed: input.confirmed },
  }, ({ recordRevision }) => {
    const now = new Date().toISOString();
    if (!registeredSessionIsLive(driver, caller, input.sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
    if (!input.confirmed) throw new CommandRefusal("SESSION_RECOVERY_CONFIRMATION_REQUIRED", "Session recovery requires explicit confirmation.");
    const read = taskContext(driver, caller.projectId, input.ref);
    if (!read) throw new CommandRefusal("TASK_NOT_FOUND", "The task could not be resolved.");
    const taskId = read.target.task.id;
    const pending = "state IN ('approved', 'active', 'resume-required', 'resolved')";
    const candidates = new Set(driver.prepare(`
      SELECT owner_session FROM work_deviations
      WHERE project_id = ? AND (temporary_task_id = ? OR resume_task_id = ?) AND ${pending} AND owner_session <> ''
    `).all(caller.projectId, taskId, taskId).map((row) => String(row.owner_session)));
    if (typeof read.owner === "string" && read.owner) candidates.add(read.owner);
    const owner = candidates.values().next().value;
    if (!owner || candidates.size !== 1 || owner === input.sessionId) {
      throw new CommandRefusal("SESSION_OWNER_UNVERIFIED", "The task does not identify one recoverable prior session.");
    }
    const previous = driver.prepare(`
      SELECT old.expires_at, old.ended_at FROM project_sessions old JOIN project_sessions current ON current.id = ?
      WHERE old.id = ? AND old.project_id = ? AND old.workspace_id = ? AND old.principal_id = ?
      AND old.client_kind = current.client_kind
    `).get(input.sessionId, owner, caller.projectId, caller.workspaceId, caller.principalId);
    if (!previous) throw new CommandRefusal("SESSION_OWNER_UNVERIFIED", "The prior session is outside this caller's recovery scope.");
    if (!previous.ended_at && String(previous.expires_at) > now) {
      throw new CommandRefusal("SESSION_OWNER_ACTIVE", "The prior session still holds a live lease.");
    }
    const existingClaim = driver.prepare("SELECT id FROM tasks WHERE project_id = ? AND active_owner_session = ? LIMIT 1")
      .get(caller.projectId, input.sessionId);
    const existingReturn = driver.prepare(`SELECT id FROM work_deviations WHERE project_id = ? AND owner_session = ? AND ${pending} LIMIT 1`)
      .get(caller.projectId, input.sessionId);
    if (existingClaim || existingReturn) throw new CommandRefusal("ACTIVE_TASK_CONFLICT", "Recovery requires a session without active tasks or pending returns.");

    const taskIds = driver.prepare(`
      UPDATE tasks SET active_owner_session = ? WHERE project_id = ? AND active_owner_session = ? RETURNING id
    `).all(input.sessionId, caller.projectId, owner).map((row) => String(row.id));
    const deviationIds = driver.prepare(`
      UPDATE work_deviations SET owner_session = ?, updated_at = ?
      WHERE project_id = ? AND owner_session = ? AND ${pending} RETURNING id
    `).all(input.sessionId, now, caller.projectId, owner).map((row) => String(row.id));
    driver.prepare("DELETE FROM task_context_reads WHERE session_id = ?").run(input.sessionId);
    recordRevision();
    publishEvent(driver, caller.projectId, "task.session.recovered", { taskIds, deviationIds });
    return { recovered: true, taskIds, deviationIds };
  }, caller);
}
