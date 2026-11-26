/**
 * Read-model queries (P128(F025)/T490).
 *
 * Discovery lists are not presentation: which entities match a filter, how
 * a task ref is formed, and which counts a feature carries must agree on
 * every surface. The line formatting stays with each adapter; the selection
 * and the canonical refs live here.
 */

import { formatFeatureRef, formatPhaseRef, taskCompositeRef, featureNumberOfPhase } from "./naming.js";
import { findFeatureByRef, findPhaseByRef } from "./refs.js";
import type { Feature, Phase, Task } from "./schema.js";

export type FeatureListSource = Pick<Feature, "id" | "number" | "shortId" | "name" | "priority"> & { status: string };
export type TaskListSource = Pick<Task, "id" | "number" | "shortId" | "title" | "priority" | "dependsOn"> & { status: string };
export type PhaseListSource = Pick<Phase, "id" | "number" | "shortId" | "title" | "priority" | "featureId"> & {
  status: string;
  tasks: TaskListSource[];
};

export interface PlannerListSource {
  loadFeatures(): Promise<{ features: FeatureListSource[] }>;
  loadAllPhases(): Promise<PhaseListSource[]>;
}

export interface FeatureListFilter {
  /** Optional feature ref (F00x/shortId/UUID/title). */
  featureRef?: string | undefined;
}

export interface FeatureListSummary {
  id: string;
  ref: string;
  shortId: string;
  name: string;
  status: string;
  priority: number;
  phaseCount: number;
  taskCount: number;
}

export interface FeatureListOutcome {
  items: FeatureListSummary[];
  /** Whether the optional feature filter resolved; null when no filter was given. */
  filterResolved: boolean | null;
}

export async function listFeatureSummaries(store: PlannerListSource, filter: FeatureListFilter = {}): Promise<FeatureListOutcome> {
  const features = (await store.loadFeatures()).features;
  const matched = filter.featureRef
    ? features.filter((feature) => feature.id === findFeatureByRef(features, filter.featureRef!)?.id)
    : features;
  const phases = await store.loadAllPhases();
  const items = matched.map((feature) => {
    const featurePhases = phases.filter((phase) => phase.featureId === feature.id);
    return {
      id: feature.id,
      ref: formatFeatureRef(feature.number),
      shortId: feature.shortId,
      name: feature.name,
      status: feature.status,
      priority: feature.priority,
      phaseCount: featurePhases.length,
      taskCount: featurePhases.reduce((total, phase) => total + phase.tasks.length, 0),
    };
  });
  return { items, filterResolved: filter.featureRef ? items.length > 0 : null };
}

export interface PhaseListFilter {
  featureRef?: string | undefined;
  status?: string | undefined;
}

export interface PhaseListSummary {
  id: string;
  ref: string;
  shortId: string;
  title: string;
  status: string;
  priority: number;
  taskCount: number;
  featureNumber: number | undefined;
}

export type PhaseListOutcome =
  | { ok: true; items: PhaseListSummary[] }
  | { ok: false; code: "FEATURE_NOT_FOUND"; message: string };

export async function listPhaseSummaries(store: PlannerListSource, filter: PhaseListFilter = {}): Promise<PhaseListOutcome> {
  const features = (await store.loadFeatures()).features;
  let phases = await store.loadAllPhases();
  if (filter.featureRef) {
    const feature = findFeatureByRef(features, filter.featureRef);
    if (!feature) {
      return { ok: false, code: "FEATURE_NOT_FOUND", message: `Feature not found: ${filter.featureRef}` };
    }
    phases = phases.filter((phase) => phase.featureId === feature.id);
  }
  if (filter.status) phases = phases.filter((phase) => phase.status === filter.status);
  const items = phases.map((phase) => {
    const featureNumber = featureNumberOfPhase(phase, features);
    return {
      id: phase.id,
      ref: formatPhaseRef(phase.number, featureNumber),
      shortId: phase.shortId,
      title: phase.title,
      status: phase.status,
      priority: phase.priority,
      taskCount: phase.tasks.length,
      featureNumber,
    };
  });
  return { ok: true, items };
}

export interface TaskListFilter {
  featureRef?: string | undefined;
  phaseRef?: string | undefined;
  status?: string | undefined;
}

export interface TaskListSummary {
  id: string;
  ref: string;
  shortId: string;
  title: string;
  status: string;
  priority: number;
  phaseId: string;
  featureId?: string;
}

export type TaskListOutcome =
  | { ok: true; items: TaskListSummary[] }
  | { ok: false; code: "FEATURE_NOT_FOUND" | "PHASE_NOT_FOUND"; message: string };

export async function listTaskSummaries(store: PlannerListSource, filter: TaskListFilter = {}): Promise<TaskListOutcome> {
  const features = (await store.loadFeatures()).features;
  let phases = await store.loadAllPhases();
  if (filter.featureRef) {
    const feature = findFeatureByRef(features, filter.featureRef);
    if (!feature) {
      return { ok: false, code: "FEATURE_NOT_FOUND", message: `Feature not found: ${filter.featureRef}` };
    }
    phases = phases.filter((phase) => phase.featureId === feature.id);
  }
  if (filter.phaseRef) {
    const phase = findPhaseByRef(phases, features, filter.phaseRef);
    if (!phase) {
      return { ok: false, code: "PHASE_NOT_FOUND", message: `Phase not found: ${filter.phaseRef}` };
    }
    phases = [phase];
  }
  const items: TaskListSummary[] = [];
  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (filter.status && task.status !== filter.status) continue;
      items.push({
        id: task.id,
        ref: taskCompositeRef(task, phase, features),
        shortId: task.shortId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        phaseId: phase.id,
        ...(phase.featureId ? { featureId: phase.featureId } : {}),
      });
    }
  }
  return { ok: true, items };
}
