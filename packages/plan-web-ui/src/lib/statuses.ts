import type { FeatureStatus, MacroTaskStatus, PhaseStatus, TaskStatus } from "./types";

export const featureStatuses: Array<{ value: FeatureStatus; label: string }> = [
  { value: "planned", label: "Planned" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
  { value: "canceled", label: "Canceled" },
  { value: "rejected", label: "Rejected" },
  { value: "deferred", label: "Deferred" },
  { value: "waiting", label: "Waiting" },
];

export const phaseStatuses: Array<{ value: PhaseStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "discovery", label: "Discovery" },
  { value: "planned", label: "Planned" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
  { value: "canceled", label: "Canceled" },
  { value: "rejected", label: "Rejected" },
  { value: "deferred", label: "Deferred" },
  { value: "waiting", label: "Waiting" },
];

export const taskStatuses: Array<{ value: TaskStatus; label: string }> = [
  { value: "planned", label: "Planned" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
  { value: "canceled", label: "Canceled" },
  { value: "rejected", label: "Rejected" },
  { value: "deferred", label: "Deferred" },
  { value: "waiting", label: "Waiting" },
];

export const taskTransitionStatuses = taskStatuses;

export const macroTaskStatuses: Array<{ value: MacroTaskStatus; label: string }> = [
  { value: "planned", label: "Planned" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
  { value: "canceled", label: "Canceled" },
  { value: "rejected", label: "Rejected" },
  { value: "deferred", label: "Deferred" },
  { value: "waiting", label: "Waiting" },
];

/**
 * Statuses a task can be started from. This mirrors `isStartableTaskStatus` in
 * @agent-plan/core, which is what the server enforces: planned work, and parked
 * work (waiting, blocked, deferred). canceled and rejected were deliberate
 * decisions, and done work is reopened, so none of those has a Start control.
 */
export function canStartTask(status: TaskStatus): boolean {
  return status === "planned" || status === "waiting" || status === "blocked" || status === "deferred";
}

/**
 * Checkpointed work resumes through Start so its checkpoint is preserved, so
 * the status control stays locked. canceled and rejected tasks have no Start,
 * so their status must stay editable or they would be stuck.
 */
export function isStatusLockedByCheckpoint(task: { status: TaskStatus; pauseSnapshot?: unknown }): boolean {
  if (!task.pauseSnapshot) return false;
  return task.status !== "canceled" && task.status !== "rejected";
}

export const CHECKPOINT_STATUS_LOCK_TITLE = "This task has a saved checkpoint. Use Start to resume it so the checkpoint is preserved.";

