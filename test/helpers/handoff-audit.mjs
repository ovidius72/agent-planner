import {
  HANDOFF_COMPLETENESS_AUDIT_VERSION,
  HANDOFF_COMPLETENESS_CATEGORIES,
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
    "## What was being done", detail,
    "## How to resume", "Continue the fixture with the recorded commands and verification steps.",
    "## Files touched", `- ${file}`,
    "## Blockers", "- None",
    "## Next steps", "- Continue the exact recorded implementation and rerun verification.",
    "## Recent decisions", "- Preserve durable operational context.",
  ].join("\n");
}
