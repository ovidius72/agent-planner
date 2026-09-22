/**
 * Which in-progress phases still have work left, in priority order — the
 * fact `planner-show` / `plan_get`, the planner-load recap, and `task_start`
 * / `planner-task-start` were all missing.
 *
 * P104(F005)/T422: `task_switch` / `planner-task-switch` and `task_deviation`
 * / `planner-task-deviation` both protect an *in-flight task* by
 * checkpointing it with a return target. Neither helps when nothing was in
 * flight — a phase's last started task simply finished (or one was never
 * started) and the phase itself was left at status in-progress. Nothing
 * else says "this phase is still open and has ready work" anywhere cheap to
 * read, so it goes unnoticed while work continues in a lower-priority phase.
 *
 * This computes the fact once: every in-progress phase with work left,
 * priority order, and — separately — how much of that work is actually
 * startable right now (not blocked, not already claimed by an active task).
 * `planner-show` / `plan_get` and the recap render the bounded listing;
 * `task_start` uses the same computation to name the specific
 * higher-priority phase a caller is about to leave open. Same shape as
 * task-order-context.ts (T421): a fact placed at the decision point, not a
 * reminder sentence.
 *
 * Placed in plan-core per AGENTS.md rule 4: both adapters render the
 * identical listing and advisory from here.
 */
import type { Feature, Phase, Task, TaskStatus } from "./schema.js";
import { featureNumberOfPhase, formatPhaseRef } from "./naming.js";

const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["done", "canceled", "rejected"];
const HARD_UNAVAILABLE_STATUSES = new Set(["blocked", "deferred", "canceled", "rejected"]);

/** Bound on how many phases the human-readable listing names before folding
 * the rest into a count — a line per phase, not a phase dump (P104(F005)/T419). */
export const OPEN_PHASE_WORK_LIST_LIMIT = 5;

function phasePriority(phase: Pick<Phase, "priority" | "number">): number {
  return phase.priority ?? phase.number;
}

function compareByPhasePriority(left: Pick<Phase, "priority" | "number">, right: Pick<Phase, "priority" | "number">): number {
  return phasePriority(left) - phasePriority(right) || left.number - right.number;
}

/** One in-progress phase with work left: enough to name it and say how much
 * of that work is actually startable right now. */
export interface OpenPhaseWork {
  phaseId: string;
  ref: string;
  title: string;
  priority: number;
  /** Tasks in this phase that are planned with every dependency done —
   * startable now. Zero means the remaining work is blocked or already
   * claimed by an active task, which is never itself a reason to switch
   * here (see the recommender's own `ready` filter in task-selection.ts). */
  readyTaskCount: number;
}

function isReadyTask(task: Task, statusById: Map<string, TaskStatus>): boolean {
  if (task.status !== "planned") return false;
  return task.dependsOn.every((id) => statusById.get(id) === "done");
}

/**
 * Every in-progress phase with at least one non-terminal task, in priority
 * order. `readyTaskCount` mirrors the task-level half of task-selection.ts's
 * `ready` filter plus its feature-level hard-unavailable check (a phase is
 * never itself hard-unavailable here — it is already status in-progress).
 */
export function listOpenPhaseWork(phases: Phase[], features: Feature[]): OpenPhaseWork[] {
  const statusById = new Map<string, TaskStatus>();
  for (const phase of phases) {
    for (const task of phase.tasks ?? []) statusById.set(task.id, task.status);
  }
  const featureById = new Map(features.map((feature) => [feature.id, feature]));

  return phases
    .filter((phase) => phase.status === "in-progress")
    .filter((phase) => (phase.tasks ?? []).some((task) => !TERMINAL_TASK_STATUSES.includes(task.status)))
    .sort(compareByPhasePriority)
    .map((phase) => {
      const feature = phase.featureId ? featureById.get(phase.featureId) : undefined;
      const featureBlocked = feature ? HARD_UNAVAILABLE_STATUSES.has(feature.status) : false;
      const readyTaskCount = featureBlocked
        ? 0
        : (phase.tasks ?? []).filter((task) => isReadyTask(task, statusById)).length;
      return {
        phaseId: phase.id,
        ref: formatPhaseRef(phase.number, featureNumberOfPhase(phase, features)),
        title: phase.title,
        priority: phasePriority(phase),
        readyTaskCount,
      };
    });
}

/** The list capped to `OPEN_PHASE_WORK_LIST_LIMIT` — what a structured
 * payload should echo, so the structured field and the rendered text line
 * count never diverge (one bound, shared, per P104(F005)/T419's discipline). */
export function boundedOpenPhaseWork(openPhases: OpenPhaseWork[]): OpenPhaseWork[] {
  return openPhases.slice(0, OPEN_PHASE_WORK_LIST_LIMIT);
}

/** Bounded human-readable rendering of `listOpenPhaseWork`'s result: one
 * line per phase up to the limit, then a fold-in count for the rest. Empty
 * array in, empty string out — callers decide whether to omit the section. */
export function openPhaseWorkLines(openPhases: OpenPhaseWork[]): string {
  if (openPhases.length === 0) return "";
  const shown = boundedOpenPhaseWork(openPhases);
  const lines = shown.map((phase) => `- ${phase.ref} — ${phase.title} (priority ${phase.priority}; ${phase.readyTaskCount} ready)`);
  const remaining = openPhases.length - shown.length;
  if (remaining > 0) lines.push(`- …and ${remaining} more in-progress phase(s) with work left.`);
  return lines.join("\n");
}

/**
 * The single higher-priority open phase a caller starting `targetPhaseId`
 * should be told about, or null when none applies. "Higher priority" means a
 * strictly lower priority number than the target's own phase — a tie is not
 * a reason to advise, since neither phase is more open than the other. Only
 * phases with ready work (`readyTaskCount > 0`) qualify: a higher-priority
 * phase whose remaining tasks are all blocked, or already claimed by its own
 * active task, is not a reason to switch there (an explicit edge case this
 * task called out).
 */
export function findHigherPriorityOpenPhase(
  phases: Phase[],
  features: Feature[],
  targetPhaseId: string,
  targetPriority: number,
): OpenPhaseWork | null {
  const higherPriority = listOpenPhaseWork(phases, features)
    .filter((entry) => entry.phaseId !== targetPhaseId)
    .filter((entry) => entry.readyTaskCount > 0)
    .filter((entry) => entry.priority < targetPriority);
  return higherPriority[0] ?? null;
}

/** Non-blocking task-start advisory: same shape as the project-context
 * staleness advisory (P102(F005)/T404) — informational, attached to a
 * successful start, never a reason to deny it. */
export function higherPriorityOpenPhaseAdvisory(candidate: OpenPhaseWork | null): string {
  if (!candidate) return "";
  return `\n\n⚠️ Phase-order advisory: ${candidate.ref} — ${candidate.title} is a higher-priority phase still in progress with ${candidate.readyTaskCount} ready task(s). This start is honored — the user may direct work anywhere — but ${candidate.ref} was not finished first.`;
}
