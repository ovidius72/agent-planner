/**
 * Parked tasks (waiting, blocked, deferred) start directly, and every refusal
 * names the way out. Real MCP server over stdio, real PlanStore, temp folders.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startMcpFixture, closeMcpFixture, cleanupMcpFixtures, callTool, toolText, toolStructured } from "../../../test/helpers/mcp-fixture.mjs";

after(async () => {
  await cleanupMcpFixtures();
});

async function readTaskContext(session) {
  await callTool(session, "planner-task-show", { task: "T001", full: true });
  await callTool(session, "planner-phase-show", { phase: "P001", full: true });
  await callTool(session, "planner-feature-show", { feature: "F001", full: true });
  await callTool(session, "planner-requirement-list", { phaseRef: "P001" });
}

async function setStatus(session, status, { checkpoint = false } = {}) {
  const phase = (await session.store.loadAllPhases())[0];
  const task = phase.tasks[0];
  await session.store.updateTask(phase.id, task.id, (current) => ({
    ...current,
    status,
    pauseSnapshot: checkpoint
      ? { id: "p1", reason: "Parked for other work", whatWasBeingDone: "Half-way through", resumeLocation: "src/x.ts:1", howToResume: "Continue", relatedTaskId: "", pausedAt: new Date().toISOString(), pausedBy: "test" }
      : current.pauseSnapshot,
  }));
  return task.id;
}

for (const status of ["waiting", "blocked", "deferred"]) {
  test(`a ${status} task with a checkpoint starts directly and keeps its checkpoint notice`, async () => {
    const session = await startMcpFixture({ name: `parked-${status}` });
    try {
      // Dependencies of the seed task are finished by construction (it has none).
      await setStatus(session, status, { checkpoint: true });
      await readTaskContext(session);
      const started = await callTool(session, "planner-task-start", { task: "T001" });
      assert.match(toolText(started), /✅ Task started: P001\(F001\)\/T001/);
      assert.equal(toolStructured(started).started, true);
      const task = (await session.store.loadAllPhases())[0].tasks[0];
      assert.equal(task.status, "in-progress");
      assert.equal(task.statusLog.at(-1).fromStatus, status, "the log records the real previous status");
      assert.equal(task.pauseSnapshot, null, "the checkpoint is consumed by the resume");
    } finally {
      await closeMcpFixture(session);
    }
  });
}

test("a parked task with unfinished dependencies is still refused", async () => {
  const session = await startMcpFixture({ name: "parked-dependency" });
  try {
    await callTool(session, "planner-task-add", { feature: "F001", phase: "P001", title: "Second", description: "src/dep.ts:1 task that depends on the first one, used to prove dependency gates stay." });
    const phase = (await session.store.loadAllPhases())[0];
    const [first, second] = phase.tasks;
    await session.store.updateTask(phase.id, second.id, (current) => ({ ...current, status: "waiting", dependsOn: [first.id] }));
    await callTool(session, "planner-task-show", { task: "T002", full: true });
    await callTool(session, "planner-phase-show", { phase: "P001", full: true });
    await callTool(session, "planner-feature-show", { feature: "F001", full: true });
    await callTool(session, "planner-requirement-list", { phaseRef: "P001" });
    const refused = await callTool(session, "planner-task-start", { task: "T002" }, { expectError: true });
    assert.match(toolText(refused), /dependencies/i);
    assert.equal((await session.store.loadAllPhases())[0].tasks[1].status, "waiting");
  } finally {
    await closeMcpFixture(session);
  }
});

for (const status of ["canceled", "rejected"]) {
  test(`a ${status} task is refused with the way out, and the two-step path works`, async () => {
    const session = await startMcpFixture({ name: `refused-${status}` });
    try {
      await setStatus(session, status);
      await readTaskContext(session);
      const refused = await callTool(session, "planner-task-start", { task: "T001" }, { expectError: true });
      assert.equal(toolStructured(refused).started, false);
      assert.match(toolText(refused), new RegExp(`${status}`));
      assert.match(toolText(refused), /planned with a motivation/);

      const planned = await callTool(session, "planner-task-update", { task: "T001", status: "planned", motivation: "Reopening the decision on purpose for this test." });
      assert.match(toolText(planned), /planned/);
      const started = await callTool(session, "planner-task-start", { task: "T001" });
      assert.equal(toolStructured(started).started, true);
    } finally {
      await closeMcpFixture(session);
    }
  });
}

test("a done task is refused and the refusal points at planner-task-reopen", async () => {
  const session = await startMcpFixture({ name: "refused-done" });
  try {
    await setStatus(session, "done");
    await readTaskContext(session);
    const refused = await callTool(session, "planner-task-start", { task: "T001" }, { expectError: true });
    assert.equal(toolStructured(refused).started, false);
    assert.match(toolText(refused), /planner-task-reopen|reopen/i);
  } finally {
    await closeMcpFixture(session);
  }
});
