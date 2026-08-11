/**
 * T230 (P053/F015) — Requirements, checklists, reorder, and links.
 *
 * Core-level coverage (real PlanStore + real filesystem, no mocks):
 *  - requirements CRUD + phase links (persist, reload, lookup, missing-target,
 *    duplicate links, deletion)
 *  - checklist: creation (addChecklistItem/createChecklistItemId), selectors,
 *    toggle/resolve, remove+renumber, string-input transform, persistence
 *  - nesting via task.subtasks (SubtaskSchema, status lifecycle) — the schema
 *    has no parent field on ChecklistItem, so nested structure is subtasks
 *  - reorder/midpoint: nextPriority scopes, midpoint insertion between
 *    neighbours, canonical order (priority || number), taskIds consistency,
 *    persistence across a fresh PlanStore
 *  - task links/dependencies: dependsOn round-trip, malformed references do
 *    not corrupt load/render, deletion cleanup keeps tasks/taskIds consistent
 *  - priority + shortId backfill (ensureShortIdsAndPriority: assign, never
 *    overwrite, idempotent, duplicates reported)
 *  - integrity (validateIntegrity + repair) and generated views consistent
 *    with canonical JSON (writeGenerated)
 *
 * Enforcement notes (recorded for later phases):
 *  - missing-target for requirement phase links and dependsOn refs is validated
 *    at the API layer (serve.ts resolveRequirementPhaseIds, P054), not in core.
 *  - the midpoint/reindex algorithm lives in serve.ts /reorder (P054 API tests);
 *    here we pin the core ordering contract it relies on.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PlanStore,
  createFeatureId,
  createPhaseId,
  createTaskId,
  createRequirementId,
  createShortId,
  normalizeSlug,
  createChecklistItemId,
  addChecklistItem,
  findChecklistItem,
  toggleChecklistItem,
  removeChecklistItem,
  FeatureSchema,
  PhaseSchema,
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

/** Canonical display order used by the app: priority, then number, then createdAt. */
function canonicalOrder(entities) {
  return [...entities].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.number - b.number || a.createdAt.localeCompare(b.createdAt),
  );
}

/** Fresh PlanStore over an EXISTING plan root (simulates a reload/restart). */
function reopen(planRoot) {
  const store = new PlanStore(planRoot);
  store.enableAutoSync(true);
  return store;
}

// ────────────────────────────────────────────────────────────────────────────
// Requirements CRUD + phase links
// ────────────────────────────────────────────────────────────────────────────

test("requirements: create/update/delete persist through a fresh PlanStore", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "req-crud", seed: "minimal" });
  const phase = (await store.loadAllPhases())[0];
  const req = await store.updateRequirements((doc) => {
    doc.requirements.push({
      id: createRequirementId(),
      title: "Handle duplicates",
      description: "Second requirement.",
      status: "planned",
      macroTasks: [],
      linkedPhaseIds: [phase.id],
      createdAt: NOW,
      updatedAt: NOW,
    });
    return doc;
  });
  const added = req.requirements.find((r) => r.title === "Handle duplicates");
  assert.ok(added, "requirement must be persisted");
  assert.deepEqual(added.linkedPhaseIds, [phase.id]);

  // update
  await store.updateRequirements((doc) => {
    const target = doc.requirements.find((r) => r.id === added.id);
    target.status = "in-progress";
    target.title = "Handle duplicates (updated)";
    target.linkedPhaseIds = [];
    return doc;
  });

  // delete one (the seeded requirement)
  const seeded = (await store.loadRequirements()).requirements.find((r) => r.title === "Users can authenticate");
  await store.updateRequirements((doc) => {
    doc.requirements = doc.requirements.filter((r) => r.id !== seeded.id);
    return doc;
  });

  // fresh reload: only the updated requirement remains
  const reopened = reopen(planRoot);
  const all = (await reopened.loadRequirements()).requirements;
  assert.equal(all.length, 1);
  assert.equal(all[0].title, "Handle duplicates (updated)");
  assert.equal(all[0].status, "in-progress");
  assert.deepEqual(all[0].linkedPhaseIds, []);
});

