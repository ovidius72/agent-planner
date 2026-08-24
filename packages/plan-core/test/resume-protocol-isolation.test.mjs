// P069(F005)/T297 — cross-worktree and resume-protocol isolation tests.
//
// Exercises the resume-required protocol and the worktree-local runtime-state
// boundary (T299) with REAL persisted planner state in isolated temp roots.
// Three areas:
//   1. resume-required proposals stay visible across recap/task-entry flows
//      (harness-agnostic — same buildRecap feeds Pi and MCP).
//   2. re-entering in-progress work surfaces an explicit re-read advisory.
//   3. two worktrees sharing canonical data do NOT share resume runtime state
//      (runtime state lives in .planner/.local, isolated per worktree).

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  PlanStore,
  FeatureSchema,
  PhaseSchema,
  createFeatureId,
  createPhaseId,
  createTaskId,
  buildRecap,
} from "../dist/index.js";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

function nowISO() {
  return new Date().toISOString();
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "resume-iso-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("P069 isolation test");
  const now = nowISO();
  const feat = FeatureSchema.parse({
    id: createFeatureId(),
    number: 1,
    name: "Feat One",
    status: "planned",
    createdAt: now,
    updatedAt: now,
  });
  await store.saveFeature(feat);
  const mkPhase = (n, status = "planned") =>
    PhaseSchema.parse({
      id: createPhaseId(),
      number: n,
      featureId: feat.id,
      slug: `phase-${n}`,
      title: `Phase ${n}`,
      status,
      createdAt: now,
      updatedAt: now,
    });
  const mkTask = (phaseId, status = "planned", n = 1) => ({
    id: createTaskId(),
    number: n,
    phaseId,
    title: `task ${n}`,
    shortName: "t",
    status,
    createdAt: now,
    updatedAt: now,
  });
  return { root, store, feat, mkPhase, mkTask, now };
}

// Pause a task and register a resume-required deviation so the planner reports
// it as a pending resume target (mirrors the real pauseTask + addWorkDeviation
// flow exercised by the adapters).
async function makeResumeRequired(store, mkPhase, mkTask, now) {
  const p = mkPhase(1, "planned");
  await store.savePhase(p);
  const resumeTask = mkTask(p.id, "in-progress", 1);
  const temporaryTask = { ...mkTask(p.id, "done", 2), id: createTaskId() };
  await store.updatePhase(p.id, (ph) => {
    ph.tasks = [resumeTask, temporaryTask];
    return ph;
  });

  const snapshot = {
    id: "snap-1",
    reason: "Pivot to other work",
    whatWasBeingDone: "Main branch work",
    resumeLocation: "src/x.ts:1",
    howToResume: "Reopen and continue",
    relatedTaskId: temporaryTask.id,
    pausedAt: now,
    pausedBy: "test",
  };
  await store.pauseTask(p.id, resumeTask.id, snapshot); // resumeTask -> planned + snapshot
  await store.addWorkDeviation({
    id: "dev-1",
    recommendedTaskId: resumeTask.id,
    temporaryTaskId: temporaryTask.id,
    resumeTaskId: resumeTask.id,
    reason: snapshot.reason,
    snapshot,
    requestedBy: "agent",
    approvedBy: "test",
    state: "resume-required",
    createdAt: now,
    activatedAt: now,
    resumeRequiredAt: now,
    resolvedAt: "",
    resumedAt: "",
  });
  return { phase: p, resumeTask, temporaryTask };
}

