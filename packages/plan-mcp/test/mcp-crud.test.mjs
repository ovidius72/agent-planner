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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
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
  await callTool(session, "planner-requirement-list", { phaseRef: phase });
}

test("writer contention stays readable and surfaces PLAN_WRITER_BUSY through MCP", async () => {
  const session = await startMcpFixture({
    name: "writer-busy",
    seed: "empty",
    env: {
      AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS: "60",
      AGENT_PLAN_WRITE_LOCK_RETRY_MS: "10",
    },
  });
  const lockPath = join(session.planRoot, ".local", "locks", "writer.lock");
  try {
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      token: "external-writer",
      pid: process.pid,
      hostname: hostname(),
      cwd: session.root,
      acquiredAt: new Date().toISOString(),
    }), "utf8");

    assert.match(toolText(await callTool(session, "planner-feature-list", {})), /No features/);
    const blocked = await callTool(session, "planner-feature-add", {
      name: "Blocked writer",
      description: LONG,
    }, { expectError: true });
    assert.match(toolText(blocked), /PLAN_WRITER_BUSY.*Read-only operations remain available/s);
    assert.equal((await session.store.loadFeatures()).features.length, 0);
  } finally {
    await rm(lockPath, { recursive: true, force: true });
    await closeMcpFixture(session);
  }
});

// ── Feature CRUD ───────────────────────────────────────────────────────────

test("concurrent MCP processes create linked phases without duplicate priority or lost feature links", async () => {
  const first = await startMcpFixture({ name: "concurrent-phase-create" });
  const second = await startMcpClient({ planRoot: first.planRoot, name: "concurrent-phase-create-second" });
  try {
    await Promise.all([
      callTool(first, "planner-phase-add", { title: "Concurrent phase A", feature: "F001", description: LONG }),
      callTool(second, "planner-phase-add", { title: "Concurrent phase B", feature: "F001", description: LONG }),
    ]);
    const allPhases = await first.store.loadAllPhases();
    const created = allPhases.filter((phase) => phase.title.startsWith("Concurrent phase"));
    assert.equal(created.length, 2);
    assert.equal(new Set(created.map((phase) => phase.priority)).size, 2, "root transactions serialize nextPriority allocation");
    const feature = (await first.store.loadFeatures()).features.find((entry) => entry.number === 1);
    assert.ok(feature);
    assert.ok(created.every((phase) => feature.phaseIds.includes(phase.id)), "both phase links persist on the feature");
  } finally {
    await closeMcpFixture(second);
    await closeMcpFixture(first);
  }
});

test("concurrent MCP task starts preserve per-session active ownership", async () => {
  const first = await startMcpFixture({ name: "concurrent-task-start" });
  const second = await startMcpClient({ planRoot: first.planRoot, name: "concurrent-task-start-second" });
  try {
    const created = await callTool(first, "planner-task-add", { feature: "F001", phase: "P001", title: "Concurrent sibling", description: LONG });
    assert.match(toolText(created), /Task created/);
    const tasks = (await first.store.loadAllPhases())[0].tasks;
    const seedRef = `T${String(tasks.find((task) => task.title !== "Concurrent sibling").number).padStart(3, "0")}`;
    const siblingRef = `T${String(tasks.find((task) => task.title === "Concurrent sibling").number).padStart(3, "0")}`;
    await readTaskContext(first, seedRef);
    await readTaskContext(second, siblingRef);

    const starts = await Promise.all([
      callTool(first, "planner-task-start", { task: seedRef }),
      callTool(second, "planner-task-start", { task: siblingRef }),
    ]);
    assert.equal(starts.filter((result) => toolStructured(result)?.started === true).length, 2);
    const activeOwnership = starts.map((result) => toolStructured(result).task.activeOwnerSession);
    assert.equal(new Set(activeOwnership).size, 2, "each active task should record a distinct owning session");
    const active = (await first.store.loadAllPhases()).flatMap((phase) => phase.tasks).filter((task) => task.status === "in-progress");
    assert.equal(active.length, 2);
    assert.deepEqual(active.map((task) => task.activeOwnerSession).filter(Boolean).length, 2);
  } finally {
    await closeMcpFixture(second);
    await closeMcpFixture(first);
  }
});

