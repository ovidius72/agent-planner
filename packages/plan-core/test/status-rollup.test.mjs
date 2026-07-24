import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PlanStore, PhaseSchema, FeatureSchema, createPhaseId, createFeatureId, createTaskId } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression: a single blocked task/phase used to poison the parent (phase AND
// feature) to "blocked", masking all done/in-progress work. Correct lifecycle:
// any progress (active work OR partial completion) ⇒ in-progress; done ⇒ done.
// Blocked/waiting/deferred surface ONLY when there is zero progress (stall).

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const nowISO = () => new Date().toISOString();

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "status-rollup-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("status-rollup test");
  const now = nowISO();
  const feat = FeatureSchema.parse({
    id: createFeatureId(), number: 1, name: "Feat", status: "planned", createdAt: now, updatedAt: now,
  });
  await store.saveFeature(feat);
  const mkPhase = (n, status = "planned") =>
    PhaseSchema.parse({
      id: createPhaseId(), number: n, featureId: feat.id, slug: `phase-${n}`,
      title: `Phase ${n}`, status, createdAt: now, updatedAt: now,
    });
  const mkTask = (phaseId, status = "planned") => ({
    id: createTaskId(), number: 1, phaseId, title: "task", shortName: "t",
    status, createdAt: now, updatedAt: now,
  });
  return { store, featId: feat.id, mkPhase, mkTask };
}

describe("status rollup — progress dominates; blocked only surfaces on zero progress", () => {
  test("phase: 1 in-progress + 1 blocked → in-progress (active dominates)", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(1);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "in-progress"), mkTask(ph.id, "blocked")];
      return ph;
    });
    await store.syncStatuses();
    assert.equal((await store.loadPhase(p.id)).status, "in-progress");
  });

  test("phase: many done + 1 blocked (no in-progress) → in-progress (completion dominates)", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(2);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [
        mkTask(ph.id, "done"), mkTask(ph.id, "done"),
        mkTask(ph.id, "done"), mkTask(ph.id, "blocked"),
      ];
      return ph;
    });
    await store.syncStatuses();
    assert.equal((await store.loadPhase(p.id)).status, "in-progress", "done work must not be masked by a single blocked task");
  });

  test("phase: done + planned (no in-progress, no blocked) → in-progress (partial completion)", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(3);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "done"), mkTask(ph.id, "planned")];
      return ph;
    });
    await store.syncStatuses();
    assert.equal((await store.loadPhase(p.id)).status, "in-progress", "started work ⇒ in-progress, not planned");
  });

  test("phase: all done → done", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(4);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "done"), mkTask(ph.id, "done")];
      return ph;
    });
    await store.syncStatuses();
    assert.equal((await store.loadPhase(p.id)).status, "done");
  });

  test("phase: planned + blocked (zero progress) → blocked (stall surfaces)", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(5);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "planned"), mkTask(ph.id, "blocked")];
      return ph;
    });
    await store.syncStatuses();
    assert.equal((await store.loadPhase(p.id)).status, "blocked");
  });

  test("phase: waiting + blocked (zero progress) → blocked (blocked above waiting)", async () => {
    const { store, mkPhase, mkTask } = await setup();
    const p = mkPhase(6);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "waiting"), mkTask(ph.id, "blocked")];
      return ph;
    });
    await store.syncStatuses();
    assert.equal((await store.loadPhase(p.id)).status, "blocked");
  });

  test("feature: one in-progress phase + one blocked phase → in-progress (not poisoned)", async () => {
    const { store, featId, mkPhase, mkTask } = await setup();
    const a = mkPhase(7);
    await store.savePhase(a);
    await store.updatePhase(a.id, (ph) => { ph.tasks = [mkTask(ph.id, "in-progress")]; return ph; });
    const b = mkPhase(8);
    await store.savePhase(b);
    await store.updatePhase(b.id, (ph) => { ph.tasks = [mkTask(ph.id, "blocked")]; return ph; });
    await store.syncStatuses();
    const feat = (await store.loadFeatures()).features.find((f) => f.id === featId);
    assert.equal(feat.status, "in-progress");
  });

  test("feature: one done phase + one blocked phase → in-progress (completion dominates)", async () => {
    const { store, featId, mkPhase, mkTask } = await setup();
    const a = mkPhase(9);
    await store.savePhase(a);
    await store.updatePhase(a.id, (ph) => { ph.tasks = [mkTask(ph.id, "done"), mkTask(ph.id, "done")]; return ph; });
    const b = mkPhase(10);
    await store.savePhase(b);
    await store.updatePhase(b.id, (ph) => { ph.tasks = [mkTask(ph.id, "blocked")]; return ph; });
    await store.syncStatuses();
    const feat = (await store.loadFeatures()).features.find((f) => f.id === featId);
    assert.equal(feat.status, "in-progress", "done phase must not be masked by a sibling blocked phase");
  });

  test("feature: all phases done → done", async () => {
    const { store, featId, mkPhase, mkTask } = await setup();
    const p = mkPhase(11);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "done"), mkTask(ph.id, "done")];
      return ph;
    });
    await store.syncStatuses();
    const feat = (await store.loadFeatures()).features.find((f) => f.id === featId);
    assert.equal(feat.status, "done");
  });

  test("feature: only a stalled (blocked) phase, zero progress → blocked (honest impediment)", async () => {
    const { store, featId, mkPhase, mkTask } = await setup();
    const p = mkPhase(12);
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => { ph.tasks = [mkTask(ph.id, "blocked")]; return ph; });
    await store.syncStatuses();
    const feat = (await store.loadFeatures()).features.find((f) => f.id === featId);
    assert.equal(feat.status, "blocked");
  });
});
