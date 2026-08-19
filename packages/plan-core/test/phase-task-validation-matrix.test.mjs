/**
 * T229 (P053/F015) — Phase and task validation matrix.
 *
 * Core-level coverage (real PlanStore + real filesystem, no mocks):
 *  - phase create: valid phase persists verbatim (number/shortId/priority/slug);
 *    title missing/empty rejected; number required positive (missing/0/negative
 *    rejected); featureId non-UUID rejected, unknown-but-valid-UUID rejected
 *    with PlanStoreError; invalid slugs rejected while clampSlug output passes;
 *    bad shortId / negative priority / bad timestamps rejected — atomic (no file)
 *  - task create: valid task persists verbatim (number/shortId/priority/shortName);
 *    title missing/empty rejected; phaseId must be a UUID (P003/""/abc rejected);
 *    invalid status rejected, all 8 valid statuses accepted; invalid shortName
 *    rejected, clampSlug output passes; negative number/priority rejected;
 *    checklist [""] and dependsOn [""] rejected; checklist string-input
 *    transform (deterministic ids, numbers 1..n, trimmed, checked=false);
 *    timestamps invalid rejected
 *  - cross-parent mismatch: a task whose phaseId points at ANOTHER phase is
 *    accepted at save (schema validates format only), stays put on plain load,
 *    and rebuildContainment relocates it to its owner phase (lossless)
 *  - task update via updatePhase: rename/status/priority/notes persist through a
 *    fresh PlanStore; invalid updates (bad status, empty title, non-UUID
 *    phaseId) reject with the phase file byte-identical (atomicity)
 *  - phase delete: removes the phase file; loadAllPhases drops it; the
 *    feature.phaseIds entry becomes dangling and is PRUNED on load
 *    (normalizeStructureSnapshot — same self-healing contract pinned in
 *    T228/T230); no cascade onto requirements
 *  - global numbering / refs: explicit phase/task numbers persist verbatim
 *    (stable sequence, never renumbered by save); duplicate numbers allowed at
 *    core (enforcement API-level); formatPhaseRef gives stable composite
 *    P00x(F00x); generated per-phase markdown uses the same composite label
 *
 * Enforcement notes (recorded for later phases):
 *  - duplicate phase/task numbers and task parent existence are not checked at
 *    the core schema layer; stricter gates live at the API layer (serve.ts,
 *    P054) — here we pin the core contract.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  PlanStore,
  PhaseSchema,
  TaskSchema,
  createFeatureId,
  createPhaseId,
  createTaskId,
  createShortId,
  clampSlug,
  formatPhaseRef,
} from "../dist/index.js";
import {
  createPlannerFixture,
  readPlanSnapshot,
  cleanupFixtures,
  BASE_TIME,
} from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupFixtures();
});

const NOW = BASE_TIME;
const TS = { createdAt: NOW, updatedAt: NOW };

const VALID_STATUSES = ["planned", "in-progress", "paused", "done", "blocked", "canceled", "rejected", "deferred", "waiting"];

function makeTask(overrides = {}) {
  return {
    id: createTaskId(),
    phaseId: "00000000-0000-4000-8000-000000000000", // placeholder, replaced by callers
    number: 1,
    shortId: createShortId(new Set(), "task"),
    priority: 10,
    shortName: clampSlug("Implement login"),
    title: "Implement login",
    status: "planned",
    description: "Task description.",
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

function makePhase(overrides = {}) {
  return {
    id: createPhaseId(),
    featureId: "00000000-0000-4000-8000-000000000000", // replaced by callers
    number: 1,
    shortId: createShortId(new Set(), "phase"),
    priority: 10,
    slug: clampSlug("Auth phase"),
    title: "Auth phase",
    summary: "Phase summary.",
    description: "Phase description.",
    tasks: [],
    taskIds: [],
    ...TS,
    handoff: "",
    ...overrides,
  };
}

function reopen(planRoot) {
  const store = new PlanStore(planRoot);
  store.enableAutoSync(true);
  return store;
}

/** Seed a feature + an empty phase, returns ids. */
async function seedFeaturePhase(name = "ptv") {
  const { planRoot, store } = await createPlannerFixture({ name, seed: "empty" });
  const featureId = createFeatureId();
  await store.saveFeature({
    id: featureId, number: 1, shortId: "AAAAA", priority: 10,
    name: "Feature", description: "", phaseIds: [], ...TS,
  });
  const phaseId = createPhaseId();
  await store.savePhase(makePhase({ id: phaseId, featureId, shortId: "CCCCC" }));
  return { planRoot, store, featureId, phaseId };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase create
// ────────────────────────────────────────────────────────────────────────────

async function fixturePhaseVerbatim() {
  const { planRoot, store } = await createPlannerFixture({ name: "phase-verbatim", seed: "empty" });
  const featureId = createFeatureId();
  await store.saveFeature({
    id: featureId, number: 1, shortId: "AAAAA", priority: 10,
    name: "Feature", description: "", phaseIds: [], ...TS,
  });
  const shortId = createShortId(new Set(), "phase-verbatim");
  const id = createPhaseId();
  await store.savePhase(makePhase({
    id, featureId, number: 5, shortId, priority: 33, slug: "auth-phase", title: "Auth phase",
  }));
  return { planRoot, store, featureId, id, shortId };
}

test("phase create: valid phase persists verbatim and exposes a stable composite ref", async () => {
  const { planRoot, store, id, shortId } = await fixturePhaseVerbatim();
  const reopened = reopen(planRoot);
  const loaded = (await reopened.loadAllPhases()).find((p) => p.id === id);
  assert.equal(loaded.number, 5);
  assert.equal(loaded.shortId, shortId);
  assert.equal(loaded.priority, 33);
  assert.equal(loaded.slug, "auth-phase");
  assert.equal(loaded.title, "Auth phase");
  assert.equal(formatPhaseRef(loaded.number, 1), "P005(F001)", "composite ref stable");
  await store.writeGenerated();
  const md = await readFile(join(planRoot, ".local", "generated", "phases", `${id}.md`), "utf-8");
  assert.match(md, /P005 — Auth phase/, "per-phase markdown uses the composite label");
});

test("phase create: missing/empty title and invalid number are rejected atomically", async () => {
  const { planRoot, store, featureId } = await seedFeaturePhase("phase-title");
  await assert.rejects(() => store.savePhase(makePhase({ featureId, title: undefined })), /title/i);
  await assert.rejects(() => store.savePhase(makePhase({ featureId, title: "" })), /title/i);
  for (const number of [undefined, 0, -1]) {
    const p = makePhase({ featureId, number });
    if (number === undefined) delete p.number;
    await assert.rejects(() => store.savePhase(p), /number/);
  }
  const files = await readdir(join(planRoot, "phases"));
  assert.equal(files.length, 1, "only the seeded phase exists — rejected saves wrote nothing");
});

test("phase create: featureId must be a UUID and must resolve to an existing feature", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "phase-featureid", seed: "empty" });
  const featureId = createFeatureId();
  await store.saveFeature({
    id: featureId, number: 1, shortId: "AAAAA", priority: 10,
    name: "Feature", description: "", phaseIds: [], ...TS,
  });
  for (const featureId of ["F005", "", "abc", "not-a-uuid"]) {
    await assert.rejects(() => store.savePhase(makePhase({ featureId })), /featureId/i);
  }
  // undefined featureId is allowed at core (legacy/unlink path)
  const p = makePhase({ featureId: undefined });
  delete p.featureId;
  await store.savePhase(p);
  // a valid-UUID featureId that matches NO feature is rejected by the store
  await assert.rejects(
    () => store.savePhase(makePhase({ featureId: createFeatureId() })),
    /does not match any existing feature/,
  );
  const files = await readdir(join(planRoot, "phases"));
  assert.equal(files.length, 1, "only the allowed phase was written");
});

