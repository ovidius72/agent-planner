/**
 * Discuss application layer (P128(F025)/T490).
 *
 * "Discuss" persists governance/discovery fields and marks the entity
 * context ready. MCP and the versioned HTTP surface must write exactly the
 * same fields in the same order, so the orchestration lives here and each
 * adapter only composes its own reply.
 *
 * A refusal carries the domain facts (entity, ref, mutable field list)
 * instead of surface wording: the adapter decides how to phrase the next
 * action, the code is the stable contract.
 */

import { replaceChecklist } from "./checklist.js";
import { taskCompositeRef } from "./naming.js";
import { formatFeatureRef, formatPhaseRef, featureNumberOfPhase } from "./naming.js";
import { normalizeDescriptionRef } from "./payload-fallback.js";
import { nowISO } from "./plan-store.js";
import { findPhaseByRef, findTaskByRef, resolveFeatureRefStrict } from "./refs.js";
import type { Feature, Phase, PlanStore, Project, Task } from "./index.js";

/** Refusal codes shared by every discuss surface. */
export type DiscussFlowRefusalCode =
  | "PROJECT_NO_MUTABLE_FIELDS"
  | "PROJECT_LEGACY_DECISIONS_READ_ONLY"
  | "FEATURE_NOT_FOUND"
  | "FEATURE_NO_MUTABLE_FIELDS"
  | "PHASE_NOT_FOUND"
  | "PHASE_NO_MUTABLE_FIELDS"
  | "TASK_NOT_FOUND"
  | "TASK_NO_MUTABLE_FIELDS";

/** A typed refusal: the adapter maps the code, details carry the facts. */
export class DiscussFlowRefusal extends Error {
  readonly code: DiscussFlowRefusalCode;
  readonly details: Record<string, unknown>;

  constructor(code: DiscussFlowRefusalCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DiscussFlowRefusal";
    this.code = code;
    this.details = details;
  }
}

const trimList = (values: string[]): string[] => values.map((item) => item.trim()).filter(Boolean);

// ── Project ─────────────────────────────────────────────────────────

export interface ProjectDiscussFlowInput {
  description?: string | undefined;
  descriptionRef?: string | undefined;
  goal?: string | undefined;
  scope?: string[] | undefined;
  outOfScope?: string[] | undefined;
  technologies?: string[] | undefined;
  tools?: string[] | undefined;
  globalRules?: string[] | undefined;
  /** Rejected by the flow: legacy free-form decisions are read-only history. */
  decisions?: string[] | undefined;
}

export interface ProjectDiscussFlowOutcome {
  project: Project;
  updatedFields: string[];
}

const PROJECT_MUTABLE_FIELDS = [
  "description", "descriptionRef", "goal", "scope", "outOfScope", "technologies", "tools", "globalRules",
] as const;

export async function discussProjectFlow(store: PlanStore, input: ProjectDiscussFlowInput): Promise<ProjectDiscussFlowOutcome> {
  const current = await store.loadProject();
  if (input.decisions !== undefined) {
    throw new DiscussFlowRefusal("PROJECT_LEGACY_DECISIONS_READ_ONLY", "The legacy free-form decisions list is read-only for history.", {
      entity: "project",
      ref: current.name,
      projectName: current.name,
    });
  }
  const updatedFields = PROJECT_MUTABLE_FIELDS.filter((field) => input[field] !== undefined);
  if (updatedFields.length === 0) {
    throw new DiscussFlowRefusal("PROJECT_NO_MUTABLE_FIELDS", `No mutable project fields were received for ${current.name}.`, {
      entity: "project",
      ref: current.name,
      projectName: current.name,
      operation: "discuss",
      mutableFields: [...PROJECT_MUTABLE_FIELDS],
    });
  }
  const project = await store.updateProject((entry) => {
    const next = { ...entry };
    if (input.description !== undefined) next.description = input.description.trim();
    if (input.goal !== undefined) next.goal = input.goal.trim();
    if (input.scope !== undefined) next.scope = trimList(input.scope);
    if (input.outOfScope !== undefined) next.outOfScope = trimList(input.outOfScope);
    if (input.technologies !== undefined) next.technologies = trimList(input.technologies);
    if (input.tools !== undefined) next.tools = trimList(input.tools);
    if (input.globalRules !== undefined) next.globalRules = trimList(input.globalRules);
    if (input.descriptionRef !== undefined) {
      const descriptionRef = normalizeDescriptionRef(input.descriptionRef);
      if (descriptionRef) next.descriptionRef = descriptionRef;
      else delete next.descriptionRef;
    }
    return next;
  });
  await store.writeGenerated();
  return { project, updatedFields: [...updatedFields] };
}

