/**
 * Pi counterpart of packages/plan-mcp/test/mcp-sessions.test.mjs: two Pi
 * sessions on one planner each keep their own side-task stack. Pi keeps module
 * state, so the two sessions run one after the other on the same folder.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";

after(async () => {
  await cleanupPiHosts();
});

async function readContext(host, taskId) {
  await host.runTool("task_get", { taskId, full: true });
  await host.runTool("phase_get", { phaseId: "P001", full: true });
  await host.runTool("feature_get", { featureId: "F001", full: true });
  await host.runTool("requirement_list", { phaseRef: "P001" });
}

async function addTask(host, title) {
  await host.runTool("task_create", {
    featureId: "F001", phaseId: "P001", title,
    description: "src/sessions.ts:1 temporary work used to prove per-session side-task stacks.",
  });
}

test("Pi: agent A's finished detour makes A return to its task, but not agent B", async () => {
  const a = await createPiHost({ name: "pi-sessions", seed: "minimal", sessionId: "session-A", keepRootOnClose: true });
  let b;
  try {
    await addTask(a, "Second task");
    await addTask(a, "Third task");

    await readContext(a, "T002");
    await a.runTool("task_start", { taskId: "T002" });
    await a.runTool("task_get", { taskId: "T001", full: true });
    await a.runTool("task_switch", {
      from_task: "T002", to_task: "T001", reason: "Detour needed before continuing",
      what_was_being_done: "Working on T002", resume_location: "src/a.ts:1", how_to_resume: "Continue T002", switched_by: "pi-a",
    });
    const done = await a.runTool("task_complete", { taskId: "T001", force: true, motivation: "Seed checklist item is irrelevant to this detour.", description_update: "Detour finished and verified for the session test." });
    assert.match(toolText(done), /RESUME REQUIRED: P001\(F001\)\/T002/);

    const forA = await a.runTool("task_recommend", {});
    assert.match(toolText(forA), /T002/, "A is told to return to its preserved task");

    const stored = (await a.store.loadProject()).workDeviations;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].ownerSession, "pi:session-A", "the switch is stamped with the Pi session that made it");
    const root = a.root;
    await closePiHost(a);

    b = await createPiHost({ name: "pi-sessions", seed: "empty", root, sessionId: "session-B" });
    const forB = await b.runTool("task_recommend", {});
    assert.doesNotMatch(toolText(forB), /RESUME REQUIRED|Resume required/i, "B is not sent back to a task it never left");
    assert.doesNotMatch(toolText(forB), /T002/, "A's preserved task is not offered to B");
    assert.equal((await b.store.loadProject("pi:session-B")).workDeviations.length, 0, "B has no side tasks of its own");
    assert.equal((await b.store.loadProject()).workDeviations.length, 1, "a sessionless reader still sees A's");
  } finally {
    if (b) await closePiHost(b);
    else await closePiHost(a).catch(() => {});
  }
});
