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
  const root = await mkdtemp(join(tmpdir(), "featureid-validation-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  store.enableAutoSync(true);
  await store.init("featureid validation");
  const now = new Date().toISOString();
  const featA = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Feature A", status: "planned", createdAt: now, updatedAt: now });
  const featB = FeatureSchema.parse({ id: createFeatureId(), number: 2, name: "Feature B", status: "planned", createdAt: now, updatedAt: now });
  await store.saveFeature(featA);
  await store.saveFeature(featB);
  return { store, root, now, featA, featB };
}

const basePhase = (overrides) => ({
  id: createPhaseId(),
  number: 1,
  slug: "p",
  title: "P",
  status: "draft",
  tasks: [],
  taskIds: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("PlanStore.savePhase featureId referential integrity", () => {
  test("rejects unknown F00x ref string (not matching any feature)", async () => {
    const { store } = await setup();
    await assert.rejects(
      () => store.savePhase(basePhase({ featureId: "F999" })),
      /does not match any existing feature/i,
    );
  });

  test("rejects unknown UUID featureId (orphan)", async () => {
    const { store } = await setup();
    await assert.rejects(
      () => store.savePhase(basePhase({ featureId: createFeatureId() })),
      /does not match any existing feature/i,
    );
  });

  test("resolves a known F00x ref string to the feature UUID before persisting", async () => {
    const { store, featA } = await setup();
    const phase = basePhase({ featureId: "F001" });
    await store.savePhase(phase);
    const loaded = await store.loadPhase(phase.id);
    assert.equal(loaded.featureId, featA.id, "F001 ref is normalized to the feature UUID");
  });

  test("accepts a valid existing feature UUID and persists it", async () => {
    const { store, featA } = await setup();
    const phase = basePhase({ featureId: featA.id });
    await store.savePhase(phase);
    const loaded = await store.loadPhase(phase.id);
    assert.equal(loaded.featureId, featA.id);
  });

  // NOTE: missing/empty featureId is intentionally ALLOWED at the core level so
  // legacy migrations, repair, and feature-delete (unlink) can persist phases
  // without a feature. The "featureId required" gate is enforced at the adapter
  // boundary (Pi phase_create/task_create + MCP planner-phase-add/planner-task-add).
  test("allows missing featureId at core level (migration/repair/unlink path)", async () => {
    const { store } = await setup();
    const phase = basePhase({ featureId: undefined });
    await store.savePhase(phase);
    const loaded = await store.loadPhase(phase.id);
    assert.equal(loaded.featureId, undefined);
  });

  test("updatePhase rejects switching to an unknown featureId", async () => {
    const { store, featA } = await setup();
    const phase = basePhase({ featureId: featA.id });
    await store.savePhase(phase);
    await assert.rejects(
      () => store.updatePhase(phase.id, (p) => ({ ...p, featureId: createFeatureId() })),
      /does not match any existing feature/i,
    );
  });

  test("updatePhase accepts switching to a known feature UUID", async () => {
    const { store, featA, featB } = await setup();
    const phase = basePhase({ featureId: featA.id });
    await store.savePhase(phase);
    await store.updatePhase(phase.id, (p) => ({ ...p, featureId: featB.id }));
    const loaded = await store.loadPhase(phase.id);
    assert.equal(loaded.featureId, featB.id);
  });

  test("updatePhase allows unlinking featureId via undefined (adapter unlink path)", async () => {
    const { store, featA } = await setup();
    const phase = basePhase({ featureId: featA.id });
    await store.savePhase(phase);
    await store.updatePhase(phase.id, (p) => ({ ...p, featureId: undefined }));
    const loaded = await store.loadPhase(phase.id);
    assert.equal(loaded.featureId, undefined);
  });

  test("updatePhase rejects empty-string featureId (schema regex requires UUID)", async () => {
    const { store, featA } = await setup();
    const phase = basePhase({ featureId: featA.id });
    await store.savePhase(phase);
    await assert.rejects(
      () => store.updatePhase(phase.id, (p) => ({ ...p, featureId: "" })),
      /UUID|featureId|regex/i,
    );
  });
});

describe("PlanStore task featureId consistency (via updatePhase)", () => {
  test("task with non-UUID phaseId is rejected by schema inside updatePhase", async () => {
    const { store, featA } = await setup();
    const phase = basePhase({ featureId: featA.id });
    await store.savePhase(phase);
    const badTask = {
      id: createTaskId(),
      phaseId: "P003", // ref string, not UUID
      number: 1,
      shortName: "t1",
      title: "T",
      status: "planned",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await assert.rejects(
      () => store.updatePhase(phase.id, (p) => { p.tasks.push(badTask); return p; }),
      /UUID|phaseId/,
    );
  });
});