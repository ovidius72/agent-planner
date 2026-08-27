import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PlanStore, PhaseSchema, FeatureSchema, createPhaseId, createFeatureId, createTaskId, buildRecap, PLANNER_EXTENSION_RULES } from "../dist/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

async function makePlan({ featStatus = "planned", phaseStatus = "planned", tasks = [{ status: "planned" }], handoff = null, nextSteps = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "recap-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("Recap project");
  const now = new Date().toISOString();
  const feat = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Feat One", status: featStatus, createdAt: now, updatedAt: now });
  await store.saveFeature(feat);
  const phase = PhaseSchema.parse({ id: createPhaseId(), number: 1, featureId: feat.id, slug: "phase-1", title: "Phase 1", status: phaseStatus, createdAt: now, updatedAt: now });
  await store.savePhase(phase);
  const taskObjs = tasks.map((t, i) => ({ id: createTaskId(), number: i + 1, phaseId: phase.id, title: `task ${i + 1}`, shortName: `t${i + 1}`, status: t.status, pauseSnapshot: t.pauseSnapshot ?? null, createdAt: now, updatedAt: now }));
  await store.updatePhase(phase.id, (ph) => { ph.tasks = taskObjs; return ph; });
  if (handoff) await store.setPhaseHandoff(phase.id, handoff);
  if (nextSteps.length) await store.saveResume({ updatedAt: now, currentPhaseId: phase.id, inProgressTaskIds: [], nextSteps, blockers: [], notes: "", lastSessionSummary: "", guardBypassUntil: "" });
  return { store, feat, phase, tasks: taskObjs };
}

describe("buildRecap — plan complete", () => {
  test("complete plan (pi): 'plan complete' focus + hint, stale nextSteps suppressed", async () => {
    const { store } = await makePlan({ featStatus: "done", phaseStatus: "done", tasks: [{ status: "done" }, { status: "done" }], nextSteps: ["Run /planner project discuss to bootstrap discovery"] });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "pi" });
    assert.ok(r.includes("plan complete — all features/phases/tasks are done"), "plan-complete focus");
    assert.ok(r.includes("Plan complete — add a new feature (/planner feature add) or phase (/planner phase add)"), "pi hint");
    assert.ok(!r.includes("bootstrap discovery"), "stale nextStep suppressed");
    assert.ok(!r.includes("Next step:"), "no Next step line");
    assert.ok(!r.includes("planner-task-add"), "no MCP leak in pi");
  });
  test("complete plan (mcp): planner-* hint, no Pi leak", async () => {
    const { store } = await makePlan({ featStatus: "done", phaseStatus: "done", tasks: [{ status: "done" }] });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "mcp" });
    assert.ok(r.includes("Plan complete — add a new feature (planner-feature-add) or phase (planner-phase-add)"), "mcp hint");
    assert.ok(!r.includes("/planner feature"), "no Pi leak in mcp");
  });
  test("empty plan (no tasks) is NOT 'plan complete'", async () => {
    const { store } = await makePlan({ tasks: [] });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "pi" });
    assert.ok(!r.includes("plan complete"), "empty plan not flagged complete");
    assert.ok(r.includes("no active task"), "empty plan shows no-active focus");
  });
});

describe("buildRecap — internal agent rules", () => {
  test("never exposes planner extension rules in human-facing recaps", async () => {
    const { store } = await makePlan({ tasks: [{ status: "planned" }] });
    for (const harness of ["pi", "mcp"]) {
      const recap = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness });
      assert.doesNotMatch(recap, /Planner rules \(extension/);
      assert.ok(!recap.includes(PLANNER_EXTENSION_RULES[0]), `${harness} recap excludes the canonical agent rule`);
    }
  });
});

describe("buildRecap — not complete, no active task", () => {
  test("begin-work hint + nextSteps shown (pi)", async () => {
    const { store } = await makePlan({ tasks: [{ status: "planned" }, { status: "planned" }], nextSteps: ["Pick the next task"] });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "pi" });
    assert.ok(r.includes("no active task — review the plan"), "no-active focus");
    assert.ok(r.includes("Next step: Pick the next task"), "nextStep shown (not suppressed)");
    assert.ok(r.includes("Use /planner task add / /planner task start to begin work"), "pi begin-work hint");
  });
  test("begin-work hint (mcp)", async () => {
    const { store } = await makePlan({ tasks: [{ status: "planned" }] });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "mcp" });
    assert.ok(r.includes("Use planner-task-add / planner-task-start to begin work"), "mcp begin-work hint");
  });
});

describe("buildRecap — active task", () => {
  test("focus line directs Pi to lifecycle-first context validation", async () => {
    const { store } = await makePlan({ featStatus: "in-progress", phaseStatus: "in-progress", tasks: [{ status: "in-progress" }, { status: "planned" }] });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "pi" });
    assert.ok(r.includes("Current focus: F01 — Feat One / P001(F001) — Phase 1 / T01 — task 1 (in-progress)"), "focus line with composite IDs");
    assert.ok(r.includes("Continue with /planner task start T01."), "Pi recap invokes lifecycle validation first");
    assert.ok(r.includes("follow only the missing or stale reads in its nextActions"), "Pi recap keeps reads demand-driven");
    assert.doesNotMatch(r, /re-read the full context|\/planner task show T01/);
  });

  test("active-task advisory uses the MCP lifecycle command", async () => {
    const { store } = await makePlan({ featStatus: "in-progress", phaseStatus: "in-progress", tasks: [{ status: "in-progress" }, { status: "planned" }] });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "mcp" });
    assert.ok(r.includes("Continue with planner-task-start T01."), "MCP recap invokes lifecycle validation first");
    assert.ok(r.includes("follow only the missing or stale reads in its nextActions"), "MCP recap keeps reads demand-driven");
    assert.doesNotMatch(r, /re-read the full context|planner-task-show T01/);
  });
});

