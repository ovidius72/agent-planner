/**
 * Pure parent-status rollup ladder (P128(F025)/T496).
 *
 * Ported verbatim from PlanStore.derivePhaseStatus / deriveFeatureStatus at
 * checkout 33621d8 (plan-store.ts :2491-2544) so the SQLite reconciliation
 * layer derives parent status from rows with the exact same semantics the
 * JSON store derives from in-memory tasks. PlanStore keeps its private
 * implementations until T490 routes consumers through the service; when it
 * does, these functions are the single source (AGENTS.md rule 19).
 */

export type TaskStatusForRollup = string;
export type PhaseStatusForRollup = string;
export type FeatureStatusForRollup = string;

/** Phase status derived from its tasks' statuses; empty phases are `draft`. */
export function derivePhaseStatusFromTaskStatuses(taskStatuses: readonly TaskStatusForRollup[]): PhaseStatusForRollup {
  if (taskStatuses.length === 0) return "draft";

  // Ignore rejected/canceled tasks (void) when deriving progress.
  const meaningful = taskStatuses.filter((s) => s !== "rejected" && s !== "canceled");
  if (meaningful.length === 0) return "rejected";
  if (meaningful.every((s) => s === "done")) return "done";

  const hasDone = meaningful.some((s) => s === "done");
  const hasActive = meaningful.some((s) => s === "in-progress");
  const hasPlanned = meaningful.some((s) => s === "planned");
  const hasBlocked = meaningful.some((s) => s === "blocked");
  const hasWaiting = meaningful.some((s) => s === "waiting");
  const hasDeferred = meaningful.some((s) => s === "deferred");

  if (hasActive) return "in-progress";
  if (hasDone && !hasPlanned && !hasBlocked && !hasWaiting && hasDeferred) return "deferred";
  // Partial completion with remaining planned/blocked/waiting work still means
  // the phase has genuinely started and is not terminal yet.
  if (hasDone) return "in-progress";
  // No progress at all ⇒ surface the stall / not-started state.
  if (hasBlocked) return "blocked";
  if (hasWaiting) return "waiting";
  if (hasDeferred) return "deferred";
  return "planned";
}

/** Feature status derived from its phases' statuses; features without phases are `planned`. */
export function deriveFeatureStatusFromPhaseStatuses(phaseStatuses: readonly PhaseStatusForRollup[]): FeatureStatusForRollup {
  if (phaseStatuses.length === 0) return "planned";

  // Ignore rejected/canceled phases when deriving progress.
  const meaningful = phaseStatuses.filter((s) => s !== "rejected" && s !== "canceled");
  if (meaningful.length === 0) return "rejected";
  if (meaningful.every((s) => s === "done")) return "done";

  const hasDone = meaningful.some((s) => s === "done");
  const hasActive = meaningful.some((s) => s === "discovery" || s === "in-progress");
  const hasPlanned = meaningful.some((s) => s === "planned");
  const hasBlocked = meaningful.some((s) => s === "blocked");
  const hasWaiting = meaningful.some((s) => s === "waiting");
  const hasDeferred = meaningful.some((s) => s === "deferred");

  if (hasActive) return "in-progress";
  if (hasDone && !hasPlanned && !hasBlocked && !hasWaiting && hasDeferred) return "deferred";
  if (hasDone) return "in-progress";
  // No progress at all ⇒ surface the stall / not-started state.
  if (hasBlocked) return "blocked";
  if (hasWaiting) return "waiting";
  if (hasDeferred) return "deferred";
  return "planned";
}
