import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cleanupFixtures, createPlannerFixture } from "../../../test/helpers/fixtures.mjs";

const decisionInput = {
  title: "Use semantic decision mutations",
  decision: "Manage accepted decisions one entry at a time.",
  rationale: "Array replacement can drop IDs, acceptedAt, or concurrent entries.",
  implementationNotes: "Expose create/update/delete helpers for every owner kind.",
};

after(async () => {
  await cleanupFixtures();
});

test("accepted decision helpers create, update, and delete project decisions without replacing metadata", async () => {
  const fixture = await createPlannerFixture({ name: "accepted-decision-project", seed: "minimal" });
  const created = await fixture.store.createAcceptedDecision({ kind: "project" }, decisionInput, "2026-02-01T00:00:00.000Z");
  assert.equal(created.title, decisionInput.title);
  assert.equal(created.acceptedAt, "2026-02-01T00:00:00.000Z");

  const updated = await fixture.store.updateAcceptedDecision({ kind: "project" }, created.id, { title: "Use semantic mutations" });
  assert.equal(updated.id, created.id);
  assert.equal(updated.acceptedAt, created.acceptedAt);
  assert.equal(updated.rationale, decisionInput.rationale);

  const deleted = await fixture.store.deleteAcceptedDecision({ kind: "project" }, created.id);
  assert.equal(deleted.id, created.id);
  assert.equal((await fixture.store.loadProject()).acceptedDecisions.length, 0);
});

test("accepted decision helpers manage feature, phase, and task owners independently", async () => {
  const fixture = await createPlannerFixture({ name: "accepted-decision-entities", seed: "minimal" });
  const [feature] = (await fixture.store.loadFeatures()).features;
  const [phase] = await fixture.store.loadAllPhases();
  const [task] = phase.tasks;

  const featureDecision = await fixture.store.createAcceptedDecision({ kind: "feature", featureId: feature.id }, decisionInput);
  const phaseDecision = await fixture.store.createAcceptedDecision({ kind: "phase", phaseId: phase.id }, { ...decisionInput, title: "Phase policy" });
  const taskDecision = await fixture.store.createAcceptedDecision({ kind: "task", phaseId: phase.id, taskId: task.id }, { ...decisionInput, title: "Task policy" });

  assert.equal((await fixture.store.loadFeatures()).features[0].acceptedDecisions[0].id, featureDecision.id);
  const reloadedPhase = await fixture.store.loadPhase(phase.id);
  assert.equal(reloadedPhase.acceptedDecisions[0].id, phaseDecision.id);
  assert.equal(reloadedPhase.tasks[0].acceptedDecisions[0].id, taskDecision.id);

  await fixture.store.deleteAcceptedDecision({ kind: "phase", phaseId: phase.id }, phaseDecision.id);
  const afterDelete = await fixture.store.loadPhase(phase.id);
  assert.equal(afterDelete.acceptedDecisions.length, 0);
  assert.equal(afterDelete.tasks[0].acceptedDecisions[0].id, taskDecision.id, "task decision remains untouched");
});

test("accepted decision update rejects no-op payloads and missing IDs without mutation", async () => {
  const fixture = await createPlannerFixture({ name: "accepted-decision-errors", seed: "minimal" });
  const created = await fixture.store.createAcceptedDecision({ kind: "project" }, decisionInput);

  await assert.rejects(
    fixture.store.updateAcceptedDecision({ kind: "project" }, created.id, {}),
    (error) => {
      assert.equal(error.details.errorCode, "NO_MUTABLE_FIELDS_RECEIVED");
      assert.equal(error.details.entity, "acceptedDecision");
      return true;
    },
  );

  await assert.rejects(
    fixture.store.deleteAcceptedDecision({ kind: "project" }, "missing"),
    (error) => {
      assert.equal(error.details.errorCode, "ACCEPTED_DECISION_NOT_FOUND");
      assert.equal(error.details.decisionId, "missing");
      return true;
    },
  );

  assert.equal((await fixture.store.loadProject()).acceptedDecisions[0].id, created.id);
});
