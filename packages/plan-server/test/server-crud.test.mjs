/**
 * T233 (P054/F015) — Server CRUD and validation endpoints.
 *
 * Exercises the real Hono server (packages/plan-server) through the T232
 * harness with real PlanStore + real filesystem:
 *  - feature / phase / task / requirement CRUD with success codes and
 *    normalized composite references (T001(P001/F001) - Title labels)
 *  - validation failures with stable error payloads (400/404)
 *  - governance gates (discuss/contextReady) on feature/phase/task
 *  - motivation requirement on restricted task status transitions
 *  - reorder (feature/phase/task) and invalid-kind rejection
 *  - export / integrity / repair endpoints
 *  - atomicity: rejected writes leave the plan byte-identical (no partial
 *    writes), malformed JSON and unsupported methods fail per contract
 *  - persistence across a second server started on the same planRoot
 *
 * No mocks: real HTTP, real PlanStore, real .planner/ files.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  startServerFixture,
  closeServerFixture,
  cleanupServerFixtures,
  request,
  expectError,
} from "../../../test/helpers/server-fixture.mjs";

after(async () => {
  await cleanupServerFixtures();
});

/** Body for JSON mutations; callers add expectStatus into the SAME object. */
const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const put = (body) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Make the seed feature governance-ready (discussedAt set) via HTTP. */
async function makeFeatureReady(fx, feature) {
  await request(fx, `/features/${feature.id}`, {
    ...put({ ...feature, discussedAt: "2026-01-01T00:00:00.000Z" }),
  });
}

// ── Feature CRUD ──────────────────────────────────────────────────────────

test("feature CRUD: create 201 with refs, list, rename, delete, missing 404", async () => {
  const fx = await startServerFixture({ name: "t233-feature-crud" });

  const created = await request(fx, "/features", { ...json({ name: "Checkout", description: "Payments flow" }), expectStatus: 201 });
  assert.ok(created.body.id);
  assert.equal(created.body.number, 2, "numbered after the minimal-seed feature");
  assert.match(created.body.shortId, /^[A-Z2-9]{5}$/);
  assert.equal(created.body.description, "Payments flow");

  const list = await request(fx, "/features");
  assert.equal(list.body.length, 2);
  const byId = await request(fx, `/features/${created.body.id}`);
  assert.equal(byId.body.name, "Checkout");

  const renamed = await request(fx, `/features/${created.body.id}`, put({ ...created.body, name: "Checkout v2" }));
  assert.equal(renamed.body.name, "Checkout v2");

  // id mismatch → 400 (no write)
  await request(fx, `/features/${created.body.id}`, {
    ...put({ ...created.body, id: "00000000-0000-4000-8000-000000000000" }),
    expectStatus: 400,
  });

  const deleted = await request(fx, `/features/${created.body.id}`, { method: "DELETE" });
  assert.deepEqual(deleted.body, { deleted: created.body.id });
  await request(fx, `/features/${created.body.id}`, { expectStatus: 404 });
});

test("feature governance gate: in-progress requires discussedAt/contextReady", async () => {
  const fx = await startServerFixture({ name: "t233-feature-gov" });
  const feature = (await request(fx, "/features")).body[0];
  assert.equal(feature.discussedAt, "", "seed feature is not governance-ready");

  await request(fx, `/features/${feature.id}`, {
    ...put({ ...feature, status: "in-progress" }),
    expectStatus: 400,
  });
  // no partial write: status still derived (planned)
  const after = await request(fx, `/features/${feature.id}`);
  assert.equal(after.body.status, "planned");
});

// ── Phase CRUD ────────────────────────────────────────────────────────────

test("phase CRUD: create 201 (slug/number), list, rename, delete, missing 404", async () => {
  const fx = await startServerFixture({ name: "t233-phase-crud" });
  const feature = (await request(fx, "/features")).body[0];

  const created = await request(fx, "/phases", { ...json({ title: "Phase Two", featureId: feature.id, summary: "s" }), expectStatus: 201 });
  assert.equal(created.body.number, 2);
  assert.equal(created.body.slug, "phase-two");
  assert.equal(created.body.featureId, feature.id);
  assert.match(created.body.shortId, /^[A-Z2-9]{5}$/);
  assert.equal(created.body.status, "draft");

  const phases = await request(fx, "/phases");
  assert.equal(phases.body.length, 2);

  const renamed = await request(fx, `/phases/${created.body.id}`, put({ ...created.body, title: "Phase Two Renamed" }));
  assert.equal(renamed.body.title, "Phase Two Renamed");

  await request(fx, `/phases/${created.body.id}`, {
    ...put({ ...created.body, id: "00000000-0000-4000-8000-000000000000" }),
    expectStatus: 400,
  });
  await request(fx, "/phases/00000000-0000-4000-8000-000000000000", { expectStatus: 404 });

  const deleted = await request(fx, `/phases/${created.body.id}`, { method: "DELETE" });
  assert.deepEqual(deleted.body, { deleted: created.body.id });
  await request(fx, `/phases/${created.body.id}`, { expectStatus: 404 });
  // feature's phaseIds pruned of the deleted phase (seed phase still linked)
  const featureAfter = await request(fx, `/features/${feature.id}`);
  assert.equal(featureAfter.body.phaseIds.length, 1);
  assert.ok(!featureAfter.body.phaseIds.includes(created.body.id), "deleted phase pruned from feature.phaseIds");
});

