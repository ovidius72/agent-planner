import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  cleanupFixtures,
  createPlannerFixture,
} from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupFixtures();
});

test("recordContextRead persists bounded attestations without changing entity timestamps", async () => {
  const { store } = await createPlannerFixture({ name: "session-info", seed: "minimal" });
  const phase = (await store.loadAllPhases())[0];
  const feature = (await store.loadFeatures()).features[0];
  const task = phase.tasks[0];
  const requirement = (await store.linkedRequirementsForPhase(phase.id))[0];
  const before = {
    task: task.updatedAt,
    phase: phase.updatedAt,
    feature: feature.updatedAt,
    requirement: requirement.updatedAt,
  };
  const readAt = "2026-02-01T00:00:00.000Z";

  await store.recordContextRead({
    sessionId: "session-a",
    phaseId: phase.id,
    taskId: task.id,
    featureId: feature.id,
    requirementIds: [requirement.id],
    createdAt: readAt,
  });

  const after = {
    task: (await store.loadPhase(phase.id)).tasks[0].updatedAt,
    phase: (await store.loadPhase(phase.id)).updatedAt,
    feature: (await store.loadFeatures()).features[0].updatedAt,
    requirement: (await store.loadRequirements()).requirements.find((entry) => entry.id === requirement.id).updatedAt,
  };
  assert.deepEqual(after, before);
  assert.deepEqual((await store.loadPhase(phase.id)).tasks[0].sessionInfo, [{ sessionId: "session-a", createdAt: readAt }]);
  assert.deepEqual((await store.loadPhase(phase.id)).sessionInfo, [{ sessionId: "session-a", createdAt: readAt }]);
  assert.deepEqual((await store.loadFeatures()).features[0].sessionInfo, [{ sessionId: "session-a", createdAt: readAt }]);
  assert.deepEqual((await store.loadRequirements()).requirements.find((entry) => entry.id === requirement.id).sessionInfo, [{ sessionId: "session-a", createdAt: readAt }]);

  await store.recordContextRead({
    sessionId: "session-a",
    phaseId: phase.id,
    taskId: task.id,
    featureId: feature.id,
    requirementIds: [requirement.id],
    createdAt: "2026-02-02T00:00:00.000Z",
  });
  assert.deepEqual((await store.loadPhase(phase.id)).sessionInfo, [{ sessionId: "session-a", createdAt: "2026-02-02T00:00:00.000Z" }]);
});

test("recordContextRead bounds session history and rejects missing requirements without mutation", async () => {
  const { store } = await createPlannerFixture({ name: "session-info-bounded", seed: "minimal" });
  const phase = (await store.loadAllPhases())[0];
  const feature = (await store.loadFeatures()).features[0];
  const task = phase.tasks[0];
  const before = JSON.stringify(await store.loadPhase(phase.id));

  await assert.rejects(
    store.recordContextRead({
      sessionId: "session-missing-requirement",
      phaseId: phase.id,
      taskId: task.id,
      featureId: feature.id,
      requirementIds: ["missing-requirement"],
      createdAt: "2026-03-01T00:00:00.000Z",
    }),
    /Requirement missing-requirement was not found/,
  );
  assert.equal(JSON.stringify(await store.loadPhase(phase.id)), before);

  const requirement = (await store.linkedRequirementsForPhase(phase.id))[0];
  for (let index = 0; index < 17; index += 1) {
    await store.recordContextRead({
      sessionId: `session-${index}`,
      phaseId: phase.id,
      taskId: task.id,
      featureId: feature.id,
      requirementIds: [requirement.id],
      createdAt: `2026-04-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    });
  }
  const sessions = (await store.loadPhase(phase.id)).sessionInfo;
  assert.equal(sessions.length, 16);
  assert.equal(sessions.some((entry) => entry.sessionId === "session-0"), false);
  assert.equal(sessions[0].sessionId, "session-16");
});
