/**
 * Feature application flows (P128(F025)/T490 — one coordinated authority).
 *
 * Creating a feature is domain orchestration, not harness behavior: one
 * flow here serves the MCP tools and the versioned HTTP API alike
 * (AGENTS.md rule 19). Identity allocation, lifecycle dates and the
 * atomic write are the flow's job; adapters wrap only their own envelope.
 */

import { createFeatureId, formatFeatureRef } from "./naming.js";
import { resolveFeatureRefStrict } from "./refs.js";
import { normalizeDescriptionRef } from "./payload-fallback.js";
import { nowISO } from "./plan-store.js";
import type { Feature, FeatureStatus, PlanStore } from "./index.js";

/** Refusal codes shared by every feature client surface. */
export type FeatureFlowRefusalCode =
  | "FEATURE_NOT_FOUND"
  | "FEATURE_NO_MUTABLE_FIELDS"
  | "FEATURE_STATUS_READ_ONLY"
  | "FEATURE_NAME_REQUIRED"
  | "FEATURE_DESCRIPTION_TOO_SHORT"
  | "FEATURE_STATUS_INVALID";

/**
 * A typed refusal raised before or during orchestration. Adapters map the
 * code to their own presentation; the code is the stable part. Details
 * carry the domain facts (refs, statuses, field lists) so every surface
 * renders the same rule with its own action labels.
 */
export class FeatureFlowRefusal extends Error {
  readonly code: FeatureFlowRefusalCode;
  readonly details: Record<string, unknown>;

  constructor(code: FeatureFlowRefusalCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FeatureFlowRefusal";
    this.code = code;
    this.details = details;
  }
}

const FEATURE_STATUSES = new Set<FeatureStatus>([
  "planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting",
]);

export interface FeatureCreateFlowInput {
  name: string;
  description: string;
  status?: string | undefined;
}

export interface FeatureCreateFlowOutcome {
  feature: Feature;
  /** Canonical ref, e.g. "F005". */
  ref: string;
  /** MCP-parity human message; HTTP ignores it. */
  message: string;
}

/** Create one feature; planner keeps ids, numbers and timestamps. */
export async function createFeatureFlow(store: PlanStore, input: FeatureCreateFlowInput): Promise<FeatureCreateFlowOutcome> {
  if (!input.name?.trim()) {
    throw new FeatureFlowRefusal("FEATURE_NAME_REQUIRED", "name is required.");
  }
  if (!input.description || input.description.trim().length < 50) {
    throw new FeatureFlowRefusal(
      "FEATURE_DESCRIPTION_TOO_SHORT",
      "Description must be at least 50 characters — include code references (file:line), current state, goals, and behaviors to preserve.",
    );
  }
  const effectiveStatus = (input.status ?? "planned") as FeatureStatus;
  if (!FEATURE_STATUSES.has(effectiveStatus)) {
    throw new FeatureFlowRefusal("FEATURE_STATUS_INVALID", `status must be one of: ${[...FEATURE_STATUSES].join(", ")}.`);
  }

  return store.runBatch(async () => {
    const timestamp = nowISO();
    const id = createFeatureId();
    const identity = await store.allocateEntityIdentity("feature", id);
    const priority = await store.nextPriority("feature");
    const feature: Feature = {
      id,
      number: identity.number,
      shortId: identity.shortId,
      priority,
      name: input.name.trim(),
      description: input.description.trim(),
      descriptionUpdatedAt: timestamp,
      status: effectiveStatus,
      discussedAt: "",
      contextReady: false,
      contextReadyReason: "",
      startDate: effectiveStatus === "in-progress" ? new Date().toISOString().slice(0, 10) : "",
      endDate: effectiveStatus === "done" ? new Date().toISOString().slice(0, 10) : "",
      workDone: "",
      workRemaining: "",
      acceptedDecisions: [],
      phaseIds: [],
      dependsOn: [],
      statusLog: [],
      sessionInfo: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await store.updateFeatures((document) => {
      document.features.push(feature);
      return document;
    });
    await store.writeGenerated();
    const ref = formatFeatureRef(feature.number);
    return {
      feature,
      ref,
      message: `✅ Feature created: ${ref} — ${feature.name}${feature.shortId ? ` · ${feature.shortId}` : ""}`,
    };
  });
}

export interface FeatureUpdateFlowInput {
  name?: string | undefined;
  description?: string | undefined;
  descriptionRef?: string | undefined;
  workDone?: string | undefined;
  workRemaining?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  priority?: number | undefined;
  /** Rejected by the flow: feature status is derived from child phases. */
  status?: string | undefined;
}

export interface FeatureUpdateFlowOutcome {
  feature: Feature;
  /** Canonical ref after the write (e.g. "F025"). */
  ref: string;
  updatedFields: string[];
}

const FEATURE_MUTABLE_FIELDS = [
  "name", "description", "descriptionRef", "workDone", "workRemaining", "startDate", "endDate", "priority",
] as const;

/**
 * Update feature metadata. The derived status is read-only (it rolls up
 * from child phases); the flow refuses it with the facts every surface
 * needs to render the same rule. Field admission and the status rule are
 * enforced here so MCP and HTTP cannot drift.
 */
export async function updateFeatureFlow(store: PlanStore, ref: string, input: FeatureUpdateFlowInput): Promise<FeatureUpdateFlowOutcome> {
  const features = (await store.loadFeatures()).features;
  const resolvedFeature = resolveFeatureRefStrict(features, ref);
  if (!resolvedFeature.ok) {
    throw new FeatureFlowRefusal("FEATURE_NOT_FOUND", resolvedFeature.error);
  }
  const feature = resolvedFeature.feature;
  const featureRef = formatFeatureRef(feature.number);
  if (input.status !== undefined) {
    throw new FeatureFlowRefusal("FEATURE_STATUS_READ_ONLY", `${featureRef} status is derived and cannot be set directly.`, {
      entity: "feature",
      ref: featureRef,
      featureId: feature.id,
      attemptedStatus: input.status,
      effectiveStatus: feature.status,
    });
  }
  const receivedFields = FEATURE_MUTABLE_FIELDS.filter((field) => input[field] !== undefined);
  if (receivedFields.length === 0) {
    throw new FeatureFlowRefusal("FEATURE_NO_MUTABLE_FIELDS", `No mutable feature fields were received for ${featureRef}.`, {
      entity: "feature",
      ref: featureRef,
      featureId: feature.id,
      operation: "update",
      mutableFields: [...FEATURE_MUTABLE_FIELDS],
    });
  }
  const updated = await store.updateFeatures((document) => {
    const target = document.features.find((entry) => entry.id === feature.id);
    if (!target) return document;
    if (input.name !== undefined) target.name = input.name.trim();
    if (input.description !== undefined) target.description = input.description.trim();
    if (input.descriptionRef !== undefined) {
      const descriptionRef = normalizeDescriptionRef(input.descriptionRef);
      if (descriptionRef) target.descriptionRef = descriptionRef;
      else delete target.descriptionRef;
    }
    if (input.workDone !== undefined) target.workDone = input.workDone.trim();
    if (input.workRemaining !== undefined) target.workRemaining = input.workRemaining.trim();
    if (input.startDate !== undefined) target.startDate = input.startDate.trim();
    if (input.endDate !== undefined) target.endDate = input.endDate.trim();
    if (input.priority !== undefined) target.priority = input.priority;
    target.updatedAt = nowISO();
    return document;
  });
  const result = updated.features.find((entry) => entry.id === feature.id)!;
  await store.writeGenerated();
  return { feature: result, ref: formatFeatureRef(result.number), updatedFields: [...receivedFields] };
}
