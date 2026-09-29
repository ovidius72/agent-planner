/**
 * P108(F005)/T443 — planner-task-move over the real MCP server. Proves the
 * published tool moves a task between real phase files (not just the core
 * unit) and that the reply stays small and ref-only no matter how large the
 * moved task's own description is: a caller moving a task already has that
 * text and must not be billed for it again.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PhaseSchema, createPhaseId } from "../../plan-core/dist/index.js";
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

async function addEmptyPhase(store, number) {
  const now = new Date().toISOString();
  const phase = PhaseSchema.parse({ id: createPhaseId(), number, slug: `phase-${number}`, title: `Phase ${number}`, createdAt: now, updatedAt: now });
  await store.savePhase({ ...phase, tasks: [], taskIds: [] });
  return phase;
}

test("planner-task-move moves a task to another phase and reports old ref → new ref", async () => {
  const session = await startMcpFixture({ name: "t443-mcp-move" });
  try {
    const target = await addEmptyPhase(session.store, 2);

    const result = await callTool(session, "planner-task-move", { tasks: ["T001"], targetPhase: "P002" });
    assert.equal(result.isError, undefined);
    assert.match(toolText(result), /Moved 1 task\(s\) to P002/);
    const structured = toolStructured(result);
    assert.equal(structured.moved, true);
    assert.equal(structured.targetPhaseRef, "P002");
    assert.equal(structured.moves.length, 1);
    assert.equal(structured.moves[0].oldRef, "P001(F001)/T001");
    assert.equal(structured.moves[0].newRef, "P002/T001");
    assert.ok(structured.readBack);

    const sourcePhase = await session.store.loadPhase((await session.store.loadAllPhases()).find((p) => p.number === 1).id);
    assert.equal(sourcePhase.tasks.length, 0, "task must be gone from the source phase");
    const targetPhase = await session.store.loadPhase(target.id);
    assert.equal(targetPhase.tasks.length, 1);
    assert.equal(targetPhase.tasks[0].number, 1, "global task number is unchanged");
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-task-move rejects an unknown target phase with a typed error", async () => {
  const session = await startMcpFixture({ name: "t443-mcp-move-bad-target" });
  try {
    const result = await callTool(session, "planner-task-move", { tasks: ["T001"], targetPhase: "P099" });
    assert.equal(result.isError, true);
    assert.equal(toolStructured(result).errorCode, "TARGET_PHASE_NOT_FOUND");
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-task-move reply stays small and never echoes the moved task's description, however large", async () => {
  const session = await startMcpFixture({ name: "t443-mcp-move-large" });
  try {
    const target = await addEmptyPhase(session.store, 2);
    const sourcePhase = (await session.store.loadAllPhases()).find((p) => p.number === 1);
    const bigDescription = "D".repeat(20_000);
    await session.store.updateTask(sourcePhase.id, sourcePhase.tasks[0].id, (task) => ({ ...task, description: bigDescription }));

    const result = await callTool(session, "planner-task-move", { tasks: ["T001"], targetPhase: "P002" });
    assert.equal(result.isError, undefined);

    const structured = toolStructured(result);
    const serialized = JSON.stringify(structured);
    assert.ok(serialized.length < 1500, `structured reply must stay small; was ${serialized.length} chars`);
    assert.ok(!serialized.includes("D".repeat(50)), "reply must never echo the moved task's description");
    assert.ok(!toolText(result).includes("D".repeat(50)), "reply text must never echo the moved task's description");

    const movedTask = (await session.store.loadPhase(target.id)).tasks[0];
    assert.equal(movedTask.description, bigDescription, "the description itself is still preserved on disk");
  } finally {
    await closeMcpFixture(session);
  }
});
