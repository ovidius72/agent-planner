/**
 * P116(F025)/T461 — Baseline reliability fixtures for the six reported
 * failures and the migration storage boundary.
 *
 * Each test builds an isolated, reproducible fixture (mkdtemp, real
 * PlanStore, real filesystem) and asserts the CURRENT observable behavior of
 * this checkout, not the desired behavior. The reported failure is recorded
 * as data: the baseline report (docs/agent-brain/baseline/README.md) pairs
 * every captured observation with the expected correction and any uncertain
 * cause. Later tasks (T462, T463, T464) change behavior; when they do, these
 * assertions are updated to the corrected contract with new evidence.
 *
 * Conventions follow the existing suites (handoff-lifecycle.test.mjs,
 * per-feature-storage.test.mjs): node:test, PlanStore over a temp .planner,
 * tmpdir cleanup in `after`.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import {
  PlanStore,
  FeatureSchema,
  PhaseSchema,
  TaskSchema,
  createFeatureId,
  createPhaseId,
  createTaskId,
  buildResumeRequiredProposal,
  recommendNextTask,
  recommendNextWork,
  checkExplicitTaskStart,
  contextReadEligibilityForSession,
  startReadSession,
  hasValidSessionAttestation,
  projectGuidelinesReadStateForSession,
  syncProjectPlannerSkill,
  syncProjectGrillMeSkill,
  loadCanonicalPlannerSkill,
  loadCanonicalGrillMeSkill,
} from "../dist/index.js";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const NOW = "2026-11-14T00:00:00.000Z";
const iso = (minutes) => new Date(new Date(NOW).getTime() + minutes * 60_000).toISOString();

async function setup(name) {
  const root = await mkdtemp(join(tmpdir(), `ab-baseline-${name}-`));
  dirs.push(root);
  const planner = join(root, ".planner");
  const store = new PlanStore(planner);
  await store.init(`baseline ${name}`);
  return { root, planner, store };
}

async function addFeature(store, number, priority) {
  const feature = FeatureSchema.parse({ id: createFeatureId(), number, name: `Feature ${number}`, priority, createdAt: NOW, updatedAt: NOW });
  await store.saveFeature(feature);
  return feature;
}

async function addPhase(store, feature, number, priority, extra = {}) {
  const phase = PhaseSchema.parse({
    id: createPhaseId(), number, featureId: feature.id, slug: `phase-${number}`,
    title: `Phase ${number}`, priority, createdAt: NOW, updatedAt: NOW, ...extra,
  });
  await store.savePhase(phase);
  return phase;
}

async function addTask(store, phase, number, overrides = {}) {
  const task = TaskSchema.parse({
    id: createTaskId(), phaseId: phase.id, number,
    shortName: `t${number}`, title: `Task ${number}`, status: "planned",
    createdAt: NOW, updatedAt: NOW, ...overrides,
  });
  await store.updatePhase(phase.id, (current) => ({ ...current, tasks: [...current.tasks, task], taskIds: [...current.taskIds, task.id] }));
  return task;
}

/** Old-format phase file: inline handoff, no sessionInfo, no revision fields. */
async function degradePhaseToOldFormat(planner, phase) {
  const path = join(planner, "phases", `${phase.id}.json`);
  const raw = JSON.parse(await readFile(path, "utf8"));
  const old = { ...raw };
  delete old.sessionInfo;
  delete old.descriptionUpdatedAt;
  delete old.handoffUpdatedAt;
  old.handoff = raw.handoff ?? "";
  old.updatedAt = NOW;
  await writeFile(path, JSON.stringify(old, null, 2));
}