test("an MCP lifecycle write preserves metadata committed by another process after its earlier read", async () => {
  const first = await startMcpFixture({ name: "cross-process-stale-lifecycle" });
  const second = await startMcpClient({ planRoot: first.planRoot, name: "cross-process-stale-lifecycle-second" });
  try {
    await readTaskContext(first, "T001");
    const workDone = "Metadata committed by the second MCP process after the first process read context.";
    await callTool(second, "planner-feature-update", { feature: "F001", workDone });

    const started = await callTool(first, "planner-task-start", { task: "T001" });
    assert.equal(toolStructured(started).started, true);
    const persisted = (await first.store.loadFeatures()).features[0];
    assert.equal(persisted.workDone, workDone);
  } finally {
    await closeMcpFixture(second);
    await closeMcpFixture(first);
  }
});

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
    await callTool(session, "planner-feature-add", { name: "Parity owner", description: LONG });
    const directDescriptionRef = ".planner/docs/p094-pane-hosts-any-app.md";
    const updated = await callTool(session, "planner-phase-update", {
      phase: shortId,
      title: "Payouts v2",
      featureId: "F002",
      descriptionRef: directDescriptionRef,
      goals: ["Ship payouts"],
      nonGoals: ["Redesign billing"],
      dependencies: ["Provider contract"],
      risks: ["Provider outage"],
      openQuestions: ["Which region first?"],
      completionCriteria: ["Payout succeeds"],
    });
    assert.match(toolText(updated), /P002\(F002\)/);
    let stored = await session.store.loadPhase(id);
    assert.equal(stored.title, "Payouts v2");
    assert.equal(stored.featureId, (await session.store.loadFeatures()).features.find((entry) => entry.number === 2).id);
    assert.equal(stored.descriptionRef, directDescriptionRef);
    assert.deepEqual(stored.goals, ["Ship payouts"]);
    assert.deepEqual(stored.nonGoals, ["Redesign billing"]);
    assert.deepEqual(stored.dependencies, ["Provider contract"]);
    assert.deepEqual(stored.risks, ["Provider outage"]);
    assert.deepEqual(stored.openQuestions, ["Which region first?"]);
    assert.deepEqual(stored.completionCriteria, ["Payout succeeds"]);
    const phaseDecisionsRejected = await callTool(session, "planner-phase-update", { phase: shortId, decisions: ["Should be rejected"] });
    assert.equal(toolStructured(phaseDecisionsRejected).updated, false);
    assert.equal(toolStructured(phaseDecisionsRejected).errorCode, "LEGACY_DECISIONS_ARRAY_READ_ONLY");
    const featureOwners = (await session.store.loadFeatures()).features;
    assert.equal(featureOwners.find((entry) => entry.number === 1).phaseIds.includes(id), false);
    assert.equal(featureOwners.find((entry) => entry.number === 2).phaseIds.includes(id), true);

    const discussed = await callTool(session, "planner-phase-discuss", {
      phase: "P002",
      goals: ["Keep derived status"],
      summary: "Governance context captured",
      openQuestions: ["Who signs off?"],
    });
    assert.equal(toolStructured(discussed).contextReady, true);
    stored = await session.store.loadPhase(id);
    assert.equal(stored.status, "draft", "phase discuss does not override derived status");
    assert.equal(stored.contextReady, true);
    assert.deepEqual(stored.goals, ["Keep derived status"]);
    assert.deepEqual(stored.openQuestions, ["Who signs off?"]);

    const readBack = await callTool(session, "planner-phase-show", { phase: "P002" });
    assert.match(toolText(readBack), /Payouts v2/, "renamed phase reads back through MCP");
    assert.match(toolText(readBack), /P002\(F002\)/, "relinked phase reads back with its new owner");
    assert.match(toolText(readBack), /\(draft; 0 tasks\)/, "status stays derived (draft) with no tasks");

    // delete → gone from store, feature phaseIds cleaned
    const deleted = await callTool(session, "planner-phase-delete", { phase: "P002" });
    assert.match(toolText(deleted), /Phase deleted: P002\(F002\)/);
    assert.equal((await session.store.loadAllPhases()).some((entry) => entry.id === id), false);
    const feature = (await session.store.loadFeatures()).features.find((entry) => entry.name === "Parity owner");
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

    const parityUpdate = await callTool(session, "planner-task-update", {
      task: "T002",
      descriptionRef: ".planner/docs/tasks/refund-flow.md",
      notes: "Provider behavior verified.",
      checklist: ["Review", "Execute"],
      subtasks: [{ title: "Validate provider", description: "Check contract" }, { title: "Execute refund" }],
    });
    assert.equal(toolStructured(parityUpdate).updated, true);
    assert.deepEqual(toolStructured(parityUpdate).updatedFields.sort(), ["checklist", "descriptionRef", "notes", "subtasks"]);
    const parityTask = (await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id);
    assert.equal(parityTask.descriptionRef, ".planner/docs/tasks/refund-flow.md");
    assert.equal(parityTask.notes, "Provider behavior verified.");
    assert.deepEqual(parityTask.checklist.map((item) => item.title), ["Review", "Execute"]);
    const taskDecisionsRejected = await callTool(session, "planner-task-update", { task: "T002", decisions: ["Should be rejected"] });
    assert.equal(toolStructured(taskDecisionsRejected).updated, false);
    assert.equal(toolStructured(taskDecisionsRejected).errorCode, "LEGACY_DECISIONS_ARRAY_READ_ONLY");
    const phaseOnDisk = JSON.parse(await readFile(join(session.planRoot, "phases", `${task.phaseId}.json`), "utf8"));
    const taskOnDisk = phaseOnDisk.tasks.find((entry) => entry.id === id);
    assert.deepEqual(taskOnDisk.checklist.map((item) => item.title), ["Review", "Execute"], "planner-task-update persists checklist to the owning phase file");
    assert.deepEqual(parityTask.subtasks.map((item) => item.title), ["Validate provider", "Execute refund"]);
    assert.ok(parityTask.subtasks.every((item) => item.id && item.id !== "forged-subtask"), "subtask IDs are planner-owned and non-empty");

    const forgedSubtask = await callTool(session, "planner-task-update", { task: "T002", subtasks: [{ id: "forged-subtask", title: "Invalid" }] });
    assert.equal(forgedSubtask.isError, true);
    assert.equal(toolStructured(forgedSubtask).errorCode, "SUBTASK_ID_INVALID");

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
    assert.deepEqual(checklist.map((item) => item.title), ["Review", "Ship"], "checklist add/toggle/remove renumbers cleanly");
    assert.equal(checklist[0].checked, true, "toggle marks C1 done");

    // T413 (P104/F005) — planner-task-update's checklist replacement must
    // carry tick state across via plan-core's replaceChecklist, not a
    // private hand-built mapping, and must surface any tick it could not
    // carry rather than dropping it in a "success" result.
    const renamed = await callTool(session, "planner-task-update", { task: "T002", checklist: ["Review carefully", "Ship"] });
    assert.equal(toolStructured(renamed).updated, true);
    assert.equal(toolStructured(renamed).checklistLostTicks, undefined, "an equal-length rename must not report a loss");
    assert.doesNotMatch(toolText(renamed), /Lost tick/);
    const renamedTask = (await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id);
    assert.deepEqual(renamedTask.checklist.map((item) => item.title), ["Review carefully", "Ship"]);
    assert.equal(renamedTask.checklist[0].checked, true, "renaming the ticked item in place must keep its tick");

    const dropped = await callTool(session, "planner-task-update", { task: "T002", checklist: ["Ship"] });
    assert.equal(toolStructured(dropped).updated, true);
    assert.deepEqual(toolStructured(dropped).checklistLostTicks, ["Review carefully"], "a checklist replacement that drops a ticked item must report it, not silently discard it");
    assert.match(toolText(dropped), /Lost tick.*Review carefully/s);
    const droppedTask = (await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id);
    assert.deepEqual(droppedTask.checklist.map((item) => item.title), ["Ship"]);
    assert.equal(droppedTask.checklist[0].checked, false);

    // make T002 the highest-priority ready task (seed T001 has priority 10)
    await callTool(session, "planner-task-update", { task: "T002", priority: 0 });
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).priority, 0);

    // blocked is not startable → reopen to planned (motivation required) first
    await callTool(session, "planner-task-update", { task: "T002", status: "planned", motivation: "Provider contract signed; resume work." });

    // Generic updates cannot bypass the dedicated completion path.
    const directDone = await callTool(session, "planner-task-update", { task: "T002", status: "done" });
    assert.match(toolText(directDone), /completion transitions require planner-task-complete/);
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).status, "planned");

    const preservedFeatureDescription = "Updated through MCP before task lifecycle synchronization.";
    await callTool(session, "planner-feature-update", { feature: "F001", description: preservedFeatureDescription, descriptionRef: ".planner/docs/features/auth-api.md" });
    assert.equal((await session.store.loadFeatures()).features.find((entry) => entry.number === 1).descriptionRef, ".planner/docs/features/auth-api.md");

    // Lifecycle work is rejected without the required full context reads.
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
    assert.deepEqual(toolStructured(deniedWithoutRequirements).nextActions, ["planner-requirement-list with phaseRef=P001(F001)", "Retry planner-task-start P001(F001)/T002"]);
    assert.deepEqual(toolStructured(deniedWithoutRequirements).requirementEligibility.requiredReads.map(({ kind, state }) => ({ kind, state })), [{ kind: "requirement", state: "missing" }]);
    assert.equal((await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.id === id).status, "planned");

    // A broad inventory is informative but does not claim every requirement was read.
    const inventory = await callTool(session, "planner-requirement-list", {});
    assert.equal(toolStructured(inventory).readScope, "inventory");
    assert.deepEqual(toolStructured(inventory).attestedRequirementIds, []);
    assert.equal(toolStructured(await callTool(session, "planner-task-start", { task: "T002" })).errorCode, "REQUIREMENTS_READ_REQUIRED");

    // Target-scoped requirement delivery + retry succeeds with a verified postcondition.
    const scopedRequirements = await callTool(session, "planner-requirement-list", { phaseRef: "P001(F001)" });
    assert.equal(toolStructured(scopedRequirements).readScope, "target");
    assert.deepEqual(toolStructured(scopedRequirements).attestedRequirementIds, toolStructured(deniedWithoutRequirements).requirementIds);
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
    assert.equal(doneTask.priority, 0);
    assert.ok(doneTask.completedAt);
    assert.equal((await session.store.loadFeatures()).features[0].description, preservedFeatureDescription, "MCP lifecycle writes preserve newer feature metadata");

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

