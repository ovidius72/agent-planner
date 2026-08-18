/**
 * T234 (P054/F015) — Server handoff and archive endpoints.
 *
 * Exercises the real Hono server (packages/plan-server) through the T232
 * harness with real PlanStore + real filesystem:
 *  - GET/PUT/DELETE /phases/:id/handoff lifecycle (write, read, replace,
 *    clear) with entity-scoped phase.handoff persistence
 *  - active GET /handoffs: pending reads, composite refs, newest-first,
 *    stale completed-phase auto-archive, empty states
 *  - GET /handoffs/archive: write-replacement (superseded) + clear (manual)
 *    + phase-done archival, metadata/content/file mapping, newest-first,
 *    empty states
 *  - archived content is NEVER exposed through the active endpoint
 *  - terminal-phase rejection (done/canceled cannot receive a handoff)
 *  - invalid paths (unknown phase, malformed JSON) per server contract
 *  - persistence across a second server on the same planRoot
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const handoffPut = (content) => put(typeof content === "string" ? { content } : content);

// ── Empty states ───────────────────────────────────────────────────────────

test("empty states: no handoffs, no archive, phase without handoff", async () => {
  const fx = await startServerFixture({ name: "t234-empty" });
  const phases = (await request(fx, "/phases")).body;

  assert.deepEqual((await request(fx, "/handoffs")).body, { handoffs: [] });
  assert.deepEqual((await request(fx, "/handoffs/archive")).body, { archived: [] });

  const seed = phases[0];
  const h = await request(fx, `/phases/${seed.id}/handoff`);
  assert.equal(h.body.content, "");
  assert.equal(h.body.updatedAt, "");
});

// ── Write / read round trip + active list + composite refs ────────────────

test("handoff write → read round trip; active /handoffs lists pending with composite refs", async () => {
  const fx = await startServerFixture({ name: "t234-write-read" });
  const feature = (await request(fx, "/features")).body[0];
  const phase = (await request(fx, "/phases")).body[0];
  const content = "P001 — continue work\n\nDetails about the next steps.";

  const written = await request(fx, `/phases/${phase.id}/handoff`, handoffPut(content));
  assert.equal(written.body.content, content);
  assert.ok(written.body.updatedAt, "updatedAt stamped");
  assert.match(written.body.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  const read = await request(fx, `/phases/${phase.id}/handoff`);
  assert.equal(read.body.content, content);
  assert.equal(read.body.updatedAt, written.body.updatedAt);

  const list = (await request(fx, "/handoffs")).body.handoffs;
  assert.equal(list.length, 1);
  const entry = list[0];
  assert.equal(entry.phaseId, phase.id);
  assert.equal(entry.featureId, feature.id);
  assert.match(entry.compositeRef, /^P\d{3}\(F\d{3}\)$/, "composite phase ref with feature number");
  assert.equal(entry.firstLine, "P001 — continue work");
  assert.equal(entry.content, content, "active endpoint returns the pending content");
  assert.equal(entry.updatedAt, written.body.updatedAt);
});

// ── Write replacement archival (superseded) ────────────────────────────────

test("replacing a handoff archives the previous content as superseded; archive never leaks into active", async () => {
  const fx = await startServerFixture({ name: "t234-superseded" });
  const phase = (await request(fx, "/phases")).body[0];

  await request(fx, `/phases/${phase.id}/handoff`, handoffPut("v1 — first draft"));
  await sleep(5);
  const v2 = await request(fx, `/phases/${phase.id}/handoff`, handoffPut("v2 — replacement"));

  // active endpoint only exposes the CURRENT content
  const read = await request(fx, `/phases/${phase.id}/handoff`);
  assert.equal(read.body.content, "v2 — replacement");
  const active = (await request(fx, "/handoffs")).body.handoffs;
  assert.equal(active.length, 1);
  assert.equal(active[0].content, "v2 — replacement");
  assert.ok(!active[0].content.includes("v1"), "archived content never exposed through active list");

  // archive has exactly one entry: the superseded v1
  const archived = (await request(fx, "/handoffs/archive")).body.archived;
  assert.equal(archived.length, 1);
  const entry = archived[0];
  assert.equal(entry.reason, "superseded");
  assert.equal(entry.content, "v1 — first draft");
  assert.equal(entry.phaseId, phase.id);
  assert.match(entry.compositeRef, /^P\d{3}\(F\d{3}\)$/);
  assert.equal(entry.firstLine, "v1 — first draft");
  assert.ok(entry.archivedAt, "archivedAt stamped");
  assert.match(entry.file, /^handoff-archive\/.+\.md$/, "archive file mapping");

  // archived file physically exists under .planner/.local/handoff-archive/
  const fileName = entry.file.replace("handoff-archive/", "");
  assert.ok(existsSync(join(fx.planRoot, ".local", "handoff-archive", fileName)), "archive file on disk");
});

// ── Clear archival (DELETE) + empty PUT = clear equivalent ─────────────────

test("DELETE clears and archives with reason manual; empty PUT behaves as clear", async () => {
  const fx = await startServerFixture({ name: "t234-clear" });
  const phase = (await request(fx, "/phases")).body[0];

  await request(fx, `/phases/${phase.id}/handoff`, handoffPut("to be cleared"));
  const cleared = await request(fx, `/phases/${phase.id}/handoff`, { method: "DELETE" });
  assert.deepEqual(cleared.body, { cleared: true });

  const read = await request(fx, `/phases/${phase.id}/handoff`);
  assert.equal(read.body.content, "");
  assert.deepEqual((await request(fx, "/handoffs")).body, { handoffs: [] });

  let archived = (await request(fx, "/handoffs/archive")).body.archived;
  assert.equal(archived.length, 1);
  assert.equal(archived[0].reason, "manual");
  assert.equal(archived[0].content, "to be cleared");

  // empty PUT (whitespace) = clear equivalent
  await request(fx, `/phases/${phase.id}/handoff`, handoffPut("one more"));
  const emptyPut = await request(fx, `/phases/${phase.id}/handoff`, handoffPut("   \n  "));
  assert.deepEqual(emptyPut.body, { cleared: true });
  assert.equal((await request(fx, `/phases/${phase.id}/handoff`)).body.content, "");
  archived = (await request(fx, "/handoffs/archive")).body.archived;
  assert.equal(archived.length, 2);
  assert.equal(archived[0].reason, "manual");
});

// ── Terminal-phase rejection + stale completed-phase cleanup ───────────────
// NOTE: phase status is DERIVED from tasks (not persisted). The only terminal
// state reachable via real HTTP+files is derived "done" (ALL tasks done).
// "canceled" is never emitted by derivePhaseStatus, so the canceled branch of
// the handoff guard is unreachable through this contract (see report).

test("derived-done phases reject new handoffs; stale pending handoffs auto-archive as phase-done", async () => {
  const fx = await startServerFixture({ name: "t234-terminal" });
  const feature = (await request(fx, "/features")).body[0];

  // Phase 1 (seed, has 1 planned task): pending handoff, then complete the task
  const p1 = (await request(fx, "/phases")).body[0];
  const task1 = p1.tasks[0];
  await request(fx, `/phases/${p1.id}/handoff`, handoffPut("stale pending handoff"));
  // done transitions require feature governance (discussedAt/contextReady)
  await request(fx, `/features/${feature.id}`, put({ ...feature, discussedAt: "2026-01-01T00:00:00.000Z" }));
  await request(fx, `/tasks/${task1.id}`, put({ phaseId: p1.id, status: "done" }));
  const p1Done = await request(fx, `/phases/${p1.id}`);
  assert.equal(p1Done.body.status, "done", "phase derives done once all tasks are done");

  // Terminal rejection: writing a NEW handoff on a done phase → 404 handler contract
  const errDone = await expectError(fx, `/phases/${p1.id}/handoff`, handoffPut("late"), { status: 404 });
  assert.match(errDone.message, /Cannot write a handoff on done phase/);

  // Phase 2 (fresh): pending handoff, then complete it too
  const p2 = await request(fx, "/phases", { ...json({ title: "Second", featureId: feature.id }), expectStatus: 201 });
  const t2 = await request(fx, `/phases/${p2.body.id}/tasks`, { ...json({ title: "t2" }), expectStatus: 201 });
  await request(fx, `/phases/${p2.body.id}/handoff`, handoffPut("second stale handoff"));
  await request(fx, `/tasks/${t2.body.id}`, put({ phaseId: p2.body.id, status: "done" }));

  // Stale cleanup: GET /handoffs auto-archives stale pending handoffs (phase-done)
  const active = (await request(fx, "/handoffs")).body.handoffs;
  assert.deepEqual(active, [], "completed phases never appear in active handoffs");
  const archived = (await request(fx, "/handoffs/archive")).body.archived;
  const reasons = archived.map((a) => a.reason);
  assert.equal(reasons.filter((r) => r === "phase-done").length, 2, "both stale handoffs archived as phase-done");
  const contents = archived.map((a) => a.content);
  assert.ok(contents.includes("stale pending handoff"));
  assert.ok(contents.includes("second stale handoff"));
});

// ── Phase-status writes are NOT persisted (derived status is the truth) ────
// Pins the public contract: PUT /phases/:id echoing status returns 200 but the
// stored status is derived from tasks, so a taskless phase stays "draft" and
// can still receive a handoff. Reported to review as a design observation.

test("taskless phase PUT status canceled is echoed but not persisted (derived draft); handoff write still allowed", async () => {
  const fx = await startServerFixture({ name: "t234-noterm-canceled" });
  const feature = (await request(fx, "/features")).body[0];
  const p = await request(fx, "/phases", { ...json({ title: "No tasks", featureId: feature.id }), expectStatus: 201 });

  const echoed = await request(fx, `/phases/${p.body.id}`, put({ ...p.body, status: "canceled" }));
  assert.equal(echoed.status, 200);
  assert.equal(echoed.body.status, "canceled", "PUT echoes the requested status");
  const derived = await request(fx, `/phases/${p.body.id}`);
  assert.notEqual(derived.body.status, "canceled", "status is derived, not persisted");
  assert.equal(derived.body.status, "draft");

  // not terminal → handoff write is allowed
  const ok = await request(fx, `/phases/${p.body.id}/handoff`, handoffPut("still active"));
  assert.equal(ok.body.content, "still active");
});

// ── Newest-first ordering ──────────────────────────────────────────────────

test("active list and archive are newest-first by timestamp", async () => {
  const fx = await startServerFixture({ name: "t234-ordering" });
  const feature = (await request(fx, "/features")).body[0];
  const p1 = (await request(fx, "/phases")).body[0];
  const p2 = await request(fx, "/phases", { ...json({ title: "Second phase", featureId: feature.id }), expectStatus: 201 });

  await request(fx, `/phases/${p1.id}/handoff`, handoffPut("older"));
  await sleep(5);
  await request(fx, `/phases/${p2.body.id}/handoff`, handoffPut("newer"));

  const active = (await request(fx, "/handoffs")).body.handoffs;
  assert.equal(active.length, 2);
  assert.equal(active[0].phaseId, p2.body.id, "newest first in active list");
  assert.equal(active[1].phaseId, p1.id);

  // clear both (A then B) → archive newest-first by archivedAt
  await request(fx, `/phases/${p1.id}/handoff`, { method: "DELETE" });
  await sleep(5);
  await request(fx, `/phases/${p2.body.id}/handoff`, { method: "DELETE" });

  const archived = (await request(fx, "/handoffs/archive")).body.archived;
  assert.equal(archived.length, 2);
  assert.equal(archived[0].phaseId, p2.body.id, "newest first in archive");
  assert.equal(archived[1].phaseId, p1.id);
});

// ── Invalid paths ──────────────────────────────────────────────────────────

test("invalid paths: unknown phase 404 on GET/PUT/DELETE, malformed JSON PUT = clear", async () => {
  const fx = await startServerFixture({ name: "t234-invalid" });
  const phase = (await request(fx, "/phases")).body[0];
  const unknown = "00000000-0000-4000-8000-000000000000";

  await request(fx, `/phases/${unknown}/handoff`, { expectStatus: 404 });
  const errGet = await expectError(fx, `/phases/${unknown}/handoff`, {}, { status: 404 });
  assert.equal(errGet.message.includes("phase not found"), true);

  await request(fx, `/phases/${unknown}/handoff`, { ...handoffPut("x"), expectStatus: 404 });
  await request(fx, `/phases/${unknown}/handoff`, { method: "DELETE", expectStatus: 404 });

  // malformed JSON body on PUT = treated as empty content = clear equivalent
  await request(fx, `/phases/${phase.id}/handoff`, handoffPut("gone soon"));
  const bad = await request(fx, `/phases/${phase.id}/handoff`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
    expectStatus: 200,
  });
  assert.deepEqual(bad.body, { cleared: true });
  assert.equal((await request(fx, `/phases/${phase.id}/handoff`)).body.content, "");
  // the cleared content was archived (manual), not lost
  const archived = (await request(fx, "/handoffs/archive")).body.archived;
  assert.ok(archived.some((a) => a.reason === "manual" && a.content === "gone soon"));
});

// ── Persistence across restart ─────────────────────────────────────────────

test("handoff + archive persist across a second server on the same planRoot", async () => {
  const fx = await startServerFixture({ name: "t234-restart" });
  const phase = (await request(fx, "/phases")).body[0];
  await request(fx, `/phases/${phase.id}/handoff`, handoffPut("v1 — to be superseded"));
  await sleep(5);
  await request(fx, `/phases/${phase.id}/handoff`, handoffPut("v2 — current"));

  const planRoot = fx.planRoot;
  await closeServerFixture(fx);

  const fx2 = await startServerFixture({ name: "t234-restart", serveOptions: { planRoot } });
  const read = await request(fx2, `/phases/${phase.id}/handoff`);
  assert.equal(read.body.content, "v2 — current", "active handoff survived restart");
  const active = (await request(fx2, "/handoffs")).body.handoffs;
  assert.equal(active.length, 1);
  assert.equal(active[0].content, "v2 — current");
  const archived = (await request(fx2, "/handoffs/archive")).body.archived;
  assert.equal(archived.length, 1);
  assert.equal(archived[0].reason, "superseded");
  assert.equal(archived[0].content, "v1 — to be superseded");
});