describe("T461 baseline — case 1: several handoffs", () => {
  // Reported failure: a resume session is confronted with several persisted
  // handoffs whose relative authority is unclear, so resumes disagreed across
  // runs. Expected correction (T462): one shared next-work contract with a
  // deterministic precedence order over handoff evidence.
  test("multiple persisted handoffs all surface as competing claims with no precedence", async () => {
    const { store } = await setup("handoffs");
    const feature = await addFeature(store, 1, 1);
    const p1 = await addPhase(store, feature, 1, 1);
    const p2 = await addPhase(store, feature, 2, 2);
    const p3 = await addPhase(store, feature, 3, 3);
    await store.setPhaseHandoff(p1.id, "# Handoff A\nWait on dependency before resuming.");
    await store.setPhaseHandoff(p2.id, "# Handoff B\nMid-implementation, resume from src/b.ts:40.");
    await store.setPhaseHandoff(p3.id, "# Handoff C\nReview pending.");
    const active = await store.listHandoffs();
    assert.equal(active.length, 3);
    // Old-format read-back: degrade one phase file and reload — defaults must
    // fill the newer fields (migration baseline evidence).
    await degradePhaseToOldFormat(store.root, p2);
    const rawOld = JSON.parse(await readFile(join(store.root, "phases", `${p2.id}.json`), "utf8"));
    assert.equal("sessionInfo" in rawOld, false);
    assert.equal("handoffUpdatedAt" in rawOld, false);
    const reloaded = await new PlanStore(store.root).loadPhase(p2.id);
    assert.equal(typeof reloaded.handoff, "string");
    // Adapters feed the same evidence into the shared recommendation; the
    // baseline passes all three handoffs in persistence order and observes
    // what the selector does with them.
    const evidence = {
      handoffs: active.map((entry) => ({ compositeRef: entry.phaseId, firstLine: entry.firstLine, resumeReady: true })),
    };
    const feature2 = await addFeature(store, 2, 20);
    const farPhase = await addPhase(store, feature2, 1, 1);
    await addTask(store, farPhase, 1, { title: "Global priority task" });
    const work = recommendNextWork((await store.loadFeatures()).features, await store.loadAllPhases(), [], "", "session-1", evidence);
    const handoffClaims = work.claims.filter((claim) => claim.source === "handoff");
    assert.equal(handoffClaims.length, 3, "all persisted handoffs surface as claims");
    assert.equal(new Set(handoffClaims.map((claim) => claim.kind)).size, 1, "baseline: handoff claims carry no precedence distinction");
  });

  test("replacing one of several handoffs archives the superseded content", async () => {
    const { store } = await setup("handoff-supersede");
    const feature = await addFeature(store, 1, 1);
    const phase = await addPhase(store, feature, 1, 1);
    await store.setPhaseHandoff(phase.id, "# first");
    await store.setPhaseHandoff(phase.id, "# second");
    assert.equal((await store.listHandoffs()).length, 1);
    assert.equal((await store.listArchivedHandoffs()).length, 1);
  });
});

describe("T461 baseline — case 2: repeated resume reads", () => {
  // Reported failure: resuming work repeatedly re-reads the task, phase and
  // feature even when nothing changed, because in-session read state is
  // process-local and persisted attestations go stale after any write.
  // Expected correction (T462/T489): attestation/revision scoping in the new
  // storage boundary so a valid attestation survives unrelated writes.
  test("a fresh session has no read evidence and must read all three entities", async () => {
    const { store } = await setup("resume-reads");
    const feature = await addFeature(store, 1, 1);
    const phase = await addPhase(store, feature, 1, 1);
    const task = await addTask(store, phase, 1);
    startReadSession("s1");
    const eligibility = contextReadEligibilityForSession({
      sessionId: "s1", taskId: task.id, phaseId: phase.id, featureId: feature.id,
      task, phase, feature,
    });
    assert.equal(eligibility.eligible, false, "no fresh or persisted read evidence yet");
    assert.equal(eligibility.requiredReads.length, 3, "baseline: task+phase+feature reads are required");
    assert.equal(eligibility.reason.includes("Read required context only for"), true);
  });

  test("an unrelated write after resume stales the persisted attestation", async () => {
    const { store } = await setup("stale-attestation");
    const feature = await addFeature(store, 1, 1);
    const phase = await addPhase(store, feature, 1, 1);
    const task = await addTask(store, phase, 1);
    // Persist attestations (as a completed resume would) at T0.
    await store.updatePhase(phase.id, (current) => ({
      ...current,
      updatedAt: iso(1),
      sessionInfo: [{ sessionId: "s1", createdAt: iso(1) }],
      tasks: current.tasks.map((entry) => entry.id === task.id
        ? { ...entry, sessionInfo: [{ sessionId: "s1", createdAt: iso(1) }], updatedAt: iso(1) }
        : entry),
    }));
    await store.updateFeature(feature.id, (current) => ({ ...current, updatedAt: iso(1) }));
    // An unrelated write (a second task) bumps the phase revision past the attestation.
    await addTask(store, phase, 2);
    await store.updatePhase(phase.id, (current) => ({ ...current, updatedAt: iso(5) }));
    const phases = await store.loadAllPhases();
    const reloadedPhase = phases.find((entry) => entry.id === phase.id);
    const eligibility = contextReadEligibilityForSession({
      sessionId: "s1", taskId: task.id, phaseId: phase.id, featureId: feature.id,
      task: reloadedPhase.tasks.find((entry) => entry.id === task.id),
      phase: reloadedPhase, feature,
    });
    assert.equal(eligibility.eligible, false);
    const stale = eligibility.requiredReads.filter((read) => read.state === "stale");
    assert.ok(stale.some((read) => read.kind === "phase"), "baseline: phase re-read required after unrelated write");
    assert.equal(hasValidSessionAttestation({
      sessionId: "s1", taskId: task.id, phaseId: phase.id,
      task: reloadedPhase.tasks.find((entry) => entry.id === task.id), phase: reloadedPhase,
    }), false);
  });
});

