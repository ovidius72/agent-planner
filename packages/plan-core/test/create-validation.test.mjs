import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PlanStore,
  FeatureSchema,
  createFeatureId,
  createPhaseId,
  createTaskId,
} from "../dist/index.js";

async function makeStore() {
  const root = await mkdtemp(join(tmpdir(), "create-validation-"));
  const store = new PlanStore(join(root, ".planner"));
  await store.init("create validation test");
  return { store, root };
}

const now = new Date().toISOString();

test("savePhase rejects non-UUID featureId ref string", async () => {
  const { store, root } = await makeStore();
  try {
    const phase = {
      id: createPhaseId(),
      number: 1,
      featureId: "F005", // ref string, not UUID
      slug: "p",
      title: "P",
      tasks: [],
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await assert.rejects(
      () => store.savePhase(phase),
      /UUID|featureId|does not match/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("savePhase resolves F00x ref to UUID before persisting", async () => {
  const { store, root } = await makeStore();
  try {
    const feature = FeatureSchema.parse({
      id: createFeatureId(),
      number: 5,
      name: "Feature Five",
      status: "planned",
      createdAt: now,
      updatedAt: now,
    });
    await store.saveFeature(feature);

    const phase = {
      id: createPhaseId(),
      number: 1,
      featureId: "F005",
      slug: "p",
      title: "P",
      tasks: [],
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await store.savePhase(phase);
    const loaded = await store.loadPhase(phase.id);
    assert.equal(loaded.featureId, feature.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task with non-UUID phaseId is rejected by schema inside updatePhase", async () => {
  const { store, root } = await makeStore();
  try {
    const feature = FeatureSchema.parse({
      id: createFeatureId(),
      number: 1,
      name: "Feature One",
      status: "planned",
      createdAt: now,
      updatedAt: now,
    });
    await store.saveFeature(feature);
    const phase = {
      id: createPhaseId(),
      number: 1,
      featureId: feature.id,
      slug: "p",
      title: "P",
      tasks: [],
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await store.savePhase(phase);

    const badTask = {
      id: createTaskId(),
      phaseId: "P003", // ref string, not UUID
      number: 1,
      shortName: "t1",
      title: "T",
      status: "planned",
      createdAt: now,
      updatedAt: now,
    };
    await assert.rejects(
      () => store.updatePhase(phase.id, (ph) => { ph.tasks.push(badTask); return ph; }),
      /UUID|phaseId/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
