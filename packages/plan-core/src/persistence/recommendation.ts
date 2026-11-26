import { prepareWorkDeviation, type RecordDeviationInput } from "../deviation-flow.js";
import { buildRecommendationReply } from "../recommend-reply.js";
import { TaskPauseSnapshotSchema, WorkDeviationSchema, type Phase } from "../schema.js";
import { recommendNextWork } from "../task-selection.js";
import { readRegisteredBoard } from "./board.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import { readRegisteredHandoffs } from "./handoffs.js";
import { resolveProjectCaller, type ProjectCaller } from "./project-access.js";
import { registeredSessionIsLive } from "./task-execution.js";

export function recommendRegisteredWork(driver: PersistenceDriver, caller: ProjectCaller, sessionId: string) {
  return driver.runExclusive(() => {
    if (!resolveProjectCaller(driver, caller)) return { kind: "forbidden" } as const;
    const { projectId, workspaceId } = caller;
    if (!registeredSessionIsLive(driver, caller, sessionId, new Date().toISOString())) return { kind: "expired" } as const;
    const board = readRegisteredBoard(driver, projectId, workspaceId);
    if (!board) return { kind: "forbidden" } as const;
    const { phases, deviations } = readRecommendationState(driver, projectId, sessionId, board.phases);
    const result = recommendNextWork(board.features, phases, deviations, "", sessionId, {
      handoffs: readRegisteredHandoffs(driver, projectId, false),
      archivedHandoffs: readRegisteredHandoffs(driver, projectId, true),
    });
    return { kind: "recommendation", reply: buildRecommendationReply(result, board.features) } as const;
  });
}

const deviationApprovalSchema = WorkDeviationSchema.pick({ recommendedTaskId: true, reason: true });

function readRecommendationState(driver: PersistenceDriver, projectId: string, sessionId: string, sourcePhases: Phase[]) {
  const owned = new Set(driver.prepare(`
    SELECT id FROM tasks WHERE project_id = ? AND status = 'in-progress' AND active_owner_session = ?
  `).all(projectId, sessionId).map(({ id }) => String(id)));
  const phases = sourcePhases.map((phase) => ({
    ...phase, tasks: phase.tasks.map((task) => ({ ...task, activeOwnerSession: owned.has(task.id) ? sessionId : "" })),
  }));
  const deviations = driver.prepare(`
    SELECT id, owner_session, state, temporary_task_id, resume_task_id, checkpoint, created_at
    FROM work_deviations WHERE project_id = ? AND state IN ('approved', 'active', 'resume-required', 'resolved')
    ORDER BY created_at DESC, id DESC
  `).all(projectId).map((row) => {
    const stored: unknown = JSON.parse(String(row.checkpoint));
    const checkpoint = TaskPauseSnapshotSchema.safeParse(stored);
    const approval = deviationApprovalSchema.safeParse(stored);
    return WorkDeviationSchema.parse({
      id: row.id, ownerSession: row.owner_session === sessionId ? sessionId : row.owner_session ? "other" : "",
      state: row.state, recommendedTaskId: approval.success ? approval.data.recommendedTaskId : row.resume_task_id, temporaryTaskId: row.temporary_task_id,
      resumeTaskId: row.resume_task_id, createdAt: row.created_at,
      snapshot: checkpoint.success ? checkpoint.data : null, reason: approval.success ? approval.data.reason : checkpoint.success ? checkpoint.data.reason : "",
    });
  });
  return { phases, deviations };
}

export interface RegisteredTaskDeviation extends RecordDeviationInput {
  requestId: string;
  sessionId: string;
}

export function recordRegisteredTaskDeviation(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredTaskDeviation) {
  return executeCommand(driver, {
    requestId: input.requestId, projectId: caller.projectId, operation: "task.deviation",
    payload: { temporaryTask: input.temporaryTask, resumeTask: input.resumeTask, reason: input.reason, sessionId: input.sessionId },
  }, ({ recordRevision }) => {
    const now = new Date().toISOString();
    if (!registeredSessionIsLive(driver, caller, input.sessionId, now)) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required.");
    const board = readRegisteredBoard(driver, caller.projectId, caller.workspaceId);
    if (!board) throw new CommandRefusal("PROJECT_NOT_FOUND", "The registered project could not be resolved.");
    const selection = readRecommendationState(driver, caller.projectId, input.sessionId, board.phases);
    const outcome = prepareWorkDeviation(board.features, selection.phases, selection.deviations, undefined, input.sessionId, input);
    if (!outcome.ok) {
      throw new CommandRefusal(outcome.code, outcome.message, {
        taskId: outcome.taskId, temporaryStatus: outcome.temporaryStatus, selectionReason: outcome.selectionReason,
      });
    }
    const { id, temporaryTaskId, resumeTaskId, recommendedTaskId, reason, createdAt } = outcome.deviation;
    driver.prepare(`
      INSERT INTO work_deviations
      (id, project_id, owner_session, state, temporary_task_id, resume_task_id, checkpoint, created_at, updated_at)
      VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?)
    `).run(id, caller.projectId, input.sessionId, temporaryTaskId, resumeTaskId, JSON.stringify({ recommendedTaskId, reason }), createdAt, createdAt);
    recordRevision();
    publishEvent(driver, caller.projectId, "task.deviation.approved", { deviationId: id, temporaryTaskId, resumeTaskId });
    return outcome;
  }, caller);
}
