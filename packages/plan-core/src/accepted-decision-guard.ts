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