test("requirements: linkedPhaseIds resolve via linkedRequirementsForPhase and survive reload", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "req-links", seed: "minimal" });
  const phase = (await store.loadAllPhases())[0];

  const linked = await store.linkedRequirementsForPhase(phase.id);
  assert.equal(linked.length, 1, "minimal seed links exactly one requirement");
  assert.equal(linked[0].title, "Users can authenticate");

  // unknown phase → empty lookup, no throw
  assert.deepEqual(await store.linkedRequirementsForPhase(createPhaseId()), []);

  // fresh reload keeps the link
  const reopened = reopen(planRoot);
  const afterReload = await reopened.linkedRequirementsForPhase(phase.id);
  assert.equal(afterReload.length, 1);
  assert.equal(afterReload[0].id, linked[0].id);
});

test("requirements: missing-target and duplicate links are stored verbatim at core level", async () => {
  // Core stores whatever the caller writes (no ref validation here); the API
  // layer rejects missing/duplicate refs before they reach the store (P054).
  const { store } = await createPlannerFixture({ name: "req-missing", seed: "empty" });
  const phase = await store.updateRequirements((doc) => {
    doc.requirements.push({
      id: createRequirementId(),
      title: "Dangling link",
      description: "Links to a phase that does not exist.",
      status: "planned",
      macroTasks: [],
      linkedPhaseIds: [createPhaseId(), "00000000-0000-4000-8000-000000000000"],
      createdAt: NOW,
      updatedAt: NOW,
    });
    return doc;
  });
  const dangling = phase.requirements[0];
  assert.equal(dangling.linkedPhaseIds.length, 2);
  // lookup for a genuinely unknown id stays empty (no crash, no false positives);
  // an id that IS listed matches verbatim (raw includes, no target resolution)
  assert.deepEqual(await store.linkedRequirementsForPhase(createPhaseId()), []);
  assert.equal((await store.linkedRequirementsForPhase(dangling.linkedPhaseIds[0])).length, 1);
  // the document round-trips without corruption
  const reloaded = await store.loadRequirements();
  assert.equal(reloaded.requirements[0].linkedPhaseIds.length, 2);
});

test("requirements: deletion of a phase keeps requirement documents intact (no cascade at core)", async () => {
  const { store } = await createPlannerFixture({ name: "req-delete-phase", seed: "minimal" });
  const phase = (await store.loadAllPhases())[0];
  await store.deletePhase(phase.id);
  // requirement still on disk with its (now dangling) link — cleanup of
  // requirement links is a product decision (validated at API/UI layers)
  const reqs = await store.loadRequirements();
  assert.equal(reqs.requirements.length, 1, "requirement document survives phase deletion");
  // no cascade at core: the requirement keeps its (now dangling) link — the
  // raw includes lookup still matches the deleted phase id. Cleanup of
  // requirement links is a product decision (API/UI layers).
  assert.equal((await store.linkedRequirementsForPhase(phase.id)).length, 1);
});

// ────────────────────────────────────────────────────────────────────────────
// Checklist
// ────────────────────────────────────────────────────────────────────────────

test("checklist: helpers are pure, deterministic, and selector-complete", () => {
  const taskId = createTaskId();
  const items = [];
  const a = addChecklistItem(items, taskId, "  Write test  ");
  items.push(a); // addChecklistItem returns the item; the caller appends
  const b = addChecklistItem(items, taskId, "Run suite");
  items.push(b);
  assert.equal(a.title, "Write test", "title trimmed");
  assert.equal(a.checked, false);
  assert.equal(a.number, 1);
  assert.equal(b.number, 2);
  // deterministic id: same (taskId, number, title) → same id
  const again = createChecklistItemId(taskId, a.number, "Write test");
  assert.equal(a.id, again, "ids are deterministic");

  // selectors: C{n}, id, exact title, partial title, case-insensitive
  assert.equal(findChecklistItem(items, "C2").id, b.id);
  assert.equal(findChecklistItem(items, b.id).id, b.id);
  assert.equal(findChecklistItem(items, "RUN SUITE").id, b.id);
  assert.equal(findChecklistItem(items, "Write").id, a.id);
  assert.equal(findChecklistItem(items, "  C1  ").id, a.id, "selectors trim input");
  assert.equal(findChecklistItem(items, "nope"), undefined);

  // toggle: explicit + flip; resolve
  assert.equal(toggleChecklistItem(items, "C1", true).checked, true);
  assert.equal(toggleChecklistItem(items, "C1").checked, false, "toggle flips");
  assert.equal(toggleChecklistItem(items, "C1", true).checked, true);
  assert.equal(toggleChecklistItem(items, "missing"), undefined);

  // remove: returns the item, renumbers the rest 1..n
  const removed = removeChecklistItem(items, "C1");
  assert.equal(removed.id, a.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].number, 1, "renumbered after removal");
  assert.equal(items[0].id, b.id);
  assert.equal(removeChecklistItem(items, "C99"), undefined, "missing remove is a no-op");
});