describe("buildRecap — pending task resume", () => {
  test("standalone paused work is surfaced with its complete checkpoint", async () => {
    const snapshot = {
      id: "snapshot-standalone", reason: "User interrupted the task", whatWasBeingDone: "Editing the parser",
      resumeLocation: "src/parser.ts:44", howToResume: "Finish parseResult and run parser tests",
      relatedTaskId: "", pausedAt: "2026-08-10T02:00:00.000Z", pausedBy: "test",
    };
    const { store } = await makePlan({ tasks: [{ status: "paused", pauseSnapshot: snapshot }] });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "mcp" });
    assert.match(r, /Current focus: checkpoint to evaluate — P001\(F001\)\/T01 — task 1/);
    assert.match(r, /Saved checkpoints \(1\)/);
    assert.match(r, /Why: User interrupted the task/);
    assert.match(r, /Checkpoint: Editing the parser/);
    assert.match(r, /Resume from: src\/parser\.ts:44/);
    assert.match(r, /How: Finish parseResult and run parser tests/);
  });

  test("task checkpoint takes precedence and includes exact resume instructions", async () => {
    const now = "2026-08-10T01:00:00.000Z";
    const snapshot = {
      id: "snapshot-1", reason: "Temporary prerequisite", whatWasBeingDone: "Implementing the selector",
      resumeLocation: "src/selector.ts:20", howToResume: "Finish the branch and rerun tests",
      relatedTaskId: "temporary", pausedAt: now, pausedBy: "test",
    };
    const { store, tasks } = await makePlan({ tasks: [{ status: "paused", pauseSnapshot: snapshot }, { status: "done" }] });
    await store.addWorkDeviation({
      id: "deviation-1", recommendedTaskId: tasks[0].id, temporaryTaskId: tasks[1].id,
      resumeTaskId: tasks[0].id, reason: snapshot.reason, snapshot, requestedBy: "agent",
      approvedBy: "test", state: "resume-required", createdAt: now, activatedAt: now,
      resumeRequiredAt: now, resolvedAt: "", resumedAt: "",
    });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "mcp" });
    assert.match(r, /Current focus: resume required — P001\(F001\)\/T01 — task 1 \(planned\)/);
    assert.match(r, /Task resume advisory/);
    assert.match(r, /Checkpoint reason: Temporary prerequisite/);
    assert.match(r, /Work checkpoint: Implementing the selector/);
    assert.match(r, /Resume from: src\/selector\.ts:20/);
    assert.match(r, /Suggested action: evaluate planner-task-start P001\(F001\)\/T01/);
    assert.match(r, /Resume advisory: evaluate whether to resume P001\(F001\)\/T01 with planner-task-start/);
    assert.match(r, /0 active, 1 with checkpoints/);
  });
});

describe("buildRecap — pending handoff", () => {
  test("handoff section + harness-aware show/clear (pi)", async () => {
    const { store } = await makePlan({ featStatus: "in-progress", phaseStatus: "in-progress", tasks: [{ status: "in-progress" }], handoff: "# Resume context\nNext: finish X" });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "pi" });
    assert.ok(r.includes("Pending phase handoffs (1)"), "handoff section");
    assert.ok(r.includes("Do you want to resume from P001(F001)?"), "specific resume CTA");
    assert.ok(r.includes("/planner handoff show P001(F001)"), "pi show cmd with ref");
    assert.ok(!r.includes("/planner handoff show <ref>"), "no generic placeholder");
  });
  test("handoff section (mcp)", async () => {
    const { store } = await makePlan({ featStatus: "in-progress", phaseStatus: "in-progress", tasks: [{ status: "in-progress" }], handoff: "# ctx" });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:1" }, { harness: "mcp" });
    assert.ok(r.includes("planner-handoff-show P001(F001)"), "mcp show cmd with ref");
    assert.ok(!r.includes("planner-handoff-show <ref>"), "no generic placeholder");
  });
});

describe("buildRecap — web URL", () => {
  test("running: local + LAN + port", async () => {
    const { store } = await makePlan({ tasks: [{ status: "planned" }] });
    const r = await buildRecap(store, { localUrl: "http://127.0.0.1:56321", lanUrl: "http://192.168.1.4:56321", port: 56321 }, { harness: "pi" });
    assert.ok(r.includes("🌐 Web UI: http://127.0.0.1:56321 (LAN: http://192.168.1.4:56321) (port 56321)"), "web line");
  });
  test("not running", async () => {
    const { store } = await makePlan({ tasks: [{ status: "planned" }] });
    const r = await buildRecap(store, {}, { harness: "pi" });
    assert.ok(r.includes("🌐 Web UI: not running — start with /planner load"), "not-running line");
  });
});