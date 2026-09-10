import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FeatureSchema,
  PhaseSchema,
  PlanStore,
  buildHierarchicalDescriptionFreshness,
  createFeatureId,
  createPhaseId,
  createTaskId,
} from "../dist/index.js";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

function fixture() {
  const featureId = createFeatureId();
  const phaseId = createPhaseId();
  const taskId = createTaskId();
  const feature = FeatureSchema.parse({
    id: featureId,
    number: 1,
    name: "Authentication",
    description: "Original feature description.",
    descriptionUpdatedAt: "2026-01-01T00:00:00.000Z",
    workDone: "Preserve this metadata.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const phase = PhaseSchema.parse({
    id: phaseId,
    number: 1,
    featureId,
    slug: "authentication",
    title: "Authentication phase",
    description: "Original phase description.",
    descriptionUpdatedAt: "2026-01-02T00:00:00.000Z",
    notes: "Preserve phase notes.",
    tasks: [{
      id: taskId,
      number: 1,
      phaseId,
      shortName: "token-refresh",
      title: "Token refresh",
      description: "Changed task execution context.",
      descriptionUpdatedAt: "2026-01-03T00:00:00.000Z",
      status: "planned",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  return { feature, phase };
}

test("freshness preview flags only the owning phase and feature with exact refs", () => {
  const { feature, phase } = fixture();
  const unrelatedFeature = FeatureSchema.parse({
    id: createFeatureId(), number: 2, name: "Unrelated", description: "Current parent.",
    descriptionUpdatedAt: "2026-01-05T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z",
  });
  const unrelatedPhase = PhaseSchema.parse({
    id: createPhaseId(), number: 2, featureId: unrelatedFeature.id, slug: "unrelated", title: "Unrelated phase",
    description: "Older child.", descriptionUpdatedAt: "2026-01-04T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z",
  });

  const preview = buildHierarchicalDescriptionFreshness([feature, unrelatedFeature], [phase, unrelatedPhase]);
  assert.deepEqual(preview.staleParentRefs, ["P001(F001)", "F001"]);
  assert.deepEqual(preview.reconciliationPreview.map((step) => step.ownerRef), ["P001(F001)", "F001"]);
  assert.equal(preview.reconciliationPreview[0].causedByRef, "P001(F001)/T001");
  assert.match(preview.reconciliationPreview[0].action, /explicitly update P001\(F001\)'s description or descriptionRef/);
  assert.equal(preview.diagnostics.find((entry) => entry.ownerRef === "P002(F002)").state, "fresh");
  assert.equal(preview.diagnostics.find((entry) => entry.ownerRef === "F002").state, "fresh");
});

test("explicit leaf-to-root parent edits restore freshness without unrelated metadata loss", async () => {
  const root = await mkdtemp(join(tmpdir(), "description-freshness-"));
  roots.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("Description freshness");
  const { feature, phase } = fixture();
  await store.saveFeature(feature);
  await store.savePhase(phase);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.updateTask(phase.id, phase.tasks[0].id, (current) => ({ ...current, description: "Newly changed task execution context." }));

  assert.deepEqual((await store.previewDescriptionReconciliation()).staleParentRefs, ["P001(F001)", "F001"]);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.updatePhase(phase.id, (current) => ({ ...current, description: "Reconciled phase description." }));
  const afterPhase = await store.previewDescriptionReconciliation();
  assert.deepEqual(afterPhase.staleParentRefs, ["F001"]);
  assert.equal((await store.loadPhase(phase.id)).notes, "Preserve phase notes.");

  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.updateFeature(feature.id, (current) => ({ ...current, description: "Reconciled feature description." }));
  assert.deepEqual((await store.previewDescriptionReconciliation()).staleParentRefs, []);
  assert.equal((await store.loadFeatures()).features[0].workDone, "Preserve this metadata.");
});
