/**
 * Accepted Decision ownership rule and the compatibility guards that enforce
 * it, shared by every adapter (MCP, Pi, HTTP, and any future harness).
 *
 * The rule: a decision has exactly one owner. Project-wide decisions belong
 * only to project.acceptedDecisions; feature-wide decisions only to that
 * feature; phase-specific decisions only to that phase; genuinely
 * task-local decisions only to that task. Nothing duplicates a decision
 * across two owners by default — see the semantic createAcceptedDecision /
 * updateAcceptedDecision / deleteAcceptedDecision operations in
 * plan-store.ts, which already write to exactly one target.
 *
 * Two things previously worked against that rule, both fixed here once so
 * no adapter has to restate the wording (AGENTS.md rule 4):
 *
 * 1. `decision_record` (Pi) wrote the same decision onto both a feature and
 *    a phase. It no longer writes anything; see
 *    buildDecisionRecordRedirectReply.
 * 2. The legacy free-form `decisions: string[]` field on project, phase,
 *    and task let an agent keep "recording" decisions in a place nothing
 *    treats as authoritative (buildBoundedAcceptedDecisionContext only ever
 *    reads acceptedDecisions). Every update tool that exposes this field
 *    now rejects new writes to it with LEGACY_DECISIONS_ARRAY_READ_ONLY_MESSAGE,
 *    the same way raw acceptedDecisions replacement was already rejected.
 *    Existing legacy content is left exactly as persisted — read-only, not
 *    deleted or migrated; only project-level legacy decisions get folded
 *    into acceptedDecisions, and only through the existing explicit
 *    project-context migration, never automatically here.
 */
import { PlanStoreError, type PlanStore } from "./plan-store.js";
import { formatFeatureRef, formatPhaseRef, featureNumberOfPhase } from "./naming.js";
import { findPhaseByRef, findTaskByRef, resolveFeatureRefStrict } from "./refs.js";
import type { MutationReply } from "./mutation-reply.js";

export const ACCEPTED_DECISION_OWNERSHIP_RULE =
  "A decision has exactly one owner: the project when it is project-wide, a feature when it is feature-wide, a phase when it is phase-specific, or a task when the decision is genuinely local to that task's work and will not outlive it. Never record the same decision on more than one owner.";

export const ACCEPTED_DECISION_RAW_REPLACEMENT_DISABLED_MESSAGE =
  "Raw acceptedDecisions replacement is disabled. Use the accepted-decision create, update, or delete operations (accepted_decision_create/update/delete, planner-accepted-decision-create/update/delete, or the /accepted-decisions HTTP endpoints) so IDs and acceptedAt are preserved.";

export const LEGACY_DECISIONS_ARRAY_READ_ONLY_MESSAGE =
  `The legacy free-form decisions list is retained read-only for history; it is not decision authority. ${ACCEPTED_DECISION_OWNERSHIP_RULE} Record new durable decisions with the accepted-decision create operation on the owner that actually holds this one.`;

export const ACCEPTED_DECISION_SEMANTIC_MUTATION_REQUIRED_ERROR_CODE = "ACCEPTED_DECISION_SEMANTIC_MUTATION_REQUIRED";
export const LEGACY_DECISIONS_ARRAY_READ_ONLY_ERROR_CODE = "LEGACY_DECISIONS_ARRAY_READ_ONLY";

/**
 * decision_record's compatibility reply: a typed redirect, never a write.
 * It cannot dual-write because it performs no write at all — the caller
 * must pick exactly one owner and call the semantic create operation
 * itself. Kept here so every current or future surface offering a
 * decision_record-shaped compatibility tool renders identical guidance
 * instead of drifting.
 */
export interface DecisionRecordRedirectInput {
  /** Resolved, human-readable feature ref (e.g. "F005"), for the feature suggestion. */
  featureRef: string;
  /** Resolved, human-readable phase ref (e.g. "P102(F005)"), for the phase suggestion. */
  phaseRef: string;
}

export interface DecisionRecordRedirectReply {
  text: string;
  structured: Record<string, unknown>;
}

