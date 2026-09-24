import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskOrderContext, taskOrderContextLine, taskCreatedPriorityFragment } from "../dist/task-order-context.js";

const feature = { id: "feature-id", number: 3 };

function phase(overrides = {}) {
  return { id: "phase-id", number: 7, featureId: feature.id, ...overrides };
}

// P104(F005)/T421: an agent reading a task in full could not see priority
// or dependencies, so it had no data to apply the ordering rule with. These
// tests pin the fact this module now surfaces at that same read.

test("buildTaskOrderContext reports the task's own priority, falling back to its number", () => {
  const currentPhase = phase({
    tasks: [
      { id: "t1", number: 1, priority: 5, title: "First", status: "planned", dependsOn: [] },
    ],
  });
  const context = buildTaskOrderContext(currentPhase.tasks[0], currentPhase, [currentPhase], [feature]);
  assert.equal(context.priority, 5);

  const noPriorityPhase = phase({
    tasks: [{ id: "t1", number: 4, title: "No explicit priority", status: "planned", dependsOn: [] }],
  });
  const fallback = buildTaskOrderContext(noPriorityPhase.tasks[0], noPriorityPhase, [noPriorityPhase], [feature]);
  assert.equal(fallback.priority, 4, "falls back to task.number when priority is unset");
});

test("buildTaskOrderContext counts ready siblings and how many precede this task", () => {
  const currentPhase = phase({
    tasks: [
      { id: "t-top", number: 1, priority: 1, title: "Top", status: "planned", dependsOn: [] },
      { id: "t-mid", number: 2, priority: 5, title: "Mid", status: "planned", dependsOn: [] },
      { id: "t-blocked", number: 3, priority: 2, title: "Blocked", status: "planned", dependsOn: ["t-top"] },
      { id: "t-done", number: 4, priority: 0, title: "Done already", status: "done", dependsOn: [] },
    ],
  });
  const midContext = buildTaskOrderContext(currentPhase.tasks[1], currentPhase, [currentPhase], [feature]);
  // Ready siblings: t-top (planned, no deps) and t-mid itself (planned, no
  // deps). t-blocked depends on an undone task so it is not ready; t-done is
  // terminal so it never counts as ready.
  assert.equal(midContext.readyCount, 2);
  assert.equal(midContext.readyAheadCount, 1, "t-top precedes t-mid by priority");
  assert.equal(midContext.nextByPriorityRef, "P007(F003)/T001");

  const topContext = buildTaskOrderContext(currentPhase.tasks[0], currentPhase, [currentPhase], [feature]);
  assert.equal(topContext.readyAheadCount, 0, "the first task in a phase has nothing ahead of it");
  assert.equal(topContext.nextByPriorityRef, null, "the top-priority ready task does not point at itself");
});

test("buildTaskOrderContext resolves dependsOn to composite ref and status, including cross-phase deps", () => {
  const otherPhase = phase({
    id: "other-phase",
    number: 8,
    tasks: [{ id: "t-cross", number: 9, priority: 1, title: "Cross-phase dep", status: "in-progress", dependsOn: [] }],
  });
  const currentPhase = phase({
    tasks: [
      { id: "t-dep-done", number: 1, priority: 1, title: "Done dep", status: "done", dependsOn: [] },
      { id: "t-target", number: 2, priority: 2, title: "Target", status: "planned", dependsOn: ["t-dep-done", "t-cross"] },
    ],
  });
  const context = buildTaskOrderContext(currentPhase.tasks[1], currentPhase, [currentPhase, otherPhase], [feature]);
  assert.deepEqual(context.dependsOn, [
    { ref: "P007(F003)/T001", taskId: "t-dep-done", status: "done" },
    { ref: "P008(F003)/T009", taskId: "t-cross", status: "in-progress" },
  ]);
});

test("buildTaskOrderContext marks a terminal task as no-longer-ordered without misleading counts", () => {
  const currentPhase = phase({
    tasks: [
      { id: "t-done", number: 1, priority: 1, title: "Finished", status: "done", dependsOn: [] },
      { id: "t-ready", number: 2, priority: 2, title: "Still ready", status: "planned", dependsOn: [] },
    ],
  });
  const context = buildTaskOrderContext(currentPhase.tasks[0], currentPhase, [currentPhase], [feature]);
  assert.equal(context.ordersApply, false);
  assert.equal(context.readyAheadCount, 0);
  assert.equal(context.nextByPriorityRef, null);
});

test("taskOrderContextLine renders one bounded line for an active task", () => {
  const currentPhase = phase({
    tasks: [
      { id: "t1", number: 1, priority: 9, title: "Active", status: "planned", dependsOn: ["t2"] },
      { id: "t2", number: 2, priority: 1, title: "Blocking", status: "in-progress", dependsOn: [] },
    ],
  });
  const context = buildTaskOrderContext(currentPhase.tasks[0], currentPhase, [currentPhase], [feature]);
  const line = taskOrderContextLine(context, "planned");
  assert.equal(line, "Priority 9 · 0 ready in phase · 0 ready ahead of this one. Depends on: P007(F003)/T002 (in-progress).");
});

test("taskOrderContextLine renders the terminal form for a done task, without ready-ahead counts", () => {
  const currentPhase = phase({
    tasks: [{ id: "t-done", number: 1, priority: 1, title: "Finished", status: "done", dependsOn: [] }],
  });
  const context = buildTaskOrderContext(currentPhase.tasks[0], currentPhase, [currentPhase], [feature]);
  const line = taskOrderContextLine(context, "done");
  assert.equal(line, "Priority 1 (done; ordering no longer applies). Depends on: None.");
});

test("taskCreatedPriorityFragment states the assigned priority", () => {
  assert.equal(taskCreatedPriorityFragment(12), "priority 12");
});