test("phase create: slug/shortId/priority/timestamp validation", async () => {
  const { planRoot, store, featureId } = await seedFeaturePhase("phase-fields");
  // invalid slugs (SlugSchema: lowercase alnum + hyphens)
  for (const slug of ["", "Bad", "bad slug", "-bad", "bad-", "BÄD"]) {
    await assert.rejects(() => store.savePhase(makePhase({ featureId, slug })), /slug/);
  }
  // clampSlug output always satisfies the schema
  await store.savePhase(makePhase({ featureId, slug: clampSlug("  My Phase With Spaces!  ", 12) }));
  // shortId
  await assert.rejects(() => store.savePhase(makePhase({ featureId, shortId: "abcde" })), /shortId/);
  await assert.rejects(() => store.savePhase(makePhase({ featureId, priority: -1 })), /priority/);
  // timestamps
  const badCreated = makePhase({ featureId });
  delete badCreated.createdAt;
  await assert.rejects(() => store.savePhase(badCreated), /createdAt/);
  await assert.rejects(() => store.savePhase(makePhase({ featureId, updatedAt: "2026-01-01" })), /updatedAt/);
  const files = await readdir(join(planRoot, "phases"));
  assert.equal(files.length, 2, "seeded phase + one valid clampSlug phase — rejected saves left nothing");
});