// ── Feature ─────────────────────────────────────────────────────────

export interface FeatureDiscussFlowInput {
  description?: string | undefined;
  descriptionRef?: string | undefined;
  workDone?: string | undefined;
  workRemaining?: string | undefined;
  dependencies?: string[] | undefined;
  /** Recorded verbatim as the context-ready reason; the surface owns the wording. */
  contextReadyReason: string;
}

export interface FeatureDiscussFlowOutcome {
  feature: Feature;
  ref: string;
  updatedFields: string[];
}

const FEATURE_DISCUSS_FIELDS = ["description", "descriptionRef", "workDone", "workRemaining", "dependencies"] as const;

export async function discussFeatureFlow(
  store: PlanStore,
  ref: string,
  input: FeatureDiscussFlowInput,
): Promise<FeatureDiscussFlowOutcome> {
  const features = (await store.loadFeatures()).features;
  const resolvedFeature = resolveFeatureRefStrict(features, ref);
  if (!resolvedFeature.ok) {
    throw new DiscussFlowRefusal("FEATURE_NOT_FOUND", resolvedFeature.error, { entity: "feature", ref });
  }
  const feature = resolvedFeature.feature;
  const featureRef = formatFeatureRef(feature.number);
  const updatedFields = FEATURE_DISCUSS_FIELDS.filter((field) => input[field] !== undefined);
  if (updatedFields.length === 0) {
    throw new DiscussFlowRefusal("FEATURE_NO_MUTABLE_FIELDS", `No mutable feature fields were received for ${featureRef}.`, {
      entity: "feature",
      ref: featureRef,
      featureId: feature.id,
      operation: "discuss",
      mutableFields: [...FEATURE_DISCUSS_FIELDS],
    });
  }
  const updated = await store.updateFeatures((document) => {
    const target = document.features.find((entry) => entry.id === feature.id);
    if (!target) return document;
    if (input.description !== undefined) target.description = input.description.trim();
    if (input.descriptionRef !== undefined) {
      const descriptionRef = normalizeDescriptionRef(input.descriptionRef);
      if (descriptionRef) target.descriptionRef = descriptionRef;
      else delete target.descriptionRef;
    }
    if (input.workDone !== undefined) target.workDone = input.workDone.trim();
    if (input.workRemaining !== undefined) target.workRemaining = input.workRemaining.trim();
    if (input.dependencies !== undefined) target.dependsOn = trimList(input.dependencies);
    target.discussedAt = nowISO();
    target.contextReady = true;
    target.contextReadyReason = input.contextReadyReason;
    target.updatedAt = nowISO();
    return document;
  });
  const result = updated.features.find((entry) => entry.id === feature.id)!;
  await store.writeGenerated();
  return { feature: result, ref: formatFeatureRef(result.number), updatedFields: [...updatedFields] };
}

// ── Phase ───────────────────────────────────────────────────────────

export interface PhaseDiscussFlowInput {
  /** Backward-compatible single goal; ignored when `goals` is supplied. */
  goal?: string | undefined;
  goals?: string[] | undefined;
  summary?: string | undefined;
  /** Stored as the phase description. */
  scope?: string | undefined;
  descriptionRef?: string | undefined;
  nonGoals?: string[] | undefined;
  dependencies?: string[] | undefined;
  risks?: string[] | undefined;
  openQuestions?: string[] | undefined;
  completionCriteria?: string[] | undefined;
  /** Recorded verbatim as the context-ready reason; the surface owns the wording. */
  contextReadyReason: string;
}

export interface PhaseDiscussFlowOutcome {
  phase: Phase;
  ref: string;
  updatedFields: string[];
}

const PHASE_DISCUSS_FIELDS = [
  "goal", "goals", "summary", "scope", "descriptionRef", "nonGoals", "dependencies", "risks", "openQuestions", "completionCriteria",
] as const;

