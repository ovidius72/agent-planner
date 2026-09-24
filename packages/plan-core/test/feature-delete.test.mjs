/**
 * P104(F005)/T424 — deleteFeatureCascade is the one place a feature delete
 * happens; every adapter (MCP, pi's tool and interactive paths, the REST
 * server) calls it instead of hand-writing the mutation. These tests cover
 * the two defects the four hand-written copies had: phases orphaned
 * instead of unlinked/cascaded, and success reported without checking the
 * delete actually persisted.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PlanStore, FeatureSchema, PhaseSchema, createFeatureId, createPhaseId, deleteFeatureCascade } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "feature-delete-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("feature delete");
  const now = new Date().toISOString();
  const feature = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Feature", createdAt: now, updatedAt: now });
  await store.saveFeature(feature);
  return { root, store, feature, now };
}

async function addPhase(store, feature, now, overrides = {}) {
  const phase = PhaseSchema.parse({
    id: createPhaseId(),
    number: overrides.number ?? 1,
    featureId: feature.id,
    slug: overrides.slug ?? "phase",
    title: overrides.title ?? "Phase",
    createdAt: now,
    updatedAt: now,
  });
  await store.savePhase(phase);
  return phase;
}

describe("deleteFeatureCascade", () => {
  test("cascade:false unlinks phases — they stay alive with featureId cleared, not orphaned", async () => {
    const { store, feature, now } = await setup();
    const phase = await addPhase(store, feature, now);

    const outcome = await deleteFeatureCascade(store, feature.id, { cascade: false });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.cascade, false);
    assert.equal(outcome.result.phaseCount, 1);
    assert.deepEqual(outcome.result.phases, [{ id: phase.id, action: "unlinked" }]);

    const survivingPhase = await store.loadPhase(phase.id);
    assert.ok(survivingPhase, "phase must still exist after an unlink delete");
    assert.equal(survivingPhase.featureId, undefined, "featureId must be cleared, not left pointing at the deleted feature");
  });

  test("cascade:true deletes the phases outright", async () => {
    const { store, feature, now } = await setup();
    const phase = await addPhase(store, feature, now);

    const outcome = await deleteFeatureCascade(store, feature.id, { cascade: true });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.cascade, true);
    assert.deepEqual(outcome.result.phases, [{ id: phase.id, action: "deleted" }]);

    await assert.rejects(() => store.loadPhase(phase.id), "a cascaded phase must no longer be readable");
  });

  test("deleting a feature that does not exist fails instead of reporting success", async () => {
    const { store } = await setup();
    const outcome = await deleteFeatureCascade(store, "00000000-0000-4000-8000-000000000000", { cascade: false });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.errorCode, "FEATURE_NOT_FOUND");
  });

  test("reports the canonical F00x ref, not the raw id", async () => {
    const { store, feature } = await setup();
    const outcome = await deleteFeatureCascade(store, feature.id, { cascade: false });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.ref, "F001");
  });

  test("a feature with no phases deletes cleanly with a zero phase count", async () => {
    const { store, feature } = await setup();
    const outcome = await deleteFeatureCascade(store, feature.id, { cascade: true });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.phaseCount, 0);
    assert.deepEqual(outcome.result.phases, []);
  });

  test("the delete is verified: the feature is actually gone from a fresh read after the call", async () => {
    const { store, feature } = await setup();
    const outcome = await deleteFeatureCascade(store, feature.id, { cascade: false });
    assert.equal(outcome.ok, true);
    const remaining = (await store.loadFeatures()).features;
    assert.ok(!remaining.some((entry) => entry.id === feature.id), "the deleted feature must not still be readable");
  });
});