test("phase create: taskIds is derived from tasks on save (normalizePhaseDocument)", async () => {
  const { planRoot, store, featureId, phaseId } = await seedFeaturePhase("phase-taskids");
  const taskId = createTaskId();
  const task = makeTask({ id: taskId, phaseId });
  // taskIds deliberately empty — normalizePhaseDocument rebuilds it
  await store.savePhase(makePhase({ id: phaseId, featureId, tasks: [task], taskIds: [] }));
  const loaded = (await reopen(planRoot).loadAllPhases()).find((p) => p.id === phaseId);
  assert.deepEqual(loaded.taskIds, [taskId], "taskIds mirrors tasks");
  assert.equal(loaded.tasks[0].id, taskId);
});

// ────────────────────────────────────────────────────────────────────────────
// Task create
// ────────────────────────────────────────────────────────────────────────────

test("task create: valid task persists verbatim and survives reload", async () => {
  const { planRoot, store, featureId, phaseId } = await seedFeaturePhase("task-verbatim");
  const shortId = createShortId(new Set(), "task-verbatim");
  const taskId = createTaskId();
  const task = makeTask({
    id: taskId, phaseId, number: 7, shortId, priority: 55, shortName: clampSlug("Do the thing"),
    title: "Do the thing", description: "Verbatim task.", notes: "n",
  });
  await store.savePhase(makePhase({ id: phaseId, featureId, tasks: [task], taskIds: [taskId] }));
  const reopened = reopen(planRoot);
  const loaded = (await reopened.loadAllPhases()).find((p) => p.id === phaseId).tasks[0];
  assert.equal(loaded.id, taskId);
  assert.equal(loaded.number, 7, "global number preserved (stable sequence)");
  assert.equal(loaded.shortId, shortId);
  assert.equal(loaded.priority, 55);
  assert.equal(loaded.shortName, "do-the-thing");
  assert.equal(loaded.title, "Do the thing");
  assert.equal(loaded.status, "planned");
  assert.equal(loaded.description, "Verbatim task.");
});

test("task create: missing/empty title and bad phaseId are rejected atomically", async () => {
  const { planRoot, store, featureId, phaseId } = await seedFeaturePhase("task-title");
  const phasePath = join(planRoot, "phases", `${phaseId}.json`);
  const before = await readFile(phasePath, "utf-8");
  await assert.rejects(() => store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [makeTask({ title: undefined })],
  })), /title/i);
  await assert.rejects(() => store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [makeTask({ title: "" })],
  })), /title/i);
  // phaseId must be a UUID, never a ref or empty
  for (const bad of ["P003", "", "abc", "not-a-uuid", "123"]) {
    await assert.rejects(() => store.savePhase(makePhase({
      id: phaseId, featureId, tasks: [makeTask({ phaseId: bad })],
    })), /phaseId/);
  }
  const after = await readFile(phasePath, "utf-8");
  assert.equal(after, before, "seeded phase file byte-identical after rejected saves");
});

test("task create: invalid status rejected; all valid statuses accepted", async () => {
  const { store, featureId, phaseId } = await seedFeaturePhase("task-status");
  for (const status of ["urgent", "nope", "", "IN-PROGRESS", "complete"]) {
    await assert.rejects(() => store.savePhase(makePhase({
      id: phaseId, featureId, tasks: [makeTask({ status })],
    })), /status/);
  }
  const tasks = VALID_STATUSES.map((status) => makeTask({ id: createTaskId(), status }));
  await store.savePhase(makePhase({ id: phaseId, featureId, tasks, taskIds: tasks.map((t) => t.id) }));
  const loaded = (await store.loadAllPhases()).find((p) => p.id === phaseId);
  assert.deepEqual(loaded.tasks.map((t) => t.status).sort(), [...VALID_STATUSES].sort());
});

test("task create: shortName/priority/number/checklist/dependsOn/timestamp validation", async () => {
  const { planRoot, store, featureId, phaseId } = await seedFeaturePhase("task-fields");
  const phasePath = join(planRoot, "phases", `${phaseId}.json`);
  const before = await readFile(phasePath, "utf-8");
  for (const shortName of ["", "Bad Name", "Bad_Name", "-bad", "bad-"]) {
    await assert.rejects(() => store.savePhase(makePhase({
      id: phaseId, featureId, tasks: [makeTask({ shortName })],
    })), /shortName/);
  }
  await assert.rejects(() => store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [makeTask({ priority: -2 })],
  })), /priority/);
  await assert.rejects(() => store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [makeTask({ number: -1 })],
  })), /number/);
  await assert.rejects(() => store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [makeTask({ checklist: [""] })],
  })), /checklist/);
  await assert.rejects(() => store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [makeTask({ dependsOn: [""] })],
  })), /dependsOn/);
  const badTs = makeTask();
  delete badTs.updatedAt;
  await assert.rejects(() => store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [badTs],
  })), /updatedAt/);
  const after = await readFile(phasePath, "utf-8");
  assert.equal(after, before, "seeded phase file byte-identical after rejected saves");
});

