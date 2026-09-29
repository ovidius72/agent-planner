/**
 * P108(F005)/T444 — planner-task-dependency-add, over the real MCP server,
 * accepts a cross-phase dependency: the description used to say "rejects
 * ... foreign tasks", which read as phase-local even though the core
 * operation never was. This is the MCP-side proof to match the plan-core
 * unit test.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PhaseSchema, createPhaseId, createTaskId } from "../../plan-core/dist/index.js";
import {
  startMcpFixture,
  closeMcpFixture,
  cleanupMcpFixtures,
  callTool,
  toolStructured,
} from "../../../test/helpers/mcp-fixture.mjs";

after(async () => {
  await cleanupMcpFixtures();
});

test("planner-task-dependency-add accepts a dependency on a task in a different phase", async () => {
  const session = await startMcpFixture({ name: "t444-mcp-cross-phase-dependency" });
  try {
    const now = new Date().toISOString();
    const seededTaskId = (await session.store.loadAllPhases()).find((p) => p.number === 1).tasks[0].id;
    const otherPhase = PhaseSchema.parse({ id: createPhaseId(), number: 2, slug: "other-phase", title: "Other phase", createdAt: now, updatedAt: now });
    const otherTask = { id: createTaskId(), phaseId: otherPhase.id, number: 2, shortId: "", priority: 0, shortName: "other-task", title: "Other task", status: "planned", createdAt: now, updatedAt: now };
    await session.store.savePhase({ ...otherPhase, tasks: [otherTask], taskIds: [otherTask.id] });

    // T001 lives in P001 (the seeded phase); T002 lives in the just-added P002.
    const result = await callTool(session, "planner-task-dependency-add", { task: "T002", dependsOn: "T001" });
    assert.equal(result.isError, undefined, "a cross-phase dependency must be accepted, not rejected as a foreign task");
    const structured = toolStructured(result);
    assert.equal(structured.updated, true);
    assert.deepEqual(structured.changed.dependsOn, [seededTaskId]);

    const persisted = await session.store.loadPhase(otherPhase.id);
    assert.deepEqual(persisted.tasks[0].dependsOn, [seededTaskId]);
  } finally {
    await closeMcpFixture(session);
  }
});
