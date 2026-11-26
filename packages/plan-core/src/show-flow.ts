/**
 * Detail read models (P128(F025)/T490).
 *
 * A show is a read of one entity plus the derived facts every client
 * needs to act on it: the canonical ref, the parent phase/feature refs,
 * the linked requirements, the ordering context and the resume
 * checkpoint. Rendering, accepted-decision formatting and MCP session
 * attestation stay with each adapter; the selection and identity live
 * here so no surface recomputes a ref or a count on its own.
 */

import { formatFeatureRef, formatPhaseRef, taskCompositeRef, featureNumberOfPhase } from "./naming.js";
import { findPhaseByRef, findTaskByRef, resolveFeatureRefStrict } from "./refs.js";
import { buildTaskOrderContext, type TaskOrderContext } from "./task-order-context.js";
import type {
  Feature,
  Phase,
  PlanStore,
  Requirement,
  Task,
  TaskPauseSnapshot,
  WorkDeviation,
} from "./index.js";

/** Refusal codes shared by every detail surface. */
export type ShowFlowRefusalCode =
  | "FEATURE_NOT_FOUND"
  | "FEATURE_REF_AMBIGUOUS"
  | "PHASE_NOT_FOUND"
  | "TASK_NOT_FOUND";

export type ShowFlowRefusal = {
  ok: false;
  code: ShowFlowRefusalCode;
  /** Canonical refusal sentence; adapters may render their own text. */
  message: string;
};

export interface FeatureShowOutcome {
  feature: Feature;
  /** Canonical feature ref, e.g. "F025". */
  ref: string;
  phaseCount: number;
  taskCount: number;
}

/**
 * Resolve one feature by ref and count what it contains. Ambiguous names
 * are refused instead of silently picking the first match.
 */
export async function showFeature(store: PlanStore, ref: string): Promise<({ ok: true } & FeatureShowOutcome) | ShowFlowRefusal> {
  const features = (await store.loadFeatures()).features;
  const resolved = resolveFeatureRefStrict(features, ref);
  if (!resolved.ok) {
    const code: ShowFlowRefusalCode = resolved.error.startsWith("Ambiguous feature ref")
      ? "FEATURE_REF_AMBIGUOUS"
      : "FEATURE_NOT_FOUND";
    return { ok: false, code, message: resolved.error };
  }
  const feature = resolved.feature;
  const phases = (await store.loadAllPhases()).filter((phase) => phase.featureId === feature.id);
  return {
    ok: true,
    feature,
    ref: formatFeatureRef(feature.number),
    phaseCount: phases.length,
    taskCount: phases.reduce((total, phase) => total + phase.tasks.length, 0),
  };
}

export interface PhaseShowOutcome {
  phase: Phase;
  /** Composite phase ref, e.g. "P128(F025)". */
  ref: string;
  featureNumber: number | undefined;
  taskCount: number;
  linkedRequirements: Requirement[];
}

/** Resolve one phase by ref plus its derived identity, count and requirements. */
export async function showPhase(store: PlanStore, ref: string): Promise<({ ok: true } & PhaseShowOutcome) | ShowFlowRefusal> {
  const features = (await store.loadFeatures()).features;
  const phase = findPhaseByRef(await store.loadAllPhases(), features, ref);
  if (!phase) return { ok: false, code: "PHASE_NOT_FOUND", message: `Phase not found: ${ref}` };
  const featureNumber = featureNumberOfPhase(phase, features);
  return {
    ok: true,
    phase,
    ref: formatPhaseRef(phase.number, featureNumber),
    featureNumber,
    taskCount: phase.tasks.length,
    linkedRequirements: await store.linkedRequirementsForPhase(phase.id),
  };
}

export interface TaskShowOptions {
  /**
   * Read session used to scope work deviations. MCP passes its planner
   * session so a reader sees the checkpoints it owns; a surface without
   * session identity (v2 today, until session registration lands) reads
   * the unscoped view.
   */
  sessionId?: string | undefined;
}

export interface TaskShowOutcome {
  task: Task;
  phase: Phase;
  feature: Feature | undefined;
  /** Composite task ref, e.g. "P128(F025)/T490". */
  ref: string;
  /** Parent phase ref, e.g. "P128(F025)". */
  phaseRef: string;
  /** Parent feature ref, e.g. "F025"; empty when the phase has no feature. */
  featureRef: string;
  orderContext: TaskOrderContext;
  /** Checkpoint to resume from, if the task has one. */
  snapshot: TaskPauseSnapshot | null;
  /** Unresolved (or resolved) deviation pointing at this task, if any. */
  pendingDeviation: WorkDeviation | undefined;
  linkedRequirements: Requirement[];
}

/**
 * Resolve one task by ref plus the execution facts a reader needs before
 * starting it: ordering context, resume checkpoint, linked requirements
 * and the parent refs. Attestation and start-gate eligibility are
 * session-scoped adapter concerns, not domain reads.
 */
export async function showTask(store: PlanStore, ref: string, options: TaskShowOptions = {}): Promise<({ ok: true } & TaskShowOutcome) | ShowFlowRefusal> {
  const features = (await store.loadFeatures()).features;
  const allPhases = await store.loadAllPhases();
  const found = findTaskByRef(allPhases, features, ref);
  if (!found) return { ok: false, code: "TASK_NOT_FOUND", message: `Task not found: ${ref}` };
  const { task, phase } = found;
  const feature = phase.featureId ? features.find((candidate) => candidate.id === phase.featureId) : undefined;

  const project = await store.loadProject(options.sessionId);
  const pendingDeviation = task.status === "done" || task.status === "canceled" || task.status === "rejected"
    ? undefined
    : project.workDeviations
      .filter((deviation) => deviation.resumeTaskId === task.id
        && (deviation.state === "resume-required" || deviation.state === "resolved"))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const snapshot = task.pauseSnapshot ?? pendingDeviation?.snapshot ?? null;

  const linkedRequirements = await store.linkedRequirementsForExecution(phase);

  return {
    ok: true,
    task,
    phase,
    feature,
    ref: taskCompositeRef(task, phase, features),
    phaseRef: formatPhaseRef(phase.number, featureNumberOfPhase(phase, features)),
    featureRef: feature ? formatFeatureRef(feature.number) : "",
    orderContext: buildTaskOrderContext(task, phase, allPhases, features),
    snapshot,
    pendingDeviation,
    linkedRequirements,
  };
}