test("task create: checklist string inputs are transformed deterministically", async () => {
  const { planRoot, store, featureId, phaseId } = await seedFeaturePhase("task-checklist");
  const taskId = createTaskId();
  const task = makeTask({
    id: taskId, phaseId, checklist: ["  Add route  ", "Write tests", "   "],
  });
  await store.savePhase(makePhase({ id: phaseId, featureId, tasks: [task], taskIds: [taskId] }));
  const loaded = (await reopen(planRoot).loadAllPhases()).find((p) => p.id === phaseId).tasks[0];
  assert.equal(loaded.checklist.length, 2, "whitespace-only item filtered by transform");
  assert.deepEqual(
    loaded.checklist.map((c) => c.title),
    ["Add route", "Write tests"],
    "titles trimmed",
  );
  assert.deepEqual(loaded.checklist.map((c) => c.number), [1, 2], "numbered 1..n");
  assert.ok(loaded.checklist.every((c) => c.checked === false));
  assert.match(loaded.checklist[0].id, /^[0-9a-f-]+-check-001-add-route$/i, "deterministic id");
  // persisted verbatim on reload
  const raw = JSON.parse(await readFile(join(planRoot, "phases", `${phaseId}.json`), "utf-8"));
  assert.equal(raw.tasks[0].checklist.length, 2);
});

// ────────────────────────────────────────────────────────────────────────────
// Cross-parent mismatch + containment repair
// ────────────────────────────────────────────────────────────────────────────

test("cross-parent: task.phaseId pointing at another phase is repaired by rebuildContainment", async () => {
  const { planRoot, store, featureId } = await createPlannerFixture({ name: "cross-parent", seed: "empty" }).then(async (fx) => {
    const featureId = createFeatureId();
    await fx.store.saveFeature({
      id: featureId, number: 1, shortId: "AAAAA", priority: 10,
      name: "Feature", description: "", phaseIds: [], ...TS,
    });
    return { ...fx, featureId };
  });
  const pid1 = createPhaseId();
  const pid2 = createPhaseId();
  const task = makeTask({ phaseId: pid2, title: "Mismatch task" });
  // the task claims phase pid2 but is filed under phase pid1
  await store.savePhase(makePhase({ id: pid1, featureId, tasks: [task], taskIds: [task.id] }));
  await store.savePhase(makePhase({ id: pid2, featureId, number: 2, tasks: [], taskIds: [] }));
  // plain load keeps the mismatch (schema validates UUID format only)
  const plain = (await store.loadAllPhases()).find((p) => p.id === pid1);
  assert.equal(plain.tasks[0].phaseId, pid2, "mismatch tolerated on save/plain load");
  // rebuildContainment relocates it to its owner phase, losslessly
  const repair = await store.rebuildContainment();
  assert.equal(repair.tasks, 1, "one task relocated");
  const after = await reopen(planRoot);
  const p1 = (await after.loadAllPhases()).find((p) => p.id === pid1);
  const p2 = (await after.loadAllPhases()).find((p) => p.id === pid2);
  assert.equal(p1.tasks.length, 0, "source phase no longer contains it");
  assert.equal(p2.tasks.length, 1, "owner phase now contains it");
  assert.equal(p2.tasks[0].title, "Mismatch task", "content preserved");
  assert.deepEqual(p2.taskIds, [task.id]);
});

// ────────────────────────────────────────────────────────────────────────────
// Task update (via updatePhase)
// ────────────────────────────────────────────────────────────────────────────

test("task update: rename/status/priority/notes persist through a fresh PlanStore", async () => {
  const { planRoot, store, featureId, phaseId } = await seedFeaturePhase("task-update");
  const taskId = createTaskId();
  await store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [makeTask({ id: taskId, phaseId })], taskIds: [taskId],
  }));
  await store.updatePhase(phaseId, (p) => {
    const t = p.tasks.find((x) => x.id === taskId);
    t.title = "Renamed task";
    t.status = "in-progress";
    t.priority = 99;
    t.notes = "notes updated";
    t.startedAt = NOW;
    return p;
  });
  const reopened = reopen(planRoot);
  const t = (await reopened.loadAllPhases()).find((p) => p.id === phaseId).tasks[0];
  assert.equal(t.title, "Renamed task");
  assert.equal(t.status, "in-progress");
  assert.equal(t.priority, 99);
  assert.equal(t.notes, "notes updated");
  assert.equal(t.startedAt, NOW);
});