test("phase create validation: title and featureId required, governance gate on status", async () => {
  const fx = await startServerFixture({ name: "t233-phase-validate" });
  await request(fx, "/phases", { ...json({}), expectStatus: 400 });
  const err = await expectError(fx, "/phases", json({}), { status: 400 });
  assert.match(err.message, /title required/);

  await request(fx, "/phases", { ...json({ title: "No feature" }), expectStatus: 400 });
  const err2 = await expectError(fx, "/phases", json({ title: "No feature" }), { status: 400 });
  assert.match(err2.message, /featureId required/);

  // governance gate on PUT: fresh phase → in-progress without discuss → 400
  const feature = (await request(fx, "/features")).body[0];
  const phase = await request(fx, "/phases", { ...json({ title: "Gov", featureId: feature.id }), expectStatus: 201 });
  await request(fx, `/phases/${phase.body.id}`, {
    ...put({ ...phase.body, status: "in-progress" }),
    expectStatus: 400,
  });
});

// ── Task CRUD + composite refs ─────────────────────────────────────────────

test("task create: 201 with global composite label and checklist transform", async () => {
  const fx = await startServerFixture({ name: "t233-task-create" });
  const feature = (await request(fx, "/features")).body[0];
  // The fixture already has T001; a task in a new phase receives global T002.
  const phase = await request(fx, "/phases", { ...json({ title: "Clean", featureId: feature.id }), expectStatus: 201 });

  const t1 = await request(fx, `/phases/${phase.body.id}/tasks`, {
    ...json({
      title: "Write tests",
      description: "d",
      checklist: ["  Add route  ", "", "   ", "Write tests"],
    }),
    expectStatus: 201,
  });
  assert.equal(t1.body.number, 2);
  const pnum = String(phase.body.number).padStart(3, "0");
  assert.equal(t1.body.label, `T002(P${pnum}/F001) - Write tests`, "normalized composite label");
  assert.equal(t1.body.checklist.length, 2, "empty/whitespace items filtered, titles trimmed");
  assert.deepEqual(t1.body.checklist.map((c) => c.title), ["Add route", "Write tests"]);
  assert.equal(t1.body.checklist[0].number, 1);
  assert.equal(t1.body.checklist[0].checked, false);

  const t2 = await request(fx, `/phases/${phase.body.id}/tasks`, { ...json({ title: "Run them" }), expectStatus: 201 });
  assert.equal(t2.body.number, 3);
  assert.equal(t2.body.label, `T003(P${pnum}/F001) - Run them`);
});

test("task create validation: title/phase/status governance", async () => {
  const fx = await startServerFixture({ name: "t233-task-validate" });
  const phase = (await request(fx, "/phases")).body[0];

  await request(fx, `/phases/${phase.id}/tasks`, { ...json({}), expectStatus: 400 });
  const err = await expectError(fx, `/phases/${phase.id}/tasks`, json({}), { status: 400 });
  assert.match(err.message, /title required/);

  await request(fx, "/phases/00000000-0000-4000-8000-000000000000/tasks", { ...json({ title: "x" }), expectStatus: 404 });

  // feature not governance-ready → in-progress rejected
  await request(fx, `/phases/${phase.id}/tasks`, { ...json({ title: "Start now", status: "in-progress" }), expectStatus: 400 });
  const err2 = await expectError(fx, `/phases/${phase.id}/tasks`, json({ title: "Start now", status: "in-progress" }), { status: 400 });
  assert.match(err2.message, /governance required/);
});

