/**
 * Ideas Inbox flows shared by every surface.
 *
 * Ideas are rollup-independent: they never affect feature, phase or task
 * status. Promotion is a two-step protocol — a discussion that persists
 * nothing, then a finalize that records the already-created target only
 * after explicit confirmation.
 */

import { findFeatureByRef, findIdeaByRef, findPhaseByRef, findTaskByRef } from "./index.js";
import {
  formatFeatureRef,
  formatIdeaRef,
  formatPhaseRef,
  taskCompositeRef,
} from "./naming.js";
import type { Idea, PlanStore } from "./index.js";

export type IdeaTargetType = "feature" | "phase" | "task";

export type IdeaRefusalCode =
  | "IDEA_NOT_FOUND"
  | "IDEA_TITLE_REQUIRED"
  | "IDEA_NO_MUTABLE_FIELDS"
  | "IDEA_ALREADY_PROMOTED"
  | "IDEA_DELETE_CONFIRMATION_REQUIRED"
  | "IDEA_PROMOTION_CONFIRMATION_REQUIRED"
  | "IDEA_PROMOTION_TARGET_NOT_FOUND";

export interface IdeaRefusal {
  ok: false;
  code: IdeaRefusalCode;
  /** Surface-neutral sentence; adapters render their own words. */
  message: string;
  ideaRef?: string;
  /** Mutable fields for the no-mutable-fields refusal. */
  mutableFields?: string[];
  /** Target ref echoed by a promotion-target refusal. */
  targetRef?: string;
  targetType?: IdeaTargetType;
  /** The resolved idea, when the refusal is about an existing entry. */
  idea?: Idea;
}

export interface IdeaSuccess<T> {
  ok: true;
  idea: T;
}

export async function listIdeasFlow(store: PlanStore): Promise<{ ok: true; ideas: Idea[] }> {
  const doc = await store.loadIdeas();
  return { ok: true, ideas: doc.ideas };
}

export async function showIdeaFlow(store: PlanStore, ref: string): Promise<IdeaSuccess<Idea> | IdeaRefusal> {
  const idea = findIdeaByRef((await store.loadIdeas()).ideas, ref);
  if (!idea) return { ok: false, code: "IDEA_NOT_FOUND", message: `Idea not found: ${ref}` };
  return { ok: true, idea };
}

export interface CreateIdeaInput {
  title: string;
  description?: string | undefined;
}

export async function createIdeaFlow(
  store: PlanStore,
  input: CreateIdeaInput,
): Promise<IdeaSuccess<Idea> | IdeaRefusal> {
  if (!input.title.trim()) {
    return { ok: false, code: "IDEA_TITLE_REQUIRED", message: "An idea title is required." };
  }
  const idea = await store.createIdea({
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
  });
  await store.writeGenerated();
  return { ok: true, idea };
}

export interface UpdateIdeaInput {
  title?: string | undefined;
  description?: string | undefined;
}

export interface IdeaUpdateSuccess {
  ok: true;
  idea: Idea;
  /** Fields the caller actually supplied, in canonical order. */
  updatedFields: string[];
}

export async function updateIdeaFlow(
  store: PlanStore,
  ref: string,
  input: UpdateIdeaInput,
): Promise<IdeaUpdateSuccess | IdeaRefusal> {
  const current = findIdeaByRef((await store.loadIdeas()).ideas, ref);
  if (!current) return { ok: false, code: "IDEA_NOT_FOUND", message: `Idea not found: ${ref}` };
  if (input.title !== undefined && !input.title.trim()) {
    return {
      ok: false,
      code: "IDEA_TITLE_REQUIRED",
      message: "An idea title is required.",
      ideaRef: formatIdeaRef(current.number),
    };
  }
  if (input.title === undefined && input.description === undefined) {
    return {
      ok: false,
      code: "IDEA_NO_MUTABLE_FIELDS",
      message: "No mutable fields were received.",
      ideaRef: formatIdeaRef(current.number),
      mutableFields: ["title", "description"],
    };
  }
  const updatedFields = [
    ...(input.title !== undefined ? ["title"] : []),
    ...(input.description !== undefined ? ["description"] : []),
  ];
  const idea = await store.updateIdea(current.id, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
  });
  await store.writeGenerated();
  return { ok: true, idea, updatedFields };
}

export interface IdeaDeleteSuccess {
  ok: true;
  ideaRef: string;
  ideaId: string;
}

export async function deleteIdeaFlow(
  store: PlanStore,
  ref: string,
  confirmed: boolean,
): Promise<IdeaDeleteSuccess | IdeaRefusal> {
  const current = findIdeaByRef((await store.loadIdeas()).ideas, ref);
  if (!current) return { ok: false, code: "IDEA_NOT_FOUND", message: `Idea not found: ${ref}` };
  if (!confirmed) {
    return {
      ok: false,
      code: "IDEA_DELETE_CONFIRMATION_REQUIRED",
      message: "Idea deletion requires confirmed=true after explicit user confirmation.",
      ideaRef: formatIdeaRef(current.number),
    };
  }
  await store.deleteIdea(current.id);
  await store.writeGenerated();
  return { ok: true, ideaRef: formatIdeaRef(current.number), ideaId: current.id };
}

