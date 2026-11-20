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
import { readPlanSnapshot } from "../../../test/helpers/fixtures.mjs";
import { mkdir, readdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";

after(async () => {
  await cleanupServerFixtures();
});

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

test("requirements family: create → list → update → delete over the shared flows", async () => {
  const fx = await startServerFixture({ name: "v2-requirements" });
  try {
    const created = (await request(fx, "/api/v2/requirements", json({
      title: "Single coordinated authority",
      description: "Every client routes through one service.",
      linkedPhaseIds: ["P001"],
      macroTasks: [{ title: "Ship v2 envelope", status: "planned" }],
    }))).body;
    assert.equal(created.apiVersion, "2");
    assert.equal(created.data.created, true);
    const requirementId = created.data.requirement.id;
    assert.match(requirementId, /^[0-9a-f-]{36}$/);
    assert.equal(created.data.requirement.linkedPhaseIds.length, 1, "P001 ref resolved to the canonical phase id");
    assert.notEqual(created.data.requirement.linkedPhaseIds[0], "P001");
    assert.equal(created.data.requirement.macroTasks[0].status, "planned");
    assert.match(created.data.requirement.macroTasks[0].id, /^MT-\d{3}$/);

    const list = (await request(fx, "/api/v2/requirements")).body;
    assert.equal(list.apiVersion, "2");
    // The minimal seed already ships one linked requirement; ours joins it.
    assert.equal(list.data.requirements.length, 2);
    assert.equal(list.data.requirements[1].id, requirementId);

    const updated = (await request(fx, `/api/v2/requirements/${requirementId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "One service, many surfaces.",
        macroTasks: [
          { id: created.data.requirement.macroTasks[0].id, title: "Ship v2 envelope", status: "done" },
          { title: "Convert every client", status: "in-progress" },
        ],
      }),
    })).body;
    assert.equal(updated.data.updated, true);
    assert.deepEqual(updated.data.updatedFields, ["description", "macroTasks"]);
    assert.equal(updated.data.requirement.macroTasks.length, 2);
    assert.equal(updated.data.requirement.macroTasks[0].status, "done");
    assert.equal(updated.data.requirement.macroTasks[1].id, "MT-002");

    const deleted = (await request(fx, `/api/v2/requirements/${requirementId}`, del)).body;
    assert.equal(deleted.data.deleted, true);

    const afterDelete = (await request(fx, "/api/v2/requirements")).body;
    assert.deepEqual(afterDelete.data.requirements.map((r) => r.id).includes(requirementId), false);
  } finally {
    await closeServerFixture(fx);
  }
});

test("requirement refusals map to typed v2 error codes", async () => {
  const fx = await startServerFixture({ name: "v2-requirement-refusals" });
  try {
    const unknownPhase = await expectError(fx, "/api/v2/requirements", json({
      title: "Dangling link",
      linkedPhaseIds: ["P999"],
    }), { status: 422 });
    assert.match(unknownPhase.message, /REQUIREMENT_PHASE_LINK_INVALID/);

    const badStatus = await expectError(fx, "/api/v2/requirements", json({
      title: "Bad macro status",
      linkedPhaseIds: ["P001"],
      macroTasks: [{ title: "X", status: "megadrive" }],
    }), { status: 422 });
    assert.match(badStatus.message, /REQUIREMENT_MACRO_TASK_INVALID/);

    const noTitle = await expectError(fx, "/api/v2/requirements", json({ linkedPhaseIds: ["P001"] }), { status: 422 });
    assert.match(noTitle.message, /REQUIREMENT_TITLE_REQUIRED/);

    const noFields = await expectError(fx, "/api/v2/requirements/00000000-0000-4000-8000-000000000000", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, { status: 422 });
    assert.match(noFields.message, /NO_MUTABLE_FIELDS/);

    const missingUpdate = await expectError(fx, "/api/v2/requirements/00000000-0000-4000-8000-000000000000", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Ghost" }),
    }, { status: 404 });
    assert.match(missingUpdate.message, /REQUIREMENT_NOT_FOUND/);

    const missingDelete = await expectError(fx, "/api/v2/requirements/00000000-0000-4000-8000-000000000000", del, { status: 404 });
    assert.match(missingDelete.message, /REQUIREMENT_NOT_FOUND/);

    const noBody = await expectError(fx, "/api/v2/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }, { status: 400 });
    assert.match(noBody.message, /INVALID_BODY/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("accepted-decisions family: list → create → update → delete on one resolved owner", async () => {
  const fx = await startServerFixture({ name: "v2-decisions" });
  try {
    const empty = (await request(fx, "/api/v2/accepted-decisions?targetType=phase&targetRef=P001")).body;
    assert.equal(empty.apiVersion, "2");
    assert.deepEqual(empty.data.decisions, []);
    assert.equal(empty.data.targetRef, "P001(F001)");

    const created = (await request(fx, "/api/v2/accepted-decisions", json({
      targetType: "phase",
      targetRef: "P001",
      title: "Loopback-only by default",
      decision: "The service binds to 127.0.0.1.",
      rationale: "Loopback Origin is evidence; LAN waits for its own task.",
    }))).body;
    assert.equal(created.data.created, true);
    assert.equal(created.data.targetRef, "P001(F001)");
    const decisionId = created.data.acceptedDecision.id;
    assert.match(decisionId, /^[0-9a-f-]{36}$/);

    const listed = (await request(fx, "/api/v2/accepted-decisions?targetType=phase&targetRef=P001")).body;
    assert.equal(listed.data.decisions.length, 1);
    assert.equal(listed.data.decisions[0].id, decisionId);

    const updated = (await request(fx, `/api/v2/accepted-decisions/${decisionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "phase", targetRef: "P001", decision: "Loopback-only, LAN is a separate task." }),
    })).body;
    assert.equal(updated.data.updated, true);
    assert.equal(updated.data.acceptedDecision.decision, "Loopback-only, LAN is a separate task.");

    const unconfirmed = await expectError(fx, `/api/v2/accepted-decisions/${decisionId}?targetType=phase&targetRef=P001`, del, { status: 409 });
    assert.match(unconfirmed.message, /ACCEPTED_DECISION_DELETE_NOT_CONFIRMED/);

    const deleted = (await request(fx, `/api/v2/accepted-decisions/${decisionId}?targetType=phase&targetRef=P001&confirmed=true`, del)).body;
    assert.equal(deleted.data.deleted, true);
    const afterDelete = (await request(fx, "/api/v2/accepted-decisions?targetType=phase&targetRef=P001")).body;
    assert.deepEqual(afterDelete.data.decisions, []);
  } finally {
    await closeServerFixture(fx);
  }
});

