// Status-filter helpers for the dashboard. Pure functions + the derived lists
// of every status value (used both as the "all" fallback and for chip rendering).

import { featureStatuses, phaseStatuses, taskStatuses } from "./statuses";
import type { FeatureStatus, PhaseStatus, TaskStatus } from "./types";

export const allFeatureStatusValues: FeatureStatus[] = featureStatuses.map((option) => option.value);
export const allPhaseStatusValues: PhaseStatus[] = phaseStatuses.map((option) => option.value);
export const allTaskStatusValues: TaskStatus[] = taskStatuses.map((option) => option.value);

/**
 * Toggle a status in a multi-select. Removing the last selected status falls
 * back to "all selected" so the list is never empty (an empty filter would
 * hide everything).
 */
export function toggleStatus<T extends string>(values: T[], value: T, all: readonly T[]): T[] {
  if (values.includes(value)) {
    const next = values.filter((entry) => entry !== value);
    return next.length === 0 ? [...all] : next;
  }
  return [...values, value];
}

export function matchesStatus<T extends string>(status: T, active: T[]): boolean {
  return active.includes(status);
}
