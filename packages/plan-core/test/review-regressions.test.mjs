import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  PlanStore,
  endPlannerSession,
  heartbeatPlannerSession,
  readTaskContextFlow,
  registerPlannerSession,
  startTaskFlow,
} from "../dist/index.js";
import { cleanupFixtures, createPlannerFixture } from "../../../test/helpers/fixtures.mjs";

after(cleanupFixtures);

test("concurrent registrations persist both issued identities", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "sessions-register-race" });
  const registrations = await Promise.all([
    registerPlannerSession(store, { clientKind: "mcp" }),
    registerPlannerSession(new PlanStore(planRoot), { clientKind: "pi" }),
  ]);
  assert.deepEqual(
    new Set((await store.loadPlannerSessions()).map((entry) => entry.sessionId)),
    new Set(registrations.map(({ session }) => session.sessionId)),
  );
});

test("a heartbeat cannot resurrect a concurrently ended session", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "sessions-end-race" });
  const { session } = await registerPlannerSession(store, { clientKind: "mcp" });
  const results = await Promise.allSettled([
    heartbeatPlannerSession(store, session.sessionId),
    endPlannerSession(new PlanStore(planRoot), session.sessionId, "finished"),
  ]);
  assert.equal(results[1].status, "fulfilled");
  const [persisted] = await store.loadPlannerSessions();
  assert.ok(persisted.endedAt);
  assert.equal(persisted.endReason, "finished");
});

test("a concurrent context edit cannot acquire a receipt for the old task response", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "task-context-revision", seed: "minimal" });
  const ref = "P001(F001)/T001";
  const sessionId = "review-session";
  const phase = (await store.loadAllPhases())[0];
  const competingStore = new PlanStore(planRoot);
  const original = store.recordContextRead.bind(store);
  let pendingEdit;
  // The competing writer runs in a separate async root, as it would in another process.
  const { AsyncResource } = await import("node:async_hooks");
  const competitor = new AsyncResource("review-competing-writer");
  store.recordContextRead = async (input) => {
    pendingEdit = competitor.runInAsyncScope(() => competingStore.updatePhase(phase.id, (current) => {
      const task = current.tasks[0];
      task.description = "Changed concurrently while context was being served.";
      task.updatedAt = new Date(Date.now() + 1000).toISOString();
      return current;
    }));
    return original(input);
  };
  const result = await readTaskContextFlow(store, sessionId, ref);
  await pendingEdit;
  assert.equal(result.ok, true);
  assert.equal(result.gate.state.ready, true);
  assert.doesNotMatch(result.taskText, /Changed concurrently/);
  assert.equal((await startTaskFlow(store, sessionId, ref)).code, "CONTEXT_READ_REQUIRED");
});