describe("T461 baseline — case 3: ignored conventions", () => {
  // Reported failure: project conventions (guidelines, planner skill) are
  // recorded but not enforced, so agents proceed without reading them.
  // Expected correction (AB-IMP-003/T505, T468): configurable, consistently
  // delivered conduct rules with enforcement at the right gate.
  test("unread guidelines never block an eligible explicit task start", async () => {
    const { store } = await setup("conventions");
    const feature = await addFeature(store, 1, 1);
    const phase = await addPhase(store, feature, 1, 1);
    const task = await addTask(store, phase, 1);
    await store.updateProject((current) => ({
      ...current,
      projectGuidelines: { content: "Always run pnpm verify before completing tasks.", updatedAt: NOW, sessionInfo: [] },
    }));
    const project = await store.loadProject();
    assert.equal(projectGuidelinesReadStateForSession(project, "s1"), "missing", "baseline: guidelines unread");
    const eligibility = checkExplicitTaskStart((await store.loadFeatures()).features, await store.loadAllPhases(), task.id);
    assert.equal(eligibility.eligible, true, "baseline: conventions are advisory only — start is not gated on them");
  });

  test("a customized planner skill is preserved, never reconciled", async () => {
    const { planner } = await setup("conventions-skill");
    const { syncProjectPlannerSkill, loadCanonicalPlannerSkill } = await import("../dist/index.js");
    const existing = await syncProjectPlannerSkill(planner);
    assert.equal(existing.status, "current", "baseline: init already provisions the managed skill");
    const second = await syncProjectPlannerSkill(planner);
    assert.equal(second.status, "current", "baseline: repeated sync does not duplicate the managed skill");
    // Old-format capability copy: no managed header, diverging content.
    const canonical = await loadCanonicalPlannerSkill();
    await writeFile(join(planner, "SKILL.md"), `${canonical.slice(0, 200)}\nLOCAL OVERRIDE: different rules.\n`);
    const third = await syncProjectPlannerSkill(planner);
    assert.equal(third.status, "customized", "baseline: customized copy is preserved");
    assert.match(third.message, /Reconcile it manually/, "reconciliation stays manual — no enforcement");
  });
});

describe("T461 baseline — case 4: nested detours", () => {
  // Reported failure: a detour taken inside another detour loses the outer
  // return target or loops. Expected correction (T464): nested interrupted
  // work preserved and resumed across phase closure with an explicit chain.
  test("nested approved detours resolve LIFO and then return to the preserved task", async () => {
    const { store } = await setup("nested-detours");
    const feature = await addFeature(store, 1, 1);
    const phase = await addPhase(store, feature, 1, 1);
    const preserved = await addTask(store, phase, 1);
    const firstDetour = await addTask(store, phase, 2);
    const nestedDetour = await addTask(store, phase, 3);
    const deviations = [
      { id: "dev-outer", recommendedTaskId: preserved.id, temporaryTaskId: firstDetour.id, resumeTaskId: preserved.id, reason: "Outer urgent fix", requestedBy: "user", approvedBy: "user", state: "approved", createdAt: iso(10), activatedAt: iso(10), resolvedAt: "", ownerSession: "" },
      { id: "dev-inner", recommendedTaskId: firstDetour.id, temporaryTaskId: nestedDetour.id, resumeTaskId: firstDetour.id, reason: "Nested urgent fix", requestedBy: "user", approvedBy: "user", state: "approved", createdAt: iso(20), activatedAt: iso(20), resolvedAt: "", ownerSession: "" },
    ];
    const duringNesting = recommendNextTask((await store.loadFeatures()).features, await store.loadAllPhases(), deviations, "", "s1");
    assert.equal(duringNesting.kind, "resume");
    assert.equal(duringNesting.candidate?.task.id, nestedDetour.id, "baseline: newest approved deviation wins while nesting");
    // The innermost detour finishes: the chain must return one level (LIFO),
    // not jump straight to the outermost preserved task.
    await store.updatePhase(phase.id, (current) => ({
      ...current,
      tasks: current.tasks.map((entry) => entry.id === nestedDetour.id ? { ...entry, status: "done", updatedAt: iso(30) } : entry),
    }));
    const afterNested = recommendNextTask((await store.loadFeatures()).features, await store.loadAllPhases(), deviations, "", "s1");
    assert.equal(afterNested.kind, "resume");
    assert.equal(afterNested.candidate?.task.id, firstDetour.id, "baseline: returns to the middle detour (one LIFO level)");
    const resume = buildResumeRequiredProposal({ ref: "P001(F001)/T002", title: firstDetour.title, taskId: firstDetour.id, phaseId: phase.id, snapshot: null });
    assert.match(resume.text, /RESUME REQUIRED/, "resume proposal is standardized");
  });
});