test("checklist: persisted via savePhase and reloaded identically", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "checklist-persist", seed: "empty" });
  const featureId = createFeatureId();
  const phaseId = createPhaseId();
  const taskId = createTaskId();
  await store.saveFeature(FeatureSchema.parse({
    id: featureId, number: 1, shortId: "AAAAA", priority: 10,
    name: "Checklist feature", description: "Fixture.",
    phaseIds: [phaseId], createdAt: NOW, updatedAt: NOW,
  }));
  const items = [];
  items.push(addChecklistItem(items, taskId, "Step one"));
  items.push(addChecklistItem(items, taskId, "Step two"));
  const task = {
    id: taskId, phaseId, number: 1, shortId: "BBBBB", priority: 10,
    shortName: normalizeSlug("Checklist task"), title: "Checklist task", status: "planned",
    description: "", notes: "", statusLog: [], decisions: [], acceptedDecisions: [],
    checklist: items, subtasks: [], dependsOn: [],
    startedAt: "", completedAt: "", createdAt: NOW, updatedAt: NOW,
  };
  await store.savePhase(PhaseSchema.parse({
    id: phaseId, featureId, number: 1, shortId: "CCCCC", priority: 10,
    slug: normalizeSlug("Checklist phase"), title: "Checklist phase", summary: "",
    description: "", tasks: [task], taskIds: [taskId], createdAt: NOW, updatedAt: NOW, handoff: "",
  }));

  // string inputs were transformed by TaskSchema into items with ids/numbers
  const fresh = reopen(planRoot);
  const phase = (await fresh.loadAllPhases())[0];
  assert.equal(phase.tasks[0].checklist.length, 2);
  assert.equal(phase.tasks[0].checklist[0].title, "Step one");
  assert.equal(phase.tasks[0].checklist[0].number, 1);
  assert.equal(phase.tasks[0].checklist[0].checked, false);
  assert.match(phase.tasks[0].checklist[0].id, /^[0-9a-f-]+-check-\d+-[a-z0-9-]+$/i, "checklist ids embed taskId + position + slug");

  // toggle + persist + reload keeps resolution
  await fresh.updatePhase(phaseId, (p) => {
    toggleChecklistItem(p.tasks[0].checklist, "C1", true);
    return p;
  });
  const reopened2 = reopen(planRoot);
  const checklist = (await reopened2.loadAllPhases())[0].tasks[0].checklist;
  assert.equal(checklist[0].checked, true, "resolution survives reload");
  assert.equal(checklist[1].checked, false);
});

test("checklist: nesting is expressed via task.subtasks (schema has no checklist parent)", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "nesting", seed: "minimal" });
  const phase = (await store.loadAllPhases())[0];
  const task = phase.tasks[0];
  await store.updatePhase(phase.id, (p) => {
    const t = p.tasks.find((x) => x.id === task.id);
    t.subtasks = [
      { id: createTaskId(), title: "Child A", status: "done", description: "", createdAt: NOW, updatedAt: NOW },
      { id: createTaskId(), title: "Child B", status: "in-progress", description: "", createdAt: NOW, updatedAt: NOW },
    ];
    return p;
  });
  const reopened = reopen(planRoot);
  const subs = (await reopened.loadAllPhases())[0].tasks[0].subtasks;
  assert.equal(subs.length, 2);
  assert.equal(subs[0].status, "done");
  assert.equal(subs[1].status, "in-progress");
  assert.ok(subs[0].id !== subs[1].id);
});

