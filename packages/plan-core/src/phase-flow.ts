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
import { resolveFeatureRefStrict } from "./refs.js";
import { nowISO, withFeatureLock } from "./plan-store.js";
import type { Feature, Phase, PlanStore } from "./index.js";

/** Refusal codes shared by every phase client surface. */
export type PhaseFlowRefusalCode =
  | "PHASE_TITLE_REQUIRED"
  | "PHASE_FEATURE_REQUIRED"
  | "PHASE_FEATURE_NOT_FOUND"
  | "PHASE_DESCRIPTION_TOO_SHORT";

/**
 * A typed refusal raised before or during orchestration. Adapters map the
 * code to their own presentation; the code is the stable part.
 */
export class PhaseFlowRefusal extends Error {
  readonly code: PhaseFlowRefusalCode;

  constructor(code: PhaseFlowRefusalCode, message: string) {
    super(message);
    this.name = "PhaseFlowRefusal";
    this.code = code;
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
