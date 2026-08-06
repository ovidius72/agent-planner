// Pure builders for the dashboard Work Tree. No React, no DOM — just data
// transformation from the plan model (features/phases/tasks) into the
// hierarchical shape the tree UI renders.

import type { Feature, FeatureStatus, Phase, PhaseStatus, Task, TaskStatus } from "./types";

import { type ParentDisplay, derivePhaseDisplay, deriveFeatureDisplay } from "./derive-display";

export type WorkTreeSortKey =
  | "priority"
  | "number"
  | "createdAt"
  | "updatedAt"
  | "title"
  | "shortId"
  | "startedAt"
  | "completedAt"
  | "status";

export type WorkTreeSortDirection = "asc" | "desc";

export interface WorkTreeSortConfig {
  key: WorkTreeSortKey;
  direction: WorkTreeSortDirection;
}

export const DEFAULT_WORK_TREE_SORT: WorkTreeSortConfig = { key: "priority", direction: "asc" };

/** How long a freshly-updated node stays highlighted after a WS event. */
export const recentHighlightDurationMs = 4200;

export interface WorkTreePhase {
  phase: Phase;
  totalTasks: number;
  doneTasks: number;
  allTasks: Task[];
  hasActiveTask: boolean;
  display: ParentDisplay;
}

export interface WorkTreeFeature {
  feature: Feature;
  totalTasks: number;
  doneTasks: number;
  allPhases: WorkTreePhase[];
  hasActiveTask: boolean;
  isActive: boolean;
  display: ParentDisplay;
}

export function countTasks(phases: Phase[]): number {
  return phases.reduce((total, phase) => total + phase.tasks.length, 0);
}

export function countDoneTasks(phases: Phase[]): number {
  return phases.reduce(
    (total, phase) => total + phase.tasks.filter((task) => task.status === "done").length,
    0,
  );
}

export function formatSequence(value: number | undefined): string {
  return String(value && value > 0 ? value : 0).padStart(3, "0");
}

const STATUS_ORDER: Record<TaskStatus | PhaseStatus | FeatureStatus, number> = {
  "draft": 0,
  "discovery": 1,
  "planned": 2,
  "waiting": 3,
  "blocked": 4,
  "deferred": 5,
  "in-progress": 6,
  "done": 7,
  "canceled": 8,
  "rejected": 9,
};

function sortValue<T extends Feature | Phase | Task>(entity: T, key: WorkTreeSortKey): string | number {
  if (key === "title") {
    return "name" in entity ? (entity as Feature).name : (entity as Phase | Task).title;
  }
  if (key === "status") {
    return STATUS_ORDER[entity.status as TaskStatus & PhaseStatus & FeatureStatus] ?? 99;
  }
  if (key === "startedAt") {
    if ("startedAt" in entity) {
      const value = (entity as Task).startedAt;
      return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
    }
    return Number.MAX_SAFE_INTEGER;
  }
  if (key === "completedAt") {
    if ("completedAt" in entity) {
      const value = (entity as Task).completedAt;
      return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
    }
    return Number.MAX_SAFE_INTEGER;
  }
  if (key === "shortId") {
    return (entity as Feature | Phase | Task).shortId ?? "";
  }
  if (key === "priority" || key === "number") {
    return (entity as Feature | Phase | Task)[key] ?? 0;
  }
  if (key === "createdAt" || key === "updatedAt") {
    const value = (entity as Feature | Phase | Task)[key];
    return value ? new Date(value).getTime() : 0;
  }
  return 0;
}

function compareEntities<T extends Feature | Phase | Task>(a: T, b: T, key: WorkTreeSortKey, direction: WorkTreeSortDirection): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  let cmp: number;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else {
    cmp = String(av).localeCompare(String(bv));
  }
  if (cmp === 0) {
    // Stable fallback: priority asc, then number asc, then createdAt asc.
    cmp = ((a.priority ?? 0) - (b.priority ?? 0)) || (a.number - b.number) || a.createdAt.localeCompare(b.createdAt);
  }
  return direction === "desc" ? -cmp : cmp;
}

export { compareEntities };

/**
 * Build the feature → phase → task tree from flat plan data.
 * Phases are grouped by featureId; tasks, phases, and features are sorted
 * according to the provided `sort` config. The default preserves the original
 * behavior: priority asc, then number, then createdAt, then title.
 */
export function buildWorkTree(
  features: Feature[],
  phases: Phase[],
  sort: WorkTreeSortConfig = DEFAULT_WORK_TREE_SORT,
): WorkTreeFeature[] {
  const phasesByFeature = new Map<string, Phase[]>();

  for (const phase of phases) {
    if (!phase.featureId) continue;
    const items = phasesByFeature.get(phase.featureId) ?? [];
    items.push(phase);
    phasesByFeature.set(phase.featureId, items);
  }

  return features
    .map((feature) => {
      const featurePhases = phasesByFeature.get(feature.id) ?? [];
      const totalTasks = featurePhases.reduce((total, phase) => total + phase.tasks.length, 0);
      const doneTasks = featurePhases.reduce(
        (total, phase) => total + phase.tasks.filter((task) => task.status === "done").length,
        0,
      );

      const allPhases = featurePhases.map((phase) => {
        const allTasks = [...phase.tasks].sort((left, right) => compareEntities(left, right, sort.key, sort.direction));
        const hasActiveTask = allTasks.some((task) => task.status === "in-progress");
        return {
          phase,
          totalTasks: phase.tasks.length,
          doneTasks: phase.tasks.filter((task) => task.status === "done").length,
          allTasks,
          hasActiveTask,
          display: derivePhaseDisplay(allTasks),
        };
      });

      const hasActiveBranch = allPhases.some(
        ({ phase, allTasks }) =>
          phase.status === "in-progress"
          || phase.status === "discovery"
          || allTasks.some((task) => task.status === "in-progress"),
      );

      return {
        feature,
        totalTasks,
        doneTasks,
        allPhases: allPhases.sort((left, right) => compareEntities(left.phase, right.phase, sort.key, sort.direction)),
        hasActiveTask: allPhases.some((entry) => entry.hasActiveTask),
        isActive: hasActiveBranch,
        display: deriveFeatureDisplay(allPhases.map((entry) => entry.phase)),
      };
    })
    .sort((left, right) => compareEntities(left.feature, right.feature, sort.key, sort.direction));
}

/** Shape of the custom WebSocket events dispatched on `window`. */
export type PlannerWsMessage = {
  type?: string;
  data?: {
    action?: string;
    id?: string;
    featureId?: string;
    phaseId?: string;
    taskId?: string;
  };
};
