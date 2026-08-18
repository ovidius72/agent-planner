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

  test("active listing retroactively archives stale completed-phase handoffs", async () => {
    const { store, phase, now } = await setup();
    const task = TaskSchema.parse({ id: createTaskId(), phaseId: phase.id, number: 1, shortName: "closed", title: "Closed task", status: "done", createdAt: now, updatedAt: now });
    await store.updatePhase(phase.id, (p) => ({ ...p, tasks: [task], taskIds: [task.id], handoff: "# stale from old adapter", handoffUpdatedAt: now }));
    assert.equal((await store.listHandoffs()).length, 0);
    assert.equal((await store.listArchivedHandoffs()).length, 1);
  });

  test("new handoffs on completed phases are rejected", async () => {
    const { store, phase, now } = await setup();
    const task = TaskSchema.parse({ id: createTaskId(), phaseId: phase.id, number: 1, shortName: "closed", title: "Closed task", status: "done", createdAt: now, updatedAt: now });
    await store.updatePhase(phase.id, (p) => ({ ...p, tasks: [task], taskIds: [task.id] }));
    await assert.rejects(() => store.setPhaseHandoff(phase.id, "# should fail"), /completed phases have no pending handoff/);
  });
});
