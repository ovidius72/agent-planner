import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlanStore, PhaseSchema, createPhaseId, createTaskId } from "../dist/index.js";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

test("dependency operations reject self edges and cycles while preserving edges", async () => {
  const root = await mkdtemp(join(tmpdir(), "dependencies-")); roots.push(root);
  const store = new PlanStore(join(root, ".planner")); await store.init("Dependencies");
  const now = "2026-01-01T00:00:00.000Z"; const phase = PhaseSchema.parse({ id: createPhaseId(), number: 1, slug: "phase", title: "Phase", status: "planned", createdAt: now, updatedAt: now });
  const first = { id: createTaskId(), phaseId: phase.id, number: 1, shortId: "", priority: 0, shortName: "first", title: "First", status: "planned", createdAt: now, updatedAt: now };
  const second = { id: createTaskId(), phaseId: phase.id, number: 2, shortId: "", priority: 1, shortName: "second", title: "Second", status: "planned", createdAt: now, updatedAt: now };
  await store.savePhase({ ...phase, tasks: [first, second], taskIds: [first.id, second.id] });
  await store.addTaskDependency(phase.id, first.id, second.id);
  assert.deepEqual((await store.loadPhase(phase.id)).tasks[0].dependsOn, [second.id]);
  await assert.rejects(() => store.addTaskDependency(phase.id, second.id, first.id), (error) => error?.details?.errorCode === "DEPENDENCY_CYCLE");
  await assert.rejects(() => store.addTaskDependency(phase.id, first.id, first.id), (error) => error?.details?.errorCode === "DEPENDENCY_SELF");
  await store.deleteTaskDependency(phase.id, first.id, second.id);
  assert.deepEqual((await store.loadPhase(phase.id)).tasks[0].dependsOn, []);
});

test("subtask semantic operations preserve identity and reject forged order or ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "subtasks-")); roots.push(root);
  const store = new PlanStore(join(root, ".planner")); await store.init("Subtasks");
  const now = "2026-01-01T00:00:00.000Z";
  const phase = PhaseSchema.parse({ id: createPhaseId(), number: 1, slug: "phase", title: "Phase", status: "planned", createdAt: now, updatedAt: now });
  const task = { id: createTaskId(), phaseId: phase.id, number: 1, shortId: "", priority: 0, shortName: "task", title: "Task", status: "planned", createdAt: now, updatedAt: now };
  await store.savePhase({ ...phase, tasks: [task], taskIds: [task.id] });
  const first = await store.createSubtask(phase.id, task.id, { title: "First" });
  const second = await store.createSubtask(phase.id, task.id, { title: "Second" });
  await assert.rejects(() => store.updateSubtask(phase.id, task.id, "forged", { title: "Nope" }), (error) => error?.details?.errorCode === "SUBTASK_NOT_FOUND");
  await store.reorderSubtasks(phase.id, task.id, [second.id, first.id]);
  const updated = await store.updateSubtask(phase.id, task.id, first.id, { status: "done" });
  assert.equal(updated.id, first.id); assert.equal(updated.status, "done");
  await assert.rejects(() => store.reorderSubtasks(phase.id, task.id, [first.id]), (error) => error?.details?.errorCode === "SUBTASK_ORDER_INVALID");
  await store.deleteSubtask(phase.id, task.id, second.id);
  assert.deepEqual((await store.loadPhase(phase.id)).tasks[0].subtasks.map((item) => item.id), [first.id]);
});
