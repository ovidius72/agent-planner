import {
  HANDOFF_COMPLETENESS_AUDIT_VERSION,
  HANDOFF_COMPLETENESS_CATEGORIES,
  HANDOFF_COLD_START_INVENTORY_VERSION,
  HANDOFF_COLD_START_SOURCE_REVIEWS,
  HANDOFF_COLD_START_INVENTORY_CATEGORIES,
} from "../../packages/plan-core/dist/index.js";

export function completeHandoffAudit() {
  return {
    version: HANDOFF_COMPLETENESS_AUDIT_VERSION,
    entries: HANDOFF_COMPLETENESS_CATEGORIES.map(({ id, label }) => ({
      category: id,
      status: "captured",
      detail: `${label} is captured with concrete operational context for the next agent.`,
    })),
  };
}

export function completeHandoffColdStartInventory(options = {}) {
  const file = options.file ?? "handoff.test.mjs";
  const items = {
    files: [file],
    symbols: ["handoff contract"],
    "working-tree-ownership": ["The fixture diff is complete and must be preserved"],
    "negative-state": ["No deletion has started and no unrelated file was modified"],
    "commands-tools": ["recorded commands"],
    "runtime-wiring": ["fixture state flows through the handoff contract"],
    "preservation-constraints": ["The existing fixture startup path must continue working"],
    "verification-evidence": ["The focused fixture test passed and confirms the handoff path is live"],
    "related-planned-work": ["No sibling fixture capability should be duplicated"],
    "user-visible-behavior": ["Durable operational context remains visible to the next agent"],
    "operator-actions": ["rerun verification"],
    "blockers-risks": ["No known fixture blocker"],
    "remaining-work": ["Continue the exact recorded implementation"],
    "ordered-resume-steps": ["Continue the fixture with the recorded commands and verification steps"],
  };
  return {
    version: HANDOFF_COLD_START_INVENTORY_VERSION,
    sourceReviews: HANDOFF_COLD_START_SOURCE_REVIEWS.map(({ id, label }) => ({
      source: id,
      detail: `${label} was reviewed before this fixture handoff was drafted.`,
    })),
    entries: HANDOFF_COLD_START_INVENTORY_CATEGORIES.map(({ id }) => ({ category: id, items: items[id] })),
  };
}

export function canonicalAuditedHandoff(title, detail, options = {}) {
  const file = options.file ?? "handoff.test.mjs";
  const reason = options.reason ?? "test fixture";
  return [
    `# ${title}`,
    "",
    "Created at: 2026-08-24T00:00:00.000Z",
    "Updated at: 2026-08-24T00:00:00.000Z",
    `Reason: ${reason}`,
    "",
    "## Current focus", detail,
    "## Current and partial state",
    `${detail} The fixture diff is complete and must be preserved; handoff contract state flows through fixture state flows through the handoff contract. The focused fixture test passed and confirms the handoff path is live. Durable operational context remains visible to the next agent. No sibling fixture capability should be duplicated. Continue the exact recorded implementation.`,
    "## Preservation constraints", "The existing fixture startup path must continue working. No deletion has started and no unrelated file was modified.",
    "## Supporting documents", `- ${file} — Retained as the inline resume capsule fixture reference with recorded commands.`,
    "## Blockers and risks", "- No known fixture blocker.",
    "## How to resume", "1. Continue the fixture with the recorded commands and verification steps; rerun verification.",
  ].join("\n");
}