// ────────────────────────────────────────────────────────────────────────────
// Reorder / midpoint
// ────────────────────────────────────────────────────────────────────────────

test("reorder: nextPriority appends at max+1 per scope", async () => {
  const { store } = await createPlannerFixture({ name: "next-priority", seed: "full" });
  const phases = await store.loadAllPhases();
  const f0 = (await store.loadFeatures()).features.find((f) => f.name === "Auth");
  const f0Phases = phases.filter((p) => p.featureId === f0.id);
  const f1 = (await store.loadFeatures()).features.find((f) => f.name === "Payments");

  const nextFeature = await store.nextPriority("feature");
  assert.equal(nextFeature, 31, "feature scope is project-wide (max+1)");

  const nextPhase = await store.nextPriority("phase", f0.id);
  const f0Max = Math.max(...f0Phases.map((p) => p.priority));
  assert.equal(nextPhase, f0Max + 1, "phase scope is per-feature siblings");

  const f1Phase = phases.find((p) => p.featureId === f1.id);
  const nextTask = await store.nextPriority("task", f1Phase.id);
  const tMax = Math.max(...f1Phase.tasks.map((t) => t.priority));
  assert.equal(nextTask, tMax + 1, "task scope is per-phase");
});

test("reorder: midpoint insertion lands between neighbours and survives reload", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "midpoint", seed: "full" });
  const features = (await store.loadFeatures()).features;
  const ordered = canonicalOrder(features);
  assert.deepEqual(ordered.map((f) => f.name), ["Auth", "Payments", "Reporting"], "seed order");

  // move Reporting (priority 30) between Auth (10) and Payments (20):
  // midpoint of 10 and 20 is 15 — strictly between
  const [auth, payments, reporting] = ordered;
  await store.updateFeatures((doc) => {
    const moved = doc.features.find((f) => f.id === reporting.id);
    moved.priority = Math.floor((auth.priority + payments.priority) / 2);
    doc.features = canonicalOrder(doc.features);
    return doc;
  });

  const reopened = reopen(planRoot);
  const afterReload = (await reopened.loadFeatures()).features;
  const names = canonicalOrder(afterReload).map((f) => f.name);
  assert.deepEqual(names, ["Auth", "Reporting", "Payments"], "midpoint insert reorders and persists");
  const moved = afterReload.find((f) => f.id === reporting.id);
  assert.ok(moved.priority > auth.priority && moved.priority < payments.priority, "priority strictly between neighbours");
});

test("reorder: task order stays canonical and taskIds stays consistent after reorder + reload", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "task-order", seed: "full" });
  const phases = await store.loadAllPhases();
  const host = phases.find((p) => p.tasks.length >= 2);
  const byPriority = canonicalOrder(host.tasks);
  const [first, second, ...rest] = byPriority;
  assert.ok(rest.length >= 0 && first && second, "host phase has ≥2 tasks");

  // move the second task to the front: midpoint insert before first (priority
  // gap 10..20 → midpoint 15) then re-sort the array as the server does
  await store.updatePhase(host.id, (p) => {
    const moved = p.tasks.find((t) => t.id === second.id);
    const anchor = p.tasks.find((t) => t.id === first.id);
    moved.priority = Math.floor(anchor.priority / 2);
    p.tasks = canonicalOrder(p.tasks);
    p.taskIds = p.tasks.map((t) => t.id);
    return p;
  });

  const reopened = reopen(planRoot);
  const phase = (await reopened.loadAllPhases()).find((p) => p.id === host.id);
  assert.equal(phase.tasks[0].id, second.id, "moved task is first");
  assert.deepEqual(
    phase.taskIds,
    phase.tasks.map((t) => t.id),
    "taskIds must mirror tasks order (store derives it on load)",
  );
  assert.deepEqual(
    phase.tasks.map((t) => t.id),
    canonicalOrder(phase.tasks).map((t) => t.id),
    "persisted task order is canonical (priority || number)",
  );
});

