/**
 * P104(F005)/T424 — both pi-adapter feature-delete surfaces (the
 * `feature_delete` tool and the interactive `/planner feature delete`
 * command) now call the shared deleteFeatureCascade (plan-core) instead of
 * hand-writing the mutation. Before this task the tool copy orphaned
 * phases when cascade was false (deleted the feature, never touched the
 * phases' featureId); this proves both surfaces now unlink or cascade
 * correctly and report the canonical F00x ref.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";

after(async () => {
  await cleanupPiHosts();
});

test("feature_delete tool (cascade false) unlinks the phase and reports the canonical ref", async () => {
  const host = await createPiHost({ name: "t424-tool-unlink", seed: "minimal" });
  try {
    const before = (await host.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.ok(before, "seed phase P001 exists");

    const result = await host.runTool("feature_delete", { featureId: "F001" });
    assert.match(toolText(result), /Feature deleted: F001/);
    assert.match(toolText(result), /unlinked: 1 phases/);
    const details = toolDetails(result);
    assert.equal(details.deleted, true);
    assert.equal(details.ref, "F001", "canonical F00x ref, not the raw featureId text");
    assert.equal(details.unlinkedPhases, 1);
    assert.equal(details.cascadedPhases, 0);

    const afterFeatures = (await host.store.loadFeatures()).features;
    assert.equal(afterFeatures.some((entry) => entry.number === 1), false);

    const afterPhase = (await host.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.ok(afterPhase, "phase survives an unlink delete");
    assert.equal(afterPhase.featureId, undefined, "phase must be unlinked, never left orphaned pointing at a deleted feature");
  } finally {
    await closePiHost(host);
  }
});

test("feature_delete tool (cascade true) deletes the phase outright", async () => {
  const host = await createPiHost({ name: "t424-tool-cascade", seed: "minimal" });
  try {
    const result = await host.runTool("feature_delete", { featureId: "F001", cascade: true });
    assert.match(toolText(result), /Feature deleted: F001 \(cascade: 1 phases\)/);
    assert.equal(toolDetails(result).cascadedPhases, 1);

    const afterPhase = (await host.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.equal(afterPhase, undefined, "cascade delete removes the phase");
  } finally {
    await closePiHost(host);
  }
});

test("interactive /planner feature delete (no cascade) unlinks the phase and reports the canonical ref", async () => {
  const host = await createPiHost({ name: "t424-interactive-unlink", seed: "minimal" });
  try {
    host.ui.confirmAnswer = false; // "Delete phases too?" → No (unlink)
    host.ui.inputAnswers.push("yes"); // confirm delete prompt
    await host.runCommand("feature delete F001");

    assert.match(host.ui.notifyCalls.at(-1)?.message ?? "", /Feature deleted: F001; unlinked 1 phase\(s\)/);

    const afterPhase = (await host.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.ok(afterPhase, "phase survives an unlink delete via the interactive path too");
    assert.equal(afterPhase.featureId, undefined, "interactive delete must not orphan the phase either");
  } finally {
    await closePiHost(host);
  }
});

test("interactive /planner feature delete cascades when confirmed", async () => {
  const host = await createPiHost({ name: "t424-interactive-cascade", seed: "minimal" });
  try {
    host.ui.confirmAnswer = true; // "Delete phases too?" → Yes (cascade)
    host.ui.inputAnswers.push("yes"); // confirm delete prompt
    await host.runCommand("feature delete F001");

    assert.match(host.ui.notifyCalls.at(-1)?.message ?? "", /Feature deleted: F001; deleted 1 phase\(s\)/);

    const afterPhase = (await host.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.equal(afterPhase, undefined, "interactive cascade delete removes the phase");
  } finally {
    await closePiHost(host);
  }
});
