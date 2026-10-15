/**
 * Two agents (two MCP sessions) on one planner each keep their own side-task
 * stack: one agent's temporary switch is not the other agent's return target.
 * Real MCP servers over stdio, real PlanStore, temp folders.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

test("MCP load and lifecycle persist each caller's own focus", async () => {
  const a = await startMcpFixture({ name: "sessions-focus" });
  try {
    await addTask(a, "Second task");
    const b = await startMcpClient({ planRoot: a.planRoot });
    await callTool(a, "planner-load");
    await callTool(b, "planner-load");
    let sessions = JSON.parse(await readFile(join(a.planRoot, ".local/resume-sessions.json"), "utf8"));
    assert.equal(Object.keys(sessions).length, 2);
    await readTaskContext(a, "T001");
    await readTaskContext(b, "T002");
    assert.equal(toolStructured(await callTool(a, "planner-task-start", { task: "T001" })).started, true);
    assert.equal(toolStructured(await callTool(b, "planner-task-start", { task: "T002" })).started, true);
    const tasks = (await a.store.loadAllPhases())[0].tasks;
    sessions = JSON.parse(await readFile(join(a.planRoot, ".local/resume-sessions.json"), "utf8"));
    for (const task of tasks) assert.deepEqual(sessions[task.activeOwnerSession].inProgressTaskIds, [task.id]);
    await callTool(a, "planner-task-pause", { task: "T001", reason: "Save progress", what_was_being_done: "Work on first task", resume_location: "src/a.ts:1", how_to_resume: "Continue first task" });
    assert.deepEqual((await a.store.loadResume(tasks[0].activeOwnerSession)).inProgressTaskIds, []);
    assert.deepEqual((await a.store.loadResume(tasks[1].activeOwnerSession)).inProgressTaskIds, [tasks[1].id]);
  } finally { await closeMcpFixture(a); }
});

test("only the owning caller gets an idempotent successful start", async () => {
  const a = await startMcpFixture({ name: "sessions-owned-start" });
  try {
    const b = await startMcpClient({ planRoot: a.planRoot });
    await readTaskContext(a, "T001");
    await readTaskContext(b, "T001");
    await callTool(a, "planner-task-start", { task: "T001" });
    const before = (await a.store.loadAllPhases())[0].tasks[0];
    const denied = await callTool(b, "planner-task-start", { task: "T001" }, { expectError: true });
    assert.equal(toolStructured(denied).started, false);
    assert.equal(toolStructured(denied).errorCode, "TASK_OWNED_BY_ANOTHER_SESSION");
    const again = await callTool(a, "planner-task-start", { task: "T001" });
    assert.equal(toolStructured(again).started, true);
    assert.equal(toolStructured(again).alreadyStarted, true);
    const after = (await a.store.loadAllPhases())[0].tasks[0];
    assert.equal(after.activeOwnerSession, before.activeOwnerSession);
    assert.deepEqual(after.statusLog, before.statusLog);
  } finally { await closeMcpFixture(a); }
});

test("concurrent stdio callers produce exactly one successful task owner", async () => {
  const a = await startMcpFixture({ name: "sessions-concurrent-start" });
  try {
    const b = await startMcpClient({ planRoot: a.planRoot });
    await readTaskContext(a, "T001");
    await readTaskContext(b, "T001");
    const replies = await Promise.all([a, b].map((session) => callTool(session, "planner-task-start", { task: "T001" })));
    assert.equal(replies.filter((reply) => toolStructured(reply).started).length, 1);
    assert.equal(replies.filter((reply) => reply.isError && toolStructured(reply).started === false).length, 1);
    const task = (await a.store.loadAllPhases())[0].tasks[0];
    assert.equal(task.status, "in-progress");
    assert.equal(task.statusLog.filter((entry) => entry.toStatus === "in-progress").length, 1);
    assert.equal(toolStructured(replies.find((reply) => toolStructured(reply).started)).task.activeOwnerSession, task.activeOwnerSession);
  } finally { await closeMcpFixture(a); }
});

test("a switch to another caller's task does not change either caller's checkpoint", async () => {
  const a = await startMcpFixture({ name: "sessions-owned-switch" });
  try {
    await addTask(a, "Second task");
    const b = await startMcpClient({ planRoot: a.planRoot });
    await readTaskContext(a, "T001");
    await readTaskContext(b, "T002");
    await callTool(a, "planner-task-start", { task: "T001" });
    await callTool(b, "planner-task-start", { task: "T002" });
    await readTaskContext(a, "T002");
    const before = (await a.store.loadAllPhases())[0].tasks;
    await callTool(a, "planner-task-switch", { from_task: "T001", to_task: "T002", reason: "Try foreign task", what_was_being_done: "First task", resume_location: "src/a.ts:1", how_to_resume: "Continue" }, { expectError: true });
    assert.deepEqual((await a.store.loadAllPhases())[0].tasks, before);
    assert.deepEqual((await a.store.loadProject()).workDeviations, []);
  } finally { await closeMcpFixture(a); }
});

test("restart recovery refuses a live owner and preserves a nested return stack after exit", async () => {
  const a = await startMcpFixture({ name: "sessions-restart" });
  try {
    await addTask(a, "Second task");
    await addTask(a, "Third task");
    await addTask(a, "Independent task");
    await readTaskContext(a, "T001");
    await callTool(a, "planner-task-start", { task: "T001" });
    for (const [from_task, to_task] of [["T001", "T002"], ["T002", "T003"]]) {
      await readTaskContext(a, to_task);
      await callTool(a, "planner-task-switch", { from_task, to_task, reason: "Nested detour", what_was_being_done: `Work on ${from_task}`, resume_location: "src/return.ts:1", how_to_resume: `Continue ${from_task}` });
    }
    const b = await startMcpClient({ planRoot: a.planRoot });
    await readTaskContext(b, "T004");
    await callTool(b, "planner-task-start", { task: "T004" });
    const c = await startMcpClient({ planRoot: a.planRoot });
    await readTaskContext(c, "T003");
    const denied = await callTool(c, "planner-task-start", { task: "T003" });
    assert.equal(toolStructured(denied).started, false, "a restart never claims success for old ownership");
    const before = await a.store.loadAll();
    const oldOwner = before.phases[0].tasks[2].activeOwnerSession;
    const oldFocus = await a.store.refreshResume("Keep recovery notes", "Nested detour underway", oldOwner);
    await callTool(c, "planner-session-recover", { task: "T003", confirmed: true }, { expectError: true });
    assert.deepEqual((await a.store.loadAll()).phases[0].tasks, before.phases[0].tasks, "live recovery changes no task");
    await a.close();
    await callTool(c, "planner-session-recover", { task: "T003", confirmed: false }, { expectError: true });
    const recovered = await callTool(c, "planner-session-recover", { task: "T003", confirmed: true });
    assert.equal(toolStructured(recovered).recovered, true);
    let after = await a.store.loadAll();
    const newOwner = after.phases[0].tasks[2].activeOwnerSession;
    assert.notEqual(newOwner, oldOwner);
    assert.deepEqual(after.phases[0].tasks[3], before.phases[0].tasks[3], "independent caller retains its work");
    for (const index of [0, 1]) assert.deepEqual(after.phases[0].tasks[index].pauseSnapshot, before.phases[0].tasks[index].pauseSnapshot);
    assert.deepEqual(after.project.workDeviations.map(({ ownerSession, ...rest }) => rest), before.project.workDeviations.map(({ ownerSession, ...rest }) => rest));
    assert.ok(after.project.workDeviations.every((entry) => entry.ownerSession === newOwner));
    const focus = await a.store.loadResume(newOwner);
    assert.equal(focus.notes, oldFocus.notes);
    assert.equal(focus.lastSessionSummary, oldFocus.lastSessionSummary);
    assert.equal(toolStructured(await callTool(c, "planner-task-recommend")).kind, "active");
    assert.equal(toolStructured(await callTool(c, "planner-task-start", { task: "T003" })).started, true);
    for (const [completed, resume] of [["T003", "T002"], ["T002", "T001"]]) {
      const done = await callTool(c, "planner-task-complete", { task: completed, force: true, motivation: "Fixture checklist irrelevant", description_update: "Detour verified and finished for restart regression." });
      assert.match(toolText(done), new RegExp(`RESUME REQUIRED:.*${resume}`));
      await readTaskContext(c, resume);
      assert.equal(toolStructured(await callTool(c, "planner-task-start", { task: resume })).started, true);
    }
    after = await a.store.loadAll();
    assert.ok(after.project.workDeviations.every((entry) => entry.state === "resumed"));
    assert.equal(after.phases[0].tasks[0].startedAt, before.phases[0].tasks[0].startedAt);
  } finally { await closeMcpFixture(a); }
});
