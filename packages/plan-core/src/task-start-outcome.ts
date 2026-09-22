import type { ContextReadEligibility, ProjectGuidelinesReadState, RequiredContextRead } from "./read-tracking.js";

export const TASK_START_ERROR_CODES = [
  "PLAN_NOT_FOUND",
  "TASK_NOT_FOUND",
  "TASK_DONE",
  "PROJECT_GUIDELINES_READ_REQUIRED",
  "CONTEXT_READ_REQUIRED",
  "REQUIREMENTS_READ_REQUIRED",
  "START_NOT_ALLOWED",
  "ACTIVE_TASK_CONFLICT",
  "PERSISTENCE_VERIFICATION_FAILED",
] as const;

export type TaskStartErrorCode = (typeof TASK_START_ERROR_CODES)[number];

export interface TaskStartDeniedOutcome {
  started: false;
  errorCode: TaskStartErrorCode;
  message: string;
  nextActions: string[];
  taskId?: string;
  requirementIds?: string[];
}

export interface TaskStartSucceededOutcome {
  started: true;
  taskId: string;
  status: "in-progress";
  alreadyStarted: boolean;
}

export type TaskStartOutcome = TaskStartDeniedOutcome | TaskStartSucceededOutcome;

export function taskStartDenied(
  errorCode: TaskStartErrorCode,
  message: string,
  nextActions: string[],
  details: { taskId?: string; requirementIds?: string[] } = {},
): TaskStartDeniedOutcome {
  return {
    started: false,
    errorCode,
    message,
    nextActions,
    ...(details.taskId ? { taskId: details.taskId } : {}),
    ...(details.requirementIds ? { requirementIds: details.requirementIds } : {}),
  };
}

export function taskStartSucceeded(taskId: string, alreadyStarted = false): TaskStartSucceededOutcome {
  return { started: true, taskId, status: "in-progress", alreadyStarted };
}

/**
 * Advisory-only readiness summary for `task_start` / `planner-task-start`,
 * built from the exact same three checks the lifecycle gate itself runs
 * (Project Guidelines, task/phase/feature context reads, linked
 * requirements). `planner-task-show` / `task_get` with `full=true` attaches
 * this so a caller sees, in the same call that reads the task, whether
 * anything else is still outstanding before starting it — the read gate's
 * requirements made discoverable up front instead of learned from a denial.
 *
 * This is read-only reporting, never enforcement: `task_start` recomputes
 * eligibility itself at call time and stays the sole authority on whether
 * work may begin. A `ready: true` report is not a status change and does
 * not shortcut the gate; it can still go stale between this read and the
 * next `task_start` call, which is exactly the edge case the gate itself
 * (not this summary) is responsible for catching.
 */
export interface TaskStartGateState {
  ready: boolean;
  projectGuidelinesReadState: ProjectGuidelinesReadState;
  missingReads: RequiredContextRead[];
  missingRequirementIds: string[];
}

export function taskStartGateState(
  contextEligibility: ContextReadEligibility,
  requirementEligibility: ContextReadEligibility,
  projectGuidelinesReadState: ProjectGuidelinesReadState,
): TaskStartGateState {
  const projectGuidelinesReady =
    projectGuidelinesReadState === "valid" || projectGuidelinesReadState === "not-required";
  return {
    ready: projectGuidelinesReady && contextEligibility.eligible && requirementEligibility.eligible,
    projectGuidelinesReadState,
    missingReads: contextEligibility.requiredReads ?? [],
    missingRequirementIds: (requirementEligibility.requiredReads ?? []).map((read) => read.id),
  };
}

/** One line for the human-readable channel: what, if anything, `task_start` still needs. */
export function taskStartGateStateLine(gate: TaskStartGateState): string {
  if (gate.ready) return "task_start readiness: ready.";
  const outstanding: string[] = [];
  if (gate.projectGuidelinesReadState !== "valid" && gate.projectGuidelinesReadState !== "not-required") {
    outstanding.push(`Project Guidelines (${gate.projectGuidelinesReadState})`);
  }
  outstanding.push(...gate.missingReads.map((read) => `${read.kind} ${read.id} (${read.state})`));
  if (gate.missingRequirementIds.length > 0) {
    outstanding.push(`${gate.missingRequirementIds.length} linked requirement(s)`);
  }
  return `task_start readiness: not ready — still needed: ${outstanding.join(", ")}.`;
}
