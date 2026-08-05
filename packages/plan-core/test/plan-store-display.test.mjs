import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PlanStore, PhaseSchema, FeatureSchema, createPhaseId, createFeatureId, createTaskId } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "plan-store-display-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("plan-store display test");
  const now = new Date().toISOString();
  const feat = FeatureSchema.parse({
    id: createFeatureId(), number: 1, name: "Feat", status: "planned", createdAt: now, updatedAt: now,
  });
  await store.saveFeature(feat);
  const mkPhase = (n) =>
    PhaseSchema.parse({
      id: createPhaseId(), number: n, featureId: feat.id, slug: `phase-${n}`,
      title: `Phase ${n}`, status: "planned", createdAt: now, updatedAt: now,
    });
  const mkTask = (phaseId, status) => ({
    id: createTaskId(), number: 1, phaseId, title: "task", shortName: "t",
    status, createdAt: now, updatedAt: now,
  });
  return { store, featId: feat.id, mkPhase, mkTask };
}

describe("PlanStore.loadPhaseDisplay", () => {
  test("done + planned tasks → started", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(1);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "done"), mkTask(ph.id, "planned")];
      return ph;
    });
    const display = await store.loadPhaseDisplay(p.id);
    assert.equal(display.displayStatus, "started");
    assert.equal(display.hasStarted, true);
    assert.equal(display.breakdown.done, 1);
    assert.equal(display.breakdown.planned, 1);
  });

  test("done + canceled tasks → closed", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(2);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "done"), mkTask(ph.id, "canceled")];
      return ph;
    });
    const display = await store.loadPhaseDisplay(p.id);
    assert.equal(display.displayStatus, "closed");
    assert.equal(display.breakdown.done, 1);
    assert.equal(display.breakdown.canceled, 1);
  });

  test("all done tasks → done", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(3);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "done"), mkTask(ph.id, "done")];
      return ph;
    });
    const display = await store.loadPhaseDisplay(p.id);
    assert.equal(display.displayStatus, "done");
  });

  test("empty phase → planned", async () => {
    const { store, mkPhase } = await setup();
    const p = mkPhase(4);
    await store.savePhase(p);
    const display = await store.loadPhaseDisplay(p.id);
    assert.equal(display.displayStatus, "planned");
    assert.equal(display.totalChildren, 0);
  });
});

describe("PlanStore.loadFeatureDisplay", () => {
  test("one done phase + one planned phase → started", async () => {
    const { store, featId, mkPhase, mkTask } = await setup();
    const a = mkPhase(10);
    await store.savePhase(a);
    await store.updatePhase(a.id, (ph) => { ph.tasks = [mkTask(ph.id, "done")]; return ph; });
    const b = mkPhase(11);
    await store.savePhase(b);
    await store.updatePhase(b.id, (ph) => { ph.tasks = [mkTask(ph.id, "planned")]; return ph; });

    const display = await store.loadFeatureDisplay(featId);
    assert.equal(display.displayStatus, "started");
    assert.equal(display.hasStarted, true);
  });

  test("all phases done → done", async () => {
    const { store, featId, mkPhase, mkTask } = await setup();
    const p = mkPhase(12);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => { ph.tasks = [mkTask(ph.id, "done"), mkTask(ph.id, "done")]; return ph; });

    const display = await store.loadFeatureDisplay(featId);
    assert.equal(display.displayStatus, "done");
  });

  test("one done phase + one canceled phase → closed", async () => {
    const { store, featId, mkPhase, mkTask } = await setup();
    const a = mkPhase(13);
    await store.savePhase(a);
    await store.updatePhase(a.id, (ph) => { ph.tasks = [mkTask(ph.id, "done")]; return ph; });
    const b = mkPhase(14);
    await store.savePhase(b);
    await store.updatePhase(b.id, (ph) => { ph.tasks = [mkTask(ph.id, "canceled")]; return ph; });
    // Phase with all-canceled tasks derives canonical "rejected" (meaningful=0),
    // which maps via fromCanonicalStatus to "rejected" for the feature rollup.
    // done + rejected → closed (mixed terminal).
    const display = await store.loadFeatureDisplay(featId);
    assert.equal(display.displayStatus, "closed");
  });
});