describe("resume-required visibility across recap flows", () => {
  test("recap surfaces a pending resume-required task (pi harness)", async () => {
    const { store, mkPhase, mkTask, now } = await setup();
    const { resumeTask } = await makeResumeRequired(store, mkPhase, mkTask, now);

    const recap = await buildRecap(store, {}, { harness: "pi" });

    assert.match(recap, /resume required — P001\(F001\)\/T01 — task 1 \(planned\)/);
    assert.match(recap, /Resume advisory/);
    assert.ok((await store.loadProject()).workDeviations.length >= 1, "deviation persisted");
  });

  test("recap surfaces a pending resume-required task (mcp harness)", async () => {
    const { store, mkPhase, mkTask, now } = await setup();
    const { resumeTask } = await makeResumeRequired(store, mkPhase, mkTask, now);

    const recap = await buildRecap(store, {}, { harness: "mcp" });

    assert.match(recap, /resume required — P001\(F001\)\/T01 — task 1 \(planned\)/);
    assert.match(recap, /Resume advisory/);
  });

  test("no resume-required text when nothing is pending", async () => {
    const { store, mkPhase, mkTask, now } = await setup();
    const p = mkPhase(1, "planned");
    await store.savePhase(p);
    await store.updatePhase(p.id, (ph) => {
      ph.tasks = [mkTask(ph.id, "in-progress", 1)];
      return ph;
    });

    const recap = await buildRecap(store, {}, { harness: "pi" });
    assert.doesNotMatch(recap, /resume required/i);
    assert.doesNotMatch(recap, /Resume advisory/);
  });

  test("completing the resume target clears its live deviations (no churn in shared project.json)", async () => {
    const { store, mkPhase, mkTask, now } = await setup();
    const { phase: p, resumeTask } = await makeResumeRequired(store, mkPhase, mkTask, now);
    assert.equal((await store.loadProject()).workDeviations.length, 1);

    await store.updatePhase(p.id, (ph) => {
      const task = ph.tasks.find((entry) => entry.id === resumeTask.id);
      task.status = "done";
      task.completedAt = nowISO();
      return ph;
    });

    const devs = (await store.loadProject()).workDeviations;
    assert.equal(devs.length, 0, "deviations cleared when resume target completes");
    const projectJson = JSON.parse(
      await (await import("node:fs/promises")).readFile(join(store.root, "project.json"), "utf8"),
    );
    assert.deepEqual(projectJson.workDeviations, [], "shared project.json stays free of runtime state");
  });
});

describe("re-entry context awareness when resuming in-progress work", () => {
  test("recap tells the agent to read the checkpoint before deciding, with the target ref", async () => {
    const { store, mkPhase, mkTask, now } = await setup();
    await makeResumeRequired(store, mkPhase, mkTask, now);

    const recap = await buildRecap(store, {}, { harness: "pi" });

    assert.match(recap, /Resume advisory/);
    assert.match(recap, /Read its checkpoint before deciding/);
    assert.match(recap, /P001\(F001\)\/T01/);
  });
});

describe("cross-worktree runtime-state isolation (T299 boundary)", () => {
  test("two worktrees sharing canonical data do not share resume runtime state", async () => {
    const { root: rootA, store: storeA, mkPhase, mkTask, now } = await setup();
    const { resumeTask } = await makeResumeRequired(storeA, mkPhase, mkTask, now);
    assert.equal((await storeA.loadProject()).workDeviations.length, 1, "A owns a resume-required deviation");

    // Simulate a second worktree: clone the canonical planner data but NOT the
    // worktree-local .local runtime state (exactly what git worktrees isolate).
    const rootB = await mkdtemp(join(tmpdir(), "resume-iso-wtB-"));
    dirs.push(rootB);
    const plannerA = join(rootA, ".planner");
    const plannerB = join(rootB, ".planner");
    await cp(plannerA, plannerB, {
      recursive: true,
      filter: (src) => !src.split(sep).includes(".local"),
    });

    const storeB = new PlanStore(plannerB);
    const bDevs = (await storeB.loadProject()).workDeviations;
    assert.equal(bDevs.length, 0, "worktree B must NOT see A's runtime resume state");

    // B can carry its own runtime state without affecting A.
    await storeB.addWorkDeviation({
      id: "dev-B",
      recommendedTaskId: resumeTask.id,
      temporaryTaskId: resumeTask.id,
      resumeTaskId: resumeTask.id,
      reason: "B-local pivot",
      snapshot: null,
      requestedBy: "agent",
      approvedBy: "test",
      state: "resume-required",
      createdAt: now,
      activatedAt: now,
      resumeRequiredAt: now,
      resolvedAt: "",
      resumedAt: "",
    });

    assert.equal((await storeA.loadProject()).workDeviations.length, 1, "A unaffected by B's runtime write");
    assert.equal((await storeB.loadProject()).workDeviations.length, 1, "B owns its own runtime state");
  });
});
