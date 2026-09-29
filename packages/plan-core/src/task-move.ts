/**
 * Move one or more tasks to a different phase without recreating them.
 *
 * Before this, moving a task meant deleting it and creating a new one in
 * the target phase — losing its id, statusLog, checklist ticks, accepted
 * decisions, pause history, and every dependsOn edge pointing at it (see
 * P108(F005): heca's P082(F003)/T468, T470, T471, T472, T513 are on hold
 * until work in P094 lands, but belong in P094 as its closing steps, and
 * recreating five ~4,000-character tasks loses all of that history). This
 * module is the one place that moves a task: only `phaseId`, `statusLog`
 * (one appended entry) and `updatedAt` change. Everything else — id,
 * number, shortId, status, checklist, subtasks, acceptedDecisions,
 * pauseSnapshot/pauseHistory, notes, description/descriptionRef and
 * dependsOn — survives untouched because the task object is spread, never
 * rebuilt field by field. Other tasks' dependsOn keep resolving because
 * task ids never change; only the composite ref they'd print as changes.
 *
 * Reply size is deliberately independent of task size: a moved task's
 * description can be tens of thousands of characters, and a caller moving
 * five tasks already has that text — it must not pay to receive it again.
 * buildTaskMoveReply (below) echoes only ref/id/shortId/title/status per
 * task, never the task body.
 *
 * Both phase files change together or neither: this runs inside
 * `store.runBatch` and mirrors the rollback-on-error shape the MCP/Pi
 * `planner-task-switch` / `task_switch` tools already use for a two-phase
 * write (pause a task in one phase, start one in another) — collect the
 * exact task objects removed from each source phase, and if any later step
 * throws, add them straight back rather than reconstructing the phase's
 * task array (which could clobber a concurrent unrelated write to that
 * file).
 */
import type { PlanStore } from "./plan-store.js";
import type { Feature, Phase, Task } from "./schema.js";
import { createStatusLogEntryId, featureNumberOfPhase, formatPhaseRef, formatThreeDigitNumber } from "./naming.js";
import type { MutationReply } from "./mutation-reply.js";

export type MoveTasksErrorCode =
  | "NO_TASKS_GIVEN"
  | "TARGET_PHASE_NOT_FOUND"
  | "TASK_NOT_FOUND"
  | "SOURCE_EQUALS_TARGET"
  | "TARGET_PHASE_TERMINAL";

/** Phase statuses a task cannot be moved into. Same terminal set as tasks
 *  (done/canceled/rejected) — a terminal phase is meant to stay closed. */
const TERMINAL_PHASE_STATUSES = new Set(["done", "canceled", "rejected"]);

/** One moved task, named only by ref/identity — never its description,
 *  checklist, statusLog or any other field a caller already has. */
export interface TaskMoveSummary {
  taskId: string;
  shortId: string;
  title: string;
  status: string;
  oldRef: string;
  newRef: string;
}

export interface MoveTasksResult {
  targetPhaseRef: string;
  moves: TaskMoveSummary[];
  /** Refs of source phases that had a pending handoff at the time of the
   *  move. A handoff is free prose and may name the moved task by ref; it
   *  is NOT rewritten here (see buildTaskMoveReply — the reply just flags
   *  it so a caller knows to check). */
  sourcePhaseRefsWithHandoff: string[];
}

export type MoveTasksOutcome =
  | { ok: true; result: MoveTasksResult }
  | { ok: false; errorCode: MoveTasksErrorCode; error: string };

function taskRef(task: Task, phase: Phase, features: Feature[]): string {
  return `${formatPhaseRef(phase.number, featureNumberOfPhase(phase, features))}/T${formatThreeDigitNumber(task.number)}`;
}

/**
 * Move `taskIds` (task UUIDs, already resolved by the caller) into
 * `targetPhaseId` (a phase UUID). Validates target-exists, source != target
 * per task, and refuses a terminal target phase — a terminal phase is
 * closed, and reopening it by dropping new work in is not this operation's
 * job (accepted decision on P108(F005)/T443: no override flag; unlink or
 * reopen the phase first). An in-progress task MAY move; the reply says so.
 */
