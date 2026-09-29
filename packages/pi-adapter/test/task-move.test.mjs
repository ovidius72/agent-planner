/**
 * P108(F005)/T443 — task_move over the real pi host. Mirrors the MCP proof:
 * a task moves between real phase files keeping its identity, and the
 * reply stays small and ref-only no matter how large the moved task's own
 * description is.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PhaseSchema, createPhaseId } from "../../plan-core/dist/index.js";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";

after(async () => {
  await cleanupPiHosts();
});

async function addEmptyPhase(store, number) {
  const now = new Date().toISOString();
  const phase = PhaseSchema.parse({ id: createPhaseId(), number, slug: `phase-${number}`, title: `Phase ${number}`, createdAt: now, updatedAt: now });
  await store.savePhase({ ...phase, tasks: [], taskIds: [] });
  return phase;
}

test("task_move moves a task to another phase and reports old ref → new ref", async () => {
  const host = await createPiHost({ name: "t443-pi-move", seed: "minimal" });
  try {
    const target = await addEmptyPhase(host.store, 2);

    const result = await host.runTool("task_move", { taskIds: ["T001"], targetPhase: "P002" });
    assert.notEqual(result.isError, true);
    assert.match(toolText(result), /Moved 1 task\(s\) to P002/);
    const details = toolDetails(result);
    assert.equal(details.moved, true);
    assert.equal(details.targetPhaseRef, "P002");
    assert.equal(details.moves[0].oldRef, "P001(F001)/T001");
    assert.equal(details.moves[0].newRef, "P002/T001");

    const sourcePhaseId = (await host.store.loadAllPhases()).find((p) => p.number === 1).id;
    assert.equal((await host.store.loadPhase(sourcePhaseId)).tasks.length, 0);
    assert.equal((await host.store.loadPhase(target.id)).tasks.length, 1);
  } finally {
    await closePiHost(host);
  }
});

test("task_move rejects an unknown target phase with a typed error", async () => {
  const host = await createPiHost({ name: "t443-pi-move-bad-target", seed: "minimal" });
  try {
    const result = await host.runTool("task_move", { taskIds: ["T001"], targetPhase: "P099" });
    assert.equal(result.isError, true);
    assert.equal(toolDetails(result).errorCode, "TARGET_PHASE_NOT_FOUND");
  } finally {
    await closePiHost(host);
  }
});

test("task_move reply stays small and never echoes the moved task's description, however large", async () => {
  const host = await createPiHost({ name: "t443-pi-move-large", seed: "minimal" });
  try {
    const target = await addEmptyPhase(host.store, 2);
    const sourcePhase = (await host.store.loadAllPhases()).find((p) => p.number === 1);
    const bigDescription = "D".repeat(20_000);
    await host.store.updateTask(sourcePhase.id, sourcePhase.tasks[0].id, (task) => ({ ...task, description: bigDescription }));

    const result = await host.runTool("task_move", { taskIds: ["T001"], targetPhase: "P002" });
    assert.notEqual(result.isError, true);

    const details = toolDetails(result);
    const serialized = JSON.stringify(details);
    assert.ok(serialized.length < 1500, `details reply must stay small; was ${serialized.length} chars`);
    assert.ok(!serialized.includes("D".repeat(50)));
    assert.ok(!toolText(result).includes("D".repeat(50)));

    const movedTask = (await host.store.loadPhase(target.id)).tasks[0];
    assert.equal(movedTask.description, bigDescription, "the description itself is still preserved on disk");
  } finally {
    await closePiHost(host);
  }
});
