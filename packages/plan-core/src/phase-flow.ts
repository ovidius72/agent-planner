/**
 * Phase application flows (P128(F025)/T490 — one coordinated authority).
 *
 * Creating a phase is domain orchestration, not harness behavior: one flow
 * here serves the MCP tools and the versioned HTTP API alike (AGENTS.md
 * rule 19). The feature must exist and is re-validated right before the
 * write; the phase write runs under the feature lock inside one atomic
 * batch, exactly as the MCP handler did.
 */

import {
  createPhaseId,
  featureNumberOfPhase,
  formatPhaseRef,
  normalizeSlug,
  validateResolvedTarget,
} from "./naming.js";
import { findPhaseByRef, resolveFeatureRefStrict } from "./refs.js";
import { normalizeDescriptionRef } from "./payload-fallback.js";
import { nowISO, withFeatureLock } from "./plan-store.js";
import type { Feature, HierarchicalDescriptionFreshness, Phase, PlanStore } from "./index.js";

/** Refusal codes shared by every phase client surface. */
export type PhaseFlowRefusalCode =
  | "PHASE_NOT_FOUND"
  | "PHASE_NO_MUTABLE_FIELDS"
  | "PHASE_STATUS_READ_ONLY"
  | "PHASE_LEGACY_DECISIONS_READ_ONLY"
  | "PHASE_TITLE_REQUIRED"
  | "PHASE_FEATURE_REQUIRED"
  | "PHASE_FEATURE_NOT_FOUND"
  | "PHASE_DESCRIPTION_TOO_SHORT";

/**
 * A typed refusal raised before or during orchestration. Adapters map the
 * code to their own presentation; the code is the stable part. Details
 * carry the domain facts (refs, statuses, field lists) so every surface
 * renders the same rule with its own action labels.
 */
export class PhaseFlowRefusal extends Error {
  readonly code: PhaseFlowRefusalCode;
  readonly details: Record<string, unknown>;

  constructor(code: PhaseFlowRefusalCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PhaseFlowRefusal";
    this.code = code;
    this.details = details;
  }
}

export interface PhaseCreateFlowInput {
  title: string;
  /** Feature ref the phase belongs to. REQUIRED — a phase belongs to a feature. */
  featureRef: string;
  summary?: string | undefined;
  description: string;
}

export interface PhaseCreateFlowOutcome {
  phase: Phase;
  feature: Feature;
  /** Canonical ref, e.g. "P102(F005)". */
  ref: string;
  /** MCP-parity human message; HTTP ignores it. */
  message: string;
}

/** Create a draft phase under a validated feature; planner keeps ids and numbers. */
export async function createPhaseFlow(store: PlanStore, input: PhaseCreateFlowInput): Promise<PhaseCreateFlowOutcome> {
  if (!input.title?.trim()) {
    throw new PhaseFlowRefusal("PHASE_TITLE_REQUIRED", "title is required.");
  }
  const featureRef = input.featureRef?.trim();
  if (!featureRef) {
    throw new PhaseFlowRefusal("PHASE_FEATURE_REQUIRED", "feature is required: a phase must belong to a feature.");
  }
  if (!input.description || input.description.trim().length < 50) {
    throw new PhaseFlowRefusal(
      "PHASE_DESCRIPTION_TOO_SHORT",
      "Description must be at least 50 characters — include code references (file:line), current state, structs/traits involved, concrete work items, behaviors to preserve.",
    );
  }

  const featuresDoc = await store.loadFeatures();
  const resolvedFeature = resolveFeatureRefStrict(featuresDoc.features, featureRef);
  if (!resolvedFeature.ok) {
    throw new PhaseFlowRefusal("PHASE_FEATURE_NOT_FOUND", resolvedFeature.error);
  }
  const feature = resolvedFeature.feature;
  const featureValidation = await validateResolvedTarget(
    "feature",
    feature.id,
    () => store.loadFeatures().then((document) => document.features.find((entry) => entry.id === feature.id)).catch(() => undefined),
  );
  if (!featureValidation.ok) {
    throw new PhaseFlowRefusal("PHASE_FEATURE_NOT_FOUND", featureValidation.error);
  }

  let created: Phase | undefined;
  await store.runBatch(() => withFeatureLock(feature.id, async () => {
    const timestamp = nowISO();
    const id = createPhaseId();
    const identity = await store.allocateEntityIdentity("phase", id);
    const priority = await store.nextPriority("phase", feature.id);
    const phase: Phase = {
      id,
      number: identity.number,
      shortId: identity.shortId,
      priority,
      slug: normalizeSlug(input.title),
      title: input.title.trim(),
      featureId: feature.id,
      status: "draft",
      discussedAt: "",
      contextReady: false,
      contextReadyReason: "",
      summary: input.summary?.trim() ?? "",
      description: input.description.trim(),
      descriptionUpdatedAt: timestamp,
      notes: "",
      goals: [],
      nonGoals: [],
      dependencies: [],
      dependsOn: [],
      risks: [],
      openQuestions: [],
      decisions: [],
      acceptedDecisions: [],
      completionCriteria: [],
      taskIds: [],
      tasks: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      handoff: "",
      handoffUpdatedAt: "",
      handoffAudit: null,
      handoffReadAt: "",
      handoffHistory: [],
      statusLog: [],
      sessionInfo: [],
    };
    await store.savePhase(phase);
    await store.updateFeatures((document) => {
      const target = document.features.find((entry) => entry.id === feature.id);
      if (target && !target.phaseIds.includes(phase.id)) target.phaseIds.push(phase.id);
      return document;
    });
    await store.writeGenerated();
    created = phase;
  }));
  if (!created) {
    throw new PhaseFlowRefusal("PHASE_FEATURE_NOT_FOUND", "Phase creation failed.");
  }
  const ref = formatPhaseRef(created.number, featureNumberOfPhase(created, featuresDoc.features));
  return {
    phase: created,
    feature,
    ref,
    message: `✅ Phase created: ${ref} — ${created.title}${created.shortId ? ` · ${created.shortId}` : ""}`,
  };
}

