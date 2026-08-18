import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PlanStore, FeatureSchema, createFeatureId } from "../dist/index.js";
import { mkdtemp, rm, writeFile, readdir, access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Helper: create a temp .planner via PlanStore.init, optionally seeding a
// legacy single-file features.json with N valid features. Returns the store,
// the planner path, and the generated features.
async function setup({ legacyFeatures = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), "planstore-"));
  const planner = join(root, ".planner");
  const store = new PlanStore(planner);
  await store.init("test-project");
  const now = new Date().toISOString();
  const features = Array.from({ length: legacyFeatures }, (_, i) =>
    FeatureSchema.parse({
      id: createFeatureId(),
      number: i + 1,
      name: `Feature ${i + 1}`,
      status: "planned",
      createdAt: now,
      updatedAt: now,
    }),
  );
  if (legacyFeatures > 0) {
    await mkdir(join(planner, "features"), { recursive: true }).catch(() => {});
    // ensure features/ is empty so loadFeatures falls back to legacy
    await writeFile(join(planner, "features.json"), JSON.stringify({ features }, null, 2));
  }
  return { store, planner, features, root };
}

const listJson = (planner) =>
  readdir(join(planner, "features")).catch(() => []).then((f) => f.filter((x) => x.endsWith(".json")));
const exists = (p) => access(p).then(() => true).catch(() => false);

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("PlanStore per-feature storage", () => {
  test("loads features from legacy features.json when features/ has no .json", async () => {
    const { store, planner, features, root } = await setup({ legacyFeatures: 2 });
    dirs.push(root);
    const loaded = await store.loadFeatures();
    assert.equal(loaded.features.length, 2);
    assert.deepEqual(
      loaded.features.map((f) => f.id).sort(),
      features.map((f) => f.id).sort(),
    );
  });

  test("migrates features.json → features/*.json on updateFeatures and removes legacy", async () => {
    const { store, planner, features, root } = await setup({ legacyFeatures: 3 });
    dirs.push(root);
    await store.updateFeatures((doc) => doc); // no-op updater triggers migration
    const files = await listJson(planner);
    assert.equal(files.length, 3, "should create one file per feature");
    assert.equal(await exists(join(planner, "features.json")), false, "legacy file should be removed");
  });

  test("reloads features from per-file after migration with ID preservation", async () => {
    const { store, planner, features, root } = await setup({ legacyFeatures: 3 });
    dirs.push(root);
    await store.updateFeatures((doc) => doc);
    const reloaded = await store.loadFeatures();
    assert.equal(reloaded.features.length, 3);
    const before = new Set(features.map((f) => f.id));
    const after = new Set(reloaded.features.map((f) => f.id));
    assert.deepEqual([...after].sort(), [...before].sort(), "ids must round-trip unchanged");
  });

  test("orphan reconcile removes feature files no longer in the document", async () => {
    const { store, planner, features, root } = await setup({ legacyFeatures: 3 });
    dirs.push(root);
    await store.saveFeatures({ features }); // migrate + write 3 files
    assert.equal((await listJson(planner)).length, 3);
    await store.saveFeatures({ features: [features[0]] }); // keep only the first
    const files = await listJson(planner);
    assert.equal(files.length, 1, "orphan files must be removed");
    assert.equal(files[0], `${features[0].id}.json`);
  });

  test("saveFeature writes a single feature file granularly", async () => {
    const { store, planner, features, root } = await setup({ legacyFeatures: 1 });
    dirs.push(root);
    await store.saveFeatures({ features }); // migrate to per-file (1 file)
    const extra = FeatureSchema.parse({
      id: createFeatureId(),
      number: 2,
      name: "Granular",
      status: "in-progress",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await store.saveFeature(extra);
    const files = await listJson(planner);
    assert.equal(files.length, 2, "saveFeature adds one file");
    const reloaded = await store.loadFeatures();
    assert.equal(reloaded.features.length, 2);
    assert.ok(reloaded.features.some((f) => f.id === extra.id));
  });

  test("migrateLegacy is idempotent and crash-safe (reappeared legacy re-migrates)", async () => {
    const { store, planner, features, root } = await setup({ legacyFeatures: 2 });
    dirs.push(root);
    await store.saveFeatures({ features }); // first migration
    assert.equal(await exists(join(planner, "features.json")), false);
    // simulate a crash mid-migration: legacy file reappears
    await writeFile(join(planner, "features.json"), JSON.stringify({ features }, null, 2));
    await store.saveFeatures({ features }); // re-run must re-migrate cleanly
    assert.equal(await exists(join(planner, "features.json")), false, "reappeared legacy must be removed");
    assert.equal((await listJson(planner)).length, 2, "per-file count preserved");
  });

  test("fresh project (no legacy) reads empty and writes per-file", async () => {
    const { store, planner, root } = await setup({ legacyFeatures: 0 });
    dirs.push(root);
    const empty = await store.loadFeatures();
    assert.equal(empty.features.length, 0);
    const now = new Date().toISOString();
    const f = FeatureSchema.parse({
      id: createFeatureId(),
      number: 1,
      name: "Fresh",
      status: "planned",
      createdAt: now,
      updatedAt: now,
    });
    await store.saveFeature(f);
    assert.equal((await listJson(planner)).length, 1);
    assert.equal(await exists(join(planner, "features.json")), false, "no legacy file should be created");
  });
});