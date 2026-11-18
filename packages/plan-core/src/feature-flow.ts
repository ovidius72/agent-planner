/**
 * Feature application flows (P128(F025)/T490 — one coordinated authority).
 *
 * Creating a feature is domain orchestration, not harness behavior: one
 * flow here serves the MCP tools and the versioned HTTP API alike
 * (AGENTS.md rule 19). Identity allocation, lifecycle dates and the
 * atomic write are the flow's job; adapters wrap only their own envelope.
 */

import { createFeatureId, formatFeatureRef } from "./naming.js";
import { nowISO } from "./plan-store.js";
import type { Feature, FeatureStatus, PlanStore } from "./index.js";

/** Refusal codes shared by every feature client surface. */
export type FeatureFlowRefusalCode =
  | "FEATURE_NAME_REQUIRED"
  | "FEATURE_DESCRIPTION_TOO_SHORT"
  | "FEATURE_STATUS_INVALID";

/**
 * A typed refusal raised before any store mutation. Adapters map the
 * code to their own presentation; the code is the stable part.
 */
export class FeatureFlowRefusal extends Error {
  readonly code: FeatureFlowRefusalCode;

  constructor(code: FeatureFlowRefusalCode, message: string) {
    super(message);
    this.name = "FeatureFlowRefusal";
    this.code = code;
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