export interface PhaseUpdateFlowInput {
  title?: string | undefined;
  summary?: string | undefined;
  description?: string | undefined;
  descriptionRef?: string | undefined;
  featureId?: string | undefined;
  priority?: number | undefined;
  goals?: string[] | undefined;
  nonGoals?: string[] | undefined;
  dependencies?: string[] | undefined;
  risks?: string[] | undefined;
  openQuestions?: string[] | undefined;
  completionCriteria?: string[] | undefined;
  /** Rejected by the flow: phase status is derived from child tasks. */
  status?: string | undefined;
  /** Rejected by the flow: the legacy free-form decisions array is read-only history. */
  decisions?: string[] | undefined;
}

export interface PhaseUpdateFlowOutcome {
  phase: Phase;
  /** Canonical ref after the write (a feature move changes the parent number). */
  ref: string;
  updatedFields: string[];
  /** Present when description/descriptionRef changed: the bounded freshness preview the MCP reply embeds. */
  descriptionFreshness: HierarchicalDescriptionFreshness | null;
  staleParentRefs: string[];
}

const PHASE_MUTABLE_FIELDS = [
  "title", "summary", "description", "descriptionRef", "featureId", "priority",
  "goals", "nonGoals", "dependencies", "risks", "openQuestions", "completionCriteria",
] as const;

const trimList = (values: string[]): string[] => values.map((item) => item.trim()).filter(Boolean);

/**
 * Update phase governance fields. Derived status is read-only; the legacy
 * free-form decisions array stays read-only for history; the optional
 * feature move is resolved and the phaseIds back-links are swapped inside
 * one batch, exactly as the MCP handler did.
 */
