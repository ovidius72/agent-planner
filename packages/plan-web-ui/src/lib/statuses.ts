import type { FeatureStatus, PhaseStatus, TaskStatus } from "./types";

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
