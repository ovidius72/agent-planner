// Pure builders for the dashboard Work Tree. No React, no DOM — just data
// transformation from the plan model (features/phases/tasks) into the
// hierarchical shape the tree UI renders.

import type { Feature, Phase, Task } from "./types";

/** How long a freshly-updated node stays highlighted after a WS event. */
export const recentHighlightDurationMs = 4200;

export interface WorkTreePhase {
  phase: Phase;
  totalTasks: number;
  doneTasks: number;
  allTasks: Task[];
  hasActiveTask: boolean;
}

export interface WorkTreeFeature {
  feature: Feature;
  totalTasks: number;
  doneTasks: number;
  allPhases: WorkTreePhase[];
  hasActiveTask: boolean;
  isActive: boolean;
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

/**
 * Build the feature → phase → task tree from flat plan data.
 * Phases are grouped by featureId; tasks are sorted by number then creation
 * time; features are sorted by number then name.
 */
export function buildWorkTree(features: Feature[], phases: Phase[]): WorkTreeFeature[] {
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
        const allTasks = [...phase.tasks].sort(
          (left, right) =>
            (left.priority ?? 0) - (right.priority ?? 0)
            || left.number - right.number
            || left.createdAt.localeCompare(right.createdAt)
            || left.title.localeCompare(right.title),
        );
        const hasActiveTask = allTasks.some((task) => task.status === "in-progress");
        return {
          phase,
          totalTasks: phase.tasks.length,
          doneTasks: phase.tasks.filter((task) => task.status === "done").length,
          allTasks,
          hasActiveTask,
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
        allPhases: allPhases.sort((left, right) => (left.phase.priority ?? 0) - (right.phase.priority ?? 0) || left.phase.number - right.phase.number),
        hasActiveTask: allPhases.some((entry) => entry.hasActiveTask),
        isActive: hasActiveBranch,
      };
    })
    .sort(
      (left, right) =>
        (left.feature.priority ?? 0) - (right.feature.priority ?? 0)
        || left.feature.number - right.feature.number
        || left.feature.name.localeCompare(right.feature.name),
    );
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