export async function moveTasks(
  store: PlanStore,
  taskIds: string[],
  targetPhaseId: string,
  timestamp = new Date().toISOString(),
): Promise<MoveTasksOutcome> {
  const uniqueTaskIds = [...new Set(taskIds)];
  if (uniqueTaskIds.length === 0) {
    return { ok: false, errorCode: "NO_TASKS_GIVEN", error: "No task ids given to move." };
  }

  return store.runBatch(async (): Promise<MoveTasksOutcome> => {
    const [phases, featuresDoc] = await Promise.all([store.loadAllPhases(), store.loadFeatures()]);
    const features = featuresDoc.features;

    const targetPhase = phases.find((phase) => phase.id === targetPhaseId);
    if (!targetPhase) {
      return { ok: false, errorCode: "TARGET_PHASE_NOT_FOUND", error: `Target phase not found: ${targetPhaseId}` };
    }
    if (TERMINAL_PHASE_STATUSES.has(targetPhase.status)) {
      const targetRef = formatPhaseRef(targetPhase.number, featureNumberOfPhase(targetPhase, features));
      return {
        ok: false,
        errorCode: "TARGET_PHASE_TERMINAL",
        error: `Target phase ${targetRef} is ${targetPhase.status}; cannot move tasks into a terminal phase.`,
      };
    }
    const targetPhaseRef = formatPhaseRef(targetPhase.number, featureNumberOfPhase(targetPhase, features));

    const allTasks = phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));
    const located: Array<{ phase: Phase; task: Task }> = [];
    for (const taskId of uniqueTaskIds) {
      const hit = allTasks.find((entry) => entry.task.id === taskId);
      if (!hit) return { ok: false, errorCode: "TASK_NOT_FOUND", error: `Task not found: ${taskId}` };
      if (hit.phase.id === targetPhaseId) {
        return {
          ok: false,
          errorCode: "SOURCE_EQUALS_TARGET",
          error: `Task ${taskRef(hit.task, hit.phase, features)} is already in ${targetPhaseRef}.`,
        };
      }
      located.push(hit);
    }

    // Group by source phase so a multi-source move removes each phase's
    // tasks in one write, and rollback restores exactly what was removed.
    const bySourcePhase = new Map<string, { phase: Phase; tasks: Task[] }>();
    for (const entry of located) {
      const bucket = bySourcePhase.get(entry.phase.id) ?? { phase: entry.phase, tasks: [] };
      bucket.tasks.push(entry.task);
      bySourcePhase.set(entry.phase.id, bucket);
    }

    const writtenSourcePhaseIds: string[] = [];
    const summaries: TaskMoveSummary[] = [];
    const sourcePhaseRefsWithHandoff = [...bySourcePhase.values()]
      .filter((bucket) => bucket.phase.handoff !== "")
      .map((bucket) => formatPhaseRef(bucket.phase.number, featureNumberOfPhase(bucket.phase, features)));
    try {
      for (const [sourcePhaseId, bucket] of bySourcePhase) {
        const idsToRemove = new Set(bucket.tasks.map((task) => task.id));
        await store.updatePhase(sourcePhaseId, (phase) => {
          phase.tasks = phase.tasks.filter((task) => !idsToRemove.has(task.id));
          return phase;
        });
        writtenSourcePhaseIds.push(sourcePhaseId);
      }

      const movedTasks: Task[] = located.map(({ phase: sourcePhase, task }) => {
        const oldRef = taskRef(task, sourcePhase, features);
        const newRef = `${targetPhaseRef}/T${formatThreeDigitNumber(task.number)}`;
        summaries.push({ taskId: task.id, shortId: task.shortId, title: task.title, status: task.status, oldRef, newRef });
        return {
          ...task,
          phaseId: targetPhaseId,
          statusLog: [...task.statusLog, {
            id: createStatusLogEntryId(),
            date: timestamp,
            fromStatus: task.status,
            toStatus: task.status,
            title: `moved ${oldRef} → ${newRef}`,
            description: `Moved from ${oldRef} to ${newRef}; status unchanged.`,
          }],
          updatedAt: timestamp,
        };
      });

      await store.updatePhase(targetPhaseId, (phase) => {
        phase.tasks = [...phase.tasks, ...movedTasks];
        return phase;
      });
    } catch (error) {
      // Roll back every source phase already written. Add the ORIGINAL task
      // objects back rather than restoring a whole array snapshot, so a
      // concurrent unrelated write to the same file (another task added or
      // edited while this move was in flight) is not clobbered.
      for (const sourcePhaseId of writtenSourcePhaseIds) {
        const bucket = bySourcePhase.get(sourcePhaseId);
        if (!bucket) continue;
        await store.updatePhase(sourcePhaseId, (phase) => {
          phase.tasks = [...phase.tasks, ...bucket.tasks];
          return phase;
        }).catch(() => {});
      }
      throw error;
    }

    // Roll up derived status the same way every other task mutation does:
    // a phase whose task count just changed may have crossed into or out of
    // a terminal status (handoff archiving, phase/feature statusLog, resume
    // refresh all live in syncTaskStatusRollup — callers must not reimplement
    // them). Every touched phase gets it, not just the target.
    for (const sourcePhaseId of writtenSourcePhaseIds) {
      await store.syncTaskStatusRollup(sourcePhaseId);
    }
    await store.syncTaskStatusRollup(targetPhaseId);

    await store.writeGenerated();

    // Prove it happened: re-read from disk rather than trusting the
    // in-memory write — same discipline as deleteFeatureCascade.
    const persistedTarget = await store.loadPhase(targetPhaseId);
    const persistedIds = new Set(persistedTarget.tasks.map((task) => task.id));
    if (summaries.some((move) => !persistedIds.has(move.taskId))) {
      return { ok: false, errorCode: "TASK_NOT_FOUND", error: `Task move did not persist to ${targetPhaseRef}.` };
    }

    return { ok: true, result: { targetPhaseRef, moves: summaries, sourcePhaseRefsWithHandoff } };
  });
}