test("planner-task-discuss: checklist replacement carries ticks via plan-core, reports what it cannot", async () => {
  // T413 (P104/F005) — planner-task-discuss builds its checklist replacement
  // independently of planner-task-update; both must route through
  // plan-core's replaceChecklist rather than each hardcoding checked:false.
  const session = await startMcpFixture({ name: "t413-discuss-checklist" });
  try {
    await callTool(session, "planner-task-add", {
      feature: "F001", phase: "P001", title: "Discuss checklist parity", description: LONG, checklist: ["Draft", "Review"],
    });
    const task = (await session.store.loadAllPhases()).flatMap((entry) => entry.tasks).find((entry) => entry.title === "Discuss checklist parity");
    await callTool(session, "planner-task-checklist-toggle", { task: task.shortId, item: "C1" });
    assert.equal((await session.store.loadPhase(task.phaseId)).tasks.find((entry) => entry.id === task.id).checklist[0].checked, true);

    // Same-length rename keeps the tick, no loss reported.
    const renamed = await callTool(session, "planner-task-discuss", { task: task.shortId, checklist: ["Draft carefully", "Review"] });
    assert.equal(toolStructured(renamed).checklistLostTicks, undefined);
    assert.doesNotMatch(toolText(renamed), /Lost tick/);
    let stored = (await session.store.loadPhase(task.phaseId)).tasks.find((entry) => entry.id === task.id);
    assert.deepEqual(stored.checklist.map((entry) => entry.title), ["Draft carefully", "Review"]);
    assert.equal(stored.checklist[0].checked, true, "planner-task-discuss must carry the tick across a same-position rename");

    // Dropping the ticked title reports the loss instead of silently discarding it.
    const dropped = await callTool(session, "planner-task-discuss", { task: task.shortId, checklist: ["Review"] });
    assert.deepEqual(toolStructured(dropped).checklistLostTicks, ["Draft carefully"]);
    assert.match(toolText(dropped), /Lost tick.*Draft carefully/s);
    stored = (await session.store.loadPhase(task.phaseId)).tasks.find((entry) => entry.id === task.id);
    assert.deepEqual(stored.checklist.map((entry) => entry.title), ["Review"]);
    assert.equal(stored.checklist[0].checked, false);
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
      "planner-requirement-list with phaseRef=P001(F001)",
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

test("context reads in any order satisfy task_start (no out-of-order gate)", async () => {
  const session = await startMcpFixture({ name: "t346-out-of-order" });
  try {
    // Read in reversed order: requirements, feature, phase, task — the opposite
    // of the old task→phase→feature ordering requirement.
    await callTool(session, "planner-requirement-list", { phaseRef: "P001" });
    await callTool(session, "planner-feature-show", { feature: "F001", full: true });
    await callTool(session, "planner-phase-show", { phase: "P001", full: true });
    await callTool(session, "planner-task-show", { task: "T001", full: true });

    const started = await callTool(session, "planner-task-start", { task: "T001" });
    assert.match(toolText(started), /Task started: P001\(F001\)\/T001/);
    assert.equal(started.isError, undefined);
    assert.equal(toolStructured(started).started, true);
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
    const featureListWithPriority = await callTool(session, "planner-feature-list", { featureRef: "F002" });
    assert.match(toolText(featureListWithPriority), /priority 5/);
    assert.equal(toolStructured(featureListWithPriority).features[0].priority, 5);
    const phaseListWithPriority = await callTool(session, "planner-phase-list", { featureRef: "F002" });
    assert.match(toolText(phaseListWithPriority), /priority 5/);
    assert.equal(toolStructured(phaseListWithPriority).phases[0].priority, 5);
    const taskListWithPriority = await callTool(session, "planner-task-list", { phaseRef: "P001" });
    assert.match(toolText(taskListWithPriority), /priority 50/);
    assert.equal(toolStructured(taskListWithPriority).tasks[0].priority, 50);
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
      descriptionRef: storedPhase.descriptionRef || "",
      acceptedDecisions: storedPhase.acceptedDecisions,
    }, "Claude-style structured-content consumers receive the phase title, detailed description, and canonical Accepted Decisions");
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