export async function updatePhaseFlow(store: PlanStore, ref: string, input: PhaseUpdateFlowInput): Promise<PhaseUpdateFlowOutcome> {
  const features = (await store.loadFeatures()).features;
  const found = findPhaseByRef(await store.loadAllPhases(), features, ref);
  if (!found) {
    throw new PhaseFlowRefusal("PHASE_NOT_FOUND", `Phase not found: ${ref}`);
  }
  const phaseRef = formatPhaseRef(found.number, featureNumberOfPhase(found, features));
  if (input.status !== undefined) {
    throw new PhaseFlowRefusal("PHASE_STATUS_READ_ONLY", `${phaseRef} status is derived and cannot be set directly.`, {
      entity: "phase",
      ref: phaseRef,
      phaseId: found.id,
      attemptedStatus: input.status,
      effectiveStatus: found.status,
    });
  }
  if (input.decisions !== undefined) {
    throw new PhaseFlowRefusal("PHASE_LEGACY_DECISIONS_READ_ONLY", "The legacy free-form decisions list is read-only for history.", {
      entity: "phase",
      ref: phaseRef,
      phaseId: found.id,
    });
  }
  const receivedFields = PHASE_MUTABLE_FIELDS.filter((field) => input[field] !== undefined);
  if (receivedFields.length === 0) {
    throw new PhaseFlowRefusal("PHASE_NO_MUTABLE_FIELDS", `No mutable phase fields were received for ${phaseRef}.`, {
      entity: "phase",
      ref: phaseRef,
      phaseId: found.id,
      operation: "update",
      mutableFields: [...PHASE_MUTABLE_FIELDS],
    });
  }
  const previousFeatureId = found.featureId;
  let nextFeatureId = previousFeatureId;
  if (input.featureId !== undefined) {
    if (input.featureId.trim() === "") {
      nextFeatureId = undefined;
    } else {
      const resolvedFeature = resolveFeatureRefStrict(features, input.featureId);
      if (!resolvedFeature.ok) {
        throw new PhaseFlowRefusal("PHASE_FEATURE_NOT_FOUND", resolvedFeature.error);
      }
      nextFeatureId = resolvedFeature.feature.id;
    }
  }

  let persisted: Phase | undefined;
  await store.runBatch(async () => {
    persisted = await store.updatePhase(found.id, (entry) => {
      if (input.title !== undefined) {
        entry.title = input.title.trim();
        entry.slug = normalizeSlug(input.title);
      }
      if (input.summary !== undefined) entry.summary = input.summary.trim();
      if (input.description !== undefined) entry.description = input.description.trim();
      if (input.descriptionRef !== undefined) {
        const descriptionRef = normalizeDescriptionRef(input.descriptionRef);
        if (descriptionRef) entry.descriptionRef = descriptionRef;
        else delete entry.descriptionRef;
      }
      if (input.featureId !== undefined) entry.featureId = nextFeatureId;
      if (input.priority !== undefined) entry.priority = input.priority;
      if (input.goals !== undefined) entry.goals = trimList(input.goals);
      if (input.nonGoals !== undefined) entry.nonGoals = trimList(input.nonGoals);
      if (input.dependencies !== undefined) entry.dependencies = trimList(input.dependencies);
      if (input.risks !== undefined) entry.risks = trimList(input.risks);
      if (input.openQuestions !== undefined) entry.openQuestions = trimList(input.openQuestions);
      if (input.completionCriteria !== undefined) entry.completionCriteria = trimList(input.completionCriteria);
      entry.updatedAt = nowISO();
      return entry;
    });
    if (input.featureId !== undefined && nextFeatureId !== previousFeatureId) {
      await store.updateFeatures((document) => {
        for (const feature of document.features) {
          if (feature.id === previousFeatureId) feature.phaseIds = feature.phaseIds.filter((phaseId) => phaseId !== found.id);
          if (feature.id === nextFeatureId && !feature.phaseIds.includes(found.id)) feature.phaseIds.push(found.id);
        }
        return document;
      });
    }
    await store.writeGenerated();
  });
  const phase = persisted!;
  const refreshedFeatures = (await store.loadFeatures()).features;
  const canonicalRef = formatPhaseRef(phase.number, featureNumberOfPhase(phase, refreshedFeatures));
  const descriptionFreshness = receivedFields.some((field) => field === "description" || field === "descriptionRef")
    ? await store.previewDescriptionReconciliation()
    : null;
  const staleParentRefs = descriptionFreshness?.diagnostics
    .filter((entry) => entry.state === "stale" && entry.ownerId === phase.featureId)
    .map((entry) => entry.ownerRef) ?? [];
  return { phase, ref: canonicalRef, updatedFields: [...receivedFields], descriptionFreshness, staleParentRefs };
}

export interface PhaseDeleteFlowOutcome {
  phaseId: string;
  /** Canonical ref at deletion time, e.g. "P102(F005)". */
  ref: string;
  shortId: string;
}

/** Delete a phase and unlink it from every feature's phaseIds, in one batch. */
export async function deletePhaseFlow(store: PlanStore, ref: string): Promise<PhaseDeleteFlowOutcome> {
  const phase = findPhaseByRef(await store.loadAllPhases(), (await store.loadFeatures()).features, ref);
  if (!phase) {
    throw new PhaseFlowRefusal("PHASE_NOT_FOUND", `Phase not found: ${ref}`);
  }
  await store.runBatch(async () => {
    await store.deletePhase(phase.id);
    await store.updateFeatures((document) => {
      for (const feature of document.features) feature.phaseIds = feature.phaseIds.filter((id) => id !== phase.id);
      return document;
    });
  });
  await store.writeGenerated();
  const ownerFeature = (await store.loadFeatures()).features.find((entry) => entry.id === phase.featureId);
  return {
    phaseId: phase.id,
    ref: formatPhaseRef(phase.number, ownerFeature?.number),
    shortId: phase.shortId,
  };
}
