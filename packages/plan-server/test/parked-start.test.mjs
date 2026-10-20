/**
 * POST /tasks/:id/start (Web UI backend): parked tasks start; refusals name the way out.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServerFixture, cleanupServerFixtures } from "../../../test/helpers/server-fixture.mjs";

after(async () => {
  await cleanupServerFixtures();
});

async function setStatus(fixture, status) {
  const phase = (await fixture.store.loadAllPhases())[0];
  const task = phase.tasks[0];
  await fixture.store.updateTask(phase.id, task.id, (current) => ({ ...current, status }));
  return task.id;
}

async function start(fixture, taskId) {
  const response = await fetch(`${fixture.handle.url}/tasks/${taskId}/start`, { method: "POST" });
  return { status: response.status, body: await response.json() };
}

for (const status of ["waiting", "blocked", "deferred"]) {
  test(`a ${status} task starts from the Web UI backend`, async () => {
    const fixture = await startServerFixture({ name: `srv-parked-${status}`, seed: "minimal" });
    const taskId = await setStatus(fixture, status);
    const result = await start(fixture, taskId);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.status, "in-progress");
    assert.equal((await fixture.store.loadAllPhases())[0].tasks[0].statusLog.at(-1).fromStatus, status);
  });
}

for (const [status, hint] of [["canceled", /planned with a motivation/], ["rejected", /planned with a motivation/], ["done", /reopen/i]]) {
  test(`a ${status} task is refused with the way out`, async () => {
    const fixture = await startServerFixture({ name: `srv-refused-${status}`, seed: "minimal" });
    const taskId = await setStatus(fixture, status);
    const result = await start(fixture, taskId);
    assert.equal(result.status, 400);
    assert.match(result.body.error, hint);
  });
}