/** Cap on how many moved tasks a reply names individually. Moving one task
 *  or a handful (the documented case) always prints every ref; a very large
 *  batch degrades to a count rather than growing the reply without bound. */
const MAX_TASK_MOVE_REPLY_ITEMS = 20;

/**
 * The one reply planner-task-move / task_move return. Deliberately NOT
 * built with buildMutationReply: that helper echoes one entity's changed
 * field values, and the only value that changed here — phaseId — is not
 * something a caller refers to directly. What a caller needs per task is
 * its old ref, its new ref, and enough identity (id/shortId/title/status)
 * to confirm it moved — never the description, checklist or statusLog it
 * already has and did not ask to resend.
 */
export function buildTaskMoveReply(result: MoveTasksResult, readBackCommand: string): MutationReply {
  const shown = result.moves.slice(0, MAX_TASK_MOVE_REPLY_ITEMS);
  const omitted = result.moves.length - shown.length;
  const lines = shown.map((move) => `${move.oldRef} → ${move.newRef} — ${move.title} [${move.status}]${move.shortId ? ` · ${move.shortId}` : ""}`);
  const handoffNotice = result.sourcePhaseRefsWithHandoff.length > 0
    ? [`⚠️ Pending handoff on ${result.sourcePhaseRefsWithHandoff.join(", ")} may reference the moved task(s) by ref; it is prose and was not rewritten — check it.`]
    : [];
  const text = [
    `✅ Moved ${result.moves.length} task(s) to ${result.targetPhaseRef}:`,
    ...lines,
    ...(omitted > 0 ? [`(+${omitted} more)`] : []),
    ...handoffNotice,
    `Read back: ${readBackCommand}`,
  ].join("\n");
  const structured: Record<string, unknown> = {
    moved: true,
    targetPhaseRef: result.targetPhaseRef,
    moves: shown.map((move) => ({ id: move.taskId, shortId: move.shortId, title: move.title, status: move.status, oldRef: move.oldRef, newRef: move.newRef })),
    ...(omitted > 0 ? { omittedMoves: omitted } : {}),
    ...(result.sourcePhaseRefsWithHandoff.length > 0 ? { sourcePhaseRefsWithHandoff: result.sourcePhaseRefsWithHandoff } : {}),
    readBack: readBackCommand,
  };
  return { text, structured };
}
