/**
 * T231 (P053/F015) — Status rollups, handoff archival, repair, persistence.
 *
 * Core-level coverage (real PlanStore + real filesystem, no mocks):
 *  - statusLog audit trail: syncTaskStatusRollup appends phase statusLog when
 *    the DERIVED status changes (baseline "draft" → first transition), is
 *    idempotent across repeated syncs, and rolls up to the feature statusLog;
 *    entries persist across a fresh PlanStore
 *  - handoff archival: task→done auto-clears the handoff (reason "phase-done"),
 *    writes the archived .md under .local/handoff-archive/, prepends a
 *    handoffHistory entry, listArchivedHandoffs returns the content, and
 *    listHandoffs excludes completed phases; history is capped at 5 entries
 *    (oldest file deleted)
 *  - canceled-work contract: an all-canceled phase derives legacy "rejected"
 *    but its handoff IS auto-cleared because every task is terminal
 *  - repair end-to-end: one repair() call heals a stale handoff on a done
 *    phase (archived), backfills missing shortIds, and keeps integrity clean;
 *    second run is a no-op (idempotent); orphan phase files are removed by
 *    cleanupOrphanPhases (not by repair)
 *  - restart persistence: statusLog, handoffHistory, cleared handoff, archive
 *    file and resume.json all survive reopen()/restart
 *  - resume refresh: refreshResume reflects current phase / in-progress task
 *    ids / blockers after status transitions
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  PlanStore,
  createFeatureId,
  createPhaseId,
  createTaskId,
  clampSlug,
  formatPhaseRef,
} from "../dist/index.js";
import {
  createPlannerFixture,
  cleanupFixtures,
  fixturePaths,
  BASE_TIME,
} from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupFixtures();
});

const NOW = BASE_TIME;
const TS = { createdAt: NOW, updatedAt: NOW };

function makeTask(overrides = {}) {
  return {
    id: createTaskId(),
    phaseId: "00000000-0000-4000-8000-000000000000",
    number: 1,
    shortId: "",
    priority: 10,
    shortName: clampSlug("Do work"),
    title: "Do work",
    status: "planned",
    description: "",
    notes: "",
    statusLog: [],
    decisions: [],
    acceptedDecisions: [],
    checklist: [],
    subtasks: [],
    dependsOn: [],
    startedAt: "",
    completedAt: "",
    ...TS,
    ...overrides,
  };
}

function reopen(planRoot) {
  const store = new PlanStore(planRoot);
  store.enableAutoSync(true);
  return store;
}

/** Empty fixture with one feature + one phase (task list starts empty). */
async function fixture(name) {
  const fx = await createPlannerFixture({ name, seed: "empty" });
  const featureId = createFeatureId();
  await fx.store.saveFeature({
    id: featureId, number: 1, shortId: "AAAAA", priority: 10,
    name: "Feature", description: "", phaseIds: [], ...TS,
  });
  const phaseId = createPhaseId();
  await fx.store.savePhase({
    id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
    slug: "phase", title: "Phase", summary: "", description: "",
    tasks: [], taskIds: [], ...TS, handoff: "",
  });
  return { ...fx, featureId, phaseId };
}

// ────────────────────────────────────────────────────────────────────────────
// statusLog audit trail
// ────────────────────────────────────────────────────────────────────────────