export function buildDecisionRecordRedirectReply(input: DecisionRecordRedirectInput): DecisionRecordRedirectReply {
  const { featureRef, phaseRef } = input;
  return {
    text: [
      `decision_record no longer writes a decision on both ${featureRef} and ${phaseRef}.`,
      ACCEPTED_DECISION_OWNERSHIP_RULE,
      "Call accepted_decision_create with the single owner this decision actually belongs to:",
      `- Project-wide: targetType "project" (omit targetRef).`,
      `- Feature-wide: targetType "feature", targetRef "${featureRef}".`,
      `- Phase-specific: targetType "phase", targetRef "${phaseRef}".`,
      `- Task-local: targetType "task", targetRef the exact task composite ref.`,
    ].join("\n"),
    structured: {
      recorded: false,
      written: false,
      redirected: true,
      redirectTool: "accepted_decision_create",
      ownershipRule: ACCEPTED_DECISION_OWNERSHIP_RULE,
      suggestions: {
        project: { targetType: "project" },
        feature: { targetType: "feature", targetRef: featureRef },
        phase: { targetType: "phase", targetRef: phaseRef },
        task: { targetType: "task", targetRef: null },
      },
    },
  };
}

/**
 * Resolve an Accepted Decision target (project/feature/phase/task) to its
 * owning entity id and a display ref. Both adapters carried an identical
 * copy for accepted_decision_create/update/delete; kept here so target
 * resolution can never drift from `resolveFeatureRefStrict`/
 * `findPhaseByRef`/`findTaskByRef` — the same ref grammar this project uses
 * everywhere else.
 */
export type AcceptedDecisionTargetType = "project" | "feature" | "phase" | "task";
export type AcceptedDecisionTargetResolution =
  | { ok: true; owner: { kind: "project" } | { kind: "feature"; featureId: string } | { kind: "phase"; phaseId: string } | { kind: "task"; phaseId: string; taskId: string }; ref: string }
  | { ok: false; error: string };

export async function resolveAcceptedDecisionTarget(
  st: PlanStore,
  targetType: AcceptedDecisionTargetType,
  targetRef: string | undefined,
): Promise<AcceptedDecisionTargetResolution> {
  if (targetType === "project") {
    const project = await st.loadProject();
    return { ok: true, owner: { kind: "project" }, ref: project.name };
  }
  const ref = targetRef?.trim();
  if (!ref) return { ok: false, error: `targetRef is required for ${targetType} accepted decisions.` };
  const [featuresDoc, phases] = await Promise.all([st.loadFeatures(), st.loadAllPhases()]);
  const features = featuresDoc.features;
  if (targetType === "feature") {
    const resolved = resolveFeatureRefStrict(features, ref);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return { ok: true, owner: { kind: "feature", featureId: resolved.feature.id }, ref: formatFeatureRef(resolved.feature.number) };
  }
  if (targetType === "phase") {
    const phase = findPhaseByRef(phases, features, ref);
    if (!phase) return { ok: false, error: `Phase not found: ${ref}` };
    return { ok: true, owner: { kind: "phase", phaseId: phase.id }, ref: formatPhaseRef(phase.number, featureNumberOfPhase(phase, features)) };
  }
  const found = findTaskByRef(phases, features, ref);
  if (!found) return { ok: false, error: `Task not found: ${ref}` };
  return {
    ok: true,
    owner: { kind: "task", phaseId: found.phase.id, taskId: found.task.id },
    ref: `${formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features))}/T${String(found.task.number).padStart(3, "0")}`,
  };
}

/**
 * Render a PlanStoreError raised by an Accepted Decision create/update/delete
 * as a text/structured pair, or rethrow when it isn't one of those (a
 * different failure is the caller's to handle). Both adapters carried an
 * identical copy of this decision; kept here so the type check and the
 * message can never drift. Each adapter still wraps its own envelope.
 */
export function acceptedDecisionMutationFailureReply(error: unknown, outcome: "created" | "updated" | "deleted"): MutationReply {
  if (!(error instanceof PlanStoreError) || !String(error.details?.errorCode ?? "").startsWith("ACCEPTED_DECISION_")) throw error;
  return {
    text: `❌ Accepted Decision mutation failed [${error.details?.errorCode}]: ${error.message}`,
    structured: { [outcome]: false, ...error.details },
  };
}
