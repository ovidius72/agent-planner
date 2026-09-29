/**
 * P108(F005)/T444 — PlanStore.addTaskDependency already resolved a
 * dependency target across every phase (it loads via loadAllPhases()), but
 * the MCP/Pi tool descriptions said "rejects ... foreign tasks", which read
 * as phase-local and misled an agent into thinking a cross-phase dependency
 * would be refused. This proves the core behavior the reworded descriptions
 * now state plainly: a task may depend on any task in any phase, and is
 * rejected only for a missing target, a self-dependency, or a cycle.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlanStore, PhaseSchema, createPhaseId, createTaskId } from "../dist/index.js";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

test("addTaskDependency accepts a cross-phase dependency when none exists yet", async () => {
  const root = await mkdtemp(join(tmpdir(), "task-dependency-cross-phase-"));
  roots.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("Cross-phase dependency");
  const now = "2026-01-01T00:00:00.000Z";

  const phaseA = PhaseSchema.parse({ id: createPhaseId(), number: 1, slug: "phase-a", title: "Phase A", createdAt: now, updatedAt: now });
  const phaseB = PhaseSchema.parse({ id: createPhaseId(), number: 2, slug: "phase-b", title: "Phase B", createdAt: now, updatedAt: now });
  const taskA = { id: createTaskId(), phaseId: phaseA.id, number: 1, shortId: "", priority: 0, shortName: "task-a", title: "Task A", status: "planned", createdAt: now, updatedAt: now };
  const taskB = { id: createTaskId(), phaseId: phaseB.id, number: 2, shortId: "", priority: 0, shortName: "task-b", title: "Task B", status: "planned", createdAt: now, updatedAt: now };
  await store.savePhase({ ...phaseA, tasks: [taskA], taskIds: [taskA.id] });
  await store.savePhase({ ...phaseB, tasks: [taskB], taskIds: [taskB.id] });

  // No dependency exists yet between these two tasks in different phases.
  const before = await store.loadPhase(phaseB.id);
  assert.deepEqual(before.tasks[0].dependsOn, []);

  const result = await store.addTaskDependency(phaseB.id, taskB.id, taskA.id);
  assert.deepEqual(result.dependsOn, [taskA.id], "cross-phase dependency must be accepted, not rejected as a foreign task");

  const persisted = await store.loadPhase(phaseB.id);
  assert.deepEqual(persisted.tasks[0].dependsOn, [taskA.id]);
});