test("statusLog: syncTaskStatusRollup appends derived transitions, idempotent, baseline draft", async () => {
  const { store, featureId, phaseId } = await fixture("statuslog");
  const taskId = createTaskId();
  await store.savePhase({
    id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
    slug: "phase", title: "Phase", summary: "", description: "",
    tasks: [makeTask({ id: taskId, phaseId })], taskIds: [taskId], ...TS, handoff: "",
  });
  // baseline is "draft" (phase creation literal) → planned
  await store.syncTaskStatusRollup(phaseId);
  let phase = (await store.loadAllPhases()).find((p) => p.id === phaseId);
  assert.equal(phase.statusLog.length, 1);
  assert.deepEqual(phase.statusLog[0], {
    ...phase.statusLog[0],
    fromStatus: "draft",
    toStatus: "planned",
    title: "draft → planned",
  });
  assert.ok(phase.statusLog[0].date, "entry has a date");
  assert.ok(phase.statusLog[0].id, "entry has an id");
  // idempotent: repeated sync without a transition appends nothing
  await store.syncTaskStatusRollup(phaseId);
  phase = (await store.loadAllPhases()).find((p) => p.id === phaseId);
  assert.equal(phase.statusLog.length, 1, "no duplicate entry on repeated sync");
  // transition → new entry
  await store.updatePhase(phaseId, (p) => {
    p.tasks[0].status = "in-progress";
    p.tasks[0].startedAt = NOW;
    return p;
  });
  await store.syncTaskStatusRollup(phaseId);
  phase = (await store.loadAllPhases()).find((p) => p.id === phaseId);
  assert.deepEqual(phase.statusLog.map((e) => e.title), ["draft → planned", "planned → in-progress"]);
});

test("statusLog: feature rollup mirrors its phases and persists across restart", async () => {
  const { planRoot, store, featureId, phaseId } = await fixture("statuslog-feature");
  const taskId = createTaskId();
  await store.savePhase({
    id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
    slug: "phase", title: "Phase", summary: "", description: "",
    tasks: [makeTask({ id: taskId, phaseId })], taskIds: [taskId], ...TS, handoff: "",
  });
  await store.syncTaskStatusRollup(phaseId);
  await store.updatePhase(phaseId, (p) => {
    p.tasks[0].status = "in-progress";
    p.tasks[0].startedAt = NOW;
    return p;
  });
  await store.syncTaskStatusRollup(phaseId);
  const feature = (await store.loadFeatures()).features.find((f) => f.id === featureId);
  assert.deepEqual(feature.statusLog.map((e) => e.title), ["planned → in-progress"], "feature log baseline is planned");
  // restart persistence
  const reopened = reopen(planRoot);
  const f2 = (await reopened.loadFeatures()).features.find((f) => f.id === featureId);
  const p2 = (await reopened.loadAllPhases()).find((p) => p.id === phaseId);
  assert.deepEqual(f2.statusLog.map((e) => e.title), ["planned → in-progress"]);
  assert.deepEqual(p2.statusLog.map((e) => e.title), ["draft → planned", "planned → in-progress"]);
});

// ────────────────────────────────────────────────────────────────────────────
// Handoff archival
// ────────────────────────────────────────────────────────────────────────────

