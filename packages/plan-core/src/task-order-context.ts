/**
 * Where a single task sits in its phase's priority order — the fact
 * `planner-task-show` / `task_get` (full view) was missing.
 *
 * P104(F005)/T421: `planner-task-list` already renders priority, and
 * `.planner/SKILL.md` already says "follow the lowest visible ready
 * priority", but the full task view showed neither the task's own priority
 * nor its dependencies. An agent reading one task in full had no data to
 * apply the rule with — it had to make a second call (task_recommend) or
 * guess from prose. This puts the same ordering fact the recommender
 * computes at the point an agent reads the task and decides what to do
 * next, so asking again is unnecessary in the common case. Adding another
 * reminder sentence was explicitly rejected: the rule already existed and
 * did not prevent the failure this task was opened from.
 *
 * Readiness here mirrors only the task-level half of task-selection.ts's
 * `ready` filter (status planned, every dependency done) — not the
 * phase/feature hardUnavailable check, which is the global recommender's
 * concern and not something a single task's own read needs to reevaluate.
 *
 * Placed in plan-core per AGENTS.md rule 4: both `planner-task-show` (MCP)
 * and `task_get` (Pi) render the identical line and structured fields from
 * here, the same way handoff-reply.ts / mutation-reply.ts / recommend-reply.ts
 * already do for their tools.
 */
import type { Feature, Phase, Task, TaskStatus } from "./schema.js";
import { featureNumberOfPhase, formatPhaseRef } from "./naming.js";

const TERMINAL_STATUSES: readonly TaskStatus[] = ["done", "canceled", "rejected"];

/** One dependency, resolved to its composite ref and current status, so a
 * caller can tell "blocked" from "done" without a second read per id. */
export interface TaskOrderDependency {
  ref: string;
  taskId: string;
  status: TaskStatus;
}

export interface TaskOrderContext {
  /** The task's own priority (falls back to its number, same convention as
   * buildPhaseWorkMap / task-selection.ts, for a task with none explicitly set). */
  priority: number;
  /** False for a terminal task: ordering no longer applies, so the
   * ready-count fields below are omitted rather than shown stale. */
  ordersApply: boolean;
  /** Sibling tasks in this task's own phase that are ready to start now:
   * status planned, every dependency done. */
  readyCount: number;
  /** Ready siblings that come before this one in priority order. Zero for
   * the first task in the phase, regardless of whether this task itself is ready. */
  readyAheadCount: number;
  /** Ref of the ready sibling that would be picked first, present only when
   * it differs from this task — i.e. only when this task is not already the
   * one to start next. */
  nextByPriorityRef: string | null;
  dependsOn: TaskOrderDependency[];
}

function taskPriority(task: Pick<Task, "priority" | "number">): number {
  return task.priority ?? task.number;
}

function compareByPriority(left: Pick<Task, "priority" | "number">, right: Pick<Task, "priority" | "number">): number {
  return taskPriority(left) - taskPriority(right) || left.number - right.number;
}

function isTaskReady(task: Task, statusById: Map<string, TaskStatus>): boolean {
  if (task.status !== "planned") return false;
  return (task.dependsOn ?? []).every((id) => statusById.get(id) === "done");
}

/**
 * Build the ordering context for one task. `allPhases` and `features` are
 * needed (not just the task's own phase) because a dependency can name a
 * task in a different phase (see PlanStore.addTaskDependency, which allows
 * any project-wide target) and its composite ref/status must resolve
 * project-wide, not just among siblings.
 */
export function buildTaskOrderContext(
  task: Task,
  phase: Phase,
  allPhases: Phase[],
  features: Feature[],
): TaskOrderContext {
  const statusById = new Map<string, TaskStatus>();
  const refById = new Map<string, string>();
  for (const candidatePhase of allPhases) {
    const phaseRef = formatPhaseRef(candidatePhase.number, featureNumberOfPhase(candidatePhase, features));
    for (const candidateTask of candidatePhase.tasks ?? []) {
      statusById.set(candidateTask.id, candidateTask.status);
      refById.set(candidateTask.id, `${phaseRef}/T${String(candidateTask.number).padStart(3, "0")}`);
    }
  }

  const siblings = phase.tasks ?? [];
  const readySiblings = siblings.filter((sibling) => isTaskReady(sibling, statusById)).sort(compareByPriority);
  const ordersApply = !TERMINAL_STATUSES.includes(task.status);
  const readyAheadCount = ordersApply
    ? readySiblings.filter((sibling) => sibling.id !== task.id && compareByPriority(sibling, task) < 0).length
    : 0;
  const topReady = readySiblings[0];
  const nextByPriorityRef = ordersApply && topReady && topReady.id !== task.id
    ? (refById.get(topReady.id) ?? null)
    : null;

  const dependsOn: TaskOrderDependency[] = (task.dependsOn ?? []).map((id) => ({
    ref: refById.get(id) ?? id,
    taskId: id,
    status: statusById.get(id) ?? "planned",
  }));

  return {
    priority: taskPriority(task),
    ordersApply,
    readyCount: readySiblings.length,
    readyAheadCount,
    nextByPriorityRef,
    dependsOn,
  };
}

/** One line for the human-readable channel of the full task view: the exact
 * shape both adapters render, so the fact is never assembled twice. Bounded
 * by construction — a count, a priority number and a short dependency list,
 * never the entities themselves. */
export function taskOrderContextLine(context: TaskOrderContext, status: TaskStatus): string {
  const depsText = context.dependsOn.length > 0
    ? context.dependsOn.map((dependency) => `${dependency.ref} (${dependency.status})`).join(", ")
    : "None";
  if (!context.ordersApply) {
    return `Priority ${context.priority} (${status}; ordering no longer applies). Depends on: ${depsText}.`;
  }
  const parts = [
    `Priority ${context.priority}`,
    `${context.readyCount} ready in phase`,
    `${context.readyAheadCount} ready ahead of this one`,
  ];
  if (context.nextByPriorityRef) parts.push(`next by priority: ${context.nextByPriorityRef}`);
  return `${parts.join(" · ")}. Depends on: ${depsText}.`;
}

/** The fact a task-creation confirmation must state: where in the phase's
 * priority order the planner placed the new task. Centralized so the two
 * otherwise differently-worded adapter confirmations never diverge on how
 * this fragment reads (see P104(F005)/T421 — eight tasks were created in
 * this phase without a priority ever being shown). */
export function taskCreatedPriorityFragment(priority: number): string {
  return `priority ${priority}`;
}
