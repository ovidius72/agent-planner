/**
 * Pi counterpart of packages/plan-mcp/test/mcp-parked-start.test.mjs: parked
 * tasks (waiting, blocked, deferred) start directly; refusals name the way out.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";

after(async () => {
  await cleanupPiHosts();
});

async function primeReads(host) {
  await host.runTool("task_get", { taskId: "T001", full: true });
  await host.runTool("phase_get", { phaseId: "P001", full: true });
  await host.runTool("feature_get", { featureId: "F001", full: true });
  await host.runTool("requirement_list", { phaseRef: "P001" });
}

async function setStatus(host, status, { checkpoint = false } = {}) {
  const phase = (await host.store.loadAllPhases())[0];
  const task = phase.tasks[0];
  await host.store.updateTask(phase.id, task.id, (current) => ({
    ...current,
    status,
    pauseSnapshot: checkpoint
      ? { id: "p1", reason: "Parked for other work", whatWasBeingDone: "Half-way through", resumeLocation: "src/x.ts:1", howToResume: "Continue", relatedTaskId: "", pausedAt: new Date().toISOString(), pausedBy: "test" }
      : current.pauseSnapshot,
  }));
}

for (const status of ["waiting", "blocked", "deferred"]) {
  test(`Pi: a ${status} task with a checkpoint starts directly`, async () => {
    const host = await createPiHost({ name: `pi-parked-${status}`, seed: "minimal" });
    try {
      await setStatus(host, status, { checkpoint: true });
      await primeReads(host);
      const started = await host.runTool("task_start", { taskId: "T001" });
      assert.match(toolText(started), /✅ Task started: P001\(F001\)\/T001/);
      assert.equal(toolDetails(started).started, true);
      const task = (await host.store.loadAllPhases())[0].tasks[0];
      assert.equal(task.status, "in-progress");
      assert.equal(task.statusLog.at(-1).fromStatus, status);
    } finally {
      await closePiHost(host);
    }
  });
}

for (const [status, hint] of [["canceled", /planned with a motivation/], ["rejected", /planned with a motivation/], ["done", /reopen/i]]) {
  test(`Pi: a ${status} task is refused and the refusal names the way out`, async () => {
    const host = await createPiHost({ name: `pi-refused-${status}`, seed: "minimal" });
    try {
      await setStatus(host, status);
      await primeReads(host);
      const refused = await host.runTool("task_start", { taskId: "T001" }, { expectError: true });
      assert.equal(toolDetails(refused).started, false);
      assert.match(toolText(refused), hint);
    } finally {
      await closePiHost(host);
    }
  });
}
