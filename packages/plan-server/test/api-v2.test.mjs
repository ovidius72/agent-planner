/**
 * API v2 — the agent working surface (P128(F025)/T490).
 *
 * The versioned HTTP surface runs the same handoff application flows the
 * MCP tools run (plan-core handoff-flow.ts), wrapped in the v2 envelope.
 * Real HTTP, real PlanStore, real .planner/ files on isolated mkdtemp
 * fixtures; never another real project (AGENTS.md rule 17).
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
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

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const del = { method: "DELETE" };
const BODY = "## Recap\n\nWork stopped at the route boundary.\n\n## Verification\n\nFocused suites green.";

test("discovery advertises the protocol, boot identity and family links", async () => {
  const fx = await startServerFixture({ name: "v2-discovery" });
  try {
    const body = (await request(fx, "/api/v2")).body;
    assert.equal(body.apiVersion, "2");
    assert.equal(body.data.protocolVersion, "1");
    assert.match(body.data.bootId, /^[0-9a-f-]{36}$/);
    assert.ok(body.data.families.handoffs.prepare.startsWith("GET /api/v2/phases/"));
  } finally {
    await closeServerFixture(fx);
  }
});

test("handoff family: prepare → confirmed write → show → verify → clear", async () => {
  const fx = await startServerFixture({ name: "v2-handoff" });
  const base = "/api/v2/phases/P001/handoff";
  try {
    // Empty show before anything is written.
    const empty = (await request(fx, base)).body;
    assert.equal(empty.data.empty, true);
    assert.equal(empty.data.phaseRef, "P001(F001)");

    const prepare = (await request(fx, `${base}/prepare`)).body;
    assert.equal(prepare.apiVersion, "2");
    assert.ok(prepare.data.draftTemplate, "prepare carries the draft template");
    const token = prepare.data.expectedHandoffUpdatedAt ?? prepare.data.currentHandoffUpdatedAt ?? "";
    assert.equal(typeof token, "string");

    // Admission contract: unconfirmed → 409; missing token → 409.
    const unconfirmed = await expectError(fx, base, json({ confirmed: false, reason: "stopping", content: BODY, expectedHandoffUpdatedAt: token }), { status: 409 });
    assert.match(unconfirmed.message, /HANDOFF_CONFIRMATION_REQUIRED/);

    const missingToken = await expectError(fx, base, json({ confirmed: true, reason: "stopping", content: BODY }), { status: 409 });
    assert.match(missingToken.message, /HANDOFF_PREFLIGHT_REQUIRED/);

    const write = (await request(fx, base, json({
      confirmed: true,
      reason: "Session boundary: context was getting long.",
      content: BODY,
      title: "Route clients through the authority",
      expectedHandoffUpdatedAt: token,
      taskUpdates: [{
        taskRef: "P001/T001",
        completionSummary: "Loopback binding shipped.",
        verification: "Focused suites green.",
        remainingWork: "Client conversion.",
      }],
      phaseNoUpdateReason: "Phase progress unchanged this session.",
      featureNoUpdateReason: "Feature scope unchanged this session.",
    }))).body;
    assert.equal(write.apiVersion, "2");
    assert.equal(write.data.persisted, true);
    assert.equal(write.data.resumeReady, false);
    assert.equal(write.data.verificationRequired, true);
    assert.deepEqual(write.data.updatedTaskIds.length, 1);

    // The title heading was applied to the submitted body.
    const show = (await request(fx, base)).body;
    assert.equal(show.data.resumeReady, false);
    assert.match(show.data.content, /# Route clients through the authority/);
    const contentHash = show.data.contentHash;
    assert.match(contentHash, /^[a-f0-9]{64}$/);

    const staleVerify = await expectError(fx, `${base}/verify`, json({ expectedContentHash: "0".repeat(64) }), { status: 409 });
    assert.match(staleVerify.message, /HANDOFF_READBACK_VERIFICATION_REQUIRED/);

    const verified = (await request(fx, `${base}/verify`, json({ expectedContentHash: contentHash }))).body;
    assert.equal(verified.data.resumeReady, true);
    assert.equal(verified.data.verificationRequired, false);

    const cleared = (await request(fx, base, del)).body;
    assert.equal(cleared.data.cleared, true);
    assert.equal(cleared.data.phaseRef, "P001(F001)");
    const afterClear = (await request(fx, base)).body;
    assert.equal(afterClear.data.empty, true);
  } finally {
    await closeServerFixture(fx);
  }
});

test("handoff refusals map to typed v2 error codes", async () => {
  const fx = await startServerFixture({ name: "v2-refusals" });
  try {
    const missing = await expectError(fx, "/api/v2/phases/P404/handoff", del, { status: 404 });
    assert.match(missing.message, /PHASE_NOT_FOUND/);

    const noBody = await expectError(fx, "/api/v2/phases/P001/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }, { status: 400 });
    assert.match(noBody.message, /INVALID_BODY/);

    const badHash = await expectError(fx, "/api/v2/phases/P001/handoff/verify", json({ expectedContentHash: "short" }), { status: 422 });
    assert.match(badHash.message, /EXPECTED_CONTENT_HASH_INVALID/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("list and recommend answer with the v2 envelope", async () => {
  const fx = await startServerFixture({ name: "v2-list-recommend" });
  const base = "/api/v2/phases/P001/handoff";
  try {
    const prepare = (await request(fx, `${base}/prepare`)).body;
    const token = prepare.data.expectedHandoffUpdatedAt ?? prepare.data.currentHandoffUpdatedAt ?? "";
    await request(fx, base, json({
      confirmed: true,
      reason: "Listing fixture handoff.",
      content: BODY,
      title: "List fixture handoff",
      expectedHandoffUpdatedAt: token,
      phaseNoUpdateReason: "Phase progress unchanged this session.",
      featureNoUpdateReason: "Feature scope unchanged this session.",
    }));

    const list = (await request(fx, "/api/v2/handoffs?page=1&pageSize=10")).body;
    assert.equal(list.apiVersion, "2");
    assert.equal(list.data.total, 1);
    assert.equal(list.data.items[0].compositeRef, "P001(F001)");
    assert.equal(list.data.items[0].resumeReady, false);
    assert.ok(!("content" in list.data.items[0]), "list summaries stay bounded");

    const recommend = (await request(fx, "/api/v2/recommend")).body;
    assert.equal(recommend.apiVersion, "2");
    assert.equal(recommend.data.selection.kind, "priority");
    assert.ok(recommend.data.selection.candidate, "the planned task is recommended");
  } finally {
    await closeServerFixture(fx);
  }
});