test("task update: rename, motivation gate on restricted transitions, statusLog + lifecycle dates", async () => {
  const fx = await startServerFixture({ name: "t233-task-update" });
  const feature = (await request(fx, "/features")).body[0];
  await makeFeatureReady(fx, feature); // allow governed transitions
  const phase = (await request(fx, "/phases")).body[0];
  const task = await request(fx, `/phases/${phase.id}/tasks`, { ...json({ title: "Update me" }), expectStatus: 201 });

  const renamed = await request(fx, `/tasks/${task.body.id}`, put({ phaseId: phase.id, title: "Updated title" }));
  assert.equal(renamed.body.title, "Updated title");

  // blocked (restricted) without motivation → 400, no write
  await request(fx, `/tasks/${task.body.id}`, {
    ...put({ phaseId: phase.id, status: "blocked" }),
    expectStatus: 400,
  });
  // in-progress (not restricted) → 200, sets startedAt
  const started = await request(fx, `/tasks/${task.body.id}`, put({ phaseId: phase.id, status: "in-progress" }));
  assert.ok(started.body.startedAt);
  assert.equal(started.body.statusLog.length, 1, "statusLog entry appended");
  assert.equal(started.body.statusLog[0].title, "planned → in-progress");

  // done → completedAt; blocked from done → motivation required
  const done = await request(fx, `/tasks/${task.body.id}`, put({ phaseId: phase.id, status: "done" }));
  assert.ok(done.body.completedAt);
  await request(fx, `/tasks/${task.body.id}`, {
    ...put({ phaseId: phase.id, status: "blocked" }),
    expectStatus: 400,
  });
  const blocked = await request(fx, `/tasks/${task.body.id}`, put({
    phaseId: phase.id, status: "blocked", motivation: "Waiting on reviewer",
  }));
  assert.equal(blocked.body.status, "blocked");
  assert.equal(blocked.body.statusLog.length, 3, "planned→in-progress, in-progress→done, done→blocked");
  assert.equal(blocked.body.statusLog.at(-1).title, "Waiting on reviewer");
});

test("task update validation: phaseId required, unknown phase/task 404", async () => {
  const fx = await startServerFixture({ name: "t233-task-update-validate" });
  const phase = (await request(fx, "/phases")).body[0];
  const task = await request(fx, `/phases/${phase.id}/tasks`, { ...json({ title: "T" }), expectStatus: 201 });

  await request(fx, `/tasks/${task.body.id}`, { ...put({}), expectStatus: 400 });
  const err = await expectError(fx, `/tasks/${task.body.id}`, put({}), { status: 400 });
  assert.match(err.message, /phaseId required/);

  // unknown phaseId → handler-level 404 with stable payload, NOT a route/method 404
  const unknownPhase = "00000000-0000-4000-8000-000000000000";
  await request(fx, `/tasks/${task.body.id}`, { ...put({ phaseId: unknownPhase }), expectStatus: 404 });
  const errPhase = await expectError(fx, `/tasks/${task.body.id}`, put({ phaseId: unknownPhase }), { status: 404 });
  assert.match(errPhase.message, /phase not found/, "stable handler error payload");
  const rawPhase = await fetch(fx.handle.url + `/tasks/${task.body.id}`, { ...put({ phaseId: unknownPhase }) });
  assert.equal(rawPhase.status, 404);
  assert.deepEqual(await rawPhase.json(), { error: "phase not found" });
  // task unchanged (no partial write)
  const after = await request(fx, `/tasks/${task.body.id}`);
  assert.equal(after.body.title, "T");

  // unknown task on a valid phase → handler-level 404
  await request(fx, `/tasks/${unknownPhase}`, { ...put({ phaseId: phase.id }), expectStatus: 404 });
  const errTask = await expectError(fx, `/tasks/${unknownPhase}`, put({ phaseId: phase.id }), { status: 404 });
  assert.match(errTask.message, /task not found/, "stable handler error payload");
  const rawTask = await fetch(fx.handle.url + `/tasks/${unknownPhase}`, { ...put({ phaseId: phase.id }) });
  assert.equal(rawTask.status, 404);
  assert.deepEqual(await rawTask.json(), { error: "task not found" });
});