test("handoff archival: task→done auto-clears with reason phase-done and archives content", async () => {
  const { planRoot, store, featureId, phaseId } = await fixture("handoff-done");
  const taskId = createTaskId();
  await store.savePhase({
    id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
    slug: "phase", title: "Phase", summary: "", description: "",
    tasks: [makeTask({ id: taskId, phaseId })], taskIds: [taskId], ...TS,
    handoff: "# Done handoff\n\nshould be archived",
  });
  await store.updatePhase(phaseId, (p) => {
    p.tasks[0].status = "done";
    p.tasks[0].startedAt = NOW;
    p.tasks[0].completedAt = NOW;
    return p;
  });
  const cleared = await store.syncTaskStatusRollup(phaseId);
  assert.equal(cleared, formatPhaseRef(1, 1), "returns composite ref of the cleared phase");
  const phase = (await store.loadAllPhases()).find((p) => p.id === phaseId);
  assert.equal(phase.handoff, "", "handoff cleared");
  assert.equal(phase.handoffHistory.length, 1);
  assert.equal(phase.handoffHistory[0].reason, "phase-done");
  assert.match(phase.handoffHistory[0].file, /^handoff-archive\/.+\.md$/);
  assert.ok(phase.handoffHistory[0].clearedAt);
  // archive file on disk contains the content
  const archiveDir = join(planRoot, ".local", "handoff-archive");
  const files = await readdir(archiveDir);
  assert.equal(files.length, 1, "one archived .md file");
  const archived = await readFile(join(archiveDir, files[0]), "utf-8");
  assert.match(archived, /# Done handoff/);
  // listArchivedHandoffs exposes it; listHandoffs excludes completed phases
  const archivedList = await store.listArchivedHandoffs();
  assert.equal(archivedList.length, 1);
  assert.equal(archivedList[0].reason, "phase-done");
  assert.match(archivedList[0].content ?? "", /# Done handoff/);
  assert.equal((await store.listHandoffs()).length, 0, "no active handoff remains on a done phase");
  // restart persistence
  const reopened = reopen(planRoot);
  const rp = (await reopened.loadAllPhases()).find((p) => p.id === phaseId);
  assert.equal(rp.handoff, "");
  assert.equal(rp.handoffHistory.length, 1);
  assert.equal((await reopened.listArchivedHandoffs()).length, 1);
});

test("handoff archival: history is capped at 5 and the oldest file is deleted", async () => {
  const { planRoot, store, featureId, phaseId } = await fixture("handoff-cap");
  for (let i = 0; i < 6; i++) {
    await store.setPhaseHandoff(phaseId, `# Handoff ${i}\n\ncontent ${i}`);
    await store.clearPhaseHandoff(phaseId, "manual");
  }
  const phase = (await store.loadAllPhases()).find((p) => p.id === phaseId);
  assert.equal(phase.handoffHistory.length, 5, "history capped at 5");
  assert.equal(phase.handoffHistory[0].reason, "manual");
  const archiveDir = join(planRoot, ".local", "handoff-archive");
  const files = await readdir(archiveDir);
  assert.equal(files.length, 5, "oldest archived file deleted");
  const archived = await store.listArchivedHandoffs();
  assert.equal(archived.length, 5);
  // newest first
  assert.match(archived[0].content ?? "", /# Handoff 5/);
});

test("handoff: all-canceled phase derives rejected but auto-archives its handoff", async () => {
  const { store, featureId, phaseId } = await fixture("handoff-canceled");
  const taskId = createTaskId();
  await store.savePhase({
    id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
    slug: "phase", title: "Phase", summary: "", description: "",
    tasks: [makeTask({ id: taskId, phaseId })], taskIds: [taskId], ...TS,
    handoff: "# Pending\n\nstill here",
  });
  await store.updatePhase(phaseId, (p) => {
    p.tasks[0].status = "canceled";
    return p;
  });
  const phase = (await store.loadAllPhases()).find((p) => p.id === phaseId);
  assert.equal(phase.status, "rejected", "all-canceled derives rejected, not canceled");
  const cleared = await store.syncTaskStatusRollup(phaseId);
  assert.equal(cleared, formatPhaseRef(1, 1), "all-terminal canceled work clears the handoff");
  const after = (await store.loadAllPhases()).find((p) => p.id === phaseId);
  assert.equal(after.handoff, "");
  assert.equal(after.handoffHistory[0].reason, "phase-done");
  assert.equal((await store.listHandoffs()).length, 0, "no active handoff remains after all tasks are canceled");
});

// ────────────────────────────────────────────────────────────────────────────
// repair end-to-end
// ────────────────────────────────────────────────────────────────────────────

test("repair: heals stale handoff + missing shortIds + integrity in one call, idempotent", async () => {
  const { planRoot, store, featureId, phaseId } = await fixture("repair-e2e");
  const taskId = createTaskId();
  // done phase with a stale handoff + feature missing its shortId
  await store.savePhase({
    id: phaseId, featureId, number: 1, shortId: "", priority: 10,
    slug: "phase", title: "Phase", summary: "", description: "",
    tasks: [makeTask({ id: taskId, phaseId, status: "done", startedAt: NOW, completedAt: NOW })],
    taskIds: [taskId], ...TS, handoff: "# Stale\n\nrepair should archive me",
  });
  await store.updateFeatures((doc) => {
    const f = doc.features.find((x) => x.id === featureId);
    f.shortId = "";
    f.phaseIds.push(phaseId);
    return doc;
  });
  const before = await store.validateIntegrity();
  assert.deepEqual(before, { duplicatePhaseIds: [], danglingPhaseIds: [], duplicateShortIds: [] });

  const repair = await store.repair();
  assert.equal(repair.handoffs.archived, 1, "stale handoff archived");
  assert.equal(repair.backfill.shortIdsAssigned, 3, "feature + phase + task all lacked shortIds");
  const phase = (await store.loadAllPhases()).find((p) => p.id === phaseId);
  assert.equal(phase.handoff, "", "handoff cleared by repair");
  assert.equal(phase.handoffHistory[0].reason, "phase-done");
  const feature = (await store.loadFeatures()).features.find((f) => f.id === featureId);
  assert.match(feature.shortId, /^[A-Z2-9]{5}$/);
  assert.deepEqual(repair.integrity, { duplicatePhaseIds: [], danglingPhaseIds: [], duplicateShortIds: [] });
  // idempotent: second repair is a no-op
  const repair2 = await store.repair();
  assert.equal(repair2.handoffs.archived, 0);
  assert.equal(repair2.backfill.shortIdsAssigned, 0);
  // restart persistence after repair
  const reopened = reopen(planRoot);
  assert.equal((await reopened.loadAllPhases()).find((p) => p.id === phaseId).handoff, "");
});

// ────────────────────────────────────────────────────────────────────────────
// Resume refresh + persistence
// ────────────────────────────────────────────────────────────────────────────

test("refreshResume: current phase, in-progress task ids and blockers follow transitions", async () => {
  const { planRoot, store, featureId, phaseId } = await fixture("resume-refresh");
  const taskId = createTaskId();
  await store.savePhase({
    id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
    slug: "phase", title: "Phase", summary: "", description: "",
    tasks: [makeTask({ id: taskId, phaseId })], taskIds: [taskId], ...TS, handoff: "",
  });
  await store.updatePhase(phaseId, (p) => {
    p.tasks[0].status = "in-progress";
    p.tasks[0].startedAt = NOW;
    return p;
  });
  await store.syncTaskStatusRollup(phaseId); // refreshResume inside
  let resume = JSON.parse(await readFile(fixturePaths(planRoot).resume, "utf-8"));
  assert.equal(resume.currentPhaseId, phaseId);
  assert.deepEqual(resume.inProgressTaskIds, [taskId]);
  assert.deepEqual(resume.blockers, []);
  // block a second task → blockers appear
  const taskId2 = createTaskId();
  await store.savePhase({
    id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
    slug: "phase", title: "Phase", summary: "", description: "",
    tasks: [
      makeTask({ id: taskId, phaseId, status: "in-progress", startedAt: NOW }),
      makeTask({ id: taskId2, phaseId, status: "blocked", title: "Blocked task" }),
    ],
    taskIds: [taskId, taskId2], ...TS, handoff: "",
  });
  await store.syncTaskStatusRollup(phaseId);
  resume = JSON.parse(await readFile(fixturePaths(planRoot).resume, "utf-8"));
  assert.deepEqual(resume.inProgressTaskIds, [taskId]);
  assert.equal(resume.blockers.length, 1);
  assert.match(resume.blockers[0], new RegExp(taskId2));
  // all done → no current phase, no in-progress tasks
  await store.savePhase({
    id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
    slug: "phase", title: "Phase", summary: "", description: "",
    tasks: [
      makeTask({ id: taskId, phaseId, status: "done", startedAt: NOW, completedAt: NOW }),
      makeTask({ id: taskId2, phaseId, status: "done", startedAt: NOW, completedAt: NOW }),
    ],
    taskIds: [taskId, taskId2], ...TS, handoff: "",
  });
  await store.syncTaskStatusRollup(phaseId);
  resume = JSON.parse(await readFile(fixturePaths(planRoot).resume, "utf-8"));
  // refreshResume RETAINS the last in-progress phase as context when nothing
  // is active anymore (existing.currentPhaseId fallback) — in-progress task
  // ids and blockers are cleared though.
  assert.equal(resume.currentPhaseId, phaseId, "last phase pointer retained as context");
  assert.deepEqual(resume.inProgressTaskIds, []);
  assert.deepEqual(resume.blockers, []);
  // restart persistence of the resume
  const reopened = reopen(planRoot);
  const r2 = JSON.parse(await readFile(fixturePaths(planRoot).resume, "utf-8"));
  assert.equal(r2.currentPhaseId, phaseId);
  assert.deepEqual(r2.inProgressTaskIds, []);
  void reopened;
});
