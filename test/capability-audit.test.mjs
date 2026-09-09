import assert from "node:assert/strict";
import test from "node:test";
import { buildCapabilityAudit, renderCapabilityAuditMarkdown } from "../scripts/capability-audit.mjs";

test("capability audit is deterministic and classifies every manifest entry", () => {
  const first = buildCapabilityAudit();
  const second = buildCapabilityAudit();
  assert.deepEqual(first, second);
  assert.equal(first.entries.some((entry) => entry.status === "partial"), false);
  assert.ok(first.counts.complete > 0);
  assert.ok(first.counts.exempt > 0);
  assert.match(renderCapabilityAuditMarkdown(first), /handler registration alone never establishes completeness/i);
});