test("task delete + /tasks/active reflects in-progress only", async () => {
  const fx = await startServerFixture({ name: "t233-task-active" });
  const feature = (await request(fx, "/features")).body[0];
  await makeFeatureReady(fx, feature);
  const phase = (await request(fx, "/phases")).body[0];

  const active = await request(fx, `/phases/${phase.id}/tasks`, { ...json({ title: "Active work", status: "in-progress" }), expectStatus: 201 });
  const planned = await request(fx, `/phases/${phase.id}/tasks`, { ...json({ title: "Later" }), expectStatus: 201 });

  let tasks = await request(fx, "/tasks/active");
  assert.equal(tasks.body.length, 1);
  assert.equal(tasks.body[0].id, active.body.id);
  assert.equal(tasks.body[0].featureNumber, 1);
  assert.equal(tasks.body[0].phaseNumber, 1);
  assert.equal(tasks.body[0].shortId, active.body.shortId, "active header can render the task shortId");

  // complete → leaves active list
  await request(fx, `/tasks/${active.body.id}`, put({ phaseId: phase.id, status: "done" }));
  tasks = await request(fx, "/tasks/active");
  assert.equal(tasks.body.length, 0);

  // delete planned task → 404 afterwards
  const deleted = await request(fx, `/tasks/${planned.body.id}`, { method: "DELETE" });
  assert.deepEqual(deleted.body, { deleted: planned.body.id });
  await request(fx, `/tasks/${planned.body.id}`, { expectStatus: 404 });
});

// ── Requirements ──────────────────────────────────────────────────────────

test("requirement CRUD: create with phase ref resolution, update, delete, validation", async () => {
  const fx = await startServerFixture({ name: "t233-req-crud" });
  const phase = (await request(fx, "/phases")).body[0];
  const now = "2026-01-01T00:00:00.000Z";

  const created = await request(fx, "/requirements", {
    ...json({
      id: crypto.randomUUID(), title: "Auth must work", description: "", status: "planned",
      macroTasks: [], linkedPhaseIds: ["P001"], createdAt: now, updatedAt: now,
    }),
    expectStatus: 201,
  });
  assert.equal(created.body.linkedPhaseIds[0], phase.id, "composite ref P001 resolved to UUID");

  // empty links → 400 (no partial write)
  await request(fx, "/requirements", {
    ...json({
      id: crypto.randomUUID(), title: "Bad", description: "", status: "planned",
      macroTasks: [], linkedPhaseIds: [], createdAt: now, updatedAt: now,
    }),
    expectStatus: 400,
  });

  const renamed = await request(fx, `/requirements/${created.body.id}`, put({ ...created.body, title: "Auth must work well" }));
  assert.equal(renamed.body.title, "Auth must work well");

  const deleted = await request(fx, `/requirements/${created.body.id}`, { method: "DELETE" });
  assert.deepEqual(deleted.body, { deleted: created.body.id });
  await request(fx, `/requirements/${created.body.id}`, { method: "DELETE", expectStatus: 404 });
});

// ── Reorder / export / integrity / repair ─────────────────────────────────

test("reorder: feature/phase/task accepted, invalid kind and missing movedId rejected", async () => {
  const fx = await startServerFixture({ name: "t233-reorder" });
  const feature = (await request(fx, "/features")).body[0];

  const ok = await request(fx, "/reorder", {
    ...json({ kind: "feature", movedId: feature.id, beforeId: null, afterId: null }),
    expectStatus: 200,
  });
  assert.deepEqual(ok.body, { ok: true, kind: "feature", movedId: feature.id });

  await request(fx, "/reorder", { ...json({ kind: "feature" }), expectStatus: 400 });
  const err = await expectError(fx, "/reorder", json({ kind: "feature" }), { status: 400 });
  assert.match(err.message, /movedId required/);

  await request(fx, "/reorder", { ...json({ kind: "bogus", movedId: feature.id }), expectStatus: 400 });
  const err2 = await expectError(fx, "/reorder", json({ kind: "bogus", movedId: feature.id }), { status: 400 });
  assert.match(err2.message, /invalid kind/);

  // task reorder on the seed phase
  const phase = (await request(fx, "/phases")).body[0];
  const task = await request(fx, `/phases/${phase.id}/tasks`, { ...json({ title: "Reorder me" }), expectStatus: 201 });
  const taskOk = await request(fx, "/reorder", json({ kind: "task", movedId: task.body.id, beforeId: null, afterId: null }));
  assert.equal(taskOk.body.ok, true);
});

test("export, integrity and repair endpoints", async () => {
  const fx = await startServerFixture({ name: "t233-export-repair" });

  const exported = await request(fx, "/export");
  assert.equal(exported.body.filePath, "EXPORT.md");
  assert.match(exported.body.markdown, /Auth API/, "export reflects real plan content");
  assert.ok(existsSync(join(fx.planRoot, "EXPORT.md")), "EXPORT.md written to disk");

  const integrity = await request(fx, "/integrity");
  assert.deepEqual(integrity.body, { duplicatePhaseIds: [], danglingPhaseIds: [], duplicateShortIds: [] });

  const repair = await request(fx, "/repair", json({}));
  assert.equal(repair.body.handoffs.archived, 0);
  assert.equal(repair.body.backfill.shortIdsAssigned, 0);
  assert.deepEqual(repair.body.integrity, { duplicatePhaseIds: [], danglingPhaseIds: [], duplicateShortIds: [] });
});

