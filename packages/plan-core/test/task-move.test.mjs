/**
 * P108(F005)/T443 — moveTasks is the one place a task changes phase without
 * being recreated. These tests cover: every field survives the move except
 * phaseId/statusLog/updatedAt, a dependent task's dependsOn keeps resolving
 * (ids never change), validation is typed by errorCode, and a failure
 * partway through a multi-source move leaves every phase file untouched
 * (rolled back), not half-moved.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlanStore, PhaseSchema, createPhaseId, createTaskId, moveTasks, buildTaskMoveReply } from "../dist/index.js";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function setup(label) {
  const root = await mkdtemp(join(tmpdir(), `task-move-${label}-`));
  roots.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("Task move");
  return { root, store, now: "2026-01-01T00:00:00.000Z" };
}

function makeTask(overrides) {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: createTaskId(), priority: 0, shortId: "", statusLog: [], decisions: [], acceptedDecisions: [],
    checklist: [], subtasks: [], dependsOn: [], pauseSnapshot: null, pauseHistory: [], notes: "",
    description: "", createdAt: now, updatedAt: now, status: "planned",
    ...overrides,
  };
}

test("moveTasks keeps every task field except phaseId/statusLog/updatedAt, and dependents keep resolving", async () => {
  const { store, now } = await setup("keeps-fields");
  const source = PhaseSchema.parse({ id: createPhaseId(), number: 1, slug: "source", title: "Source", createdAt: now, updatedAt: now });
  const target = PhaseSchema.parse({ id: createPhaseId(), number: 2, slug: "target", title: "Target", createdAt: now, updatedAt: now });

  const moved = makeTask({
    phaseId: source.id, number: 10, shortId: "MVEDT", shortName: "moved-task", title: "Moved task",
    status: "in-progress", notes: "some notes", description: "a description",
    checklist: [{ id: "c1", number: 1, title: "step one", checked: true }],
    subtasks: [{ id: "s1", title: "sub", description: "", status: "planned", createdAt: now, updatedAt: now }],
    acceptedDecisions: [{ id: "d1", title: "Decision", decision: "do it", rationale: "because", implementationNotes: "", acceptedAt: now }],
    pauseHistory: [{ id: "p1", reason: "r", whatWasBeingDone: "w", resumeLocation: "l", howToResume: "h", relatedTaskId: "", pausedAt: now, pausedBy: "" }],
  });
  const dependent = makeTask({ phaseId: source.id, number: 11, shortId: "DEPND", shortName: "dependent-task", title: "Dependent task", dependsOn: [moved.id] });

  await store.savePhase({ ...source, tasks: [moved, dependent], taskIds: [moved.id, dependent.id] });
  await store.savePhase({ ...target, tasks: [], taskIds: [] });

  const outcome = await moveTasks(store, [moved.id], target.id, "2026-02-02T00:00:00.000Z");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.targetPhaseRef, "P002");
  assert.deepEqual(outcome.result.moves, [{
    taskId: moved.id, shortId: "MVEDT", title: "Moved task", status: "in-progress",
    oldRef: "P001/T010", newRef: "P002/T010",
  }]);

  const persistedSource = await store.loadPhase(source.id);
  const persistedTarget = await store.loadPhase(target.id);
  assert.equal(persistedSource.tasks.length, 1, "moved task must be gone from the source phase");
  assert.equal(persistedSource.tasks[0].id, dependent.id);

  const persistedMoved = persistedTarget.tasks.find((t) => t.id === moved.id);
  assert.ok(persistedMoved, "moved task must exist in the target phase");
  assert.equal(persistedMoved.phaseId, target.id);
  assert.equal(persistedMoved.id, moved.id);
  assert.equal(persistedMoved.number, 10, "global task number must not change");
  assert.equal(persistedMoved.shortId, "MVEDT");
  assert.equal(persistedMoved.status, "in-progress", "status must not change on a move");
  assert.equal(persistedMoved.notes, "some notes");
  assert.equal(persistedMoved.description, "a description");
  assert.deepEqual(persistedMoved.checklist.map((c) => ({ title: c.title, checked: c.checked })), [{ title: "step one", checked: true }]);
  assert.equal(persistedMoved.subtasks.length, 1);
  assert.equal(persistedMoved.acceptedDecisions.length, 1);
  assert.equal(persistedMoved.pauseHistory.length, 1);

  // A new statusLog entry was appended recording the move, without changing status.
  const lastEntry = persistedMoved.statusLog[persistedMoved.statusLog.length - 1];
  assert.ok(lastEntry, "a statusLog entry must be appended for the move");
  assert.equal(lastEntry.fromStatus, "in-progress");
  assert.equal(lastEntry.toStatus, "in-progress");
  assert.match(lastEntry.title, /P001\/T010.*P002\/T010/);

  // The dependent task, untouched and still in the source phase, still
  // resolves its dependency because the moved task's id never changed.
  const persistedDependent = persistedSource.tasks.find((t) => t.id === dependent.id);
  assert.deepEqual(persistedDependent.dependsOn, [moved.id]);
});

test("moveTasks rejects: target phase not found, source == target, task not found, terminal target phase", async () => {
  const { store, now } = await setup("validation");
  const source = PhaseSchema.parse({ id: createPhaseId(), number: 1, slug: "source", title: "Source", createdAt: now, updatedAt: now });
  const openTarget = PhaseSchema.parse({ id: createPhaseId(), number: 2, slug: "open-target", title: "Open target", createdAt: now, updatedAt: now });
  const doneOnly = PhaseSchema.parse({ id: createPhaseId(), number: 3, slug: "done-only", title: "Done only", createdAt: now, updatedAt: now });
  const task = makeTask({ phaseId: source.id, number: 20, shortName: "task", title: "Task" });
  const openTask = makeTask({ phaseId: openTarget.id, number: 22, shortName: "open-task", title: "Open task" });
  const doneTask = makeTask({ phaseId: doneOnly.id, number: 21, shortName: "done-task", title: "Done task", status: "done" });
  await store.savePhase({ ...source, tasks: [task], taskIds: [task.id] });
  await store.savePhase({ ...openTarget, tasks: [openTask], taskIds: [openTask.id] });
  await store.savePhase({ ...doneOnly, tasks: [doneTask], taskIds: [doneTask.id] });

  const notFound = await moveTasks(store, [task.id], "00000000-0000-0000-0000-000000000000");
  assert.equal(notFound.ok, false);
  assert.equal(notFound.errorCode, "TARGET_PHASE_NOT_FOUND");

  const sameSource = await moveTasks(store, [task.id], source.id);
  assert.equal(sameSource.ok, false);
  assert.equal(sameSource.errorCode, "SOURCE_EQUALS_TARGET");

  const missingTask = await moveTasks(store, ["00000000-0000-0000-0000-000000000000"], openTarget.id);
  assert.equal(missingTask.ok, false);
  assert.equal(missingTask.errorCode, "TASK_NOT_FOUND");

  // doneOnly's derived status is "done" (its only task is done) — terminal.
  const terminal = await moveTasks(store, [task.id], doneOnly.id);
  assert.equal(terminal.ok, false);
  assert.equal(terminal.errorCode, "TARGET_PHASE_TERMINAL");

  const noTasks = await moveTasks(store, [], openTarget.id);
  assert.equal(noTasks.ok, false);
  assert.equal(noTasks.errorCode, "NO_TASKS_GIVEN");
});

test("moveTasks is atomic: a failure after removing from sources leaves every phase file untouched", async () => {
  const { store, now } = await setup("atomic");
  const sourceA = PhaseSchema.parse({ id: createPhaseId(), number: 1, slug: "source-a", title: "Source A", createdAt: now, updatedAt: now });
  const sourceB = PhaseSchema.parse({ id: createPhaseId(), number: 2, slug: "source-b", title: "Source B", createdAt: now, updatedAt: now });
  const target = PhaseSchema.parse({ id: createPhaseId(), number: 3, slug: "target", title: "Target", createdAt: now, updatedAt: now });
  const taskA = makeTask({ phaseId: sourceA.id, number: 30, shortName: "task-a", title: "Task A" });
  const taskB = makeTask({ phaseId: sourceB.id, number: 31, shortName: "task-b", title: "Task B" });
  await store.savePhase({ ...sourceA, tasks: [taskA], taskIds: [taskA.id] });
  await store.savePhase({ ...sourceB, tasks: [taskB], taskIds: [taskB.id] });
  await store.savePhase({ ...target, tasks: [], taskIds: [] });

  const original = store.updatePhase.bind(store);
  let calls = 0;
  store.updatePhase = async (...args) => {
    calls += 1;
    // Let both source removals succeed, then fail on the target write.
    if (calls === 3) throw new Error("simulated failure writing target phase");
    return original(...args);
  };

  await assert.rejects(() => moveTasks(store, [taskA.id, taskB.id], target.id), /simulated failure/);
  store.updatePhase = original;

  const persistedA = await store.loadPhase(sourceA.id);
  const persistedB = await store.loadPhase(sourceB.id);
  const persistedTarget = await store.loadPhase(target.id);
  assert.deepEqual(persistedA.tasks.map((t) => t.id), [taskA.id], "source A must be rolled back");
  assert.deepEqual(persistedB.tasks.map((t) => t.id), [taskB.id], "source B must be rolled back");
  assert.equal(persistedTarget.tasks.length, 0, "target must never have been written");
});

test("moveTasks flags a source phase's pending handoff without rewriting it, and buildTaskMoveReply surfaces it", async () => {
  const { store, now } = await setup("handoff-notice");
  const source = PhaseSchema.parse({ id: createPhaseId(), number: 1, slug: "source", title: "Source", createdAt: now, updatedAt: now });
  const target = PhaseSchema.parse({ id: createPhaseId(), number: 2, slug: "target", title: "Target", createdAt: now, updatedAt: now });
  const task = makeTask({ phaseId: source.id, number: 40, shortName: "task", title: "Task" });
  await store.savePhase({ ...source, tasks: [task], taskIds: [task.id], handoff: "See P001/T040 for the remaining wiring." });
  await store.savePhase({ ...target, tasks: [], taskIds: [] });

  const outcome = await moveTasks(store, [task.id], target.id);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.result.sourcePhaseRefsWithHandoff, ["P001"]);

  const reply = buildTaskMoveReply(outcome.result, "planner-task-show P002/T040 full=true");
  assert.match(reply.text, /Pending handoff on P001.*not rewritten/);
  assert.deepEqual(reply.structured.sourcePhaseRefsWithHandoff, ["P001"]);

  // The handoff itself, being free prose, is left exactly as it was.
  const persistedSource = await store.loadPhase(source.id);
  assert.equal(persistedSource.handoff, "See P001/T040 for the remaining wiring.");
});
