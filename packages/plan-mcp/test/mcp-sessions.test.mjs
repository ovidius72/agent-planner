/**
 * Two agents (two MCP sessions) on one planner each keep their own side-task
 * stack: one agent's temporary switch is not the other agent's return target.
 * Real MCP servers over stdio, real PlanStore, temp folders.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  startMcpFixture,
  startMcpClient,
  closeMcpFixture,
  cleanupMcpFixtures,
  callTool,
  toolText,
  toolStructured,
} from "../../../test/helpers/mcp-fixture.mjs";

after(async () => {
  await cleanupMcpFixtures();
});

async function readTaskContext(session, task, phase = "P001", feature = "F001") {
  await callTool(session, "planner-task-show", { task, full: true });
  await callTool(session, "planner-phase-show", { phase, full: true });
  await callTool(session, "planner-feature-show", { feature, full: true });
  await callTool(session, "planner-requirement-list", { phaseRef: phase });
}

async function addTask(session, title) {
  await callTool(session, "planner-task-add", {
    feature: "F001", phase: "P001", title,
    description: "src/sessions.ts:1 temporary work used to prove per-session side-task stacks.",
  });
}

/** Agent A starts T002, switches to T001 for a detour and finishes it: A must return to T002. */
async function agentADetour(a) {
  await readTaskContext(a, "T002");
  await callTool(a, "planner-task-start", { task: "T002" });
  await callTool(a, "planner-task-show", { task: "T001", full: true });
  await callTool(a, "planner-task-switch", {
    from_task: "T002", to_task: "T001", reason: "Detour needed before continuing",
    what_was_being_done: "Working on T002", resume_location: "src/a.ts:1", how_to_resume: "Continue T002", switched_by: "agent-a",
  });
  return callTool(a, "planner-task-complete", { task: "T001", force: true, motivation: "Seed checklist item is irrelevant to this detour.", description_update: "Detour finished and verified for the session test." });
}

test("agent A's finished detour makes A return to its task, but not agent B", async () => {
  const a = await startMcpFixture({ name: "sessions-return" });
  try {
    await addTask(a, "Second task");
    await addTask(a, "Third task");
    const b = await startMcpClient({ planRoot: a.planRoot, name: "agent-b" });

    const done = await agentADetour(a);
    assert.match(toolText(done), /RESUME REQUIRED: P001\(F001\)\/T002/);

    const forA = await callTool(a, "planner-task-recommend", {});
    assert.equal(toolStructured(forA).kind, "resume", "A is told to return to its preserved task");
    assert.match(toolText(forA), /T002/);

    const forB = await callTool(b, "planner-task-recommend", {});
    assert.notEqual(toolStructured(forB).kind, "resume", "B is not sent back to a task it never left");
    assert.doesNotMatch(toolText(forB), /RESUME REQUIRED|Resume required/i);

    const stored = (await a.store.loadProject()).workDeviations;
    assert.equal(stored.length, 1);
    assert.match(stored[0].ownerSession, /^mcp-process:/, "the switch is stamped with the session that made it");
    assert.equal(stored[0].state, "resume-required");
    assert.equal((await a.store.loadProject("some-other-session")).workDeviations.length, 0, "another session cannot see it");
    assert.equal((await a.store.loadProject(stored[0].ownerSession)).workDeviations.length, 1);
    await b.close();
  } finally {
    await closeMcpFixture(a);
  }
});

test("B can start another task without being forced to resume A's task", async () => {
  const a = await startMcpFixture({ name: "sessions-start" });
  try {
    await addTask(a, "Second task");
    await addTask(a, "Third task");
    const b = await startMcpClient({ planRoot: a.planRoot, name: "agent-b" });
    await agentADetour(a);

    await readTaskContext(b, "T003");
    const started = await callTool(b, "planner-task-start", { task: "T003" });
    assert.match(toolText(started), /✅ Task started: P001\(F001\)\/T003/);
    assert.doesNotMatch(toolText(started), /RESUME REQUIRED before starting a different task/, "B has no pending return of its own");
    await b.close();
  } finally {
    await closeMcpFixture(a);
  }
});

test("a single agent sees exactly what it did before: the switch and the return still work", async () => {
  const a = await startMcpFixture({ name: "sessions-single" });
  try {
    await addTask(a, "Second task");
    await agentADetour(a);
    await readTaskContext(a, "T002");
    const shown = await callTool(a, "planner-task-show", { task: "T002", full: true });
    assert.match(toolText(shown), /Resume advisory:/);
    const resumed = await callTool(a, "planner-task-start", { task: "T002" });
    assert.match(toolText(resumed), /Task started: P001\(F001\)\/T002/);
    assert.equal((await a.store.loadProject()).workDeviations.at(-1).state, "resumed");
  } finally {
    await closeMcpFixture(a);
  }
});
