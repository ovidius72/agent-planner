import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PlanStore, FeatureSchema, PhaseSchema, TaskSchema, createFeatureId, createPhaseId, createTaskId } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "handoff-lifecycle-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("handoff lifecycle");
  const now = new Date().toISOString();
  const feature = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Feature", createdAt: now, updatedAt: now });
  await store.saveFeature(feature);
  const phase = PhaseSchema.parse({ id: createPhaseId(), number: 1, featureId: feature.id, slug: "phase", title: "Phase", createdAt: now, updatedAt: now });
  await store.savePhase(phase);
  return { root, store, phase, feature, now };
}

describe("handoff lifecycle hardening", () => {
  test("replacing a pending handoff archives the previous content as superseded", async () => {
    const { store, phase } = await setup();
    await store.setPhaseHandoff(phase.id, "# first");
    await store.setPhaseHandoff(phase.id, "# second");
    const active = await store.listHandoffs();
    assert.equal(active.length, 1);
    assert.equal(active[0].firstLine, "second");
    const archived = await store.listArchivedHandoffs();
    assert.equal(archived.length, 1);
    assert.equal(archived[0].reason, "superseded");
    assert.equal(archived[0].firstLine, "first");
  });

  test("repair archives stale handoffs on completed phases and hides them from active list", async () => {
    const { store, phase, now } = await setup();
    const task = TaskSchema.parse({ id: createTaskId(), phaseId: phase.id, number: 1, shortName: "closed", title: "Closed task", status: "done", createdAt: now, updatedAt: now });
    await store.updatePhase(phase.id, (p) => ({ ...p, tasks: [task], taskIds: [task.id], handoff: "# stale done handoff", handoffUpdatedAt: now }));
    const report = await store.repair();
    assert.equal(report.handoffs.archived, 1);
    assert.equal((await store.listHandoffs()).length, 0);
    const archived = await store.listArchivedHandoffs();
    assert.equal(archived.length, 1);
    assert.equal(archived[0].reason, "phase-done");
    assert.equal(archived[0].firstLine, "stale done handoff");
  });

  test("repair retroactively archives rejected-phase handoffs", async () => {
    const { store, phase, now } = await setup();
    const task = TaskSchema.parse({ id: createTaskId(), phaseId: phase.id, number: 1, shortName: "rejected", title: "Rejected task", status: "rejected", createdAt: now, updatedAt: now });
    await store.updatePhase(phase.id, (current) => ({ ...current, tasks: [task], taskIds: [task.id], handoff: "# stale rejected handoff", handoffUpdatedAt: now }));

    const report = await store.repair();
    assert.equal(report.handoffs.archived, 1);
    assert.equal((await store.loadPhase(phase.id)).handoff, "");
    assert.equal((await store.listArchivedHandoffs())[0].reason, "phase-rejected");
  });

  test("active listing retroactively archives stale completed-phase handoffs", async () => {
    const { store, phase, now } = await setup();
    const task = TaskSchema.parse({ id: createTaskId(), phaseId: phase.id, number: 1, shortName: "closed", title: "Closed task", status: "done", createdAt: now, updatedAt: now });
    await store.updatePhase(phase.id, (p) => ({ ...p, tasks: [task], taskIds: [task.id], handoff: "# stale from old adapter", handoffUpdatedAt: now }));
    assert.equal((await store.listHandoffs()).length, 0);
    assert.equal((await store.listArchivedHandoffs()).length, 1);
  });

  test("every canonical terminal phase outcome archives with its exact reason", async () => {
    const cases = [
      { name: "all rejected", statuses: ["rejected", "rejected"], derived: "rejected", reason: "phase-rejected" },
      { name: "done plus rejected", statuses: ["done", "rejected"], derived: "done", reason: "phase-done" },
      { name: "done plus canceled", statuses: ["done", "canceled"], derived: "done", reason: "phase-done" },
      { name: "all canceled", statuses: ["canceled", "canceled"], derived: "rejected", reason: "phase-rejected" },
    ];

    for (const scenario of cases) {
      const { store, phase, now } = await setup();
      const tasks = scenario.statuses.map((status, index) => TaskSchema.parse({
        id: createTaskId(),
        phaseId: phase.id,
        number: index + 1,
        shortName: `${scenario.name.replaceAll(" ", "-")}-${index + 1}`,
        title: `${scenario.name} task ${index + 1}`,
        status,
        createdAt: now,
        updatedAt: now,
      }));
      await store.updatePhase(phase.id, (current) => ({
        ...current,
        tasks,
        taskIds: tasks.map((task) => task.id),
        handoff: `# ${scenario.name} handoff`,
        handoffUpdatedAt: now,
      }));

      assert.equal((await store.loadPhase(phase.id)).status, scenario.derived, scenario.name);
      assert.ok(await store.syncTaskStatusRollup(phase.id), `${scenario.name} archives immediately`);
      assert.equal((await store.loadPhase(phase.id)).handoff, "", scenario.name);
      const archived = await store.listArchivedHandoffs();
      assert.equal(archived[0].reason, scenario.reason, scenario.name);
    }
  });

  test("nonterminal planned, waiting, blocked, and deferred phases keep active handoffs", async () => {
    for (const status of ["planned", "waiting", "blocked", "deferred"]) {
      const { store, phase, now } = await setup();
      const task = TaskSchema.parse({ id: createTaskId(), phaseId: phase.id, number: 1, shortName: status, title: `${status} task`, status, createdAt: now, updatedAt: now });
      await store.updatePhase(phase.id, (current) => ({ ...current, tasks: [task], taskIds: [task.id], handoff: `# ${status} handoff`, handoffUpdatedAt: now }));

      assert.equal(await store.syncTaskStatusRollup(phase.id), null, status);
      assert.equal((await store.listHandoffs()).length, 1, status);
      assert.equal((await store.listArchivedHandoffs()).length, 0, status);
    }
  });

  test("active listing retroactively archives rejected handoffs instead of hiding or retaining them", async () => {
    const { store, phase, now } = await setup();
    const task = TaskSchema.parse({ id: createTaskId(), phaseId: phase.id, number: 1, shortName: "rejected", title: "Rejected task", status: "rejected", createdAt: now, updatedAt: now });
    await store.updatePhase(phase.id, (current) => ({ ...current, tasks: [task], taskIds: [task.id], handoff: "# rejected stale handoff", handoffUpdatedAt: now }));

    assert.deepEqual(await store.listHandoffs(), []);
    const archived = await store.listArchivedHandoffs();
    assert.equal(archived.length, 1);
    assert.equal(archived[0].reason, "phase-rejected");
    assert.equal(archived[0].firstLine, "rejected stale handoff");
  });

  test("new handoffs on done and rejected phases are rejected", async () => {
    for (const status of ["done", "rejected"]) {
      const { store, phase, now } = await setup();
      const task = TaskSchema.parse({ id: createTaskId(), phaseId: phase.id, number: 1, shortName: status, title: `${status} task`, status, createdAt: now, updatedAt: now });
      await store.updatePhase(phase.id, (current) => ({ ...current, tasks: [task], taskIds: [task.id] }));
      await assert.rejects(
        () => store.setPhaseHandoff(phase.id, "# should fail"),
        new RegExp(`Cannot write a handoff on ${status} phase.*terminal phases have no pending handoff`),
      );
    }
  });
});