export interface IdeaPromotionBeginSuccess {
  ok: true;
  idea: Idea;
  targetType: IdeaTargetType;
  /** Surface-renderable recommendation for the discussion. */
  recommendation: string;
  grillMeSkill: string;
  nextActions: string[];
}

/**
 * Start the promotion discussion. Nothing is persisted: the caller still
 * has to create the agreed target through the normal create operations.
 */
export async function beginIdeaPromotionFlow(
  store: PlanStore,
  ref: string,
  targetType: IdeaTargetType,
): Promise<IdeaPromotionBeginSuccess | IdeaRefusal> {
  const idea = findIdeaByRef((await store.loadIdeas()).ideas, ref);
  if (!idea) return { ok: false, code: "IDEA_NOT_FOUND", message: `Idea not found: ${ref}` };
  if (idea.promotion) {
    return {
      ok: false,
      code: "IDEA_ALREADY_PROMOTED",
      message: `${formatIdeaRef(idea.number)} is already promoted to ${idea.promotion.targetRef}.`,
      ideaRef: formatIdeaRef(idea.number),
      idea,
    };
  }
  const features = (await store.loadFeatures()).features;
  const phases = await store.loadAllPhases();
  const recommendedFeature = features[0];
  const recommendedPhase = recommendedFeature
    ? phases.find((phase) => phase.featureId === recommendedFeature.id)
    : phases[0];
  const recommendation = targetType === "feature"
    ? "Create a new feature after the discussion."
    : targetType === "phase"
      ? recommendedFeature
        ? `Recommended parent feature: ${formatFeatureRef(recommendedFeature.number)} — ${recommendedFeature.name}. Confirm or choose another feature before creating the phase.`
        : "Create and confirm a parent feature before promoting to a phase."
      : recommendedPhase
        ? `Recommended destination: ${formatPhaseRef(recommendedPhase.number, features.find((feature) => feature.id === recommendedPhase.featureId)?.number)} — ${recommendedPhase.title}. Confirm its feature and phase before creating the task.`
        : "Create and confirm a parent feature and phase before promoting to a task.";
  return {
    ok: true,
    idea,
    targetType,
    recommendation,
    grillMeSkill: await store.ideaDiscussionSkill(),
    nextActions: [
      "Follow grill-me one question at a time.",
      "Obtain explicit parent and target confirmation.",
      "Create the agreed target through the normal feature/phase/task creation tool.",
      "Call planner-idea-promotion-finalize with discussionCompleted=true and confirmed=true.",
    ],
  };
}

export interface FinalizeIdeaPromotionInput {
  idea: string;
  targetType: IdeaTargetType;
  targetRef: string;
  discussionCompleted: boolean;
  confirmed: boolean;
}

export interface IdeaPromotionSuccess {
  ok: true;
  idea: Idea;
  /** Canonical ref of the recorded target. */
  targetRef: string;
}

export async function finalizeIdeaPromotionFlow(
  store: PlanStore,
  input: FinalizeIdeaPromotionInput,
): Promise<IdeaPromotionSuccess | IdeaRefusal> {
  if (!input.discussionCompleted || !input.confirmed) {
    return {
      ok: false,
      code: "IDEA_PROMOTION_CONFIRMATION_REQUIRED",
      message: "Promotion requires discussionCompleted=true and confirmed=true; no target or promotion was persisted.",
      targetType: input.targetType,
      targetRef: input.targetRef,
    };
  }
  const idea = findIdeaByRef((await store.loadIdeas()).ideas, input.idea);
  if (!idea) return { ok: false, code: "IDEA_NOT_FOUND", message: `Idea not found: ${input.idea}` };
  const target = await resolvePromotionTarget(store, input.targetType, input.targetRef);
  if (!target) {
    return {
      ok: false,
      code: "IDEA_PROMOTION_TARGET_NOT_FOUND",
      message: `Confirmed ${input.targetType} target not found: ${input.targetRef}; no promotion was persisted.`,
      ideaRef: formatIdeaRef(idea.number),
      targetType: input.targetType,
      targetRef: input.targetRef,
    };
  }
  const promoted = await store.promoteIdea(idea.id, { targetType: input.targetType, targetId: target.id });
  await store.writeGenerated();
  return { ok: true, idea: promoted, targetRef: promoted.promotion?.targetRef ?? target.ref };
}

/** Resolve the already-created target a promotion may record. */
async function resolvePromotionTarget(
  store: PlanStore,
  type: IdeaTargetType,
  ref: string,
): Promise<{ id: string; ref: string } | undefined> {
  const [featuresDoc, phases] = await Promise.all([store.loadFeatures(), store.loadAllPhases()]);
  const features = featuresDoc.features;
  if (type === "feature") {
    const feature = findFeatureByRef(features, ref);
    return feature ? { id: feature.id, ref: formatFeatureRef(feature.number) } : undefined;
  }
  if (type === "phase") {
    const phase = findPhaseByRef(phases, features, ref);
    return phase
      ? { id: phase.id, ref: formatPhaseRef(phase.number, features.find((item) => item.id === phase.featureId)?.number) }
      : undefined;
  }
  const found = findTaskByRef(phases, features, ref);
  return found ? { id: found.task.id, ref: taskCompositeRef(found.task, found.phase, features) } : undefined;
}
