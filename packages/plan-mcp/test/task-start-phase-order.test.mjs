/**
 * P104(F005)/T422 — regression for the reported session: P102 (priority 34)
 * was left in-progress with a planned task while work moved on to P104
 * (priority 36). `task_switch` and `task_deviation` both protect an
 * in-flight task; nothing protected a phase whose last task simply finished.
 * `planner-task-start` now attaches a non-blocking phase-order advisory when
 * the target phase is not the highest-priority in-progress phase with ready
 * work, without ever denying the start.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PhaseSchema, createPhaseId, createTaskId } from "@agent-plan/core";
import {
  startMcpFixture,
  closeMcpFixture,
  cleanupMcpFixtures,
  callTool,
  toolText,
  toolStructured,
} from "../../../test/helpers/mcp-fixture.mjs";
import { cleanupFixtures } from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupMcpFixtures();
  await cleanupFixtures();
});

/**
 * Adds a second phase to the fixture's feature: a higher-priority phase
 * (lower priority number than the "minimal" seed's phase, which is 10) with
 * one done task and `readyTasks` still-planned tasks — in-progress by
 * derived status, with that many tasks ready to start.
 */
async function addHigherPriorityOpenPhase(session, { priority = 5, readyTasks = 1 } = {}) {
  const now = new Date().toISOString();
  const featureId = (await session.store.loadFeatures()).features[0].id;
  const phase = PhaseSchema.parse({
    id: createPhaseId(), featureId, number: 900, priority, slug: "higher-priority-phase", title: "Higher priority phase", createdAt: now, updatedAt: now,
  });
  await session.store.savePhase(phase);
  await session.store.updatePhase(phase.id, (ph) => {
    ph.tasks = [
      { id: createTaskId(), number: 901, phaseId: phase.id, title: "Already finished", shortName: "already-finished", status: "done", createdAt: now, updatedAt: now },
      ...Array.from({ length: readyTasks }, (_, index) => ({
        id: createTaskId(), number: 902 + index, phaseId: phase.id, title: `Still open ${index}`, shortName: `still-open-${index}`, status: "planned", createdAt: now, updatedAt: now,
      })),
    ];
    return ph;
  });
  return phase;
}

/** Satisfies task_start's read gates for the "minimal" seed's own T001/P001/F001
 * (P001 has one linked requirement) — the exact sequence the sibling handoff
 * retention test (mcp-handoff.test.mjs) uses before calling planner-task-start. */
async function primeSeedReads(session) {
  await callTool(session, "planner-task-show", { task: "T001", full: true });
  await callTool(session, "planner-phase-show", { phase: "P001", full: true });
  await callTool(session, "planner-feature-show", { feature: "F001", full: true });
  await callTool(session, "planner-requirement-list", { phaseRef: "P001" });
}

/** Satisfies task_start's read gates for a task in the added higher-priority
 * phase. It carries no requirement of its own, but the seed's requirement is
 * linked to F001's P001 — `linkedRequirementsForFeature` surfaces it for
 * every phase in that feature, so it still gates a task in the new phase. */
async function primeHigherPhaseReads(session, taskRef) {
  await callTool(session, "planner-task-show", { task: taskRef, full: true });
  await callTool(session, "planner-phase-show", { phase: "P900", full: true });
  await callTool(session, "planner-feature-show", { feature: "F001", full: true });
  await callTool(session, "planner-requirement-list", { phaseRef: "P900" });
}

