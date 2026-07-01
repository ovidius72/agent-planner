import type { Phase, Subtask, Task } from "./types";

export interface StatusSummary {
  active: number;
  planned: number;
  done: number;
  blocked: number;
  canceled: number;
}

export function createEmptyStatusSummary(): StatusSummary {
  return {
    active: 0,
    planned: 0,
    done: 0,
    blocked: 0,
    canceled: 0,
  };
}

export function formatStatusSummary(summary: StatusSummary): string {
  const parts: string[] = [];

  if (summary.active) parts.push(`${summary.active} active`);
  if (summary.planned) parts.push(`${summary.planned} planned`);
  if (summary.done) parts.push(`${summary.done} done`);
  if (summary.blocked) parts.push(`${summary.blocked} blocked`);
  if (summary.canceled) parts.push(`${summary.canceled} canceled`);

  return parts.join(" · ");
}

export function summarizePhaseStatuses(phases: Phase[]): StatusSummary {
  const summary = createEmptyStatusSummary();

  for (const phase of phases) {
    if (phase.status === "in-progress" || phase.status === "discovery") {
      summary.active += 1;
      continue;
    }

    if (phase.status === "planned" || phase.status === "draft") {
      summary.planned += 1;
      continue;
    }

    if (phase.status === "done") {
      summary.done += 1;
      continue;
    }

    if (phase.status === "blocked") {
      summary.blocked += 1;
      continue;
    }

    if (phase.status === "canceled") {
      summary.canceled += 1;
    }
  }

  return summary;
}

export function summarizeTaskStatuses(tasks: Task[]): StatusSummary {
  const summary = createEmptyStatusSummary();

  for (const task of tasks) {
    if (task.status === "in-progress") {
      summary.active += 1;
      continue;
    }

    if (task.status === "planned") {
      summary.planned += 1;
      continue;
    }

    if (task.status === "done") {
      summary.done += 1;
      continue;
    }

    if (task.status === "blocked") {
      summary.blocked += 1;
      continue;
    }

    if (task.status === "canceled") {
      summary.canceled += 1;
    }
  }

  return summary;
}

export function summarizeSubtaskStatuses(subtasks: Subtask[]): StatusSummary {
  const summary = createEmptyStatusSummary();

  for (const subtask of subtasks) {
    if (subtask.status === "in-progress") {
      summary.active += 1;
      continue;
    }

    if (subtask.status === "planned") {
      summary.planned += 1;
      continue;
    }

    if (subtask.status === "done") {
      summary.done += 1;
      continue;
    }

    if (subtask.status === "blocked") {
      summary.blocked += 1;
      continue;
    }

    if (subtask.status === "canceled") {
      summary.canceled += 1;
    }
  }

  return summary;
}
