import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FeatureSchema,
  PhaseSchema,
  PlanStore,
  TaskSchema,
  createFeatureId,
  createPhaseId,
  createTaskId,
} from "../dist/index.js";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

test("descriptionUpdatedAt is independent of generic entity updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "description-updated-at-"));
  roots.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("description timestamp test");

  const createdAt = "2026-01-01T00:00:00.000Z";
  const feature = FeatureSchema.parse({
    id: createFeatureId(), number: 1, shortId: "ABCDE", priority: 1, name: "Feature",
    description: "Initial feature description", createdAt, updatedAt: createdAt,
  });
  await store.saveFeature(feature);
  const savedFeature = (await store.loadFeatures()).features[0];
  assert.ok(savedFeature.descriptionUpdatedAt, "a non-empty description receives a timestamp");
  const featureDescriptionUpdatedAt = savedFeature.descriptionUpdatedAt;

  await store.updateFeatures((doc) => {
    doc.features[0].priority = 2;
    doc.features[0].updatedAt = "2026-01-02T00:00:00.000Z";
    return doc;
  });
  assert.equal((await store.loadFeatures()).features[0].descriptionUpdatedAt, featureDescriptionUpdatedAt);

  const phase = PhaseSchema.parse({
    id: createPhaseId(), featureId: feature.id, number: 1, shortId: "FGHIJ", priority: 1,
    slug: "phase", title: "Phase", description: "Initial phase description", createdAt, updatedAt: createdAt,
  });
  const task = TaskSchema.parse({
    id: createTaskId(), phaseId: phase.id, number: 1, shortId: "KLMNP", priority: 1,
    shortName: "task", title: "Task", status: "planned", description: "Initial task description", createdAt, updatedAt: createdAt,
  });
  phase.tasks = [task];
  phase.taskIds = [task.id];
  await store.savePhase(phase);

  const savedPhase = await store.loadPhase(phase.id);
  const phaseDescriptionUpdatedAt = savedPhase.descriptionUpdatedAt;
  const taskDescriptionUpdatedAt = savedPhase.tasks[0].descriptionUpdatedAt;
  assert.ok(phaseDescriptionUpdatedAt);
  assert.ok(taskDescriptionUpdatedAt);

  await store.updatePhase(phase.id, (current) => {
    current.title = "Renamed phase";
    current.tasks[0].status = "in-progress";
    current.updatedAt = "2026-01-02T00:00:00.000Z";
    return current;
  });
  const nonDescriptionUpdate = await store.loadPhase(phase.id);
  assert.equal(nonDescriptionUpdate.descriptionUpdatedAt, phaseDescriptionUpdatedAt);
  assert.equal(nonDescriptionUpdate.tasks[0].descriptionUpdatedAt, taskDescriptionUpdatedAt);

  await store.updatePhase(phase.id, (current) => {
    current.description = "Changed phase description";
    current.tasks[0].description = "Changed task description";
    return current;
  });
  const descriptionUpdate = await store.loadPhase(phase.id);
  assert.notEqual(descriptionUpdate.descriptionUpdatedAt, phaseDescriptionUpdatedAt);
  assert.notEqual(descriptionUpdate.tasks[0].descriptionUpdatedAt, taskDescriptionUpdatedAt);
});

test("legacy feature descriptions use createdAt as a display-only fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "description-updated-at-legacy-"));
  roots.push(root);
  const plannerRoot = join(root, ".planner");
  const store = new PlanStore(plannerRoot);
  await store.init("legacy feature timestamp test");

  const createdAt = "2025-12-01T00:00:00.000Z";
  const legacyFeature = FeatureSchema.parse({
    id: createFeatureId(), number: 1, shortId: "QWERT", priority: 1, name: "Legacy feature",
    description: "Persisted before description timestamps", createdAt, updatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(legacyFeature.descriptionUpdatedAt, "");
  await mkdir(join(plannerRoot, "features"), { recursive: true });
  await writeFile(join(plannerRoot, "features", `${legacyFeature.id}.json`), `${JSON.stringify(legacyFeature, null, 2)}\n`);

  const loaded = (await store.loadFeatures()).features[0];
  assert.equal(loaded.descriptionUpdatedAt, createdAt);
});
