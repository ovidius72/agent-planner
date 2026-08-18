import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PlanStore, PhaseSchema, FeatureSchema, createPhaseId, createFeatureId, createTaskId } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "reorder-noflip-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("Reorder no-flip");
  const now = new Date().toISOString();
  const feat = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Feat One", status: "planned", createdAt: now, updatedAt: now });
  await store.saveFeature(feat);
  const mkPhase = (n, status) => PhaseSchema.parse({ id: createPhaseId(), number: n, featureId: feat.id, slug: `phase-${n}`, title: `Phase ${n}`, status, createdAt: now, updatedAt: now });
  const mkTask = (phaseId, status) => ({ id: createTaskId(), number: 1, phaseId, title: "task", shortName: "t", status, createdAt: now, updatedAt: now });
  return { store, feat, mkPhase, mkTask, now };
}

describe("reorder (priority-only) must not change derived feature status", () => {
  test("runBatch: priority-only reorder preserves derived in-progress status", async () => {
    const { store, feat, mkPhase, mkTask } = await setup();
    // Mixed feature: phase 1 done, phase 2 planned ⇒ derived in-progress.
    const p1 = mkPhase(1, "planned");
    const p2 = mkPhase(2, "planned");
    await store.savePhase(p1);
    await store.savePhase(p2);
    await store.updatePhase(p1.id, (ph) => { ph.tasks = [mkTask(ph.id, "done")]; return ph; });
    await store.updatePhase(p2.id, (ph) => { ph.tasks = [mkTask(ph.id, "planned")]; return ph; });

    await store.syncStatuses();
    assert.equal((await store.loadFeatures()).features.find((f) => f.id === feat.id)?.status, "in-progress", "sanity: mixed done+planned derives in-progress");

    await store.runBatch(async () => {
      await store.updateFeatures((doc) => {
        for (const f of doc.features) f.priority = (f.id === feat.id ? 10 : 20);
        doc.features.sort((a, b) => a.priority - b.priority || a.number - b.number);
        return doc;
      });
    });

    assert.equal((await store.loadFeatures()).features.find((f) => f.id === feat.id)?.status, "in-progress", "priority-only reorder must not change derived status");
  });

  test("without runBatch: priority-only update also preserves derived status", async () => {
    const { store, feat, mkPhase, mkTask } = await setup();
    const p1 = mkPhase(1, "planned");
    const p2 = mkPhase(2, "planned");
    await store.savePhase(p1);
    await store.savePhase(p2);
    await store.updatePhase(p1.id, (ph) => { ph.tasks = [mkTask(ph.id, "done")]; return ph; });
    await store.updatePhase(p2.id, (ph) => { ph.tasks = [mkTask(ph.id, "planned")]; return ph; });

    await store.syncStatuses();
    assert.equal((await store.loadFeatures()).features.find((f) => f.id === feat.id)?.status, "in-progress");

    await store.updateFeatures((doc) => {
      for (const f of doc.features) f.priority = 10;
      return doc;
    });

    assert.equal((await store.loadFeatures()).features.find((f) => f.id === feat.id)?.status, "in-progress", "priority-only update must not alter the derived status");
  });
});
