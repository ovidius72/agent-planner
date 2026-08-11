import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FeatureSchema,
  PhaseSchema,
  PlanStore,
  createFeatureId,
  createPhaseId,
} from "@agent-plan/core";
import { serve } from "../dist/index.js";

const roots = [];
let handle;
let store;
let phase;

function requirement(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "Requirements API fixture",
    description: "",
    status: "planned",
    macroTasks: [],
    linkedPhaseIds: ["P001"],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function request(path, init) {
  const response = await fetch(`${handle.url}${path}`, init);
  return { response, body: await response.json() };
}

before(async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plan-requirements-api-"));
  roots.push(root);
  store = new PlanStore(join(root, ".planner"));
  await store.init("requirements api test");

  const now = new Date().toISOString();
  const feature = FeatureSchema.parse({
    id: createFeatureId(), number: 1, name: "Feature", phaseIds: [], createdAt: now, updatedAt: now,
  });
  await store.saveFeature(feature);
  phase = PhaseSchema.parse({
    id: createPhaseId(), featureId: feature.id, number: 1, slug: "phase", title: "Phase", createdAt: now, updatedAt: now,
  });
  await store.savePhase(phase);
  await store.updateFeatures((doc) => {
    doc.features[0].phaseIds.push(phase.id);
    return doc;
  });
  handle = await serve({ planRoot: store.root, port: 0, staticDir: "", quiet: true });
});

after(async () => {
  await handle?.close();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("requirements API phase-link invariant", () => {
  test("POST rejects missing and unknown phase links without persistence", async () => {
    const before = await store.loadRequirements();
    for (const linkedPhaseIds of [[], ["P999"]]) {
      const { response, body } = await request("/requirements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requirement({ linkedPhaseIds })),
      });
      assert.equal(response.status, 400);
      assert.match(body.error, /linkedPhaseIds|linked phase/i);
      assert.deepEqual(await store.loadRequirements(), before);
    }
  });

  test("POST resolves a phase reference to its persisted UUID", async () => {
    const { response, body } = await request("/requirements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requirement({ linkedPhaseIds: ["P001"] })),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(body.linkedPhaseIds, [phase.id]);
    const persisted = (await store.loadRequirements()).requirements.find((entry) => entry.id === body.id);
    assert.deepEqual(persisted?.linkedPhaseIds, [phase.id]);
  });

  test("GET phase returns requirements linked by the canonical phase UUID", async () => {
    const requirement = (await store.loadRequirements()).requirements[0];
    assert.ok(requirement, "POST fixture must have created a requirement");
    const { response, body } = await request(`/phases/${phase.id}`);
    assert.equal(response.status, 200);
    assert.deepEqual(body.linkedRequirements.map((entry) => entry.id), [requirement.id]);
  });

  test("PUT rejects removing or replacing the last valid phase link without changing the requirement", async () => {
    const current = (await store.loadRequirements()).requirements[0];
    assert.ok(current, "POST fixture must have created a requirement");
    for (const linkedPhaseIds of [[], [crypto.randomUUID()]]) {
      const { response, body } = await request(`/requirements/${current.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...current, linkedPhaseIds }),
      });
      assert.equal(response.status, 400);
      assert.match(body.error, /linkedPhaseIds|linked phase/i);
      const persisted = (await store.loadRequirements()).requirements.find((entry) => entry.id === current.id);
      assert.deepEqual(persisted, current);
    }
  });
});