test("accepted-decision refusals map to typed v2 error codes", async () => {
  const fx = await startServerFixture({ name: "v2-decision-refusals" });
  try {
    const badType = await expectError(fx, "/api/v2/accepted-decisions?targetType=galaxy", {}, { status: 422 });
    assert.match(badType.message, /ACCEPTED_DECISION_TARGET_TYPE_INVALID/);

    const missingTarget = await expectError(fx, "/api/v2/accepted-decisions?targetType=phase&targetRef=P999", {}, { status: 404 });
    assert.match(missingTarget.message, /ACCEPTED_DECISION_TARGET_NOT_FOUND/);

    const noTitle = await expectError(fx, "/api/v2/accepted-decisions", json({ targetType: "project" }), { status: 422 });
    assert.match(noTitle.message, /ACCEPTED_DECISION_TITLE_REQUIRED/);

    const missingUpdate = await expectError(fx, "/api/v2/accepted-decisions/00000000-0000-4000-8000-000000000000", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "project", title: "Ghost" }),
    }, { status: 404 });
    assert.match(missingUpdate.message, /ACCEPTED_DECISION_NOT_FOUND/);

    const noBody = await expectError(fx, "/api/v2/accepted-decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }, { status: 400 });
    assert.match(noBody.message, /INVALID_BODY/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("tasks family: create under a feature/phase pair, then checklist add → toggle → remove", async () => {
  const fx = await startServerFixture({ name: "v2-tasks" });
  try {
    const created = (await request(fx, "/api/v2/phases/P001/tasks", json({
      feature: "F001",
      title: "Wire clients to the shared service",
      description: "Convert MCP, Pi and CLI call sites to the versioned v2 surface. Current: direct PlanStore construction; desired: HTTP over the loopback service.",
      checklist: ["Inventory call sites", "Swap to v2 client"],
    }))).body;
    assert.equal(created.apiVersion, "2");
    assert.equal(created.data.created, true);
    const taskRef = created.data.taskRef;
    assert.match(taskRef, /^P001\(F001\)\/T\d{3}$/);
    assert.notEqual(taskRef, "P001(F001)/T001", "the seed task already holds T001");
    assert.equal(created.data.task.checklist.length, 2);
    assert.equal(created.data.task.status, "planned");

    const added = (await request(fx, `/api/v2/tasks/${encodeURIComponent(taskRef)}/checklist`, json({ title: "Verify parity" }))).body;
    assert.equal(added.data.added, true);
    assert.equal(added.data.item.number, 3);
    assert.equal(added.data.checklistSize, 3);

    const toggled = (await request(fx, `/api/v2/tasks/${encodeURIComponent(taskRef)}/checklist/toggle`, json({ item: "C1", checked: true }))).body;
    assert.equal(toggled.data.toggled, true);
    assert.equal(toggled.data.item.checked, true);
    assert.match(toggled.data.message, /1\/3 checked/);

    const removed = (await request(fx, `/api/v2/tasks/${encodeURIComponent(taskRef)}/checklist?item=${encodeURIComponent("C1")}`, del)).body;
    assert.equal(removed.data.removed, true);
    assert.equal(removed.data.checklistSize, 2);
    assert.equal(removed.data.item.title, "Inventory call sites");

    // Renumbering: the former C2 "Swap to v2 client" is now C1.
    const retoggled = (await request(fx, `/api/v2/tasks/${encodeURIComponent(taskRef)}/checklist/toggle`, json({ item: "Swap to v2 client", checked: true }))).body;
    assert.equal(retoggled.data.item.number, 1);
  } finally {
    await closeServerFixture(fx);
  }
});

test("task refusals map to typed v2 error codes", async () => {
  const fx = await startServerFixture({ name: "v2-task-refusals" });
  try {
    const missingPhase = await expectError(fx, "/api/v2/phases/P999/tasks", json({
      feature: "F001",
      title: "Orphan attempt",
      description: "A description that is long enough to pass the flow's fifty-character execution-context rule.",
    }), { status: 404 });
    assert.match(missingPhase.message, /TASK_PHASE_NOT_FOUND/);

    const mismatch = await expectError(fx, "/api/v2/phases/P001/tasks", json({
      feature: "F999",
      title: "Wrong feature",
      description: "A description that is long enough to pass the flow's fifty-character execution-context rule.",
    }), { status: 404 });
    assert.match(mismatch.message, /TASK_FEATURE_NOT_FOUND/);

    const shortDescription = await expectError(fx, "/api/v2/phases/P001/tasks", json({
      feature: "F001",
      title: "One-liner",
      description: "too short",
    }), { status: 422 });
    assert.match(shortDescription.message, /TASK_DESCRIPTION_TOO_SHORT/);

    const missingTaskChecklist = await expectError(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T999")}/checklist`, json({ title: "X" }), { status: 404 });
    assert.match(missingTaskChecklist.message, /TASK_NOT_FOUND/);

    const noItemSelector = await expectError(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T001")}/checklist`, del, { status: 422 });
    assert.match(noItemSelector.message, /CHECKLIST_ITEM_REQUIRED/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("features and phases create family: planner-assigned identity under a validated feature", async () => {
  const fx = await startServerFixture({ name: "v2-hierarchy-create" });
  try {
    const feature = (await request(fx, "/api/v2/features", json({
      name: "Agent Brain service",
      description: "One authenticated multi-project application service used by every supported client. Current: per-process embedded servers; desired: one user-scoped service.",
    }))).body;
    assert.equal(feature.data.created, true);
    assert.match(feature.data.ref, /^F\d{3}$/);
    assert.equal(feature.data.feature.status, "planned");
    assert.match(feature.data.feature.id, /^[0-9a-f-]{36}$/);

    const badStatus = await expectError(fx, "/api/v2/features", json({
      name: "Bad status",
      description: "A description that is long enough to pass the fifty-character execution-context rule for features.",
      status: "megadrive",
    }), { status: 422 });
    assert.match(badStatus.message, /FEATURE_STATUS_INVALID/);

    const shortDescription = await expectError(fx, "/api/v2/features", json({
      name: "One-liner",
      description: "too short",
    }), { status: 422 });
    assert.match(shortDescription.message, /FEATURE_DESCRIPTION_TOO_SHORT/);

    const phase = (await request(fx, "/api/v2/phases", json({
      feature: feature.data.ref,
      title: "Route every client through the service",
      summary: "MCP, Pi, CLI and Web UI on one v2 surface.",
      description: "Convert all call sites to the versioned v2 API. Current: direct PlanStore construction in MCP and Pi; desired: HTTP over the loopback service with session registration first.",
    }))).body;
    assert.equal(phase.data.created, true);
    assert.match(phase.data.ref, /^P\d{3}\(F\d{3}\)$/);
    assert.equal(phase.data.phase.status, "draft");
    assert.equal(phase.data.phase.featureId, feature.data.feature.id);

    const missingFeature = await expectError(fx, "/api/v2/phases", json({
      title: "Orphan phase",
      description: "A description that is long enough to pass the flow's fifty-character execution-context rule for phases.",
    }), { status: 422 });
    assert.match(missingFeature.message, /PHASE_FEATURE_REQUIRED/);

    const unknownFeature = await expectError(fx, "/api/v2/phases", json({
      feature: "F999",
      title: "Dangling phase",
      description: "A description that is long enough to pass the flow's fifty-character execution-context rule for phases.",
    }), { status: 404 });
    assert.match(unknownFeature.message, /PHASE_FEATURE_NOT_FOUND/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("features and phases update/delete family: metadata, feature move, phase delete, cascade", async () => {
  const fx = await startServerFixture({ name: "v2-hierarchy-mutate" });
  const featureBody = (name) => ({
    name,
    description: "A description that is long enough to pass the fifty-character execution-context rule for features.",
  });
  const phaseBody = (feature, title) => ({
    feature,
    title,
    description: "A description that is long enough to pass the flow's fifty-character execution-context rule for phases.",
  });
  try {
    const featureA = (await request(fx, "/api/v2/features", json(featureBody("Agent Brain authority")))).body.data;
    const featureB = (await request(fx, "/api/v2/features", json(featureBody("Client conversion")))).body.data;
    const phase = (await request(fx, "/api/v2/phases", json(phaseBody(featureA.ref, "Route every client")))).body.data;

    // Feature metadata is mutable; identity and ref stay planner-assigned.
    const featureUpdate = (await request(fx, `/api/v2/features/${featureA.ref}`, put({ name: "Agent Brain authority (renamed)", priority: 7 }))).body.data;
    assert.equal(featureUpdate.updated, true);
    assert.equal(featureUpdate.ref, featureA.ref);
    assert.deepEqual(featureUpdate.updatedFields, ["name", "priority"]);
    assert.equal(featureUpdate.feature.id, featureA.feature.id);
    assert.equal(featureUpdate.feature.name, "Agent Brain authority (renamed)");
    assert.equal(featureUpdate.feature.priority, 7);

    // A phase move swaps the feature phaseIds back-links inside one batch and
    // the canonical ref follows the new parent.
    const phaseUpdate = (await request(fx, `/api/v2/phases/${encodeURIComponent(phase.ref)}`, put({ title: "Move every client", featureId: featureB.ref }))).body.data;
    assert.equal(phaseUpdate.updated, true);
    assert.equal(phaseUpdate.ref, `P${String(phase.phase.number).padStart(3, "0")}(${featureB.ref})`);
    assert.equal(phaseUpdate.phase.id, phase.phase.id);
    assert.equal(phaseUpdate.phase.featureId, featureB.feature.id);
    assert.equal(phaseUpdate.phase.title, "Move every client");
    assert.deepEqual(phaseUpdate.updatedFields, ["title", "featureId"]);
    assert.equal(phaseUpdate.descriptionFreshness, null, "no description change → no freshness preview");
    assert.deepEqual(phaseUpdate.staleParentRefs, []);

    const moved = await readPlanSnapshot(fx.planRoot);
    assert.deepEqual(moved.features.find((entry) => entry.id === featureA.feature.id).phaseIds, [], "old parent no longer lists the phase");
    assert.deepEqual(moved.features.find((entry) => entry.id === featureB.feature.id).phaseIds, [phase.phase.id], "new parent lists it once");

    // Phase delete removes the phase and unlinks it from every feature.
    const deletedPhase = (await request(fx, `/api/v2/phases/${encodeURIComponent(phaseUpdate.ref)}`, del)).body.data;
    assert.equal(deletedPhase.deleted, true);
    assert.equal(deletedPhase.phaseId, phase.phase.id);
    assert.equal(deletedPhase.ref, phaseUpdate.ref);
    assert.equal(typeof deletedPhase.shortId, "string");
    const afterPhaseDelete = await readPlanSnapshot(fx.planRoot);
    assert.deepEqual(afterPhaseDelete.features.find((entry) => entry.id === featureB.feature.id).phaseIds, []);
    assert.equal(afterPhaseDelete.phases.some((entry) => entry.id === phase.phase.id), false);

    // Feature delete without cascade unlinks its phases and keeps them.
    const keptPhase = (await request(fx, "/api/v2/phases", json(phaseBody(featureB.ref, "Survives the feature")))).body.data;
    const unlinked = (await request(fx, `/api/v2/features/${featureB.ref}`, del)).body.data;
    assert.equal(unlinked.deleted, true);
    assert.equal(unlinked.ref, featureB.ref);
    assert.equal(unlinked.cascade, false);
    assert.equal(unlinked.phaseCount, 1);
    const afterUnlink = await readPlanSnapshot(fx.planRoot);
    assert.equal(afterUnlink.features.some((entry) => entry.id === featureB.feature.id), false);
    assert.equal(afterUnlink.phases.find((entry) => entry.id === keptPhase.phase.id).featureId, undefined);

    // Feature delete with cascade removes the child phases too.
    const doomedPhase = (await request(fx, "/api/v2/phases", json(phaseBody(featureA.ref, "Dies with the feature")))).body.data;
    const cascaded = (await request(fx, `/api/v2/features/${featureA.ref}?cascade=true`, del)).body.data;
    assert.equal(cascaded.deleted, true);
    assert.equal(cascaded.cascade, true);
    assert.equal(cascaded.phaseCount, 1);
    const afterCascade = await readPlanSnapshot(fx.planRoot);
    assert.equal(afterCascade.features.some((entry) => entry.id === featureA.feature.id), false);
    assert.equal(afterCascade.phases.some((entry) => entry.id === doomedPhase.phase.id), false);
  } finally {
    await closeServerFixture(fx);
  }
});

test("feature and phase update/delete refusals map to typed v2 error codes", async () => {
  const fx = await startServerFixture({ name: "v2-hierarchy-refusals" });
  try {
    const featureStatus = await expectError(fx, "/api/v2/features/F001", put({ status: "done" }), { status: 409 });
    assert.match(featureStatus.message, /FEATURE_STATUS_READ_ONLY/);
    assert.match(featureStatus.message, /F001/);

    const featureNoFields = await expectError(fx, "/api/v2/features/F001", put({}), { status: 422 });
    assert.match(featureNoFields.message, /FEATURE_NO_MUTABLE_FIELDS/);

    const missingFeature = await expectError(fx, "/api/v2/features/F999", put({ name: "Ghost" }), { status: 404 });
    assert.match(missingFeature.message, /FEATURE_NOT_FOUND/);

    const missingFeatureDelete = await expectError(fx, "/api/v2/features/F999", del, { status: 404 });
    assert.match(missingFeatureDelete.message, /FEATURE_NOT_FOUND/);

    const featureNoBody = await expectError(fx, "/api/v2/features/F001", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }, { status: 400 });
    assert.match(featureNoBody.message, /INVALID_BODY/);

    const phaseStatus = await expectError(fx, "/api/v2/phases/P001", put({ status: "done" }), { status: 409 });
    assert.match(phaseStatus.message, /PHASE_STATUS_READ_ONLY/);

    const legacyDecisions = await expectError(fx, "/api/v2/phases/P001", put({ decisions: ["old history"] }), { status: 409 });
    assert.match(legacyDecisions.message, /PHASE_LEGACY_DECISIONS_READ_ONLY/);

    const phaseNoFields = await expectError(fx, "/api/v2/phases/P001", put({}), { status: 422 });
    assert.match(phaseNoFields.message, /PHASE_NO_MUTABLE_FIELDS/);

    const missingPhase = await expectError(fx, "/api/v2/phases/P999", put({ title: "Ghost" }), { status: 404 });
    assert.match(missingPhase.message, /PHASE_NOT_FOUND/);

    const unknownFeature = await expectError(fx, "/api/v2/phases/P001", put({ featureId: "F999" }), { status: 404 });
    assert.match(unknownFeature.message, /PHASE_FEATURE_NOT_FOUND/);

    const missingPhaseDelete = await expectError(fx, "/api/v2/phases/P999", del, { status: 404 });
    assert.match(missingPhaseDelete.message, /PHASE_NOT_FOUND/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("discuss family: project, feature, phase and task over the shared flows", async () => {
  const fx = await startServerFixture({ name: "v2-discuss" });
  const t001 = encodeURIComponent("P001(F001)/T001");
  try {
    const project = (await request(fx, "/api/v2/project/discuss", put({
      goal: "One coordinated planner authority",
      scope: ["MCP", "Pi", "CLI"],
      technologies: ["Node.js"],
    }))).body.data;
    assert.equal(project.discussed, true);
    assert.deepEqual(project.updatedFields, ["goal", "scope", "technologies"]);
    assert.equal(project.project.goal, "One coordinated planner authority");
    assert.deepEqual(project.project.scope, ["MCP", "Pi", "CLI"]);

    // The specific ".../discuss" route must win over PUT /features/*.
    const feature = (await request(fx, "/api/v2/features/F001/discuss", put({
      description: "One authenticated service used by every supported client.",
      workRemaining: "Convert the remaining call sites.",
      dependencies: ["service runtime record"],
    }))).body.data;
    assert.equal(feature.discussed, true);
    assert.equal(feature.ref, "F001");
    assert.deepEqual(feature.updatedFields, ["description", "workRemaining", "dependencies"]);
    assert.equal(feature.feature.contextReady, true);
    assert.match(feature.feature.contextReadyReason, /API v2/);
    assert.deepEqual(feature.feature.dependsOn, ["service runtime record"]);

    const phase = (await request(fx, "/api/v2/phases/P001/discuss", put({
      goals: ["Route every client through the service"],
      scope: "Convert all call sites to the versioned API.",
      risks: ["Adapter drift"],
    }))).body.data;
    assert.equal(phase.discussed, true);
    assert.equal(phase.ref, "P001(F001)");
    assert.deepEqual(phase.phase.goals, ["Route every client through the service"]);
    assert.equal(phase.phase.contextReady, true);
    assert.match(phase.phase.contextReadyReason, /API v2/);

    // Checklist replacement carries ticks by exact title.
    const task = (await request(fx, `/api/v2/tasks/${t001}/discuss`, put({
      description: "Implement the login endpoint over the shared service.",
      checklist: ["Add route", "Verify parity"],
    }))).body.data;
    assert.equal(task.discussed, true);
    assert.equal(task.ref, "P001(F001)/T001");
    assert.deepEqual(task.updatedFields, ["description", "checklist"]);
    assert.equal(task.task.checklist.length, 2);
    assert.deepEqual(task.checklistLostTicks, []);
  } finally {
    await closeServerFixture(fx);
  }
});

test("discuss refusals map to typed v2 error codes", async () => {
  const fx = await startServerFixture({ name: "v2-discuss-refusals" });
  try {
    const projectDecisions = await expectError(fx, "/api/v2/project/discuss", put({ decisions: ["legacy history"] }), { status: 409 });
    assert.match(projectDecisions.message, /PROJECT_LEGACY_DECISIONS_READ_ONLY/);

    const projectNoFields = await expectError(fx, "/api/v2/project/discuss", put({}), { status: 422 });
    assert.match(projectNoFields.message, /PROJECT_NO_MUTABLE_FIELDS/);

    const missingFeature = await expectError(fx, "/api/v2/features/F999/discuss", put({ description: "Ghost feature context that is long enough to be stored." }), { status: 404 });
    assert.match(missingFeature.message, /FEATURE_NOT_FOUND/);

    const featureNoFields = await expectError(fx, "/api/v2/features/F001/discuss", put({}), { status: 422 });
    assert.match(featureNoFields.message, /FEATURE_NO_MUTABLE_FIELDS/);

    const missingPhase = await expectError(fx, "/api/v2/phases/P999/discuss", put({ summary: "Ghost" }), { status: 404 });
    assert.match(missingPhase.message, /PHASE_NOT_FOUND/);

    const phaseNoFields = await expectError(fx, "/api/v2/phases/P001/discuss", put({}), { status: 422 });
    assert.match(phaseNoFields.message, /PHASE_NO_MUTABLE_FIELDS/);

    const missingTask = await expectError(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T999")}/discuss`, put({ description: "Ghost task context that is long enough to be stored." }), { status: 404 });
    assert.match(missingTask.message, /TASK_NOT_FOUND/);

    const taskNoFields = await expectError(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T001")}/discuss`, put({}), { status: 422 });
    assert.match(taskNoFields.message, /TASK_NO_MUTABLE_FIELDS/);

    const noBody = await expectError(fx, "/api/v2/project/discuss", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }, { status: 400 });
    assert.match(noBody.message, /INVALID_BODY/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("discovery lists: features, phases and tasks share the MCP selection logic", async () => {
  const fx = await startServerFixture({ name: "v2-lists" });
  try {
    const features = (await request(fx, "/api/v2/features")).body.data;
    assert.equal(features.total, 1);
    assert.deepEqual(features.features[0].ref, "F001");
    assert.equal(features.features[0].phaseCount, 1);
    assert.equal(features.features[0].taskCount, 1);

    const filteredByShortId = (await request(fx, "/api/v2/features?featureRef=AAAAA")).body.data;
    assert.equal(filteredByShortId.total, 1);
    assert.equal(filteredByShortId.features[0].id, features.features[0].id);

    const phases = (await request(fx, "/api/v2/phases?status=planned")).body.data;
    assert.equal(phases.total, 1);
    assert.equal(phases.phases[0].ref, "P001(F001)");
    assert.equal(phases.phases[0].featureNumber, 1);
    assert.equal(phases.phases[0].taskCount, 1);

    const tasks = (await request(fx, "/api/v2/tasks?phaseRef=P001&status=planned")).body.data;
    assert.equal(tasks.total, 1);
    assert.equal(tasks.tasks[0].ref, "P001(F001)/T001");
    assert.equal(tasks.tasks[0].title, "Implement login");

    const noMatch = (await request(fx, "/api/v2/tasks?status=done")).body.data;
    assert.equal(noMatch.total, 0);

    const unknownFeature = await expectError(fx, "/api/v2/features?featureRef=F999", {}, { status: 404 });
    assert.match(unknownFeature.message, /FEATURE_NOT_FOUND/);

    const unknownPhaseFilter = await expectError(fx, "/api/v2/phases?featureRef=F999", {}, { status: 404 });
    assert.match(unknownPhaseFilter.message, /FEATURE_NOT_FOUND/);

    const unknownTaskPhase = await expectError(fx, "/api/v2/tasks?phaseRef=P999", {}, { status: 404 });
    assert.match(unknownTaskPhase.message, /PHASE_NOT_FOUND/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("task mutation family: metadata update, dependencies and move over the shared flows", async () => {
  const fx = await startServerFixture({ name: "v2-task-mutations" });
  const t001 = encodeURIComponent("P001(F001)/T001");
  const phaseBody = (feature, title) => ({
    feature,
    title,
    description: "A description that is long enough to pass the flow's fifty-character execution-context rule for phases.",
  });
  try {
    const updated = (await request(fx, `/api/v2/tasks/${t001}`, put({
      title: "Implement login over the service",
      priority: 3,
      notes: "Runs through the shared task flow.",
      checklist: ["Add route", "Verify parity"],
    }))).body.data;
    assert.equal(updated.updated, true);
    assert.equal(updated.ref, "P001(F001)/T001");
    assert.deepEqual(updated.updatedFields, ["title", "notes", "priority", "checklist"]);
    assert.equal(updated.task.title, "Implement login over the service");
    assert.equal(updated.task.priority, 3);
    assert.equal(updated.task.checklist.length, 2);

    // A second task in another phase becomes the dependency target.
    const targetPhase = (await request(fx, "/api/v2/phases", json(phaseBody("F001", "Dependency target phase")))).body.data;
    const second = (await request(fx, `/api/v2/phases/${encodeURIComponent(targetPhase.ref)}/tasks`, json({
      feature: "F001",
      title: "Ship the dependency",
      description: "A description that is long enough to pass the flow's fifty-character execution-context rule.",
    }))).body.data;

    const added = (await request(fx, `/api/v2/tasks/${t001}/dependencies`, json({ dependsOn: second.taskRef }))).body.data;
    assert.equal(added.updated, true);
    assert.equal(added.dependencyRef, second.taskRef);
    assert.equal(added.dependsOn.length, 1);

    const selfDependency = await expectError(fx, `/api/v2/tasks/${t001}/dependencies`, json({ dependsOn: "P001(F001)/T001" }), { status: 422 });
    assert.match(selfDependency.message, /DEPENDENCY_SELF/);

    const unconfirmed = await expectError(fx, `/api/v2/tasks/${t001}/dependencies?dependsOn=${encodeURIComponent(second.taskRef)}`, del, { status: 409 });
    assert.match(unconfirmed.message, /CONFIRMATION_REQUIRED/);

    const removed = (await request(fx, `/api/v2/tasks/${t001}/dependencies?dependsOn=${encodeURIComponent(second.taskRef)}&confirmed=true`, del)).body.data;
    assert.equal(removed.updated, true);
    assert.deepEqual(removed.dependsOn, []);

    // Move: the composite ref follows the new phase, id and checklist survive.
    const movedPhase = (await request(fx, "/api/v2/phases", json(phaseBody("F001", "Move destination")))).body.data;
    const moved = (await request(fx, "/api/v2/tasks/move", json({ tasks: ["P001(F001)/T001"], targetPhase: movedPhase.ref }))).body.data;
    assert.equal(moved.moved, true);
    assert.equal(moved.targetPhaseRef, movedPhase.ref);
    assert.equal(moved.moves.length, 1);
    const movedEntry = moved.moves[0];
    assert.equal(movedEntry.oldRef, "P001(F001)/T001");
    assert.equal(movedEntry.newRef, `${movedPhase.ref}/T001`);
    assert.equal(movedEntry.id, updated.task.id);

    const afterMove = await readPlanSnapshot(fx.planRoot);
    const homePhase = afterMove.phases.find((entry) => entry.id === movedPhase.phase.id);
    assert.equal(homePhase.tasks.some((task) => task.id === updated.task.id), true);
    assert.equal(homePhase.tasks.find((task) => task.id === updated.task.id).checklist.length, 2);
  } finally {
    await closeServerFixture(fx);
  }
});

test("task mutation refusals map to typed v2 error codes", async () => {
  const fx = await startServerFixture({ name: "v2-task-mutation-refusals" });
  const t001 = encodeURIComponent("P001(F001)/T001");
  try {
    const missing = await expectError(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T999")}`, put({ title: "Ghost" }), { status: 404 });
    assert.match(missing.message, /TASK_NOT_FOUND/);

    const noFields = await expectError(fx, `/api/v2/tasks/${t001}`, put({}), { status: 422 });
    assert.match(noFields.message, /TASK_NO_MUTABLE_FIELDS/);

    const lifecycleStart = await expectError(fx, `/api/v2/tasks/${t001}`, put({ status: "in-progress" }), { status: 409 });
    assert.match(lifecycleStart.message, /TASK_LIFECYCLE_TRANSITION_REQUIRED/);

    const lifecycleDone = await expectError(fx, `/api/v2/tasks/${t001}`, put({ status: "done" }), { status: 409 });
    assert.match(lifecycleDone.message, /TASK_LIFECYCLE_TRANSITION_REQUIRED/);

    const legacyDecisions = await expectError(fx, `/api/v2/tasks/${t001}`, put({ decisions: ["old"] }), { status: 409 });
    assert.match(legacyDecisions.message, /TASK_LEGACY_DECISIONS_READ_ONLY/);

    const motivation = await expectError(fx, `/api/v2/tasks/${t001}`, put({ status: "blocked" }), { status: 422 });
    assert.match(motivation.message, /TASK_MOTIVATION_REQUIRED/);

    const badStatus = await expectError(fx, `/api/v2/tasks/${t001}`, put({ status: "megadrive" }), { status: 422 });
    assert.match(badStatus.message, /TASK_STATUS_INVALID/);

    const badSubtask = await expectError(fx, `/api/v2/tasks/${t001}`, put({
      subtasks: [{ id: "00000000-0000-4000-8000-000000000000", title: "Foreign" }],
    }), { status: 422 });
    assert.match(badSubtask.message, /SUBTASK_ID_INVALID/);

    const missingDependencyTarget = await expectError(fx, `/api/v2/tasks/${t001}/dependencies`, json({ dependsOn: "P001(F001)/T999" }), { status: 404 });
    assert.match(missingDependencyTarget.message, /DEPENDENCY_TASK_NOT_FOUND/);

    const selfDependencyByBareRef = await expectError(fx, `/api/v2/tasks/${t001}/dependencies`, json({ dependsOn: "T001" }), { status: 422 });
    assert.match(selfDependencyByBareRef.message, /DEPENDENCY_SELF/);

    const noTargetPhase = await expectError(fx, "/api/v2/tasks/move", json({ tasks: ["P001(F001)/T001"], targetPhase: "P999" }), { status: 404 });
    assert.match(noTargetPhase.message, /TARGET_PHASE_NOT_FOUND/);

    const noTasks = await expectError(fx, "/api/v2/tasks/move", json({ tasks: [], targetPhase: "P001" }), { status: 422 });
    assert.match(noTasks.message, /NO_TASKS_GIVEN/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("detail reads: one feature, phase and task each with canonical identity", async () => {
  const fx = await startServerFixture({ name: "v2-show" });
  const phaseRef = encodeURIComponent("P001(F001)");
  const taskRef = encodeURIComponent("P001(F001)/T001");
  try {
    const feature = (await request(fx, "/api/v2/features/AAAAA")).body.data;
    assert.equal(feature.ref, "F001");
    assert.equal(feature.feature.name, "Auth API");
    assert.equal(feature.phaseCount, 1);
    assert.equal(feature.taskCount, 1);
    assert.equal(feature.feature.description, "Authentication API for the fixture.");

    const phase = (await request(fx, `/api/v2/phases/${phaseRef}`)).body.data;
    assert.equal(phase.ref, "P001(F001)");
    assert.equal(phase.featureNumber, 1);
    assert.equal(phase.taskCount, 1);
    assert.equal(phase.phase.title, "Auth API phase");
    assert.equal(phase.phase.description, "Fixture phase with one planned task.");
    assert.deepEqual(phase.linkedRequirements.map((requirement) => requirement.title), ["Users can authenticate"]);

    const task = (await request(fx, `/api/v2/tasks/${taskRef}`)).body.data;
    assert.equal(task.ref, "P001(F001)/T001");
    assert.equal(task.phaseRef, "P001(F001)");
    assert.equal(task.featureRef, "F001");
    assert.equal(task.task.title, "Implement login");
    assert.equal(task.task.checklist.length, 1);
    assert.equal(task.task.checklist[0].title, "Add route");
    assert.equal(task.phase.ref, "P001(F001)");
    assert.equal(task.feature.ref, "F001");
    assert.equal(task.orderContext.priority, 10);
    assert.equal(task.orderContext.readyAheadCount, 0);
    assert.equal(task.snapshot, null);
    assert.equal(task.pendingDeviation, null);
    assert.deepEqual(task.linkedRequirements.map((requirement) => requirement.title), ["Users can authenticate"]);
  } finally {
    await closeServerFixture(fx);
  }
});

test("detail read refusals map to typed v2 error codes", async () => {
  const fx = await startServerFixture({ name: "v2-show-refusals" });
  const featureBody = (name) => json({
    name,
    description: "A description that is long enough to pass the flow's fifty-character execution-context rule.",
  });
  try {
    const missingFeature = await expectError(fx, "/api/v2/features/F999", {}, { status: 404 });
    assert.match(missingFeature.message, /FEATURE_NOT_FOUND/);

    const missingPhase = await expectError(fx, "/api/v2/phases/P999", {}, { status: 404 });
    assert.match(missingPhase.message, /PHASE_NOT_FOUND/);

    const missingTask = await expectError(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T999")}`, {}, { status: 404 });
    assert.match(missingTask.message, /TASK_NOT_FOUND/);

    // Two features with one exact name: the ref exists but not uniquely.
    await request(fx, "/api/v2/features", featureBody("Twin feature"));
    await request(fx, "/api/v2/features", featureBody("Twin feature"));
    const ambiguous = await expectError(fx, `/api/v2/features/${encodeURIComponent("Twin feature")}`, {}, { status: 409 });
    assert.match(ambiguous.message, /FEATURE_REF_AMBIGUOUS/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("documents family: list, view and confirmed save over the shared doc flow", async () => {
  const fx = await startServerFixture({ name: "v2-documents" });
  const docPath = ".planner/docs/notes/architecture.md";
  const viewPath = (value) => `/api/v2/documents/view?path=${encodeURIComponent(value)}`;
  try {
    const empty = (await request(fx, "/api/v2/documents")).body.data;
    assert.equal(empty.total, 0);

    const unconfirmed = await expectError(fx, "/api/v2/documents/save", put({ path: docPath, content: "# Doc\n" }), { status: 409 });
    assert.match(unconfirmed.message, /DOCUMENT_CONFIRMATION_REQUIRED/);

    const traversal = await expectError(fx, viewPath(".planner/docs/../manifest.json"), {}, { status: 400 });
    assert.match(traversal.message, /DOCUMENT_PATH_INVALID/);

    const outside = await expectError(fx, viewPath("/etc/passwd"), {}, { status: 400 });
    assert.match(outside.message, /DOCUMENT_PATH_INVALID/);

    const saved = (await request(fx, "/api/v2/documents/save", put({
      path: docPath,
      content: "# Architecture\n\nShared document.\n",
      confirmed: true,
    }))).body.data;
    assert.equal(saved.path, docPath);
    assert.equal(saved.saved, true);

    const viewed = (await request(fx, viewPath(docPath))).body.data;
    assert.equal(viewed.path, docPath);
    assert.match(viewed.content, /Shared document/);

    const listed = (await request(fx, "/api/v2/documents")).body.data;
    assert.equal(listed.total, 1);
    assert.equal(listed.documents[0].path, docPath);
    assert.equal(typeof listed.documents[0].size, "number");
    assert.match(listed.documents[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const missing = await expectError(fx, viewPath(".planner/docs/nope.md"), {}, { status: 404 });
    assert.match(missing.message, /DOCUMENT_NOT_REGULAR_FILE/);

    const emptyContent = await expectError(fx, "/api/v2/documents/save", put({
      path: ".planner/docs/blank.md",
      content: "   ",
      confirmed: true,
    }), { status: 422 });
    assert.match(emptyContent.message, /DOCUMENT_CONTENT_REQUIRED/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("documents family refuses symlink escapes on read and save", async () => {
  const fx = await startServerFixture({ name: "v2-document-symlinks" });
  const docsDir = join(fx.planRoot, "docs");
  try {
    await mkdir(docsDir, { recursive: true });
    await symlink("/etc/passwd", join(docsDir, "escape.md"));
    const path = ".planner/docs/escape.md";

    const viewed = await expectError(fx, `/api/v2/documents/view?path=${encodeURIComponent(path)}`, {}, { status: 404 });
    assert.match(viewed.message, /DOCUMENT_NOT_REGULAR_FILE/);

    const saved = await expectError(fx, "/api/v2/documents/save", put({ path, content: "# Overwrite\n", confirmed: true }), { status: 404 });
    assert.match(saved.message, /DOCUMENT_NOT_REGULAR_FILE/);

    const listed = (await request(fx, "/api/v2/documents")).body.data;
    assert.equal(listed.total, 0);
  } finally {
    await closeServerFixture(fx);
  }
});

test("search family: one query across entities, decisions and documents", async () => {
  const fx = await startServerFixture({ name: "v2-search" });
  try {
    const auth = (await request(fx, "/api/v2/search?q=auth")).body.data;
    assert.equal(auth.query, "auth");
    assert.ok(auth.total >= 3, `expected feature, phase and requirement hits, got ${auth.total}`);
    const featureHit = auth.hits.find((hit) => hit.type === "feature" && hit.ref === "F001");
    assert.ok(featureHit, "feature hit carries its canonical ref");
    assert.deepEqual(featureHit.matchedFields, ["name", "description"]);
    assert.match(featureHit.snippet, /Auth/i);
    assert.ok(auth.hits.some((hit) => hit.type === "phase" && hit.ref === "P001(F001)"));

    const login = (await request(fx, "/api/v2/search?q=login")).body.data;
    assert.ok(login.hits.some((hit) => hit.type === "task" && hit.ref === "P001(F001)/T001"));

    const byRef = (await request(fx, "/api/v2/search?q=F001")).body.data;
    assert.equal(byRef.hits[0].ref, "F001", "an exact ref match ranks first");

    const limited = (await request(fx, "/api/v2/search?q=auth&limit=1")).body.data;
    assert.equal(limited.hits.length, 1);
    assert.ok(limited.total > 1);
    assert.equal(limited.truncated, true);

    // Accepted decisions are searchable through their owner ref.
    const created = (await request(fx, "/api/v2/accepted-decisions", json({
      targetType: "feature",
      targetRef: "F001",
      title: "Loopback-only by default",
      decision: "The service binds to 127.0.0.1.",
    }))).body.data;
    const decisions = (await request(fx, "/api/v2/search?q=loopback")).body.data;
    const decisionHit = decisions.hits.find((hit) => hit.type === "accepted-decision" && hit.ref === created.acceptedDecision.id);
    assert.ok(decisionHit, "accepted decision is searchable");
    assert.equal(decisionHit.ownerRef, "F001");

    // Planner documents join the same query.
    const docPath = ".planner/docs/search-note.md";
    await request(fx, "/api/v2/documents/save", put({
      path: docPath,
      content: "# Note\n\nThe sentinelword marks this document.\n",
      confirmed: true,
    }));
    const documents = (await request(fx, "/api/v2/search?q=sentinelword")).body.data;
    assert.equal(documents.total, 1);
    assert.equal(documents.hits[0].type, "document");
    assert.equal(documents.hits[0].ref, docPath);
    assert.equal(documents.hits[0].matchedFields[0], "content");
    assert.equal(documents.skippedDocuments, 0);

    const tooShort = await expectError(fx, "/api/v2/search?q=a", {}, { status: 422 });
    assert.match(tooShort.message, /SEARCH_QUERY_TOO_SHORT/);

    const badLimit = await expectError(fx, "/api/v2/search?q=auth&limit=abc", {}, { status: 422 });
    assert.match(badLimit.message, /SEARCH_LIMIT_INVALID/);

    const noMatch = (await request(fx, "/api/v2/search?q=zzzznotfound")).body.data;
    assert.equal(noMatch.total, 0);
    assert.deepEqual(noMatch.hits, []);
  } finally {
    await closeServerFixture(fx);
  }
});

test("session family: the service issues an id, heartbeat records liveness, end is recorded", async () => {
  const fx = await startServerFixture({ name: "v2-sessions" });
  try {
    const registered = (await request(fx, "/api/v2/sessions", json({
      clientKind: "mcp",
      clientVersion: "9.9.9",
      agentId: "worker-1",
      displayName: "Worker 1",
      harnessId: "claude-code",
      capabilities: ["handoff", "lifecycle", "handoff"],
    }))).body.data.session;
    assert.match(registered.sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(registered.clientKind, "mcp");
    assert.equal(registered.agentId, "worker-1");
    assert.equal(registered.displayName, "Worker 1");
    assert.equal(registered.harnessId, "claude-code");
    assert.deepEqual(registered.capabilities, ["handoff", "lifecycle"]);
    assert.equal(registered.contextEpoch, 1);
    assert.equal(registered.endedAt, "");
    assert.match(registered.projectId, /[0-9a-f-]{36}/);

    // Records are worktree-local runtime state, not tracked plan data.
    const onDisk = JSON.parse(await readFile(join(fx.planRoot, ".local", "sessions.json"), "utf8"));
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].sessionId, registered.sessionId);

    const heartbeat = (await request(fx, `/api/v2/sessions/${registered.sessionId}/heartbeat`, { method: "POST" })).body.data;
    assert.equal(heartbeat.heartbeat, true);
    assert.equal(heartbeat.session.sessionId, registered.sessionId);
    assert.ok(heartbeat.session.lastSeenAt >= registered.lastSeenAt);

    const ended = (await request(fx, `/api/v2/sessions/${registered.sessionId}?reason=task-finished`, del)).body.data;
    assert.equal(ended.ended, true);
    assert.match(ended.session.endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(ended.session.endReason, "task-finished");

    const heartbeatAfterEnd = await expectError(fx, `/api/v2/sessions/${registered.sessionId}/heartbeat`, { method: "POST" }, { status: 409 });
    assert.match(heartbeatAfterEnd.message, /SESSION_ENDED/);

    const unknown = await expectError(fx, "/api/v2/sessions/00000000-0000-4000-8000-000000000000/heartbeat", { method: "POST" }, { status: 404 });
    assert.match(unknown.message, /SESSION_NOT_FOUND/);

    const missingKind = await expectError(fx, "/api/v2/sessions", json({ clientVersion: "1.0.0" }), { status: 422 });
    assert.match(missingKind.message, /SESSION_CLIENT_KIND_REQUIRED/);

    // A second registration is a distinct session; ending one never ends the other.
    const second = (await request(fx, "/api/v2/sessions", json({ clientKind: "pi" }))).body.data.session;
    assert.notEqual(second.sessionId, registered.sessionId);
    assert.equal(second.agentId, "pi");
    assert.equal(second.displayName, "pi");
    const stored = JSON.parse(await readFile(join(fx.planRoot, ".local", "sessions.json"), "utf8"));
    assert.equal(stored.length, 2);
    assert.equal(stored.find((record) => record.sessionId === second.sessionId).endedAt, "");
  } finally {
    await closeServerFixture(fx);
  }
});

test("context family: registered sessions receive content and durable receipts", async () => {
  const fx = await startServerFixture({ name: "v2-context" });
  const taskRef = encodeURIComponent("P001(F001)/T001");
  const phaseRef = encodeURIComponent("P001(F001)");
  try {
    const session = (await request(fx, "/api/v2/sessions", json({ clientKind: "mcp", agentId: "worker-1" }))).body.data.session;
    const headers = { "X-Planner-Session": session.sessionId };

    const anonymous = await expectError(fx, "/api/v2/context/project", {}, { status: 400 });
    assert.match(anonymous.message, /SESSION_REQUIRED/);

    const stranger = { "X-Planner-Session": "00000000-0000-4000-8000-000000000000" };
    const unknownSession = await expectError(fx, "/api/v2/context/project", { headers: stranger }, { status: 404 });
    assert.match(unknownSession.message, /SESSION_NOT_FOUND/);

    const project = (await request(fx, "/api/v2/context/project", { headers })).body.data;
    assert.equal(project.contextComplete, true);
    assert.equal(project.attested, true);
    assert.equal(project.totalChunks, 1);
    assert.equal(typeof project.fingerprint, "string");
    assert.equal(project.chunks.length, 1);
    assert.equal(typeof project.chunks[0].content, "string");

    const guidelines = (await request(fx, "/api/v2/context/guidelines", { headers })).body.data;
    assert.equal(guidelines.readRecorded, false);
    assert.equal(guidelines.projectGuidelines.content, "");

    const requirements = (await request(fx, `/api/v2/context/requirements?phaseRef=${phaseRef}`, { headers })).body.data;
    assert.equal(requirements.phaseRef, "P001(F001)");
    assert.deepEqual(requirements.requirements.map((requirement) => requirement.title), ["Users can authenticate"]);
    assert.equal(requirements.attestedRequirementIds.length, 1);

    const phase = (await request(fx, `/api/v2/context/phases/${phaseRef}`, { headers })).body.data;
    assert.equal(phase.ref, "P001(F001)");
    assert.equal(phase.attested, true);
    assert.match(phase.text, /Accepted Decisions \(0\):/);
    assert.equal(phase.linkedRequirements.length, 1);

    const task = (await request(fx, `/api/v2/context/tasks/${taskRef}`, { headers })).body.data;
    assert.equal(task.ref, "P001(F001)/T001");
    assert.equal(task.phaseRef, "P001(F001)");
    assert.equal(task.featureRef, "F001");
    assert.equal(task.persisted, true);
    assert.deepEqual(task.attestedRequirementIds, [task.linkedRequirements[0].id]);
    assert.match(task.taskText, /Add route/);
    assert.match(task.taskText, /Users can authenticate/);
    assert.match(task.phaseText, /Accepted Decisions \(0\):/);
    assert.match(task.featureText, /Accepted Decisions \(0\):/);

    // The receipt is durable on the entities, not only in process memory.
    const phaseFiles = (await readdir(join(fx.planRoot, "phases"))).filter((name) => name.endsWith(".json"));
    const storedPhases = await Promise.all(phaseFiles.map(async (name) => JSON.parse(await readFile(join(fx.planRoot, "phases", name), "utf8"))));
    const storedPhase = storedPhases.find((entry) => entry.tasks.some((candidate) => candidate.id === task.task.id));
    assert.ok(storedPhase.sessionInfo.some((entry) => entry.sessionId === session.sessionId));
    assert.ok(storedPhase.tasks.find((candidate) => candidate.id === task.task.id).sessionInfo
      .some((entry) => entry.sessionId === session.sessionId));

    const missingTask = await expectError(fx, `/api/v2/context/tasks/${encodeURIComponent("P001(F001)/T999")}`, { headers }, { status: 404 });
    assert.match(missingTask.message, /TASK_NOT_FOUND/);

    const missingPhaseRef = await expectError(fx, "/api/v2/context/requirements", { headers }, { status: 422 });
    assert.match(missingPhaseRef.message, /PHASE_REF_REQUIRED/);

    const badMaxChars = await expectError(fx, "/api/v2/context/project?maxChars=0", { headers }, { status: 422 });
    assert.match(badMaxChars.message, /CONTEXT_MAX_CHARS_INVALID/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("lifecycle family: task start requires a session and the delivered context bundle", async () => {
  const fx = await startServerFixture({ name: "v2-lifecycle-start" });
  const taskRef = encodeURIComponent("P001(F001)/T001");
  const startPath = `/api/v2/tasks/${taskRef}/start`;
  try {
    const anonymous = await expectError(fx, startPath, json({}), { status: 400 });
    assert.match(anonymous.message, /SESSION_REQUIRED/);

    const session = (await request(fx, "/api/v2/sessions", json({ clientKind: "mcp", agentId: "worker-1" }))).body.data.session;
    const headers = { "X-Planner-Session": session.sessionId };

    const unknownTask = await expectError(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T999")}/start`, {
      method: "POST",
      headers,
    }, { status: 404 });
    assert.match(unknownTask.message, /TASK_NOT_FOUND/);

    // Starting before the required reads is a typed refusal that names the
    // missing context, not a silent lifecycle write.
    const denied = await request(fx, startPath, { method: "POST", headers, expectStatus: 409 });
    assert.equal(denied.body.error.code, "CONTEXT_READ_REQUIRED");
    assert.match(denied.body.error.message, /Required context reads/);
    assert.equal(denied.body.error.context.taskRef, "P001(F001)/T001");
    assert.equal(denied.body.error.context.phaseRef, "P001(F001)");
    assert.equal(denied.body.error.context.featureRef, "F001");
    assert.ok(denied.body.error.evidence.contextEligibility.requiredReads.length > 0);

    // One context bundle delivers task, phase, feature and requirements.
    const bundle = (await request(fx, `/api/v2/context/tasks/${taskRef}`, { headers })).body.data;
    assert.equal(bundle.persisted, true);

    const started = (await request(fx, startPath, { method: "POST", headers })).body.data;
    assert.equal(started.started, true);
    assert.equal(started.alreadyStarted, false);
    assert.equal(started.taskRef, "P001(F001)/T001");
    assert.equal(started.phaseRef, "P001(F001)");
    assert.equal(started.featureRef, "F001");
    assert.equal(started.task.status, "in-progress");
    assert.equal(started.task.activeOwnerSession, session.sessionId);
    assert.match(started.phaseContext, /📋 Task context/);
    assert.equal(started.advisory, null);
    assert.equal(started.projectContextStale, false);

    // The lifecycle write is persisted, not only reported.
    const shown = (await request(fx, `/api/v2/tasks/${taskRef}`)).body.data;
    assert.equal(shown.task.status, "in-progress");
    assert.equal(shown.task.activeOwnerSession, session.sessionId);

    // A second start re-claims ownership without duplicating the context block.
    const again = (await request(fx, startPath, { method: "POST", headers })).body.data;
    assert.equal(again.started, true);
    assert.equal(again.alreadyStarted, true);
    assert.equal(again.phaseContext, "");

    // A different session cannot re-claim a task another session owns.
    const other = (await request(fx, "/api/v2/sessions", json({ clientKind: "cli" }))).body.data.session;
    const otherHeaders = { "X-Planner-Session": other.sessionId };
    await request(fx, `/api/v2/context/tasks/${taskRef}`, { headers: otherHeaders });
    const conflict = await request(fx, startPath, { method: "POST", headers: otherHeaders, expectStatus: 409 });
    assert.match(conflict.body.error.code, /OWNED|CONFLICT/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("lifecycle family: completion gates evidence and checklist, then records the summary", async () => {
  const fx = await startServerFixture({ name: "v2-lifecycle-complete" });
  const taskRef = encodeURIComponent("P001(F001)/T001");
  const completePath = `/api/v2/tasks/${taskRef}/complete`;
  try {
    const anonymous = await request(fx, completePath, { ...json({ descriptionUpdate: "Shipped and verified." }), expectStatus: 400 });
    assert.equal(anonymous.body.error.code, "SESSION_REQUIRED");

    const session = (await request(fx, "/api/v2/sessions", json({ clientKind: "mcp", agentId: "worker-1" }))).body.data.session;
    const headers = { "X-Planner-Session": session.sessionId, "Content-Type": "application/json" };

    const unknownTask = await request(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T999")}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ descriptionUpdate: "Shipped and verified." }),
      expectStatus: 404,
    });
    assert.equal(unknownTask.body.error.code, "TASK_NOT_FOUND");

    const shortEvidence = await request(fx, completePath, {
      method: "POST",
      headers,
      body: JSON.stringify({ descriptionUpdate: "short" }),
      expectStatus: 422,
    });
    assert.equal(shortEvidence.body.error.code, "COMPLETION_EVIDENCE_REQUIRED");

    const checklist = await request(fx, completePath, {
      method: "POST",
      headers,
      body: JSON.stringify({ descriptionUpdate: "Shipped the login route and verified the focused suite." }),
      expectStatus: 409,
    });
    assert.equal(checklist.body.error.code, "CHECKLIST_INCOMPLETE");
    assert.deepEqual(checklist.body.error.uncheckedItems, ["Add route"]);

    const forceWithoutMotivation = await request(fx, completePath, {
      method: "POST",
      headers,
      body: JSON.stringify({ descriptionUpdate: "Shipped the login route and verified the focused suite.", force: true }),
      expectStatus: 409,
    });
    assert.equal(forceWithoutMotivation.body.error.code, "FORCE_MOTIVATION_REQUIRED");

    // Tick the real checklist item, then complete without an override.
    const toggled = (await request(fx, `/api/v2/tasks/${taskRef}/checklist/toggle`, { method: "POST", headers, body: JSON.stringify({ item: "Add route", checked: true }) })).body.data;
    assert.equal(toggled.item.checked, true);

    const completed = (await request(fx, completePath, {
      method: "POST",
      headers,
      body: JSON.stringify({ descriptionUpdate: "Shipped the login route and verified the focused suite." }),
    })).body.data;
    assert.equal(completed.completed, true);
    assert.equal(completed.taskRef, "P001(F001)/T001");
    assert.equal(completed.phaseRef, "P001(F001)");
    assert.equal(completed.featureRef, "F001");
    assert.equal(completed.task.status, "done");
    assert.match(completed.task.completedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(completed.task.description, /\*\*Completion summary:\*\*\nShipped the login route/);
    const lastLog = completed.task.statusLog.at(-1);
    assert.equal(lastLog.fromStatus, "planned");
    assert.equal(lastLog.toStatus, "done");
    assert.equal(lastLog.description, "Shipped the login route and verified the focused suite.");
    assert.equal(completed.clearedHandoffRef, null);
    assert.equal(completed.resumeRequired, null);

    const shown = (await request(fx, `/api/v2/tasks/${taskRef}`)).body.data;
    assert.equal(shown.task.status, "done");
  } finally {
    await closeServerFixture(fx);
  }
});

test("lifecycle family: forced completion records the override instead of ticking items", async () => {
  const fx = await startServerFixture({ name: "v2-lifecycle-force" });
  const taskRef = encodeURIComponent("P001(F001)/T001");
  try {
    const session = (await request(fx, "/api/v2/sessions", json({ clientKind: "cli" }))).body.data.session;
    const headers = { "X-Planner-Session": session.sessionId, "Content-Type": "application/json" };
    const completed = (await request(fx, `/api/v2/tasks/${taskRef}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        descriptionUpdate: "Shipped the route and verified it manually; the checklist entry no longer matches the work.",
        force: true,
        motivation: "The checklist item tracked a route that moved to the gateway task.",
      }),
    })).body.data;
    assert.equal(completed.completed, true);
    assert.equal(completed.task.checklist[0].checked, false, "forcing never auto-ticks checklist items");
    assert.match(completed.task.description, /Forced completion overrode 1 unchecked checklist item\(s\): Add route\./);
    assert.match(completed.task.description, /Motivation: The checklist item tracked a route/);
  } finally {
    await closeServerFixture(fx);
  }
});

test("lifecycle family: pause captures a durable checkpoint and refuses other states", async () => {
  const fx = await startServerFixture({ name: "v2-lifecycle-pause" });
  const taskRef = encodeURIComponent("P001(F001)/T001");
  const pausePath = `/api/v2/tasks/${taskRef}/pause`;
  try {
    const session = (await request(fx, "/api/v2/sessions", json({ clientKind: "mcp", agentId: "worker-1" }))).body.data.session;
    const headers = { "X-Planner-Session": session.sessionId, "Content-Type": "application/json" };

    const checkpointBody = {
      reason: "Need the gateway contract first",
      whatWasBeingDone: "Wiring the login route to the auth client",
      resumeLocation: "packages/plan-server/src/serve.ts:login route",
      howToResume: "Read the gateway contract, then finish the route wiring.",
    };

    // A planned task cannot be checkpointed.
    const notInProgress = await request(fx, pausePath, { method: "POST", headers, body: JSON.stringify(checkpointBody), expectStatus: 409 });
    assert.equal(notInProgress.body.error.code, "TASK_NOT_IN_PROGRESS");

    const incomplete = await request(fx, pausePath, { method: "POST", headers, body: JSON.stringify({ reason: "only reason" }), expectStatus: 422 });
    assert.equal(incomplete.body.error.code, "PAUSE_CHECKPOINT_REQUIRED");
    assert.deepEqual(incomplete.body.error.missing, ["whatWasBeingDone", "resumeLocation", "howToResume"]);

    const missingTask = await request(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T999")}/pause`, {
      method: "POST",
      headers,
      body: JSON.stringify(checkpointBody),
      expectStatus: 404,
    });
    assert.equal(missingTask.body.error.code, "TASK_NOT_FOUND");

    // Start, then checkpoint the in-progress task.
    await request(fx, `/api/v2/context/tasks/${taskRef}`, { headers });
    await request(fx, `/api/v2/tasks/${taskRef}/start`, { method: "POST", headers });

    const paused = (await request(fx, pausePath, { method: "POST", headers, body: JSON.stringify(checkpointBody) })).body.data;
    assert.equal(paused.paused, true);
    assert.equal(paused.task.status, "planned");
    assert.equal(paused.task.activeOwnerSession, "");
    assert.equal(paused.snapshot.reason, checkpointBody.reason);
    assert.equal(paused.snapshot.whatWasBeingDone, checkpointBody.whatWasBeingDone);
    assert.equal(paused.snapshot.resumeLocation, checkpointBody.resumeLocation);
    assert.equal(paused.snapshot.howToResume, checkpointBody.howToResume);
    assert.match(paused.snapshot.pausedAt, /^\d{4}-\d{2}-\d{2}T/);

    const shown = (await request(fx, `/api/v2/tasks/${taskRef}`)).body.data;
    assert.equal(shown.task.pauseSnapshot.id, paused.snapshot.id);
    assert.equal(shown.task.statusLog.at(-1).toStatus, "planned");
  } finally {
    await closeServerFixture(fx);
  }
});

test("lifecycle family: reopen requires confirmation and a completed task", async () => {
  const fx = await startServerFixture({ name: "v2-lifecycle-reopen" });
  const taskRef = encodeURIComponent("P001(F001)/T001");
  const reopenPath = `/api/v2/tasks/${taskRef}/reopen`;
  try {
    const session = (await request(fx, "/api/v2/sessions", json({ clientKind: "cli" }))).body.data.session;
    const headers = { "X-Planner-Session": session.sessionId, "Content-Type": "application/json" };

    const notDone = await request(fx, reopenPath, { method: "POST", headers, body: JSON.stringify({ confirmed: true }), expectStatus: 409 });
    assert.equal(notDone.body.error.code, "TASK_REOPEN_NOT_DONE");

    const completed = (await request(fx, `/api/v2/tasks/${taskRef}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        descriptionUpdate: "Shipped the route and verified the focused suite.",
        force: true,
        motivation: "Checklist tracked an item that moved to another task.",
      }),
    })).body.data;
    assert.equal(completed.completed, true);

    const unconfirmed = await request(fx, reopenPath, { method: "POST", headers, body: JSON.stringify({}), expectStatus: 409 });
    assert.equal(unconfirmed.body.error.code, "TASK_REOPEN_CONFIRMATION_REQUIRED");

    const reopened = (await request(fx, reopenPath, { method: "POST", headers, body: JSON.stringify({ confirmed: true }) })).body.data;
    assert.equal(reopened.reopened, true);
    assert.equal(reopened.task.status, "in-progress");
    assert.equal(reopened.task.completedAt, "");
    assert.equal(reopened.task.activeOwnerSession, session.sessionId);
    assert.match(reopened.task.description, /Shipped the route and verified the focused suite/, "completion evidence is retained");

    const missingTask = await request(fx, `/api/v2/tasks/${encodeURIComponent("P001(F001)/T999")}/reopen`, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirmed: true }),
      expectStatus: 404,
    });
    assert.equal(missingTask.body.error.code, "TASK_NOT_FOUND");
  } finally {
    await closeServerFixture(fx);
  }
});

test("lifecycle family: switch pauses the source, claims the target and records the LIFO return", async () => {
  const fx = await startServerFixture({ name: "v2-lifecycle-switch" });
  const sourceRef = "P001(F001)/T001";
  const sourcePath = encodeURIComponent(sourceRef);
  try {
    const session = (await request(fx, "/api/v2/sessions", json({ clientKind: "mcp", agentId: "worker-1" }))).body.data.session;
    const headers = { "X-Planner-Session": session.sessionId, "Content-Type": "application/json" };

    const temporary = (await request(fx, "/api/v2/phases/P001/tasks", json({
      feature: "F001",
      title: "Temporary detour",
      description: "A detour task long enough to pass the flow's fifty-character execution-context rule.",
    }))).body.data;
    const targetRef = temporary.taskRef;
    const targetPath = encodeURIComponent(targetRef);

    // The target must pass the same read receipts as a start.
    await request(fx, `/api/v2/context/tasks/${sourcePath}`, { headers });
    await request(fx, `/api/v2/tasks/${sourcePath}/start`, { method: "POST", headers });

    const denied = await request(fx, "/api/v2/tasks/switch", {
      method: "POST",
      headers,
      body: JSON.stringify({
        fromTask: sourceRef,
        toTask: targetRef,
        reason: "Detour needed",
        whatWasBeingDone: "Wiring the login route",
        resumeLocation: "packages/plan-server/src/serve.ts:120",
        howToResume: "Continue the route wiring.",
      }),
      expectStatus: 409,
    });
    assert.equal(denied.body.error.code, "CONTEXT_READ_REQUIRED");
    assert.equal(denied.body.error.context.sourceRef, sourceRef);
    assert.equal(denied.body.error.context.targetRef, targetRef);
    assert.equal(denied.body.error.context.sourcePhaseRef, "P001(F001)");
    assert.equal(denied.body.error.context.targetPhaseRef, "P001(F001)");
    assert.ok(denied.body.error.evidence.contextEligibility.requiredReads.length > 0);

    const incomplete = await request(fx, "/api/v2/tasks/switch", {
      method: "POST",
      headers,
      body: JSON.stringify({ fromTask: sourceRef, toTask: targetRef }),
      expectStatus: 422,
    });
    assert.equal(incomplete.body.error.code, "SWITCH_CHECKPOINT_REQUIRED");
    assert.deepEqual(incomplete.body.error.missing, ["reason", "whatWasBeingDone", "resumeLocation", "howToResume"]);

    const unknown = await request(fx, "/api/v2/tasks/switch", {
      method: "POST",
      headers,
      body: JSON.stringify({
        fromTask: sourceRef,
        toTask: "P001(F001)/T999",
        reason: "Detour needed",
        whatWasBeingDone: "Wiring the login route",
        resumeLocation: "src/serve.ts:120",
        howToResume: "Continue.",
      }),
      expectStatus: 404,
    });
    assert.equal(unknown.body.error.code, "TASK_NOT_FOUND");

    const sameTask = await request(fx, "/api/v2/tasks/switch", {
      method: "POST",
      headers,
      body: JSON.stringify({
        fromTask: sourceRef,
        toTask: sourceRef,
        reason: "Detour needed",
        whatWasBeingDone: "Wiring the login route",
        resumeLocation: "src/serve.ts:120",
        howToResume: "Continue.",
      }),
      expectStatus: 409,
    });
    assert.equal(sameTask.body.error.code, "SWITCH_SAME_TASK");

    // One target context bundle satisfies the read gate.
    await request(fx, `/api/v2/context/tasks/${targetPath}`, { headers });

    const switched = (await request(fx, "/api/v2/tasks/switch", {
      method: "POST",
      headers,
      body: JSON.stringify({
        fromTask: sourceRef,
        toTask: targetRef,
        reason: "Detour needed before continuing",
        whatWasBeingDone: "Wiring the login route",
        resumeLocation: "packages/plan-server/src/serve.ts:120",
        howToResume: "Continue the route wiring after the detour.",
        switchedBy: "worker-1",
      }),
    })).body.data;
    assert.equal(switched.switched, true);
    assert.equal(switched.sourceRef, sourceRef);
    assert.equal(switched.targetRef, targetRef);
    assert.equal(switched.sourcePhaseRef, "P001(F001)");
    assert.equal(switched.targetPhaseRef, "P001(F001)");
    assert.equal(switched.snapshot.reason, "Detour needed before continuing");
    assert.equal(switched.snapshot.resumeLocation, "packages/plan-server/src/serve.ts:120");
    assert.equal(switched.deviation.state, "active");
    assert.equal(switched.deviation.ownerSession, session.sessionId);
    assert.match(switched.deviation.resumeTaskId, /^[0-9a-f-]{36}$/);
    assert.match(switched.deviation.temporaryTaskId, /^[0-9a-f-]{36}$/);
    assert.equal(switched.deviation.snapshot.id, switched.snapshot.id);

    // The lifecycle writes are persisted: source checkpointed, target owned.
    const source = (await request(fx, `/api/v2/tasks/${sourcePath}`)).body.data;
    assert.equal(source.task.status, "planned");
    assert.equal(source.task.activeOwnerSession, "");
    assert.equal(source.task.pauseSnapshot.resumeLocation, "packages/plan-server/src/serve.ts:120");
    assert.equal(source.task.pauseSnapshot.relatedTaskId, switched.deviation.temporaryTaskId);
    const target = (await request(fx, `/api/v2/tasks/${targetPath}`)).body.data;
    assert.equal(target.task.status, "in-progress");
    assert.equal(target.task.activeOwnerSession, session.sessionId);

    // Another session cannot take over work this session owns.
    const other = (await request(fx, "/api/v2/sessions", json({ clientKind: "cli" }))).body.data.session;
    const otherHeaders = { "X-Planner-Session": other.sessionId, "Content-Type": "application/json" };
    const foreign = await request(fx, "/api/v2/tasks/switch", {
      method: "POST",
      headers: otherHeaders,
      body: JSON.stringify({
        fromTask: targetRef,
        toTask: sourceRef,
        reason: "Try to take over",
        whatWasBeingDone: "Another worker's detour",
        resumeLocation: "src/other.ts:1",
        howToResume: "Continue.",
      }),
      expectStatus: 409,
    });
    assert.equal(foreign.body.error.code, "TASK_OWNED_BY_ANOTHER_SESSION");
  } finally {
    await closeServerFixture(fx);
  }
});

test("deviations family: an approved detour is recorded without touching task state", async () => {
  const fx = await startServerFixture({ name: "v2-deviations" });
  const resumeRef = "P001(F001)/T001";
  const resumePath = encodeURIComponent(resumeRef);
  try {
    const anonymous = await request(fx, "/api/v2/deviations", {
      ...json({ temporaryTask: resumeRef, reason: "Detour" }),
      expectStatus: 400,
    });
    assert.equal(anonymous.body.error.code, "SESSION_REQUIRED");

    const session = (await request(fx, "/api/v2/sessions", json({ clientKind: "mcp", agentId: "worker-1" }))).body.data.session;
    const headers = { "X-Planner-Session": session.sessionId, "Content-Type": "application/json" };
    const temporary = (await request(fx, "/api/v2/phases/P001/tasks", json({
      feature: "F001",
      title: "Approved detour",
      description: "A detour task long enough to pass the flow's fifty-character execution-context rule.",
    }))).body.data;
    const temporaryRef = temporary.taskRef;

    const incomplete = await request(fx, "/api/v2/deviations", {
      method: "POST",
      headers,
      body: JSON.stringify({ temporaryTask: temporaryRef }),
      expectStatus: 422,
    });
    assert.equal(incomplete.body.error.code, "DEVIATION_INPUT_REQUIRED");
    assert.deepEqual(incomplete.body.error.missing, ["reason"]);

    const unknown = await request(fx, "/api/v2/deviations", {
      method: "POST",
      headers,
      body: JSON.stringify({ temporaryTask: "P001(F001)/T999", reason: "Detour" }),
      expectStatus: 404,
    });
    assert.equal(unknown.body.error.code, "TASK_NOT_FOUND");

    const sameTask = await request(fx, "/api/v2/deviations", {
      method: "POST",
      headers,
      body: JSON.stringify({ temporaryTask: resumeRef, resumeTask: resumeRef, reason: "Detour" }),
      expectStatus: 422,
    });
    assert.equal(sameTask.body.error.code, "DEVIATION_SAME_TASK");

    const before = await readPlanSnapshot(fx.planRoot);
    const resumeTaskId = before.phases[0].tasks.find((task) => task.title === "Implement login").id;

    const approved = (await request(fx, "/api/v2/deviations", {
      method: "POST",
      headers,
      body: JSON.stringify({ temporaryTask: temporaryRef, resumeTask: resumeRef, reason: "Seed work must unblock the detour" }),
    })).body.data;
    assert.equal(approved.approved, true);
    assert.equal(approved.temporaryRef, temporaryRef);
    assert.equal(approved.resumeRef, resumeRef);
    assert.equal(approved.deviation.state, "approved");
    assert.equal(approved.deviation.ownerSession, session.sessionId);
    assert.equal(approved.deviation.resumeTaskId, resumeTaskId);
    assert.equal(approved.deviation.temporaryTaskId, temporary.task.id);
    assert.equal(approved.deviation.snapshot, null);

    // Bookkeeping only: neither task changed status or ownership.
    const after = await readPlanSnapshot(fx.planRoot);
    assert.deepEqual(
      after.phases[0].tasks.map((task) => [task.id, task.status, task.activeOwnerSession]),
      before.phases[0].tasks.map((task) => [task.id, task.status, task.activeOwnerSession]),
    );
    // Deviations live in worktree-local .local/deviations.json, never in
    // shared project.json.
    const stored = JSON.parse(await readFile(join(fx.planRoot, ".local", "deviations.json"), "utf-8")).at(-1);
    assert.equal(stored.id, approved.deviation.id);
    assert.equal(stored.reason, "Seed work must unblock the detour");
    assert.equal(stored.ownerSession, session.sessionId);

    const shown = (await request(fx, `/api/v2/tasks/${resumePath}`)).body.data;
    assert.equal(shown.task.status, "planned");
  } finally {
    await closeServerFixture(fx);
  }
});

test("session family: recovery is confirmed, identified by task ref and moves ownership", async () => {
  const fx = await startServerFixture({ name: "v2-session-recover" });
  const taskRef = "P001(F001)/T001";
  const taskPath = encodeURIComponent(taskRef);
  try {
    const session = (await request(fx, "/api/v2/sessions", json({ clientKind: "mcp", agentId: "worker-1" }))).body.data.session;
    const headers = { "X-Planner-Session": session.sessionId, "Content-Type": "application/json" };
    await request(fx, `/api/v2/context/tasks/${taskPath}`, { headers });
    await request(fx, `/api/v2/tasks/${taskPath}/start`, { method: "POST", headers });

    const heir = (await request(fx, "/api/v2/sessions", json({ clientKind: "cli" }))).body.data.session;
    const heirHeaders = { "X-Planner-Session": heir.sessionId, "Content-Type": "application/json" };
    const recoverPath = "/api/v2/sessions/recover";

    const anonymous = await request(fx, recoverPath, {
      ...json({ task: taskRef, confirmed: true }),
      expectStatus: 400,
    });
    assert.equal(anonymous.body.error.code, "SESSION_REQUIRED");

    const noTask = await request(fx, recoverPath, { method: "POST", headers: heirHeaders, body: JSON.stringify({ confirmed: true }), expectStatus: 422 });
    assert.equal(noTask.body.error.code, "TASK_REF_REQUIRED");

    const unknown = await request(fx, recoverPath, {
      method: "POST",
      headers: heirHeaders,
      body: JSON.stringify({ task: "P001(F001)/T999", confirmed: true }),
      expectStatus: 404,
    });
    assert.equal(unknown.body.error.code, "TASK_NOT_FOUND");

    const unconfirmed = await request(fx, recoverPath, {
      method: "POST",
      headers: heirHeaders,
      body: JSON.stringify({ task: taskRef, confirmed: false }),
      expectStatus: 409,
    });
    assert.equal(unconfirmed.body.error.code, "SESSION_RECOVERY_CONFIRMATION_REQUIRED");

    const before = await readPlanSnapshot(fx.planRoot);
    assert.equal(before.phases[0].tasks[0].activeOwnerSession, session.sessionId);

    const recovered = (await request(fx, recoverPath, {
      method: "POST",
      headers: heirHeaders,
      body: JSON.stringify({ task: taskRef, confirmed: true }),
    })).body.data;
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.taskRef, taskRef);
    assert.equal(recovered.phaseRef, "P001(F001)");
    assert.equal(recovered.featureRef, "F001");
    assert.deepEqual(recovered.taskIds, [before.phases[0].tasks[0].id]);
    assert.deepEqual(recovered.deviationIds, []);

    // Ownership moved; status, checkpoint and read gates are untouched.
    const shown = (await request(fx, `/api/v2/tasks/${taskPath}`)).body.data;
    assert.equal(shown.task.status, "in-progress");
    assert.equal(shown.task.activeOwnerSession, heir.sessionId);
    assert.equal(shown.task.startedAt, before.phases[0].tasks[0].startedAt);
  } finally {
    await closeServerFixture(fx);
  }
});
