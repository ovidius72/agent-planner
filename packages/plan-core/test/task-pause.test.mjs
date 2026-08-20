import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFeatureId,
  createPhaseId,
  createTaskId,
  FeatureSchema,
  PhaseSchema,
  PlanStore,
} from "../dist/index.js";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(status = "in-progress") {
  const root = await mkdtemp(join(tmpdir(), "plan-store-pause-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("task pause test");
  const createdAt = "2026-08-10T00:00:00.000Z";
  const feature = FeatureSchema.parse({
    id: createFeatureId(), number: 1, name: "Feature", status: "planned", createdAt, updatedAt: createdAt,
  });
  await store.saveFeature(feature);
  const phase = PhaseSchema.parse({
    id: createPhaseId(), number: 1, featureId: feature.id, slug: "phase", title: "Phase",
    status: "planned", createdAt, updatedAt: createdAt,
  });
  await store.savePhase(phase);
  const taskId = createTaskId();
  await store.updatePhase(phase.id, (current) => {
    current.tasks = [{
      id: taskId, number: 1, phaseId: phase.id, title: "Task", shortName: "task",
      status, startedAt: status === "in-progress" ? createdAt : "", createdAt, updatedAt: createdAt,
    }];
    return current;
  });
  return { store, phaseId: phase.id, taskId, createdAt };
}

const checkpoint = (relatedTaskId = "temporary-task") => ({
  id: "pause-snapshot-1",
  reason: "A prerequisite needs a temporary change",
  whatWasBeingDone: "Implementing the core selector",
  resumeLocation: "packages/plan-core/src/task-selection.ts:75",
  howToResume: "Finish the LIFO branch and rerun core tests",
  relatedTaskId,
  pausedAt: "2026-08-10T01:00:00.000Z",
  pausedBy: "test-session",
});

test("pauseTask persists a structured checkpoint and truthful paused status", async () => {
  const { store, phaseId, taskId, createdAt } = await setup();
  const paused = await store.pauseTask(phaseId, taskId, checkpoint());

  assert.equal(paused.status, "paused");
  assert.equal(paused.startedAt, createdAt);
  assert.equal(paused.pauseSnapshot.resumeLocation, checkpoint().resumeLocation);
  assert.equal(paused.pauseHistory.length, 1);
  assert.equal(paused.statusLog.at(-1).toStatus, "paused");
  assert.match(paused.statusLog.at(-1).description, /How to resume/);

  const phase = await store.loadPhase(phaseId);
  assert.equal(phase.status, "paused");
  assert.equal((await store.loadPhaseDisplay(phaseId)).displayStatus, "paused");
});

test("resumeTask clears only the active checkpoint and preserves history and startedAt", async () => {
  const { store, phaseId, taskId, createdAt } = await setup();
  await store.pauseTask(phaseId, taskId, checkpoint());
  const resumed = await store.resumeTask(phaseId, taskId, "2026-08-10T02:00:00.000Z");

  assert.equal(resumed.status, "in-progress");
  assert.equal(resumed.startedAt, createdAt);
  assert.equal(resumed.pauseSnapshot, null);
  assert.equal(resumed.pauseHistory.length, 1);
  assert.equal(resumed.statusLog.at(-1).fromStatus, "paused");
  assert.match(resumed.statusLog.at(-1).description, /task-selection\.ts:75/);
});

test("pauseTask rejects non-active work and incomplete checkpoints", async () => {
  const { store, phaseId, taskId } = await setup("planned");
  await assert.rejects(() => store.pauseTask(phaseId, taskId, checkpoint()), /cannot be paused from planned/);

  const active = await setup();
  await assert.rejects(
    () => active.store.pauseTask(active.phaseId, active.taskId, { ...checkpoint(), howToResume: "" }),
    /too_small|string must contain/i,
  );
});