test("planner-task-start advises when the target phase is not the highest-priority in-progress phase with ready work", async () => {
  const session = await startMcpFixture({ name: "t422-lower-priority-start" });
  try {
    await addHigherPriorityOpenPhase(session);
    // The "minimal" seed's own phase is priority 10 — lower priority than
    // the phase just added (priority 5).
    await primeSeedReads(session);
    const started = await callTool(session, "planner-task-start", { task: "T001" });
    const structured = toolStructured(started);
    assert.equal(structured.started, true, "the start is never blocked by the advisory");
    assert.ok(structured.higherPriorityOpenPhase, "names the higher-priority phase in the structured payload");
    assert.equal(structured.higherPriorityOpenPhase.title, "Higher priority phase");
    assert.equal(structured.higherPriorityOpenPhase.readyTaskCount, 1);
    assert.match(toolText(started), /Phase-order advisory/);
    assert.match(toolText(started), /Higher priority phase/);
    assert.match(toolText(started), /1 ready task/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-task-start does not advise when the target phase is already the highest-priority open phase", async () => {
  const session = await startMcpFixture({ name: "t422-highest-priority-start" });
  try {
    await addHigherPriorityOpenPhase(session);
    await primeHigherPhaseReads(session, "T902");
    const started = await callTool(session, "planner-task-start", { task: "T902" });
    const structured = toolStructured(started);
    assert.equal(structured.started, true);
    assert.equal(structured.higherPriorityOpenPhase, null, "already the highest-priority open phase — nothing to advise");
    assert.doesNotMatch(toolText(started), /Phase-order advisory/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-task-start does not advise when the higher-priority phase's remaining work is blocked, not ready", async () => {
  const session = await startMcpFixture({ name: "t422-blocked-higher-priority" });
  try {
    const blockedPhase = await addHigherPriorityOpenPhase(session, { readyTasks: 0 });
    const now = new Date().toISOString();
    await session.store.updatePhase(blockedPhase.id, (ph) => {
      ph.tasks = [
        ...ph.tasks,
        { id: createTaskId(), number: 950, phaseId: ph.id, title: "Blocked remainder", shortName: "blocked-remainder", status: "planned", dependsOn: ["some-undone-task-elsewhere"], createdAt: now, updatedAt: now },
      ];
      return ph;
    });
    await primeSeedReads(session);
    const started = await callTool(session, "planner-task-start", { task: "T001" });
    const structured = toolStructured(started);
    assert.equal(structured.started, true);
    assert.equal(structured.higherPriorityOpenPhase, null, "a blocked remainder is never a reason to advise switching there");
    assert.doesNotMatch(toolText(started), /Phase-order advisory/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-show lists in-progress phases with work left, priority-ordered", async () => {
  const session = await startMcpFixture({ name: "t422-planner-show-listing" });
  try {
    await addHigherPriorityOpenPhase(session); // priority 5, in-progress, 1 ready
    // Bring the seed's own phase (priority 10) to in-progress too — done +
    // planned — so this exercises priority ordering across two real
    // in-progress phases through the full server, not just a single entry.
    const now = new Date().toISOString();
    const seedPhase = (await session.store.loadAllPhases()).find((phase) => phase.number === 1);
    await session.store.updatePhase(seedPhase.id, (ph) => {
      ph.tasks = [
        { ...ph.tasks[0], status: "done" },
        { id: createTaskId(), number: 2, phaseId: ph.id, title: "Second seed task", shortName: "second-seed-task", status: "planned", createdAt: now, updatedAt: now },
      ];
      return ph;
    });

    const shown = await callTool(session, "planner-show", {});
    const structured = toolStructured(shown);
    assert.equal(structured.overview.openPhaseWork.length, 2, "both the seed's own phase and the added phase are in-progress with work left");
    assert.equal(structured.overview.openPhaseWork[0].title, "Higher priority phase", "priority-ordered: lower priority number first");
    assert.equal(structured.overview.openPhaseWork[0].readyTaskCount, 1);
    assert.equal(structured.overview.openPhaseWork[1].title, "Auth API phase");
    assert.equal(structured.overview.openPhaseWork[1].readyTaskCount, 1);
    assert.match(toolText(shown), /In-progress phases with work left \(priority order\)/);
    assert.match(toolText(shown), /Higher priority phase/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("already-started re-affirmation carries the same phase-order advisory", async () => {
  const session = await startMcpFixture({ name: "t422-already-started" });
  try {
    await primeSeedReads(session);
    await callTool(session, "planner-task-start", { task: "T001" });
    await addHigherPriorityOpenPhase(session);
    const alreadyStarted = await callTool(session, "planner-task-start", { task: "T001" });
    const structured = toolStructured(alreadyStarted);
    assert.equal(structured.started, true);
    assert.equal(structured.alreadyStarted, true);
    assert.ok(structured.higherPriorityOpenPhase);
    assert.match(toolText(alreadyStarted), /Phase-order advisory/);
  } finally {
    await closeMcpFixture(session);
  }
});