export async function discussPhaseFlow(
  store: PlanStore,
  ref: string,
  input: PhaseDiscussFlowInput,
): Promise<PhaseDiscussFlowOutcome> {
  const features = (await store.loadFeatures()).features;
  const found = findPhaseByRef(await store.loadAllPhases(), features, ref);
  if (!found) {
    throw new DiscussFlowRefusal("PHASE_NOT_FOUND", `Phase not found: ${ref}`, { entity: "phase", ref });
  }
  const phaseRef = formatPhaseRef(found.number, featureNumberOfPhase(found, features));
  const updatedFields = PHASE_DISCUSS_FIELDS.filter((field) => input[field] !== undefined);
  if (updatedFields.length === 0) {
    throw new DiscussFlowRefusal("PHASE_NO_MUTABLE_FIELDS", `No mutable phase fields were received for ${phaseRef}.`, {
      entity: "phase",
      ref: phaseRef,
      phaseId: found.id,
      operation: "discuss",
      mutableFields: [...PHASE_DISCUSS_FIELDS],
    });
  }
  const phase = await store.updatePhase(found.id, (entry) => {
    if (input.goals !== undefined) entry.goals = trimList(input.goals);
    else if (input.goal !== undefined) entry.goals = trimList([input.goal]);
    if (input.summary !== undefined) entry.summary = input.summary.trim();
    if (input.scope !== undefined) entry.description = input.scope.trim();
    if (input.descriptionRef !== undefined) {
      const descriptionRef = normalizeDescriptionRef(input.descriptionRef);
      if (descriptionRef) entry.descriptionRef = descriptionRef;
      else delete entry.descriptionRef;
    }
    if (input.nonGoals !== undefined) entry.nonGoals = trimList(input.nonGoals);
    if (input.dependencies !== undefined) entry.dependencies = trimList(input.dependencies);
    if (input.risks !== undefined) entry.risks = trimList(input.risks);
    if (input.openQuestions !== undefined) entry.openQuestions = trimList(input.openQuestions);
    if (input.completionCriteria !== undefined) entry.completionCriteria = trimList(input.completionCriteria);
    entry.discussedAt = nowISO();
    entry.contextReady = true;
    entry.contextReadyReason = input.contextReadyReason;
    entry.updatedAt = nowISO();
    return entry;
  });
  await store.writeGenerated();
  return { phase, ref: formatPhaseRef(phase.number, featureNumberOfPhase(phase, features)), updatedFields: [...updatedFields] };
}

// ── Task ────────────────────────────────────────────────────────────

export interface TaskDiscussFlowInput {
  description?: string | undefined;
  descriptionRef?: string | undefined;
  /** Replaces the checklist; ticks carry over by title, then by position. */
  checklist?: string[] | undefined;
}

export interface TaskDiscussFlowOutcome {
  task: Task;
  ref: string;
  updatedFields: string[];
  checklistLostTicks: string[];
}

const TASK_DISCUSS_FIELDS = ["description", "descriptionRef", "checklist"] as const;

export async function discussTaskFlow(
  store: PlanStore,
  ref: string,
  input: TaskDiscussFlowInput,
): Promise<TaskDiscussFlowOutcome> {
  const features = (await store.loadFeatures()).features;
  const found = findTaskByRef(await store.loadAllPhases(), features, ref);
  if (!found) {
    throw new DiscussFlowRefusal("TASK_NOT_FOUND", `Task not found: ${ref}`, { entity: "task", ref });
  }
  const taskRef = taskCompositeRef(found.task, found.phase, features);
  const updatedFields = TASK_DISCUSS_FIELDS.filter((field) => input[field] !== undefined);
  if (updatedFields.length === 0) {
    throw new DiscussFlowRefusal("TASK_NO_MUTABLE_FIELDS", `No mutable task fields were received for ${taskRef}.`, {
      entity: "task",
      ref: taskRef,
      taskId: found.task.id,
      operation: "discuss",
      mutableFields: [...TASK_DISCUSS_FIELDS],
    });
  }
  let updatedTask: Task | undefined;
  let checklistLostTicks: string[] = [];
  await store.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) return phase;
    if (input.description !== undefined) task.description = input.description.trim();
    if (input.descriptionRef !== undefined) {
      const descriptionRef = normalizeDescriptionRef(input.descriptionRef);
      if (descriptionRef) task.descriptionRef = descriptionRef;
      else delete task.descriptionRef;
    }
    if (input.checklist !== undefined) {
      const replacement = replaceChecklist(task.checklist ?? [], input.checklist, task.id);
      task.checklist = replacement.items;
      checklistLostTicks = replacement.lostTicks;
    }
    task.updatedAt = nowISO();
    phase.updatedAt = task.updatedAt;
    updatedTask = task;
    return phase;
  });
  await store.writeGenerated();
  const task = updatedTask ?? found.task;
  const refreshedFeatures = (await store.loadFeatures()).features;
  return {
    task,
    ref: taskCompositeRef(task, found.phase, refreshedFeatures),
    updatedFields: [...updatedFields],
    checklistLostTicks,
  };
}