// ── Atomicity + malformed input + methods + persistence ───────────────────

test("atomicity: rejected writes leave plan unchanged; malformed JSON and bad method per contract", async () => {
  const fx = await startServerFixture({ name: "t233-atomic" });
  const feature = (await request(fx, "/features")).body[0];
  const phase = (await request(fx, "/phases")).body[0];

  // snapshot before rejected writes
  const beforeFeature = await request(fx, `/features/${feature.id}`);
  const beforePhase = await request(fx, `/phases/${phase.id}`);

  // rejected feature rename (id mismatch) → unchanged
  await request(fx, `/features/${feature.id}`, {
    ...put({ ...feature, id: "00000000-0000-4000-8000-000000000000", name: "SHOULD NOT LAND" }),
    expectStatus: 400,
  });
  assert.equal((await request(fx, `/features/${feature.id}`)).body.name, beforeFeature.body.name);

  // rejected task status (blocked without motivation) → phase unchanged
  const task = await request(fx, `/phases/${phase.id}/tasks`, { ...json({ title: "Atomic" }), expectStatus: 201 });
  await request(fx, `/tasks/${task.body.id}`, {
    ...put({ phaseId: phase.id, status: "blocked" }),
    expectStatus: 400,
  });
  const afterPhase = await request(fx, `/phases/${phase.id}`);
  const afterTask = afterPhase.body.tasks.find((t) => t.id === task.body.id);
  assert.equal(afterTask.status, "planned", "no partial write on rejected transition");

  // malformed JSON → 500 with stable error payload
  const badJson = await request(fx, "/features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
    expectStatus: 500,
  });
  assert.equal(badJson.body.error, "internal");

  // unsupported method on a GET-only route → Hono 404 text
  const wrongMethod = await request(fx, "/health", { method: "PUT", expectStatus: 404 });
  assert.equal(wrongMethod.body, "404 Not Found");
});

test("delete removes the phase file AND its inline .bak (no resurrect via readJson backup fallback)", async () => {
  const fx = await startServerFixture({ name: "t233-delete-bak" });
  const feature = (await request(fx, "/features")).body[0];
  const created = await request(fx, "/phases", { ...json({ title: "Bak victim", featureId: feature.id }), expectStatus: 201 });
  const id = created.body.id;
  // PUT rename → updatePhase writes the inline phases/<id>.json.bak backup
  await request(fx, `/phases/${id}`, put({ ...created.body, title: "Renamed" }));
  const phaseFile = join(fx.planRoot, "phases", `${id}.json`);
  const bakFile = `${phaseFile}.bak`;
  assert.ok(existsSync(bakFile), "inline .bak exists after updatePhase");

  await request(fx, `/phases/${id}`, { method: "DELETE" });
  assert.equal(existsSync(phaseFile), false, "phase file removed");
  assert.equal(existsSync(bakFile), false, "inline .bak removed with the phase");
  // readJson would otherwise resurrect the phase from the .bak fallback
  await request(fx, `/phases/${id}`, { expectStatus: 404 });
});

test("persistence across restart: a second server on the same planRoot sees the data", async () => {
  const fx = await startServerFixture({ name: "t233-restart" });
  const phase = (await request(fx, "/phases")).body[0];
  const created = await request(fx, "/features", { ...json({ name: "Survives restart" }), expectStatus: 201 });
  const task = await request(fx, `/phases/${phase.id}/tasks`, { ...json({ title: "Persistent task" }), expectStatus: 201 });

  const planRoot = fx.planRoot;
  await closeServerFixture(fx);

  // fresh server on the SAME planRoot
  const fx2 = await startServerFixture({ name: "t233-restart", serveOptions: { planRoot } });
  const features = await request(fx2, "/features");
  assert.ok(features.body.some((f) => f.id === created.body.id), "feature survived restart");
  const phases = await request(fx2, "/phases");
  const phase2 = phases.body.find((p) => p.id === phase.id);
  assert.ok(phase2.tasks.some((t) => t.id === task.body.id), "task survived restart");
  // composite ref stable after restart
  assert.equal(phase2.tasks.find((t) => t.id === task.body.id).title, "Persistent task");
});