test("reorder: tight gaps (≤1) fall back to reindexed canonical order", async () => {
  // When the gap between neighbours is exhausted the server reindexes to
  // (i+1)*GAP. Core contract: a reindexed phase reloads in canonical order
  // with taskIds consistent — the invariant the endpoint's reindex relies on.
  const { planRoot, store } = await createPlannerFixture({ name: "reindex", seed: "minimal" });
  const phase = (await store.loadAllPhases())[0];
  const task = phase.tasks[0];
  const extra = Array.from({ length: 3 }, (_, i) => ({
    id: createTaskId(),
    phaseId: phase.id,
    number: 2 + i,
    shortId: createShortId(new Set(), `extra-${i}`),
    priority: 10, // deliberately colliding with the seeded task
    shortName: normalizeSlug(`Extra ${i}`),
    title: `Extra ${i}`,
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
    createdAt: NOW,
    updatedAt: NOW,
  }));
  await store.updatePhase(phase.id, (p) => {
    p.tasks = [task, ...extra];
    p.taskIds = p.tasks.map((t) => t.id);
    return p;
  });
  // reindex fallback (as the endpoint does): (i+1)*10 by canonical order
  await store.updatePhase(phase.id, (p) => {
    const sorted = canonicalOrder(p.tasks);
    sorted.forEach((t, i) => { t.priority = (i + 1) * 10; });
    p.tasks = sorted;
    p.taskIds = sorted.map((t) => t.id);
    return p;
  });
  const reopened = reopen(planRoot);
  const after = (await reopened.loadAllPhases())[0];
  assert.deepEqual(
    after.tasks.map((t) => t.priority),
    [10, 20, 30, 40],
    "reindexed priorities are 10,20,30,40",
  );
  assert.deepEqual(after.taskIds, after.tasks.map((t) => t.id), "taskIds consistent after reindex");
});

// ────────────────────────────────────────────────────────────────────────────
// Task links / dependencies
// ────────────────────────────────────────────────────────────────────────────

test("links: dependsOn round-trips and survives reload", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "depends", seed: "full" });
  const phase = (await store.loadAllPhases()).find((p) => p.tasks.length >= 2);
  const [a, b] = canonicalOrder(phase.tasks);
  await store.updatePhase(phase.id, (p) => {
    const task = p.tasks.find((t) => t.id === a.id);
    task.dependsOn = [b.id];
    return p;
  });
  const reopened = reopen(planRoot);
  const after = (await reopened.loadAllPhases()).find((p) => p.id === phase.id);
  const taskA = after.tasks.find((t) => t.id === a.id);
  assert.deepEqual(taskA.dependsOn, [b.id], "dependency reference survives reload");
});

test("links: malformed references do not corrupt load or generated views", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "bad-refs", seed: "minimal" });
  const phase = (await store.loadAllPhases())[0];
  await store.updatePhase(phase.id, (p) => {
    const t = p.tasks[0];
    t.dependsOn = ["not-a-real-id", "garbage-ref"];
    t.subtasks = [{ id: "sub-1", title: "Child", status: "planned", description: "", createdAt: NOW, updatedAt: NOW }];
    return p;
  });
  // load + render must not throw on malformed relation refs
  const reopened = reopen(planRoot);
  const after = (await reopened.loadAllPhases())[0];
  assert.deepEqual(after.tasks[0].dependsOn, ["not-a-real-id", "garbage-ref"]);
  const written = await reopened.writeGenerated();
  assert.ok(written.length >= 1, "generated views still render");
  const planMd = await readFile(join(planRoot, ".local", "generated", "PLAN.md"), "utf-8").catch(() => "");
  assert.match(planMd, /Plan/, "PLAN.md renders despite malformed refs");
});

test("deletion-cleanup: removing a task keeps tasks/taskIds consistent and survives reload", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "delete-task", seed: "full" });
  const phase = (await store.loadAllPhases()).find((p) => p.tasks.length >= 2);
  const victim = phase.tasks[0];
  // same shape as the DELETE /tasks/:id handler
  await store.updatePhase(phase.id, (p) => {
    p.tasks = p.tasks.filter((t) => t.id !== victim.id);
    p.taskIds = p.taskIds.filter((id) => id !== victim.id);
    p.updatedAt = NOW;
    return p;
  });
  const reopened = reopen(planRoot);
  const after = (await reopened.loadAllPhases()).find((p) => p.id === phase.id);
  assert.ok(!after.tasks.some((t) => t.id === victim.id), "task removed");
  assert.ok(!after.taskIds.includes(victim.id), "taskId removed from taskIds");
  assert.equal(after.taskIds.length, after.tasks.length, "tasks/taskIds stay in lockstep");
});