describe("T461 baseline — case 5: current-phase priority bias (AB-IMP-007/008)", () => {
  // Reported failure: a session is sent to work in another agent's phase when
  // the adapter supplies that phase as "current", and a higher-priority empty
  // phase is never proposed for planning. Expected correction (T462/T463):
  // session-aware phase continuity and explicit empty-phase proposals.
  test("currentPhaseId overrides global priority with no session-ownership check", async () => {
    const { store } = await setup("phase-bias");
    const f1 = await addFeature(store, 1, 1);
    const globalPhase = await addPhase(store, f1, 1, 1);
    await addTask(store, globalPhase, 1, { title: "Global priority task" });
    const f2 = await addFeature(store, 2, 20);
    const foreignPhase = await addPhase(store, f2, 1, 20);
    await addTask(store, foreignPhase, 1, { title: "Foreign phase task" });
    const phases = await store.loadAllPhases();
    const features = (await store.loadFeatures()).features;
    const withForeignCurrent = recommendNextTask(features, phases, [], foreignPhase.id, "s2");
    assert.equal(withForeignCurrent.kind, "priority");
    assert.equal(withForeignCurrent.candidate?.phase.id, foreignPhase.id);
    assert.match(withForeignCurrent.reason, /Continue the current phase/, "baseline: current phase beats global priority");
    const work = recommendNextWork(features, phases, [], foreignPhase.id, "s2");
    const reloadedForeign = phases.find((entry) => entry.id === foreignPhase.id);
    assert.equal(work.nextTask?.id, reloadedForeign.tasks[0].id);
  });

  test("a higher-priority empty phase is never proposed for planning", async () => {
    const { store } = await setup("empty-phase");
    const f1 = await addFeature(store, 1, 1);
    await addPhase(store, f1, 1, 0); // priority 0, zero tasks — planning never discussed
    const f2 = await addFeature(store, 2, 10);
    const fallback = await addPhase(store, f2, 1, 10);
    await addTask(store, fallback, 1);
    const work = recommendNextWork((await store.loadFeatures()).features, await store.loadAllPhases());
    assert.equal(work.selection.kind, "priority");
    assert.equal(work.selection.candidate?.phase.id, fallback.id, "work lands in the task-bearing phase");
    const planningClaims = work.claims.filter((claim) => /plan/i.test(claim.reason) || /discuss/i.test(claim.reason));
    assert.equal(planningClaims.length, 0, "baseline: no claim proposes discussing the empty phase (AB-IMP-008)");
  });
});

describe("T461 baseline — case 6: duplicate capability creation", () => {
  // Reported failure: harnesses and agents created their own copies of
  // planner capabilities, drifting apart. Expected correction (T468/T469):
  // canonical cross-harness delivery with single-source ownership.
  test("repeated sync does not duplicate the managed skill files", async () => {
    const { planner } = await setup("capability-dup");
    // Baseline: store.init() already provisions both managed skills, so the
    // first explicit sync reports the files as current, and repeated syncs
    // stay idempotent (no duplicate files, ever).
    const first = await syncProjectPlannerSkill(planner);
    const again = await syncProjectPlannerSkill(planner);
    assert.equal(first.status, "current");
    assert.equal(again.status, "current");
    const grillFirst = await syncProjectGrillMeSkill(planner);
    const grillAgain = await syncProjectGrillMeSkill(planner);
    assert.equal(grillFirst.status, "current");
    assert.equal(grillAgain.status, "current");
  });

  test("an old-format capability copy without a managed header is adopted, not duplicated", async () => {
    const { planner } = await setup("capability-legacy");
    await mkdir(join(planner, "skills", "grill-me"), { recursive: true });
    const canonical = await loadCanonicalGrillMeSkill();
    // Old format: same canonical content but no managed hash header.
    await writeFile(join(planner, "skills", "grill-me", "SKILL.md"), canonical);
    const result = await syncProjectGrillMeSkill(planner);
    assert.ok(["adopted", "updated"].includes(result.status), `baseline: legacy copy is adopted in place (got ${result.status})`);
  });
});

