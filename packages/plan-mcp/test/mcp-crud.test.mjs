/**
 * T237 (P055/F015) — MCP CRUD, validation, references, and requirements.
 *
 * Invokes the real published MCP server (via the T236 subprocess harness)
 * and verifies the domain contracts as a host would consume them:
 *  - CRUD across feature/phase/task with follow-up reads THROUGH MCP
 *  - validation: missing/invalid/ambiguous refs, missing motivation,
 *    schema failures — all without mutating the temporary plan
 *  - human references: composite F/P/T, bare P00x/T00x (global), shortId,
 *    UUID, and title resolution across show/update/delete/list filters
 *  - checklist add/toggle/remove and priority (reorder surface) updates
 *  - status transitions incl. the motivation gate and reopen
 *  - linked requirements surfaced via planner-phase-show (structured)
 *  - repair, integrity, and orphan cleanup (dry-run → confirmed)
 *  - no raw UUID leaks in actionable text when a composite ref exists
 *
 * No mocks: real server binary, real stdio, real PlanStore/filesystem.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createPhaseId } from "../../plan-core/dist/index.js";
import {
  startMcpClient,
  startMcpFixture,
  closeMcpFixture,
  cleanupMcpFixtures,
  callTool,
  expectToolError,
  toolText,
  toolStructured,
} from "../../../test/helpers/mcp-fixture.mjs";

after(async () => {
  await cleanupMcpFixtures();
});

const LONG = "src/mcp-crud.ts:10 existing state and the concrete goal for this entity; include file refs and behaviors to preserve so the description clears the 50-char minimum.";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function readTaskContext(session, task = "T001", phase = "P001", feature = "F001") {
  await callTool(session, "planner-task-show", { task, full: true });
  await callTool(session, "planner-phase-show", { phase, full: true });
  await callTool(session, "planner-feature-show", { feature, full: true });
  await callTool(session, "planner-requirement-list", {});
}

// ── Feature CRUD ───────────────────────────────────────────────────────────

test("feature CRUD: human refs, ambiguity, no UUID leak, follow-up reads", async () => {
  const session = await startMcpFixture({ name: "t237-feature" });
  try {
    // create → composite ref + shortId in text, never the raw UUID
    const created = await callTool(session, "planner-feature-add", { name: "Payments", description: LONG });
    const createdText = toolText(created);
    assert.match(createdText, /✅ Feature created: F002/);
    assert.match(createdText, /· [A-Z0-9]{5}/, "shortId surfaced in create output");
    assert.ok(!UUID_RE.test(createdText), "create output must not leak the raw UUID");

    const feature = (await session.store.loadFeatures()).features.find((entry) => entry.name === "Payments");
    const { id, shortId } = feature;

    // read back THROUGH MCP by every human ref form
    for (const ref of ["F002", shortId, "Payments", id]) {
      const shown = await callTool(session, "planner-feature-show", { feature: ref });
      assert.match(toolText(shown), /F002/, `show resolves ref ${ref}`);
    }

    // update by shortId → read back by name
    const renamed = await callTool(session, "planner-feature-update", { feature: shortId, name: "Payments v2" });
    assert.match(toolText(renamed), /F002/);
    const shown2 = await callTool(session, "planner-feature-show", { feature: "Payments v2" });
    assert.match(toolText(shown2), /Payments v2/);

    const beforeStatusUpdate = (await session.store.loadFeatures()).features.find((entry) => entry.id === id);
    const statusRejected = await callTool(session, "planner-feature-update", { feature: "Payments v2", status: "done" }, { expectError: true });
    assert.match(toolText(statusRejected), /DERIVED_STATUS_READ_ONLY/);
    assert.equal(toolStructured(statusRejected).updated, false);
    assert.equal(toolStructured(statusRejected).effectiveStatus, "planned");
    const afterStatusUpdate = (await session.store.loadFeatures()).features.find((entry) => entry.id === id);
    assert.equal(afterStatusUpdate.updatedAt, beforeStatusUpdate.updatedAt, "rejected status update does not mutate feature metadata");
    assert.equal(afterStatusUpdate.status, "planned", "feature status remains derived");

    // duplicate data → ambiguous name error, nothing mutated
    await callTool(session, "planner-feature-add", { name: "Payments v2", description: LONG });
    const ambiguous = await callTool(session, "planner-feature-show", { feature: "Payments v2" });
    expectToolError(ambiguous, /^Ambiguous feature ref: Payments v2\./);
    assert.ok(!toolText(ambiguous).includes("F002"), "ambiguous ref error never resolves to one entity");
    assert.equal((await session.store.loadFeatures()).features.filter((entry) => entry.name === "Payments v2").length, 2);

    // delete with phases: cascade removes, plain unlinks
    await callTool(session, "planner-feature-add", { name: "Reporting", description: LONG });
    const reporting = (await session.store.loadFeatures()).features.find((entry) => entry.name === "Reporting");
    await callTool(session, "planner-phase-add", { title: "Reporting phase", feature: reporting.shortId, description: LONG });
    const cascaded = await callTool(session, "planner-feature-delete", { feature: "Reporting", cascade: true });
    assert.match(toolText(cascaded), /deleted 1 phases/);
    const afterCascade = await session.store.loadAllPhases();
    assert.equal(afterCascade.some((entry) => entry.title === "Reporting phase"), false, "cascade deletes child phases");

    await callTool(session, "planner-feature-add", { name: "Audit", description: LONG });
    await callTool(session, "planner-phase-add", { title: "Audit phase", feature: "Audit", description: LONG });
    const unlinked = await callTool(session, "planner-feature-delete", { feature: "Audit" });
    assert.match(toolText(unlinked), /unlinked 1 phases/);
    const auditPhase = (await session.store.loadAllPhases()).find((entry) => entry.title === "Audit phase");
    assert.ok(auditPhase, "phase survives plain feature delete");
    assert.equal(auditPhase.featureId, undefined, "phase unlinked from the deleted feature");
  } finally {
    await closeMcpFixture(session);
  }
});

// ── Phase CRUD + validation + atomicity ────────────────────────────────────

test("phase CRUD: invalid parents rejected atomically, refs resolve, deletes clean up", async () => {
  const session = await startMcpFixture({ name: "t237-phase" });
  try {
    // trigger the one-time shortId/migration backfill with a read first, so
    // the counter snapshot is the post-migration baseline
    await callTool(session, "planner-show", {});
    const counters = await session.store.loadProject();

    // missing feature → actionable error, no phase, no number allocated
    const noFeature = await callTool(session, "planner-phase-add", { title: "Orphan", description: LONG });
    expectToolError(noFeature, /feature is required/i);
    // unresolved feature → no phase, counter untouched
    const badFeature = await callTool(session, "planner-phase-add", { title: "Orphan", feature: "F999", description: LONG });
    expectToolError(badFeature, /Feature not found: F999/);
    const after = await session.store.loadProject();
    assert.equal(after.nextPhaseNumber, counters.nextPhaseNumber, "rejected phase-add does not allocate a number");
    assert.equal((await session.store.loadAllPhases()).some((entry) => entry.title === "Orphan"), false);

    // valid create → composite + shortId, no UUID leak
    const created = await callTool(session, "planner-phase-add", { title: "Payouts", feature: "F001", description: LONG });
    const createdText = toolText(created);
    assert.match(createdText, /✅ Phase created: P002\(F001\)/);
    assert.ok(!UUID_RE.test(createdText), "phase create output must not leak the raw UUID");

    const phase = (await session.store.loadAllPhases()).find((entry) => entry.title === "Payouts");
    const { id, shortId } = phase;

    // every ref form resolves for show and update
    for (const ref of ["P002", "P002(F001)", shortId, "Payouts", id]) {
      const shown = await callTool(session, "planner-phase-show", { phase: ref });
      assert.match(toolText(shown), /P002\(F001\)/, `phase-show resolves ref ${ref}`);
    }

    // phase status is DERIVED from tasks (empty phase → draft); status update
    // attempts are rejected instead of reporting a false-success mutation.
    const before = await callTool(session, "planner-phase-show", { phase: "P002" });
    assert.match(toolText(before), /\(draft; 0 tasks\)/, "empty phase derives draft");
    const rejectedStatus = await callTool(session, "planner-phase-update", { phase: shortId, title: "Payouts v2", status: "in-progress" }, { expectError: true });
    assert.match(toolText(rejectedStatus), /DERIVED_STATUS_READ_ONLY/);
    assert.equal(toolStructured(rejectedStatus).updated, false);
    assert.equal(toolStructured(rejectedStatus).effectiveStatus, "draft");
    const storedAfterRejection = await session.store.loadPhase(id);
    assert.equal(storedAfterRejection.title, "Payouts", "mixed status update is rejected atomically");
    const updated = await callTool(session, "planner-phase-update", { phase: shortId, title: "Payouts v2" });
    assert.match(toolText(updated), /P002\(F001\)/);
    const stored = await session.store.loadPhase(id);
    assert.equal(stored.title, "Payouts v2");
    const readBack = await callTool(session, "planner-phase-show", { phase: "P002" });
    assert.match(toolText(readBack), /Payouts v2/, "renamed phase reads back through MCP");
    assert.match(toolText(readBack), /\(draft; 0 tasks\)/, "status stays derived (draft) with no tasks");

    // delete → gone from store, feature phaseIds cleaned
    const deleted = await callTool(session, "planner-phase-delete", { phase: "P002" });
    assert.match(toolText(deleted), /Phase deleted: P002\(F001\)/);
    assert.equal((await session.store.loadAllPhases()).some((entry) => entry.id === id), false);
    const feature = (await session.store.loadFeatures()).features.find((entry) => entry.name === "Auth API");
    assert.equal(feature.phaseIds.includes(id), false, "feature.phaseIds cleaned on phase delete");

    // invalid phase ref on show/delete → error, no mutation
    expectToolError(await callTool(session, "planner-phase-show", { phase: "P999" }), /Phase not found: P999/);
    expectToolError(await callTool(session, "planner-phase-delete", { phase: "P999" }), /Phase not found: P999/);
    assert.equal((await session.store.loadAllPhases()).length, 1, "only the seed phase remains");
  } finally {
    await closeMcpFixture(session);
  }
});

// ── Task CRUD + status transitions + motivation gate ───────────────────────

test("task CRUD: checklist, motivation gate, reopen, no UUID leak", async () => {
  const session = await startMcpFixture({ name: "t237-task" });
  try {
    // trigger the one-time shortId/migration backfill with a read first, so
    // the counter snapshot is the post-migration baseline
    await callTool(session, "planner-show", {});
    const counters = await session.store.loadProject();

    // invalid parent refs → actionable errors, no number allocated, no task
    expectToolError(await callTool(session, "planner-task-add", { feature: "F001", phase: "P999", title: "Ghost", description: LONG }), /Phase not found: P999/);
    expectToolError(await callTool(session, "planner-task-add", { phase: "P001", title: "No parent", description: LONG }), /feature is required/i);
    expectToolError(await callTool(session, "planner-task-add", { feature: "F999", phase: "P001", title: "Ghost", description: LONG }), /Feature not found: F999/);
    const afterRejects = await session.store.loadProject();
    assert.equal(afterRejects.nextTaskNumber, counters.nextTaskNumber, "rejected task-add does not allocate a number");
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).some((entry) => entry.title === "Ghost"), false);

    // valid create with checklist → composite + shortId, no UUID leak
    const created = await callTool(session, "planner-task-add", {
      feature: "F001", phase: "P001", title: "Refund flow", description: LONG, checklist: ["Validate", "Execute"],
    });
    const createdText = toolText(created);
    assert.match(createdText, /✅ Task created: P001\(F001\)\/T002/);
    assert.match(createdText, /· [A-Z0-9]{5}/);
    assert.ok(!UUID_RE.test(createdText), "task create output must not leak the raw UUID");

    const task = (await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.title === "Refund flow");
    const { id, shortId } = task;

    // every ref form resolves
    for (const ref of ["T002", "P001(F001)/T002", "F001/P001/T002", shortId, "Refund flow", id]) {
      const shown = await callTool(session, "planner-task-show", { task: ref });
      assert.match(toolText(shown), /P001\(F001\)\/T002/, `task-show resolves ref ${ref}`);
    }

    // status gate: blocked without motivation → error, no mutation
    const noMotivation = await callTool(session, "planner-task-update", { task: "T002", status: "blocked" });
    expectToolError(noMotivation, /requires a motivation/);
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).status, "planned");

    // Starting is a dedicated lifecycle operation, not a generic update.
    const genericStart = await callTool(session, "planner-task-update", { task: "T002", status: "in-progress" });
    expectToolError(genericStart, /require planner-task-start/);
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).status, "planned");

    // with motivation → transition + statusLog entry
    const blocked = await callTool(session, "planner-task-update", { task: "T002", status: "blocked", motivation: "Waiting on the payments provider contract." });
    assert.match(toolText(blocked), /\(blocked\)/);
    const blockedTask = (await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id);
    assert.equal(blockedTask.status, "blocked");
    assert.equal(blockedTask.statusLog.at(-1).toStatus, "blocked");
    assert.equal(blockedTask.statusLog.at(-1).title, "Waiting on the payments provider contract.");

    // checklist ops: add C3, toggle C1, remove C2 → renumber
    await callTool(session, "planner-task-checklist-add", { task: "T002", title: "Ship" });
    await callTool(session, "planner-task-checklist-toggle", { task: "T002", item: "C1" });
    await callTool(session, "planner-task-checklist-remove", { task: "T002", item: "C2" });
    const checklist = (await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).checklist;
    assert.deepEqual(checklist.map((item) => item.title), ["Validate", "Ship"], "checklist add/toggle/remove renumbers cleanly");
    assert.equal(checklist[0].checked, true, "toggle marks C1 done");

    // make T002 the highest-priority ready task (seed T001 has priority 10)
    await callTool(session, "planner-task-update", { task: "T002", priority: 5 });

    // blocked is not startable → reopen to planned (motivation required) first
    await callTool(session, "planner-task-update", { task: "T002", status: "planned", motivation: "Provider contract signed; resume work." });

    // Generic updates cannot bypass the dedicated completion path.
    const directDone = await callTool(session, "planner-task-update", { task: "T002", status: "done" });
    assert.match(toolText(directDone), /completion transitions require planner-task-complete/);
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).status, "planned");

    // Lifecycle work is rejected without the ordered full-read sequence.
    const deniedWithoutReads = await callTool(session, "planner-task-start", { task: "T002" });
    assert.equal(deniedWithoutReads.isError, true);
    assert.equal(toolStructured(deniedWithoutReads).started, false);
    assert.equal(toolStructured(deniedWithoutReads).errorCode, "CONTEXT_READ_REQUIRED");
    assert.match(toolText(deniedWithoutReads), /TASK START FAILED.*started: false/s);
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).status, "planned");

    await callTool(session, "planner-task-show", { task: "T002", full: true });
    await callTool(session, "planner-phase-show", { phase: "P001", full: true });
    await callTool(session, "planner-feature-show", { feature: "F001", full: true });
    const deniedWithoutRequirements = await callTool(session, "planner-task-start", { task: "T002" });
    assert.equal(deniedWithoutRequirements.isError, true);
    assert.equal(toolStructured(deniedWithoutRequirements).errorCode, "REQUIREMENTS_READ_REQUIRED");
    assert.deepEqual(toolStructured(deniedWithoutRequirements).nextActions, ["planner-requirement-list", "Retry planner-task-start P001(F001)/T002"]);
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).status, "planned");

    // lifecycle: requirement read + retry succeeds with a verified postcondition.
    await callTool(session, "planner-requirement-list", {});
    const started = await callTool(session, "planner-task-start", { task: "T002" });
    assert.match(toolText(started), /Task started: P001\(F001\)\/T002/);
    assert.equal(started.isError, undefined);
    assert.equal(toolStructured(started).started, true);
    assert.equal(toolStructured(started).status, "in-progress");
    const paused = await callTool(session, "planner-task-pause", {
      task: "T002", reason: "Temporary review interruption", what_was_being_done: "Validating the provider contract",
      resume_location: "src/provider.ts:20", how_to_resume: "Continue validation and rerun provider tests", paused_by: "mcp-test",
    });
    assert.match(toolText(paused), /Resume checkpoint saved: P001\(F001\)\/T002/);
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).status, "planned");

    // The stdio MCP process keeps one isolated fallback session ID. Pause
    // invalidates only the changed task; parent and requirement attestations
    // remain reusable, so the retry asks for task context only.
    const deniedResume = await callTool(session, "planner-task-start", { task: "T002" });
    assert.equal(toolStructured(deniedResume).errorCode, "CONTEXT_READ_REQUIRED");
    assert.deepEqual(toolStructured(deniedResume).nextActions, [
      "planner-task-show P001(F001)/T002 with full=true",
      "Retry planner-task-start P001(F001)/T002",
    ]);
    await callTool(session, "planner-task-show", { task: "T002", full: true });
    assert.match(toolText(await callTool(session, "planner-task-start", { task: "T002" })), /Task started/);
    const missingEvidence = await callTool(session, "planner-task-complete", { task: "T002", force: true }, { expectError: true });
    assert.match(toolText(missingEvidence), /description_update/);
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).status, "in-progress");
    const done = await callTool(session, "planner-task-complete", { task: "T002", force: true, description_update: "Created task completed and verified through MCP CRUD coverage." });
    assert.match(toolText(done), /\(done\)/);
    const doneTask = (await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id);
    assert.equal(doneTask.status, "done");
    assert.ok(doneTask.completedAt);

    const reopenNoMotivation = await callTool(session, "planner-task-update", { task: "T002", status: "planned" });
    expectToolError(reopenNoMotivation, /requires a motivation/);
    await callTool(session, "planner-task-update", { task: "T002", status: "planned", motivation: "Reopening: refund edge case found in review." });
    const reopened = (await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id);
    assert.equal(reopened.status, "planned");
    assert.equal(reopened.completedAt, "", "reopen clears completedAt");

    // delete → gone from phase, taskIds cleaned
    const deleted = await callTool(session, "planner-task-delete", { task: "T002" });
    assert.match(toolText(deleted), /Task deleted: P001\(F001\)\/T002/);
    assert.ok(!toolText(deleted).includes(id), "task delete output uses composite ref, not UUID");
    const phase = (await session.store.loadAllPhases())[0];
    assert.equal(phase.tasks.some((entry) => entry.id === id), false);
    assert.equal(phase.taskIds.includes(id), false);
  } finally {
    await closeMcpFixture(session);
  }
});

test("distinct MCP server processes cannot reuse each other's context attestations", async () => {
  const first = await startMcpFixture({ name: "t337-mcp-session-isolation" });
  const planRoot = first.planRoot;
  try {
    await readTaskContext(first, "T001");
    assert.equal(toolStructured(await callTool(first, "planner-task-start", { task: "T001" })).started, true);
  } finally {
    await closeMcpFixture(first);
  }

  const second = await startMcpClient({ planRoot, name: "t337-second-mcp-process" });
  try {
    const denied = await callTool(second, "planner-task-start", { task: "T001" });
    assert.equal(toolStructured(denied).errorCode, "CONTEXT_READ_REQUIRED");
    assert.deepEqual(toolStructured(denied).contextEligibility.requiredReads.map((read) => read.kind), ["task", "phase", "feature"]);
    assert.deepEqual(toolStructured(denied).nextActions, [
      "planner-task-show P001(F001)/T001 with full=true",
      "planner-phase-show P001(F001) with full=true",
      "planner-feature-show F001 with full=true",
      "planner-requirement-list",
      "Retry planner-task-start P001(F001)/T001",
    ]);
  } finally {
    await closeMcpFixture(second);
  }
});


test("planned sibling can start when another task makes the parent derive waiting", async () => {
  const session = await startMcpFixture({ name: "t237-waiting-sibling" });
  try {
    await callTool(session, "planner-task-add", {
      feature: "F001",
      phase: "P001",
      title: "Waiting sibling",
      description: "src/waiting-sibling.ts:10 sibling task used to prove waiting parent status does not block unrelated planned work.",
    });
    await callTool(session, "planner-task-update", {
      task: "T002",
      status: "waiting",
      motivation: "External dependency is not ready yet.",
    });

    const phase = (await session.store.loadAllPhases()).find((entry) => entry.number === 1);
    const feature = (await session.store.loadFeatures()).features.find((entry) => entry.number === 1);
    assert.equal(phase.status, "waiting", "sibling waiting task makes the phase derive waiting");
    assert.equal(feature.status, "waiting", "waiting phase makes the feature derive waiting");

    await readTaskContext(session, "T001", "P001", "F001");
    const started = await callTool(session, "planner-task-start", { task: "T001" });
    assert.match(toolText(started), /Task started: P001\(F001\)\/T001/);
    const updatedPhase = (await session.store.loadAllPhases()).find((entry) => entry.number === 1);
    assert.equal(updatedPhase.tasks.find((task) => task.number === 1).status, "in-progress");
  } finally {
    await closeMcpFixture(session);
  }
});

// ── List filters + reorder (priority) surface ──────────────────────────────

test("list filters and priority (reorder) updates are visible through reads", async () => {
  const session = await startMcpFixture({ name: "t237-lists" });
  try {
    await callTool(session, "planner-feature-add", { name: "Billing", description: LONG });
    await callTool(session, "planner-phase-add", { title: "Billing phase", feature: "F002", description: LONG });

    // feature-list filter by ref
    const fList = await callTool(session, "planner-feature-list", { featureRef: "F002" });
    assert.match(toolText(fList), /F002/);
    assert.ok(!toolText(fList).includes("F001"), "feature-list filter scopes to the ref");

    // phase-list filters by featureRef and status
    const pList = await callTool(session, "planner-phase-list", { featureRef: "F002" });
    assert.match(toolText(pList), /P002\(F002\)/);
    const pByStatus = await callTool(session, "planner-phase-list", { status: "planned" });
    assert.match(toolText(pByStatus), /P001\(F001\)/);
    assert.ok(!toolText(pByStatus).includes("(in-progress)"), "status filter narrows the list");

    // task-list filters by phaseRef and status
    const tByPhase = await callTool(session, "planner-task-list", { phaseRef: "P001" });
    assert.match(toolText(tByPhase), /P001\(F001\)\/T001/);
    const tByStatus = await callTool(session, "planner-task-list", { status: "planned" });
    assert.match(toolText(tByStatus), /T001/);

    // reorder surface: priority updates persist and read back
    await callTool(session, "planner-feature-update", { feature: "F002", priority: 5 });
    await callTool(session, "planner-phase-update", { phase: "P002", priority: 5 });
    await callTool(session, "planner-task-update", { task: "T001", priority: 50 });
    const features = (await session.store.loadFeatures()).features;
    assert.equal(features.find((entry) => entry.name === "Billing").priority, 5);
    const phases = await session.store.loadAllPhases();
    assert.equal(phases.find((entry) => entry.title === "Billing phase").priority, 5);
    const seedTask = phases.find((entry) => entry.number === 1).tasks[0];
    assert.equal(seedTask.priority, 50, "task priority update persists");
    // reading back through MCP reflects the persisted values
    const updatedF = await callTool(session, "planner-feature-show", { feature: "F002", full: true });
    assert.match(toolText(updatedF), /Billing/);
  } finally {
    await closeMcpFixture(session);
  }
});

// ── Linked requirements (MCP-visible surface) ──────────────────────────────

test("planner-phase-show gives structured-content clients the full phase read model", async () => {
  const session = await startMcpFixture({ name: "t237-requirements" });
  try {
    const storedPhase = (await session.store.loadAllPhases())[0];
    const shown = await callTool(session, "planner-phase-show", { phase: "P001", full: true });
    assert.match(toolText(shown), /1 linked requirement/);
    const structured = toolStructured(shown);
    assert.deepEqual(structured.phase, {
      ref: "P001(F001)",
      shortId: storedPhase.shortId,
      title: storedPhase.title,
      summary: storedPhase.summary,
      status: storedPhase.status,
      taskCount: storedPhase.tasks.length,
      description: storedPhase.description,
    }, "Claude-style structured-content consumers receive the phase title and detailed description");
    assert.ok(Array.isArray(structured.linkedRequirements), "phase-show exposes linkedRequirements");
    assert.equal(structured.linkedRequirements.length, 1);
    assert.equal(structured.linkedRequirements[0].title, "Users can authenticate");
    assert.deepEqual(structured.linkedRequirements[0].linkedPhaseIds, [storedPhase.id], "structured link points at the seed phase");

    // Compact reads stay compact but still identify the phase structurally.
    const compact = await callTool(session, "planner-phase-show", { phase: "P001" });
    assert.match(toolText(compact), /1 linked requirement/);
    assert.equal(toolStructured(compact).phase.description, undefined);
  } finally {
    await closeMcpFixture(session);
  }
});

test("priority is overridable but active task switches require a snapshot and deterministic return", async () => {
  const session = await startMcpFixture({ name: "t281-explicit-start" });
  try {
    for (const title of ["Explicit lower-priority task", "Another temporary task"]) {
      await callTool(session, "planner-task-add", {
        feature: "F001",
        phase: "P001",
        title,
        description: "src/task-start.ts:1 deliberately select temporary work while preserving the prior checkpoint.",
      });
    }

    await readTaskContext(session, "T002");
    const priorityOverride = await callTool(session, "planner-task-start", { task: "T002" });
    assert.match(toolText(priorityOverride), /✅ Task started: P001\(F001\)\/T002/);
    assert.match(toolText(priorityOverride), /Priority advisory/);

    // T002 already attested the shared phase, feature, and requirements.
    // A sibling start requires only the exact new task read.
    await callTool(session, "planner-task-show", { task: "T001", full: true });
    const denied = await callTool(session, "planner-task-start", { task: "T001" });
    assert.equal(denied.isError, true);
    assert.equal(toolStructured(denied).started, false);
    assert.equal(toolStructured(denied).errorCode, "ACTIVE_TASK_CONFLICT");
    assert.match(toolText(denied), /TASK START FAILED.*planner-task-switch/is);

    // The attestation created by the denied start is reusable without rereading parents.
    const deniedAgain = await callTool(session, "planner-task-start", { task: "T001" });
    assert.equal(toolStructured(deniedAgain).errorCode, "ACTIVE_TASK_CONFLICT");

    const switched = await callTool(session, "planner-task-switch", {
      from_task: "T002", to_task: "T001", reason: "Seed task must unblock temporary implementation",
      what_was_being_done: "Editing the lower-priority implementation", resume_location: "src/task-start.ts:20",
      how_to_resume: "Continue implementation and rerun focused tests", switched_by: "mcp-test",
    });
    assert.match(toolText(switched), /Task switched: P001\(F001\)\/T002 → P001\(F001\)\/T001/);
    let tasks = (await session.store.loadAllPhases())[0].tasks;
    assert.deepEqual(tasks.map((task) => task.status), ["in-progress", "planned", "planned"]);
    assert.equal(tasks[1].pauseSnapshot.resumeLocation, "src/task-start.ts:20");

    const done = await callTool(session, "planner-task-complete", { task: "T001", force: true, description_update: "Temporary task completed and verified through MCP switch coverage." });
    assert.match(toolText(done), /RESUME REQUIRED: P001\(F001\)\/T002/);
    assert.equal((await session.store.loadProject()).workDeviations.at(-1).state, "resume-required");

    const shownResume = await callTool(session, "planner-task-show", { task: "T002", full: true });
    assert.match(toolText(shownResume), /Resume advisory:/);
    assert.match(toolText(shownResume), /Work checkpoint: Editing the lower-priority implementation/);
    assert.match(toolText(shownResume), /Resume from: src\/task-start\.ts:20/);

    await readTaskContext(session, "T003");
    const skipAdvisory = await callTool(session, "planner-task-start", { task: "T003" });
    assert.match(toolText(skipAdvisory), /✅ Task started: P001\(F001\)\/T003/);
    assert.match(toolText(skipAdvisory), /RESUME REQUIRED before starting a different task: P001\(F001\)\/T002/);
    const skipStructured = toolStructured(skipAdvisory);
    assert.ok(skipStructured?.resumeRequired, "task_start while a resume-required is pending must return an explicit structured resumeRequired proposal");
    assert.equal(skipStructured.resumeRequired.taskId, tasks[1].id);
    assert.equal(skipStructured.resumeRequired.snapshot?.resumeLocation, "src/task-start.ts:20");
    let project = await session.store.loadProject();
    assert.equal(project.workDeviations.at(-1).state, "resume-required");

    await callTool(session, "planner-task-complete", { task: "T003", force: true, description_update: "Second temporary task completed and verified." });
    await readTaskContext(session, "T002");
    const resumed = await callTool(session, "planner-task-start", { task: "T002" });
    assert.match(toolText(resumed), /Task started/);
    tasks = (await session.store.loadAllPhases())[0].tasks;
    assert.equal(tasks[1].status, "in-progress");
    assert.equal(tasks[1].pauseSnapshot, null);
    project = await session.store.loadProject();
    assert.equal(project.workDeviations.at(-1).state, "resumed");

    const finishedResumeTarget = await callTool(session, "planner-task-complete", { task: "T002", force: true, description_update: "Resume target completed and verified." });
    assert.doesNotMatch(toolText(finishedResumeTarget), /RESUME REQUIRED:/);
    project = await session.store.loadProject();
    assert.equal(project.workDeviations.length, 0);
    const shownDone = await callTool(session, "planner-task-show", { task: "T002", full: true });
    assert.doesNotMatch(toolText(shownDone), /Resume advisory:/);
  } finally {
    await closeMcpFixture(session);
  }
});

// ── Repair, integrity, orphan cleanup ──────────────────────────────────────

test("repair, integrity, and orphan cleanup flow", async () => {
  const session = await startMcpFixture({ name: "t237-repair" });
  try {
    // clean plan → repair reports zero issues
    const clean = await callTool(session, "planner-repair", {});
    const cleanReport = toolStructured(clean).report;
    assert.equal(cleanReport.integrity.duplicatePhaseIds.length, 0);
    assert.equal(cleanReport.integrity.danglingPhaseIds.length, 0);
    assert.match(toolText(clean), /Repair done:/);

    // inject an orphan phase (featureId points at a nonexistent feature)
    const orphanId = createPhaseId();
    await mkdir(join(session.planRoot, "phases"), { recursive: true });
    await writeFile(
      join(session.planRoot, "phases", `${orphanId}.json`),
      JSON.stringify({
        id: orphanId, number: 99, featureId: createPhaseId(), slug: "orphan", title: "Orphan phase",
        status: "planned", tasks: [], taskIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }, null, 2),
    );

    // dry-run lists it, never deletes
    const dry = await callTool(session, "planner-cleanup-orphan-phases", {});
    assert.match(toolText(dry), /Found 1 orphan phase/);
    assert.match(toolText(dry), /Rerun with confirm=true/);
    assert.equal((await session.store.loadAllPhases()).some((entry) => entry.id === orphanId), true, "dry-run leaves the orphan");

    // confirm removes it
    const confirmed = await callTool(session, "planner-cleanup-orphan-phases", { confirm: true });
    assert.match(toolText(confirmed), /Removed 1 orphan phase/);
    assert.equal((await session.store.loadAllPhases()).some((entry) => entry.id === orphanId), false, "confirmed cleanup deletes the file");
  } finally {
    await closeMcpFixture(session);
  }
});