// ────────────────────────────────────────────────────────────────────────────
// Priority + shortId backfill
// ────────────────────────────────────────────────────────────────────────────

test("backfill: ensureShortIdsAndPriority assigns missing shortIds, preserves existing, idempotent", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "backfill", seed: "empty" });
  // craft entities WITHOUT shortIds (all empty) and a priority collision
  const featureId = createFeatureId();
  const phaseId = createPhaseId();
  const taskId = createTaskId();
  await store.saveFeature(FeatureSchema.parse({
    id: featureId, number: 1, shortId: "", priority: 10,
    name: "Backfill feature", description: "No shortId yet.",
    phaseIds: [phaseId], createdAt: NOW, updatedAt: NOW,
  }));
  await store.savePhase(PhaseSchema.parse({
    id: phaseId, featureId, number: 1, shortId: "", priority: 10,
    slug: normalizeSlug("Backfill phase"), title: "Backfill phase", summary: "",
    description: "", tasks: [{
      id: taskId, phaseId, number: 1, shortId: "", priority: 10,
      shortName: normalizeSlug("Backfill task"), title: "Backfill task", status: "planned",
      description: "", notes: "", statusLog: [], decisions: [], acceptedDecisions: [],
      checklist: [], subtasks: [], dependsOn: [],
      startedAt: "", completedAt: "", createdAt: NOW, updatedAt: NOW,
    }], taskIds: [taskId], createdAt: NOW, updatedAt: NOW, handoff: "",
  }));

  const first = await store.ensureShortIdsAndPriority();
  assert.equal(first.shortIdsAssigned, 3, "feature + phase + task each get a shortId");
  assert.equal(first.prioritiesAssigned, 0, "backfill never re-prioritizes (left to reorder)");
  assert.deepEqual(first.duplicateShortIds, []);

  const reopened = reopen(planRoot);
  const f = (await reopened.loadFeatures()).features[0];
  const p = (await reopened.loadAllPhases())[0];
  assert.match(f.shortId, /^[A-Z2-9]{5}$/, "Crockford 5-char shortId");
  assert.match(p.shortId, /^[A-Z2-9]{5}$/);
  assert.match(p.tasks[0].shortId, /^[A-Z2-9]{5}$/);
  assert.notEqual(f.shortId, p.shortId, "shortIds are globally unique");
  assert.notEqual(p.shortId, p.tasks[0].shortId);

  // second run: idempotent — nothing to assign
  const second = await store.ensureShortIdsAndPriority();
  assert.equal(second.shortIdsAssigned, 0, "idempotent: no reassignment on second run");
  assert.equal(second.prioritiesAssigned, 0);

  // existing shortIds are NEVER overwritten
  const before = (await reopened.loadAllPhases())[0].tasks[0].shortId;
  await reopened.ensureShortIdsAndPriority();
  assert.equal((await reopened.loadAllPhases())[0].tasks[0].shortId, before, "existing shortId untouched");
});

test("backfill: duplicate shortIds are reported, not silently fixed", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "dup-sid", seed: "empty" });
  const featureId = createFeatureId();
  const phaseId = createPhaseId();
  await store.saveFeature(FeatureSchema.parse({
    id: featureId, number: 1, shortId: "AAAAA", priority: 10,
    name: "Dup feature", description: "", phaseIds: [phaseId], createdAt: NOW, updatedAt: NOW,
  }));
  await store.savePhase(PhaseSchema.parse({
    id: phaseId, featureId, number: 1, shortId: "AAAAA", priority: 10,
    slug: normalizeSlug("Dup phase"), title: "Dup phase", summary: "",
    description: "", tasks: [], taskIds: [], createdAt: NOW, updatedAt: NOW, handoff: "",
  }));
  const report = await store.ensureShortIdsAndPriority();
  assert.deepEqual(report.duplicateShortIds, ["AAAAA"], "collision surfaced in the report");
  const integrity = await store.validateIntegrity();
  assert.deepEqual(integrity.duplicateShortIds, ["AAAAA"], "validateIntegrity agrees");
});

