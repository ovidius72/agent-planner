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
