import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PlanStaleWriteError } from "../dist/index.js";
import { cleanupFixtures, createPlannerFixture } from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupFixtures();
});

test("field-scoped feature updates reject stale revisions without losing canonical metadata", async () => {
  const fixture = await createPlannerFixture({ name: "stale-feature", seed: "minimal" });
  const snapshot = (await fixture.store.loadFeatures()).features[0];
  const decision = {
    id: "decision-stale-write",
    title: "Preserve canonical decision",
    decision: "Canonical feature metadata wins over stale snapshots.",
    rationale: "A later serialized writer can still carry obsolete data.",
    implementationNotes: "Apply only explicit fields against a lock-reloaded entity.",
    acceptedAt: "2026-01-02T00:00:00.000Z",
  };

  const current = await fixture.store.updateFeature(snapshot.id, (feature) => ({
    ...feature,
    description: "new canonical description",
    acceptedDecisions: [...feature.acceptedDecisions, decision],
    updatedAt: "2026-01-02T00:00:00.000Z",
  }), { expectedUpdatedAt: snapshot.updatedAt });
  assert.equal(current.description, "new canonical description");

  await assert.rejects(
    fixture.store.updateFeature(snapshot.id, (feature) => ({
      ...feature,
      workDone: "stale client write",
      updatedAt: "2026-01-03T00:00:00.000Z",
    }), { expectedUpdatedAt: snapshot.updatedAt }),
    (error) => {
      assert.ok(error instanceof PlanStaleWriteError);
      assert.equal(error.code, "PLAN_STALE_WRITE");
      assert.equal(error.details.entity, "feature");
      assert.equal(error.details.expectedUpdatedAt, snapshot.updatedAt);
      assert.equal(error.details.actualUpdatedAt, "2026-01-02T00:00:00.000Z");
      return true;
    },
  );

  const persisted = (await fixture.store.loadFeatures()).features[0];
  assert.equal(persisted.description, "new canonical description");
  assert.deepEqual(persisted.acceptedDecisions, [decision]);
  assert.equal(persisted.workDone, "");
});

test("stale phase and task snapshots cannot overwrite newer canonical fields", async () => {
  const fixture = await createPlannerFixture({ name: "stale-phase-task", seed: "minimal" });
  const phaseSnapshot = (await fixture.store.loadAllPhases())[0];
  const taskSnapshot = phaseSnapshot.tasks[0];

  await fixture.store.updatePhase(phaseSnapshot.id, (phase) => ({
    ...phase,
    description: "new canonical phase description",
    updatedAt: "2026-01-02T00:00:00.000Z",
  }), { expectedUpdatedAt: phaseSnapshot.updatedAt });
  await assert.rejects(
    fixture.store.updatePhase(phaseSnapshot.id, (phase) => ({
      ...phase,
      summary: "stale summary",
      updatedAt: "2026-01-03T00:00:00.000Z",
    }), { expectedUpdatedAt: phaseSnapshot.updatedAt }),
    (error) => error instanceof PlanStaleWriteError && error.details.entity === "phase",
  );

  const taskCurrent = (await fixture.store.loadPhase(phaseSnapshot.id)).tasks[0];
  await fixture.store.updateTask(phaseSnapshot.id, taskCurrent.id, (task) => ({
    ...task,
    description: "new canonical task description",
    updatedAt: "2026-01-04T00:00:00.000Z",
  }), { expectedUpdatedAt: taskCurrent.updatedAt });
  await assert.rejects(
    fixture.store.updateTask(phaseSnapshot.id, taskCurrent.id, (task) => ({
      ...task,
      title: "stale task title",
      updatedAt: "2026-01-05T00:00:00.000Z",
    }), { expectedUpdatedAt: taskSnapshot.updatedAt }),
    (error) => error instanceof PlanStaleWriteError && error.details.entity === "task",
  );

  const persisted = await fixture.store.loadPhase(phaseSnapshot.id);
  assert.equal(persisted.description, "new canonical phase description");
  assert.equal(persisted.summary, phaseSnapshot.summary);
  assert.equal(persisted.tasks[0].description, "new canonical task description");
  assert.equal(persisted.tasks[0].title, taskSnapshot.title);
});

test("legacy snapshot save methods reject older feature, phase, and requirement documents", async () => {
  const fixture = await createPlannerFixture({ name: "stale-legacy-saves", seed: "minimal" });
  const featureSnapshot = structuredClone((await fixture.store.loadFeatures()).features[0]);
  const phaseSnapshot = structuredClone((await fixture.store.loadAllPhases())[0]);
  const requirementsSnapshot = structuredClone(await fixture.store.loadRequirements());

  await fixture.store.updateFeature(featureSnapshot.id, (feature) => ({
    ...feature,
    description: "new feature content",
    updatedAt: "2026-01-02T00:00:00.000Z",
  }));
  await fixture.store.updatePhase(phaseSnapshot.id, (phase) => ({
    ...phase,
    description: "new phase content",
    updatedAt: "2026-01-02T00:00:00.000Z",
  }));
  await fixture.store.updateRequirement(requirementsSnapshot.requirements[0].id, (requirement) => ({
    ...requirement,
    description: "new requirement content",
    updatedAt: "2026-01-02T00:00:00.000Z",
  }));

  await assert.rejects(fixture.store.saveFeature(featureSnapshot), PlanStaleWriteError);
  await assert.rejects(fixture.store.savePhase(phaseSnapshot), PlanStaleWriteError);
  await assert.rejects(fixture.store.saveRequirements(requirementsSnapshot), PlanStaleWriteError);

  assert.equal((await fixture.store.loadFeatures()).features[0].description, "new feature content");
  assert.equal((await fixture.store.loadPhase(phaseSnapshot.id)).description, "new phase content");
  assert.equal((await fixture.store.loadRequirements()).requirements[0].description, "new requirement content");
});

test("field-scoped requirement updates preserve unrelated fields and reject stale revisions", async () => {
  const fixture = await createPlannerFixture({ name: "stale-requirement", seed: "minimal" });
  const snapshot = (await fixture.store.loadRequirements()).requirements[0];

  await fixture.store.updateRequirement(snapshot.id, (requirement) => ({
    ...requirement,
    description: "new canonical requirement description",
    updatedAt: "2026-01-02T00:00:00.000Z",
  }), { expectedUpdatedAt: snapshot.updatedAt });

  await assert.rejects(
    fixture.store.updateRequirement(snapshot.id, (requirement) => ({
      ...requirement,
      title: "stale title",
      updatedAt: "2026-01-03T00:00:00.000Z",
    }), { expectedUpdatedAt: snapshot.updatedAt }),
    (error) => error instanceof PlanStaleWriteError && error.details.entity === "requirement",
  );

  const persisted = (await fixture.store.loadRequirements()).requirements[0];
  assert.equal(persisted.title, snapshot.title);
  assert.equal(persisted.description, "new canonical requirement description");
  assert.deepEqual(persisted.linkedPhaseIds, snapshot.linkedPhaseIds);
});
