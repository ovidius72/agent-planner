/**
 * P104(F005)/T422 — regression for the reported session: P102 (priority 34)
 * was left in-progress with a planned task while work moved on to P104
 * (priority 36). `task_switch` and `task_deviation` both protect an
 * in-flight task; nothing protected a phase whose last task simply finished.
 * `task_start` now attaches a non-blocking phase-order advisory when the
 * target phase is not the highest-priority in-progress phase with ready
 * work, without ever denying the start. Mirrors
 * packages/plan-mcp/test/task-start-phase-order.test.mjs so both adapters
 * are pinned against the same plan-core shaping.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PhaseSchema, createPhaseId, createTaskId } from "../../plan-core/dist/index.js";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";

after(async () => {
  await cleanupPiHosts();
});

/**
 * Adds a second phase to the fixture's feature: a higher-priority phase
 * (lower priority number than the "minimal" seed's phase, which is 10) with
 * one done task and `readyTasks` still-planned tasks — in-progress by
 * derived status, with that many tasks ready to start.
 */
async function addHigherPriorityOpenPhase(host, { priority = 5, readyTasks = 1 } = {}) {
  const now = new Date().toISOString();
  const featureId = (await host.store.loadFeatures()).features[0].id;
  const phase = PhaseSchema.parse({
    id: createPhaseId(), featureId, number: 900, priority, slug: "higher-priority-phase", title: "Higher priority phase", createdAt: now, updatedAt: now,
  });
  await host.store.savePhase(phase);
  await host.store.updatePhase(phase.id, (ph) => {
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
 * (P001 has one linked requirement). */
async function primeSeedReads(host) {
  await host.runTool("task_get", { taskId: "T001", full: true });
  await host.runTool("phase_get", { phaseId: "P001", full: true });
  await host.runTool("feature_get", { featureId: "F001", full: true });
  await host.runTool("requirement_list", { phaseRef: "P001" });
}

/** Satisfies task_start's read gates for a task in the added higher-priority
 * phase. It carries no requirement of its own, but the seed's requirement is
 * linked to F001's P001 — `linkedRequirementsForFeature` surfaces it for
 * every phase in that feature, so it still gates a task in the new phase. */
async function primeHigherPhaseReads(host, taskId) {
  await host.runTool("task_get", { taskId, full: true });
  await host.runTool("phase_get", { phaseId: "P900", full: true });
  await host.runTool("feature_get", { featureId: "F001", full: true });
  await host.runTool("requirement_list", { phaseRef: "P900" });
}

test("task_start advises when the target phase is not the highest-priority in-progress phase with ready work", async () => {
  const host = await createPiHost({ name: "t422-lower-priority-start", seed: "minimal" });
  try {
    await addHigherPriorityOpenPhase(host);
    await primeSeedReads(host);
    const started = await host.runTool("task_start", { taskId: "T001" });
    const details = toolDetails(started);
    assert.equal(details.started, true, "the start is never blocked by the advisory");
    assert.ok(details.higherPriorityOpenPhase, "names the higher-priority phase in the structured payload");
    assert.equal(details.higherPriorityOpenPhase.title, "Higher priority phase");
    assert.equal(details.higherPriorityOpenPhase.readyTaskCount, 1);
    assert.match(toolText(started), /Phase-order advisory/);
    assert.match(toolText(started), /Higher priority phase/);
    assert.match(toolText(started), /1 ready task/);
  } finally {
    await closePiHost(host);
  }
});

test("task_start does not advise when the target phase is already the highest-priority open phase", async () => {
  const host = await createPiHost({ name: "t422-highest-priority-start", seed: "minimal" });
  try {
    await addHigherPriorityOpenPhase(host);
    await primeHigherPhaseReads(host, "T902");
    const started = await host.runTool("task_start", { taskId: "T902" });
    const details = toolDetails(started);
    assert.equal(details.started, true);
    assert.equal(details.higherPriorityOpenPhase, null, "already the highest-priority open phase — nothing to advise");
    assert.doesNotMatch(toolText(started), /Phase-order advisory/);
  } finally {
    await closePiHost(host);
  }
});

test("task_start does not advise when the higher-priority phase's remaining work is blocked, not ready", async () => {
  const host = await createPiHost({ name: "t422-blocked-higher-priority", seed: "minimal" });
  try {
    const blockedPhase = await addHigherPriorityOpenPhase(host, { readyTasks: 0 });
    const now = new Date().toISOString();
    await host.store.updatePhase(blockedPhase.id, (ph) => {
      ph.tasks = [
        ...ph.tasks,
        { id: createTaskId(), number: 950, phaseId: ph.id, title: "Blocked remainder", shortName: "blocked-remainder", status: "planned", dependsOn: ["some-undone-task-elsewhere"], createdAt: now, updatedAt: now },
      ];
      return ph;
    });
    await primeSeedReads(host);
    const started = await host.runTool("task_start", { taskId: "T001" });
    const details = toolDetails(started);
    assert.equal(details.started, true);
    assert.equal(details.higherPriorityOpenPhase, null, "a blocked remainder is never a reason to advise switching there");
    assert.doesNotMatch(toolText(started), /Phase-order advisory/);
  } finally {
    await closePiHost(host);
  }
});

test("plan_get lists in-progress phases with work left, priority-ordered", async () => {
  const host = await createPiHost({ name: "t422-plan-get-listing", seed: "minimal" });
  try {
    await addHigherPriorityOpenPhase(host); // priority 5, in-progress, 1 ready
    const now = new Date().toISOString();
    const seedPhase = (await host.store.loadAllPhases()).find((phase) => phase.number === 1);
    await host.store.updatePhase(seedPhase.id, (ph) => {
      ph.tasks = [
        { ...ph.tasks[0], status: "done" },
        { id: createTaskId(), number: 2, phaseId: ph.id, title: "Second seed task", shortName: "second-seed-task", status: "planned", createdAt: now, updatedAt: now },
      ];
      return ph;
    });

    const shown = await host.runTool("plan_get", {});
    const details = toolDetails(shown);
    assert.equal(details.openPhaseWork.length, 2, "both the seed's own phase and the added phase are in-progress with work left");
    assert.equal(details.openPhaseWork[0].title, "Higher priority phase", "priority-ordered: lower priority number first");
    assert.equal(details.openPhaseWork[0].readyTaskCount, 1);
    assert.equal(details.openPhaseWork[1].title, "Auth API phase");
    assert.match(toolText(shown), /In-progress phases with work left \(priority order\)/);
    assert.match(toolText(shown), /Higher priority phase/);
  } finally {
    await closePiHost(host);
  }
});

test("already-started re-affirmation carries the same phase-order advisory", async () => {
  const host = await createPiHost({ name: "t422-already-started", seed: "minimal" });
  try {
    await primeSeedReads(host);
    await host.runTool("task_start", { taskId: "T001" });
    await addHigherPriorityOpenPhase(host);
    const alreadyStarted = await host.runTool("task_start", { taskId: "T001" });
    const details = toolDetails(alreadyStarted);
    assert.equal(details.started, true);
    assert.equal(details.alreadyStarted, true);
    assert.ok(details.higherPriorityOpenPhase);
    assert.match(toolText(alreadyStarted), /Phase-order advisory/);
  } finally {
    await closePiHost(host);
  }
});
