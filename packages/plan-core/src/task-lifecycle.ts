import type { Task } from "./schema.js";

/**
 * Apply the timestamp side effects of a task status transition: set
 * `startedAt` the first time a task becomes in-progress, stamp
 * `completedAt` on entering `done`, and clear `completedAt` when a task
 * leaves `done` for any other status (reopening). Both adapters carried an
 * identical copy of this decision for every status-changing tool (update,
 * start, complete, reopen, switch). Mutates `task` in place, matching how
 * every call site already used it (fetch, mutate, persist).
 */
export function applyTaskLifecycleDates(task: Task, nextStatus: Task["status"], now: string): void {
  const previousStatus = task.status;
  if (nextStatus === "in-progress" && !task.startedAt) task.startedAt = now;
  if (nextStatus === "done") {
    if (!task.startedAt) task.startedAt = now;
    task.completedAt = now;
  } else if (previousStatus === "done") {
    task.completedAt = "";
  }
  task.status = nextStatus;
}