test("task update: invalid updates reject and leave the phase file byte-identical", async () => {
  const { planRoot, store, featureId, phaseId } = await seedFeaturePhase("task-update-invalid");
  const taskId = createTaskId();
  await store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [makeTask({ id: taskId, phaseId })], taskIds: [taskId],
  }));
  const before = await readFile(join(planRoot, "phases", `${phaseId}.json`), "utf-8");
  await assert.rejects(() => store.updatePhase(phaseId, (p) => {
    p.tasks[0].status = "urgent";
    return p;
  }), /status/);
  await assert.rejects(() => store.updatePhase(phaseId, (p) => {
    p.tasks[0].title = "";
    return p;
  }), /title/);
  await assert.rejects(() => store.updatePhase(phaseId, (p) => {
    p.tasks[0].phaseId = "P003";
    return p;
  }), /phaseId/);
  const after = await readFile(join(planRoot, "phases", `${phaseId}.json`), "utf-8");
  assert.equal(after, before, "phase file byte-identical after rejected updates");
});

// ────────────────────────────────────────────────────────────────────────────
// Phase delete + numbering
// ────────────────────────────────────────────────────────────────────────────

test("phase delete: file removed, phase dropped, feature.phaseIds pruned on load", async () => {
  const { planRoot, store, featureId, phaseId } = await seedFeaturePhase("phase-delete");
  const taskId = createTaskId();
  await store.savePhase(makePhase({
    id: phaseId, featureId, tasks: [makeTask({ id: taskId, phaseId })], taskIds: [taskId],
  }));
  // link the phase into the feature on disk
  await store.updateFeatures((doc) => {
    doc.features.find((f) => f.id === featureId).phaseIds.push(phaseId);
    return doc;
  });
  await store.deletePhase(phaseId);
  const files = await readdir(join(planRoot, "phases"));
  assert.deepEqual(files, [], "phase file removed");
  assert.ok(!(await store.loadAllPhases()).some((p) => p.id === phaseId));
  // the feature still lists the phase on disk, but load prunes the dangling id
  const raw = JSON.parse(await readFile(join(planRoot, "features", `${featureId}.json`), "utf-8"));
  assert.ok(raw.phaseIds.includes(phaseId), "on-disk feature still lists it (no cascade at core)");
  const loaded = (await store.loadFeatures()).features.find((f) => f.id === featureId);
  assert.deepEqual(loaded.phaseIds, [], "dangling phaseId pruned on load");
});

test("numbering: explicit phase/task numbers are never renumbered; duplicates allowed at core", async () => {
  const { planRoot, store, featureId } = await createPlannerFixture({ name: "phase-numbers", seed: "empty" }).then(async (fx) => {
    const featureId = createFeatureId();
    await fx.store.saveFeature({
      id: featureId, number: 1, shortId: "AAAAA", priority: 10,
      name: "Feature", description: "", phaseIds: [], ...TS,
    });
    return { ...fx, featureId };
  });
  // two phases with the SAME global number in different features — core does
  // not enforce uniqueness (API assigns from the monotonic counter)
  const pidA = createPhaseId();
  const pidB = createPhaseId();
  await store.savePhase(makePhase({ id: pidA, featureId, number: 42, tasks: [], taskIds: [] }));
  await store.savePhase(makePhase({ id: pidB, featureId, number: 42, tasks: [], taskIds: [] }));
  const reopened = reopen(planRoot);
  const numbers = (await reopened.loadAllPhases()).map((p) => p.number);
  assert.deepEqual(numbers, [42, 42], "numbers stored verbatim, never renumbered");
  assert.equal(formatPhaseRef(42, 1), "P042(F001)", "composite ref stable regardless of duplicates");
  // task numbers likewise stay explicit
  const taskId = createTaskId();
  await store.savePhase(makePhase({
    id: pidA, featureId, number: 42,
    tasks: [makeTask({ id: taskId, phaseId: pidA, number: 9 })], taskIds: [taskId],
  }));
  const t = (await reopen(planRoot).loadAllPhases()).find((p) => p.id === pidA).tasks[0];
  assert.equal(t.number, 9, "explicit task number preserved");
});
