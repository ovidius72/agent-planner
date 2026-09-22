/**
 * P104(F005)/T424 — planner-feature-delete now calls the shared
 * deleteFeatureCascade (plan-core), the same function every other delete
 * surface calls. This is the MCP-side proof: the reply carries a verified
 * result and the canonical F00x ref, and cascade:false leaves the phase
 * alive and unlinked (not pointing at a feature id nothing owns anymore).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  startMcpFixture,
  closeMcpFixture,
  cleanupMcpFixtures,
  callTool,
  toolText,
  toolStructured,
} from "../../../test/helpers/mcp-fixture.mjs";

after(async () => {
  await cleanupMcpFixtures();
});

test("planner-feature-delete (cascade false) reports the canonical ref, verified, and unlinks the phase", async () => {
  const session = await startMcpFixture({ name: "t424-mcp-unlink" });
  try {
    const before = (await session.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.ok(before, "seed phase P001 exists");

    const result = await callTool(session, "planner-feature-delete", { feature: "F001" });
    assert.match(toolText(result), /✅ Feature deleted: F001; unlinked 1 phases/);
    const structured = toolStructured(result);
    assert.equal(structured.deleted, true);
    assert.equal(structured.ref, "F001", "canonical F00x ref, not the raw UUID");
    assert.equal(structured.affectedPhases, 1);
    assert.equal(structured.cascade, false);

    const afterFeatures = (await session.store.loadFeatures()).features;
    assert.equal(afterFeatures.some((entry) => entry.number === 1), false, "feature is actually gone");

    const afterPhase = (await session.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.ok(afterPhase, "phase survives an unlink delete — it must not be orphaned by deletion");
    assert.equal(afterPhase.featureId, undefined, "phase's featureId is cleared, never left pointing at a feature that no longer exists");
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-feature-delete (cascade true) deletes the phase outright", async () => {
  const session = await startMcpFixture({ name: "t424-mcp-cascade" });
  try {
    const result = await callTool(session, "planner-feature-delete", { feature: "F001", cascade: true });
    assert.match(toolText(result), /✅ Feature deleted: F001; deleted 1 phases/);
    const structured = toolStructured(result);
    assert.equal(structured.ref, "F001");
    assert.equal(structured.cascade, true);

    const afterPhase = (await session.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.equal(afterPhase, undefined, "cascade delete removes the phase, not just the feature");
  } finally {
    await closeMcpFixture(session);
  }
});