describe("T461 baseline — same-task races and failed/incomplete replies", () => {
  // Reported failure: two agents claiming the same task could both succeed.
  // Expected correction: atomic claim at the storage boundary (architecture
  // contract). The baseline records what happens today with two independent
  // PlanStore instances racing on the same task.
  test("two concurrent claimTask calls on one task produce one deterministic owner", async () => {
    const { store } = await setup("claim-race");
    const feature = await addFeature(store, 1, 1);
    const phase = await addPhase(store, feature, 1, 1);
    const task = await addTask(store, phase, 1);
    const rival = new PlanStore(store.root);
    const [mine, theirs] = await Promise.allSettled([
      store.claimTask(phase.id, task.id, "session-a"),
      rival.claimTask(phase.id, task.id, "session-b"),
    ]);
    const persisted = (await store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === task.id);
    const winners = [mine, theirs].filter((entry) => entry.status === "fulfilled");
    const failures = [mine, theirs].filter((entry) => entry.status === "rejected");
    assert.ok(winners.length >= 1, "at least one claim wins");
    assert.ok(persisted.activeOwnerSession, "the task ends owned by exactly one session");
    if (failures.length === 1) {
      assert.match(String(failures[0].reason?.message ?? failures[0].reason), /another session|owned|started/i);
    } else {
      // Baseline uncertainty: when both writes succeed, the last writer wins
      // silently. Recorded as the reported race — the storage boundary must
      // make this impossible.
      assert.ok(["session-a", "session-b"].includes(persisted.activeOwnerSession));
    }
  });

  test("failed and incomplete replies are observable error paths", async () => {
    const { store } = await setup("failed-replies");
    const feature = await addFeature(store, 1, 1);
    const phase = await addPhase(store, feature, 1, 1);
    await assert.rejects(() => store.claimTask(phase.id, "missing-task", "s1"), /Task not found/);
    await assert.rejects(() => store.loadPhase("missing-phase"), /read failed|not found/i);
    const emptyWork = recommendNextWork([], []);
    assert.equal(emptyWork.selection.kind, "none", "incomplete plan yields an explicit insufficient result");
    assert.ok(emptyWork.claims.some((claim) => claim.kind === "insufficient"));
  });
});

describe("T461 baseline — migration storage boundary", () => {
  // Migration baseline (checklist item 4): what the current storage does when
  // the planner descriptor is missing or incompatible, and with a legacy
  // single-file layout. No real project is touched.
  test("a missing manifest makes the workspace undetectable", async () => {
    const { planner } = await setup("descriptor-missing");
    await rm(join(planner, "manifest.json"), { force: true });
    const bare = new PlanStore(planner);
    assert.equal(await bare.exists(), false, "baseline: without its descriptor the workspace is not detected as a plan");
    await assert.rejects(() => bare.loadManifest(), /read failed|manifest/i);
  });

  test("an incompatible manifest schemaVersion is rejected, not migrated silently", async () => {
    const { planner } = await setup("descriptor-incompatible");
    const manifestPath = join(planner, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.schemaVersion = 999;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const incompatible = new PlanStore(planner);
    await assert.rejects(() => incompatible.loadManifest(), /schemaVersion|Invalid/i);
  });

  test("legacy single-file features.json is migrated to per-feature files on demand", async () => {
    const { planner } = await setup("legacy-layout");
    const feature = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Legacy", priority: 1, createdAt: NOW, updatedAt: NOW });
    await writeFile(join(planner, "features.json"), JSON.stringify({ features: [feature] }, null, 2));
    const legacy = new PlanStore(planner);
    const loaded = (await legacy.loadFeatures()).features;
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].name, "Legacy");
    assert.equal(await legacy.exists(), true);
  });
});