// ────────────────────────────────────────────────────────────────────────────
// Integrity + generated views
// ────────────────────────────────────────────────────────────────────────────

test("integrity: dangling feature→phase refs are pruned on load; orphan phases are repairable", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "integrity", seed: "full" });
  const healthy = await store.validateIntegrity();
  assert.deepEqual(healthy, { duplicatePhaseIds: [], danglingPhaseIds: [], duplicateShortIds: [] });

  // (1) A dangling ref written through the API is pruned by load-time
  // normalization (normalizeStructureSnapshot drops unknown phaseIds) — the
  // store self-heals reads, so integrity stays clean.
  const feature = (await store.loadFeatures()).features[0];
  const missing = createPhaseId();
  await store.updateFeatures((doc) => {
    const f = doc.features.find((x) => x.id === feature.id);
    f.phaseIds.push(missing);
    return doc;
  });
  const pruned = (await store.loadFeatures()).features.find((f) => f.id === feature.id);
  assert.ok(!pruned.phaseIds.includes(missing), "unknown phaseId pruned from feature.phaseIds on load");
  assert.deepEqual(await store.validateIntegrity(), { duplicatePhaseIds: [], danglingPhaseIds: [], duplicateShortIds: [] });

  // (2) An ORPHAN phase (raw file whose featureId points at no feature —
  // savePhase rejects this, so it simulates on-disk corruption) is detected
  // by listOrphanPhases and removed by cleanupOrphanPhases.
  const orphanId = createPhaseId();
  const { writeFile } = await import("node:fs/promises");
  const orphan = {
    id: orphanId, featureId: createFeatureId(), number: 99, shortId: "ZZZZZ", priority: 10,
    slug: normalizeSlug("Orphan phase"), title: "Orphan phase", summary: "",
    description: "Raw orphaned phase file.", tasks: [], taskIds: [],
    createdAt: NOW, updatedAt: NOW, handoff: "",
  };
  await writeFile(join(planRoot, "phases", `${orphanId}.json`), JSON.stringify(orphan, null, 2), "utf-8");
  const orphans = await store.listOrphanPhases();
  assert.equal(orphans.length, 1, "orphan phase detected");
  assert.equal(orphans[0].phaseId, orphanId);
  const cleaned = await store.cleanupOrphanPhases();
  assert.equal(cleaned.removed.length, 1);
  const phases = await store.loadAllPhases();
  assert.ok(!phases.some((p) => p.id === orphanId), "orphan phase file removed");
});

test("generated views reflect canonical JSON (ordering, checklist, subtasks)", async () => {
  const { planRoot, store } = await createPlannerFixture({ name: "render-consistent", seed: "full" });
  const phase = (await store.loadAllPhases()).find((p) => p.tasks.length >= 2);
  // make the state interesting: toggle a checklist item and reorder a task
  await store.updatePhase(phase.id, (p) => {
    const t = p.tasks[0];
    const items = [];
    items.push(addChecklistItem(items, t.id, "Alpha"));
    items.push(addChecklistItem(items, t.id, "Beta"));
    toggleChecklistItem(items, "C2", true);
    t.checklist = items;
    return p;
  });
  const written = await store.writeGenerated();
  assert.ok(written.length >= 1, "writeGenerated wrote files");

  const genDir = join(planRoot, ".local", "generated");
  const phaseMd = await readFile(join(genDir, "phases", `${phase.id}.md`), "utf-8");
  assert.match(phaseMd, /## Tasks/);
  assert.match(phaseMd, /Alpha/);
  assert.match(phaseMd, /- \[x\] Beta/, "checked checklist item rendered as [x]");
  assert.match(phaseMd, /- \[ \] Alpha/);

  // canonical JSON (loadAllPhases) agrees with the rendered order: first task
  // in the markdown is the first task in canonical order
  const reopened = reopen(planRoot);
  const after = (await reopened.loadAllPhases()).find((p) => p.id === phase.id);
  const firstTask = canonicalOrder(after.tasks)[0];
  assert.match(phaseMd, new RegExp(`### .*${firstTask.id}`), "rendered phase starts with the canonical first task");
});
