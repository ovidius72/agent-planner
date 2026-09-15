/**
 * T242 (P056/F015) — Pi mutations, validation, requirements, and handoffs.
 *
 * Exercises the REAL adapter tools (via the T240 host harness) for:
 *  - feature → phase → task → requirement creation round-trip
 *  - invalid fields and missing refs: rejected writes leave files unchanged
 *  - lifecycle + rollup: start, update (with motivation), complete (with the
 *    unchecked-checklist gate), phase/feature rollup to done
 *  - checklist add/toggle/remove and task priority (reorder)
 *  - requirements: create + link + update
 *  - handoffs: proposal, explicit target confirmation, list/show/clear with
 *    archive, and terminal-phase (done) rejection
 *  - plan_repair integrity report on a healthy plan
 *
 * UI notifications and tool responses must use composite IDs (P00x/F00x/T00x),
 * never raw UUIDs as the primary reference.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";
import { canonicalAuditedHandoff, completeHandoffAudit, completeHandoffColdStartInventory } from "../../../test/helpers/handoff-audit.mjs";

after(async () => {
  await cleanupPiHosts();
});

const LONG_DESC =
  "src/harness.ts:10 existing state and the concrete goal for this mutation-test entity; include file refs and behaviors to preserve so the description clears the minimum.";

async function readTaskContext(host, taskId, phaseId = "P001", featureId = "F001") {
  await host.runTool("task_get", { taskId, full: true });
  await host.runTool("phase_get", { phaseId, full: true });
  await host.runTool("feature_get", { featureId, full: true });
  await host.runTool("requirement_list", { phaseRef: phaseId });
}

function canonicalHandoff(title, detail) {
  return canonicalAuditedHandoff(title, detail, { file: "mutations.test.mjs", reason: "mutation fixture" });
}

function readBackSourceReviews() {
  return ["conversation", "planner-entities", "working-tree", "verification-runtime", "peer-agent-output"].map((source) => ({
    source,
    detail: `${source} was compared again with the entire persisted handoff body and no missing resume fact was found.`,
  }));
}

async function preparedHandoffArgs(host, phaseRef = "P001") {
  const prepared = await host.runTool("handoff_prepare", { phaseRef });
  return {
    expectedHandoffUpdatedAt: toolDetails(prepared).handoffUpdatedAt ?? "",
    reconciledExistingHandoff: true,
    completenessAudit: completeHandoffAudit(),
    coldStartInventory: completeHandoffColdStartInventory({ file: "mutations.test.mjs" }),
    taskUpdates: [],
    phaseNoUpdateReason: "Fixture does not change durable phase context.",
    featureNoUpdateReason: "Fixture does not change durable feature context.",
  };
}

describe("pi-adapter mutations, validation, requirements, handoffs", () => {
  test("writer contention stays readable and surfaces PLAN_WRITER_BUSY through Pi tools", async () => {
    const host = await createPiHost({ name: "writer-busy", seed: "empty" });
    const lockPath = join(host.planRoot, ".local", "locks", "writer.lock");
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      token: "external-writer",
      pid: process.pid,
      hostname: hostname(),
      cwd: host.root,
      acquiredAt: new Date().toISOString(),
    }), "utf8");
    const previousTimeout = process.env.AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS;
    const previousRetry = process.env.AGENT_PLAN_WRITE_LOCK_RETRY_MS;
    process.env.AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS = "60";
    process.env.AGENT_PLAN_WRITE_LOCK_RETRY_MS = "10";
    try {
      assert.match(toolText(await host.runTool("feature_list", {})), /No features/);
      await assert.rejects(
        host.runTool("feature_create", { name: "Blocked writer", description: LONG_DESC }),
        /PLAN_WRITER_BUSY.*Read-only operations remain available/,
      );
      assert.equal((await host.store.loadFeatures()).features.length, 0);
    } finally {
      if (previousTimeout === undefined) delete process.env.AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS;
      else process.env.AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS = previousTimeout;
      if (previousRetry === undefined) delete process.env.AGENT_PLAN_WRITE_LOCK_RETRY_MS;
      else process.env.AGENT_PLAN_WRITE_LOCK_RETRY_MS = previousRetry;
      await rm(lockPath, { recursive: true, force: true });
      await closePiHost(host);
    }
  });

  test("creation round-trip: feature → phase → task → requirement with composite IDs", async () => {
    const host = await createPiHost({ name: "t242-create", seed: "minimal" });
    try {
      // Feature
      const feat = await host.runTool("feature_create", { name: "Feature Two", description: LONG_DESC });
      assert.match(toolText(feat), /✅ Feature created: F002/);
      assert.equal((await host.store.loadFeatures()).features.length, 2);

      // Phase linked to the new feature (global phase numbering: P002).
      const phase = await host.runTool("phase_create", {
        featureId: "F002",
        title: "Phase Two",
        description: LONG_DESC,
      });
      assert.match(toolText(phase), /P002/);
      const phaseTwo = (await host.store.loadAllPhases()).find((p) => p.number === 2);
      assert.ok(phaseTwo, "phase 2 persisted");

      // Task with a seeded checklist.
      const task = await host.runTool("task_create", {
        featureId: "F002",
        phaseId: "P002",
        title: "Task Two",
        description: LONG_DESC,
        checklist: ["Do A", "Do B"],
      });
      assert.match(toolText(task), /T002/);
      const phaseTwoAfter = (await host.store.loadAllPhases()).find((p) => p.number === 2);
      const taskTwo = phaseTwoAfter.tasks.find((t) => t.number === 2);
      assert.ok(taskTwo, "task 2 persisted");
      assert.deepEqual(taskTwo.checklist.map((i) => i.title), ["Do A", "Do B"]);

      // Requirement linked to the phase.
      const req = await host.runTool("requirement_create", {
        title: "Req Two",
        description: "The linked requirement.",
        linkedPhaseIds: [phaseTwo.id],
      });
      assert.match(toolText(req), /Requirement created: /);
      const reqs = (await host.store.loadRequirements()).requirements;
      const created = reqs.find((r) => r.title === "Req Two");
      assert.ok(created, "requirement persisted");
      assert.ok(created.linkedPhaseIds.includes(phaseTwo.id), "requirement linked to the phase");
    } finally {
      await closePiHost(host);
    }
  });

  test("task creation cannot bypass lifecycle reads with an in-progress status", async () => {
    const host = await createPiHost({ name: "t326-create-planned", seed: "minimal" });
    try {
      const before = await host.store.loadProject();
      const rejected = await host.runTool("task_create", {
        featureId: "F001",
        phaseId: "P001",
        title: "Bypass attempt",
        description: LONG_DESC,
        status: "in-progress",
      });
      assert.match(toolText(rejected), /Tasks must be created planned/);
      assert.equal((await host.store.loadAllPhases())[0].tasks.length, 1);
      assert.equal((await host.store.loadProject()).nextTaskNumber, before.nextTaskNumber);
    } finally {
      await closePiHost(host);
    }
  });

  test("blank project language choices default content and chat to English", async () => {
    const host = await createPiHost({ name: "t326-language-default", seed: "minimal" });
    try {
      host.ui.inputAnswers.push("", "");
      await host.runCommand("project language");
      const project = await host.store.loadProject();
      assert.equal(project.contentLanguage, "English");
      assert.equal(project.chatLanguage, "English");
    } finally {
      await closePiHost(host);
    }
  });

  test("invalid writes are rejected and leave the phase file byte-for-byte unchanged", async () => {
    const host = await createPiHost({ name: "t242-invalid", seed: "minimal" });
    try {
      const phaseId = (await host.store.loadAllPhases())[0].id;
      const phasePath = join(host.planRoot, "phases", `${phaseId}.json`);
      const phaseBytes = async () => readFile(phasePath);
      const assertFileUntouched = async (label) => {
        assert.deepEqual(await phaseBytes(), before, `${label}: phase JSON bytes unchanged`);
      };

      const before = await phaseBytes();
      const taskBefore = (await host.store.loadAllPhases())[0].tasks[0];
      const beforeStatus = taskBefore.status;
      const beforeLog = taskBefore.statusLog.length;
      const beforeHandoff = (await host.store.loadAllPhases())[0].handoff;

      // Bogus status → rejected by schema validation; file untouched.
      const bogus = await host.runTool("task_update", { taskId: "T001", status: "bogus" });
      assert.match(toolText(bogus), /Update failed: /);
      await assertFileUntouched("bogus status");
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, beforeStatus);

      // Restrictive status without motivation → rejected (tool enforces
      // needsMotivation like the MCP adapter and the /planner command).
      const noMotivation = await host.runTool("task_update", { taskId: "T001", status: "blocked" });
      assert.match(toolText(noMotivation), /requires a motivation/);
      await assertFileUntouched("restrictive status without motivation");
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, beforeStatus);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].statusLog.length, beforeLog);

      // Starting is a dedicated lifecycle operation, not a generic update.
      const genericStart = await host.runTool("task_update", { taskId: "T001", status: "in-progress" });
      assert.match(toolText(genericStart), /require task_start/);
      await assertFileUntouched("generic task start");

      // Missing/invalid refs handled gracefully.
      const missingTask = await host.runTool("task_start", { taskId: "   " });
      assert.match(toolText(missingTask), /Task not found/);
      await assertFileUntouched("missing task ref");
      const badRef = await host.runTool("handoff_write", { phaseRef: "P999", content: "x", confirmed: true, completenessAudit: completeHandoffAudit() });
      assert.match(toolText(badRef), /Phase not found/);
      await assertFileUntouched("missing phase ref");

      // Handoff text/title validations are rejected without touching the phase.
      // Omitting content is only for a retry against a token from a previously
      // failed write (T409); with no expectedHandoffUpdatedAt at all this hits
      // the ordinary preflight-token gate, not a content-specific message.
      const empty = await host.runTool("handoff_write", { phaseRef: "P001", confirmed: true, completenessAudit: completeHandoffAudit() });
      assert.match(toolText(empty), /HANDOFF_PREFLIGHT_REQUIRED/);
      await assertFileUntouched("empty handoff text");
      const generic = await host.runTool("handoff_write", { phaseRef: "P001", content: "Handoff", completenessAudit: completeHandoffAudit() });
      assert.match(toolText(generic), /Generic handoff title/);
      await assertFileUntouched("generic handoff title");
      assert.equal((await host.store.loadAllPhases())[0].handoff, beforeHandoff);

      // With a valid motivation the same transition succeeds and logs it.
      const ok = await host.runTool("task_update", {
        taskId: "T001",
        status: "blocked",
        motivation: "Blocked pending the upstream fixture API.",
      });
      assert.match(toolText(ok), /Task updated:/);
      const taskAfter = (await host.store.loadAllPhases())[0].tasks[0];
      assert.equal(taskAfter.status, "blocked");
      assert.equal(taskAfter.statusLog.length, beforeLog + 1);
      assert.match(taskAfter.statusLog.at(-1).description, /upstream fixture API/);
      // The successful write MUST change the file (guard against a vacuous test).
      assert.notDeepEqual(await phaseBytes(), before, "successful update changes the phase JSON bytes");
    } finally {
      await closePiHost(host);
    }
  });

  test("lifecycle + rollup: start, complete gate, force-complete rolls phase and feature to done", async () => {
    const host = await createPiHost({ name: "t242-lifecycle", seed: "minimal" });
    try {
      await host.emit("session_start", { type: "session_start", reason: "startup" });
      // Generic updates cannot bypass the dedicated completion path or its evidence requirement.
      const directDone = await host.runTool("task_update", { taskId: "T001", status: "done" });
      assert.match(toolText(directDone), /completion transitions require task_complete/);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, "planned");

      const preservedFeatureDescription = "Updated through Pi before task lifecycle synchronization.";
      await host.runTool("feature_update", { featureId: "F001", description: preservedFeatureDescription });

      // A lifecycle start must not mutate before the exact full-read sequence.
      const deniedWithoutReads = await host.runTool("task_start", { taskId: "T001" });
      assert.equal(deniedWithoutReads.isError, true);
      assert.equal(toolDetails(deniedWithoutReads).started, false);
      assert.equal(toolDetails(deniedWithoutReads).errorCode, "CONTEXT_READ_REQUIRED");
      assert.match(toolText(deniedWithoutReads), /TASK START FAILED.*started: false/s);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, "planned");
      await host.runTool("task_get", { taskId: "T001" });
      await host.runTool("phase_get", { phaseId: "P001" });
      await host.runTool("feature_get", { featureId: "F001" });
      const deniedAfterCompactReads = await host.runTool("task_start", { taskId: "T001" });
      assert.equal(deniedAfterCompactReads.isError, true);
      assert.equal(toolDetails(deniedAfterCompactReads).errorCode, "CONTEXT_READ_REQUIRED");

      // Full hierarchy reads without requirements still produce a typed denial.
      await host.runTool("task_get", { taskId: "T001", full: true });
      await host.runTool("phase_get", { phaseId: "P001", full: true });
      await host.runTool("feature_get", { featureId: "F001", full: true });
      const deniedWithoutRequirements = await host.runTool("task_start", { taskId: "T001" });
      assert.equal(deniedWithoutRequirements.isError, true);
      assert.equal(toolDetails(deniedWithoutRequirements).started, false);
      assert.equal(toolDetails(deniedWithoutRequirements).errorCode, "REQUIREMENTS_READ_REQUIRED");
      assert.deepEqual(toolDetails(deniedWithoutRequirements).nextActions, ["requirement_list with phaseRef=P001(F001)", "Retry task_start P001(F001)/T001"]);
      assert.deepEqual(toolDetails(deniedWithoutRequirements).requirementEligibility.requiredReads.map(({ kind, state }) => ({ kind, state })), [{ kind: "requirement", state: "missing" }]);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, "planned");

      // A broad inventory is informative but does not claim that every requirement was read.
      const inventory = await host.runTool("requirement_list", {});
      assert.equal(toolDetails(inventory).readScope, "inventory");
      assert.deepEqual(toolDetails(inventory).attestedRequirementIds, []);
      assert.equal(toolDetails(await host.runTool("task_start", { taskId: "T001" })).errorCode, "REQUIREMENTS_READ_REQUIRED");

      // Start — response carries the composite ref only after target-scoped requirements are delivered.
      const scopedRequirements = await host.runTool("requirement_list", { phaseRef: "P001(F001)" });
      assert.equal(toolDetails(scopedRequirements).readScope, "target");
      assert.deepEqual(toolDetails(scopedRequirements).attestedRequirementIds, toolDetails(deniedWithoutRequirements).requirementIds);
      const preservedWorkDone = "Metadata committed after Pi read the task context.";
      await host.runTool("feature_update", { featureId: "F001", workDone: preservedWorkDone });
      const started = await host.runTool("task_start", { taskId: "T001" });
      assert.match(toolText(started), /✅ Task started:/);
      assert.match(toolText(started), /P001\(F001\)/);
      assert.match(toolText(started), /Implement login/);
      assert.match(toolText(started), /Phase work map — canonical sibling capability ownership/);
      assert.match(toolText(started), /P001\(F001\)\/T001 \(current\)/);
      assert.match(toolText(started), /reread this canonical phase work map and the relevant sibling task full view/);
      assert.equal(toolDetails(started).started, true);
      assert.equal(toolDetails(started).status, "in-progress");
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, "in-progress");

      const paused = await host.runTool("task_pause", {
        taskId: "T001", reason: "Temporary review interruption", what_was_being_done: "Implementing login",
        resume_location: "src/login.ts:20", how_to_resume: "Continue login and rerun auth tests", paused_by: "pi-test",
      });
      assert.match(toolText(paused), /Resume checkpoint saved: P001\(F001\)\/T001/);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, "planned");

      // Pi emits session_start again when the same logical session reloads.
      // The stable SessionManager UUID must preserve valid parent/requirement
      // attestations, so only the task changed by pause needs a reread.
      await host.emit("session_start", { type: "session_start", reason: "reload" });
      const deniedResume = await host.runTool("task_start", { taskId: "T001" });
      assert.equal(toolDetails(deniedResume).errorCode, "CONTEXT_READ_REQUIRED");
      assert.deepEqual(toolDetails(deniedResume).nextActions, [
        "task_get P001(F001)/T001 with full=true",
        "Retry task_start P001(F001)/T001",
      ]);
      await host.runTool("task_get", { taskId: "T001", full: true });
      assert.match(toolText(await host.runTool("task_start", { taskId: "T001" })), /Task started/);

      const missingEvidence = await host.runTool("task_complete", { taskId: "T001", force: true });
      assert.match(toolText(missingEvidence), /durable completion and verification evidence/);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, "in-progress");

      // Complete without force is gated by the unchecked checklist item.
      const gated = await host.runTool("task_complete", { taskId: "T001", description_update: "Fixture completion evidence is present." });
      assert.match(toolText(gated), /checklist item\(s\) not done/);
      assert.equal(toolDetails(gated).uncheckedChecklistItems.length, 1);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, "in-progress");

      // Force-complete succeeds and rolls the phase (and feature) to done.
      const done = await host.runTool("task_complete", { taskId: "T001", force: true, description_update: "All done in this fixture." });
      assert.match(toolText(done), /Task completed/);
      const phase = (await host.store.loadAllPhases())[0];
      assert.equal(phase.tasks[0].status, "done");
      assert.match(phase.tasks[0].description, /All done in this fixture\./);
      assert.equal(phase.status, "done", "phase rolls to done via syncTaskStatusRollup");
      const features = await host.store.loadFeatures();
      assert.equal(features.features[0].status, "done", "feature rolls to done");
      assert.equal(features.features[0].description, preservedFeatureDescription, "Pi lifecycle writes preserve newer feature metadata");
      assert.equal(features.features[0].workDone, preservedWorkDone, "Pi lifecycle writes preserve metadata committed after context reads");
    } finally {
      await closePiHost(host);
    }
  });

  test("priority remains overridable while active switches require a checkpoint and deterministic return", async () => {
    const host = await createPiHost({ name: "t281-explicit-start", seed: "minimal" });
    try {
      await host.emit("session_start", { type: "session_start", reason: "startup" });
      for (const title of ["Explicit lower-priority task", "Another temporary task"]) {
        await host.runTool("task_create", {
          featureId: "F001",
          phaseId: "P001",
          title,
          description: "src/task-start.ts:1 deliberately select temporary work while preserving the prior task checkpoint.",
        });
      }

      await readTaskContext(host, "T002");
      const priorityOverride = await host.runTool("task_start", { taskId: "T002" });
      assert.match(toolText(priorityOverride), /✅ Task started: P001\(F001\)\/T002/);
      assert.match(toolText(priorityOverride), /Priority advisory/);

      // T002 already attested the shared phase, feature, and requirements.
      // A sibling start requires only the exact new task read.
      await host.runTool("task_get", { taskId: "T001", full: true });
      const denied = await host.runTool("task_start", { taskId: "T001" });
      assert.equal(denied.isError, true);
      assert.equal(toolDetails(denied).started, false);
      assert.equal(toolDetails(denied).errorCode, "ACTIVE_TASK_CONFLICT");
      assert.match(toolText(denied), /TASK START FAILED.*task_switch/is);

      // The attestation created by the denied start is reusable without rereading parents.
      const deniedAgain = await host.runTool("task_start", { taskId: "T001" });
      assert.equal(toolDetails(deniedAgain).errorCode, "ACTIVE_TASK_CONFLICT");

      const switched = await host.runTool("task_switch", {
        from_task: "T002", to_task: "T001", reason: "Seed task must unblock the temporary implementation",
        what_was_being_done: "Editing the lower-priority implementation", resume_location: "src/task-start.ts:20",
        how_to_resume: "Continue the implementation and rerun its focused tests", switched_by: "pi-test",
      });
      assert.match(toolText(switched), /Task switched: P001\(F001\)\/T002 → P001\(F001\)\/T001/);
      let tasks = (await host.store.loadAllPhases())[0].tasks;
      assert.deepEqual(tasks.map((task) => task.status), ["in-progress", "planned", "planned"]);
      assert.equal(tasks[1].pauseSnapshot.resumeLocation, "src/task-start.ts:20");

      const done = await host.runTool("task_complete", { taskId: "T001", force: true, description_update: "Temporary task completed and verified." });
      assert.match(toolText(done), /RESUME REQUIRED: P001\(F001\)\/T002/);
      assert.equal((await host.store.loadProject()).workDeviations.at(-1).state, "resume-required");

      const shownResume = await host.runTool("task_get", { taskId: "T002", full: true });
      assert.match(toolText(shownResume), /Resume advisory:/);
      assert.match(toolText(shownResume), /Work checkpoint: Editing the lower-priority implementation/);
      assert.match(toolText(shownResume), /Resume from: src\/task-start\.ts:20/);

      await readTaskContext(host, "T003");
      const skipAdvisory = await host.runTool("task_start", { taskId: "T003" });
      assert.match(toolText(skipAdvisory), /✅ Task started: P001\(F001\)\/T003/);
      assert.match(toolText(skipAdvisory), /RESUME REQUIRED before starting a different task: P001\(F001\)\/T002/);
      assert.ok(skipAdvisory.resumeRequired, "task_start while a resume-required is pending must return an explicit structured resumeRequired proposal");
      assert.equal(skipAdvisory.resumeRequired.taskId, tasks[1].id);
      assert.equal(skipAdvisory.resumeRequired.snapshot?.resumeLocation, "src/task-start.ts:20");
      let project = await host.store.loadProject();
      assert.equal(project.workDeviations.at(-1).state, "resume-required");

      await host.runTool("task_complete", { taskId: "T003", force: true, description_update: "Second temporary task completed and verified." });
      await readTaskContext(host, "T002");
      const resumed = await host.runTool("task_start", { taskId: "T002" });
      assert.match(toolText(resumed), /Task started/);
      tasks = (await host.store.loadAllPhases())[0].tasks;
      assert.equal(tasks[1].status, "in-progress");
      assert.equal(tasks[1].pauseSnapshot, null);
      project = await host.store.loadProject();
      assert.equal(project.workDeviations.at(-1).state, "resumed");

      const finishedResumeTarget = await host.runTool("task_complete", { taskId: "T002", force: true, description_update: "Resume target completed and verified." });
      assert.doesNotMatch(toolText(finishedResumeTarget), /RESUME REQUIRED:/);
      project = await host.store.loadProject();
      assert.equal(project.workDeviations.length, 0);
      const shownDone = await host.runTool("task_get", { taskId: "T002", full: true });
      assert.doesNotMatch(toolText(shownDone), /Resume advisory:/);
    } finally {
      await closePiHost(host);
    }
  });

  test("checklist add/toggle/remove and task priority (reorder)", async () => {
    const host = await createPiHost({ name: "t242-checklist", seed: "minimal" });
    try {
      const task = async () => (await host.store.loadAllPhases())[0].tasks[0];

      // Add
      const added = await host.runTool("task_checklist_add", { taskId: "T001", title: "Do the thing" });
      assert.match(toolText(added), /C2/);
      assert.equal((await task()).checklist.length, 2);

      // Toggle on, then toggle off
      await host.runTool("task_checklist_toggle", { taskId: "T001", item: "C2" });
      assert.equal((await task()).checklist.find((i) => i.number === 2).checked, true);
      await host.runTool("task_checklist_toggle", { taskId: "T001", item: "C2" });
      assert.equal((await task()).checklist.find((i) => i.number === 2).checked, false);

      // Explicit checked=true, then remove
      await host.runTool("task_checklist_toggle", { taskId: "T001", item: "Do the thing", checked: true });
      const removed = await host.runTool("task_checklist_remove", { taskId: "T001", item: "C2" });
      assert.match(toolText(removed), /C2/);
      assert.equal((await task()).checklist.length, 1);
      assert.equal((await task()).checklist[0].number, 1);

      // Reorder knob: priority is persisted and reflected by compact discovery output.
      await host.runTool("feature_update", { featureId: "F001", priority: 7 });
      await host.runTool("phase_update", { phaseId: "P001", priority: 8 });
      await host.runTool("task_update", { taskId: "T001", priority: 9 });
      assert.equal((await task()).priority, 9);
      assert.match(toolText(await host.runTool("feature_list", {})), /priority 7/);
      assert.match(toolText(await host.runTool("phase_list", {})), /priority 8/);
      const list = await host.runTool("task_list", {});
      assert.match(toolText(list), /T001/);
      assert.match(toolText(list), /priority 9/);
    } finally {
      await closePiHost(host);
    }
  });

  test("phase discuss and update parity persist planning fields, relinking, and task context", async () => {
    const host = await createPiHost({ name: "t370-mutation-parity", seed: "minimal" });
    try {
      await host.runTool("feature_create", {
        name: "Parity owner",
        description: "src/parity.ts:1 owns the relinked phase while preserving canonical planner metadata and derived status behavior.",
      });
      const phase = (await host.store.loadAllPhases())[0];
      const featureTwo = (await host.store.loadFeatures()).features.find((feature) => feature.number === 2);
      const directDescriptionRef = ".planner/docs/p094-pane-hosts-any-app.md";
      const updated = await host.runTool("phase_update", {
        phaseId: "P001",
        featureId: "F002",
        descriptionRef: directDescriptionRef,
        goals: ["Close adapter parity"],
        nonGoals: ["Change status rollups"],
        dependencies: ["Canonical store"],
        risks: ["Contract drift"],
        openQuestions: ["Which client remains?"],
        decisions: ["Use semantic mutations"],
        completionCriteria: ["All surfaces agree"],
      });
      assert.equal(toolDetails(updated).updated, true);
      let persistedPhase = await host.store.loadPhase(phase.id);
      assert.equal(persistedPhase.featureId, featureTwo.id);
      assert.equal(persistedPhase.descriptionRef, directDescriptionRef);
      assert.deepEqual(persistedPhase.goals, ["Close adapter parity"]);
      assert.deepEqual(persistedPhase.nonGoals, ["Change status rollups"]);
      assert.deepEqual(persistedPhase.dependencies, ["Canonical store"]);
      assert.deepEqual(persistedPhase.risks, ["Contract drift"]);
      assert.deepEqual(persistedPhase.openQuestions, ["Which client remains?"]);
      assert.deepEqual(persistedPhase.decisions, ["Use semantic mutations"]);
      assert.deepEqual(persistedPhase.completionCriteria, ["All surfaces agree"]);
      const owners = (await host.store.loadFeatures()).features;
      assert.equal(owners.find((feature) => feature.number === 1).phaseIds.includes(phase.id), false);
      assert.equal(owners.find((feature) => feature.number === 2).phaseIds.includes(phase.id), true);

      const discussed = await host.runTool("phase_discuss", {
        phaseId: "P001",
        goals: ["Preserve derived status"],
        summary: "Context is ready",
        openQuestions: ["Who verifies parity?"],
      });
      assert.equal(toolDetails(discussed).discussed, true);
      assert.equal(toolDetails(discussed).contextReady, true);
      persistedPhase = await host.store.loadPhase(phase.id);
      assert.equal(persistedPhase.status, "planned", "phase discuss preserves the derived task rollup");
      assert.equal(persistedPhase.contextReady, true);
      assert.deepEqual(persistedPhase.goals, ["Preserve derived status"]);
      assert.deepEqual(persistedPhase.openQuestions, ["Who verifies parity?"]);

      const taskUpdate = await host.runTool("task_update", {
        taskId: "T001",
        descriptionRef: ".planner/docs/tasks/parity-task.md",
        notes: "Implementation context retained.",
        decisions: ["Keep lifecycle tools authoritative"],
        checklist: ["Review", "Execute"],
      });
      assert.equal(toolDetails(taskUpdate).updated, true);
      assert.deepEqual(toolDetails(taskUpdate).updatedFields.sort(), ["checklist", "decisions", "descriptionRef", "notes"]);
      const task = (await host.store.loadPhase(phase.id)).tasks[0];
      assert.equal(task.descriptionRef, ".planner/docs/tasks/parity-task.md");
      assert.equal(task.notes, "Implementation context retained.");
      assert.deepEqual(task.decisions, ["Keep lifecycle tools authoritative"]);
      assert.deepEqual(task.checklist.map((item) => item.title), ["Review", "Execute"]);
      const phaseOnDisk = JSON.parse(await readFile(join(host.planRoot, "phases", `${phase.id}.json`), "utf8"));
      assert.deepEqual(phaseOnDisk.tasks[0].checklist.map((item) => item.title), ["Review", "Execute"], "task_update persists checklist to the owning phase file");

      // T413 (P104/F005) — task_update's checklist replacement must carry
      // tick state across via plan-core's replaceChecklist, not a private
      // hand-built mapping, and must surface any tick it could not carry.
      await host.runTool("task_checklist_toggle", { taskId: "T001", item: "C1" });
      assert.equal((await host.store.loadPhase(phase.id)).tasks[0].checklist[0].checked, true);

      const renamed = await host.runTool("task_update", { taskId: "T001", checklist: ["Review carefully", "Execute"] });
      assert.equal(toolDetails(renamed).updated, true);
      assert.equal(toolDetails(renamed).checklistLostTicks, undefined, "an equal-length rename must not report a loss");
      assert.doesNotMatch(toolText(renamed), /Lost tick/);
      const renamedTask = (await host.store.loadPhase(phase.id)).tasks[0];
      assert.deepEqual(renamedTask.checklist.map((item) => item.title), ["Review carefully", "Execute"]);
      assert.equal(renamedTask.checklist[0].checked, true, "renaming the ticked item in place must keep its tick");

      const dropped = await host.runTool("task_update", { taskId: "T001", checklist: ["Execute"] });
      assert.equal(toolDetails(dropped).updated, true);
      assert.deepEqual(toolDetails(dropped).checklistLostTicks, ["Review carefully"], "a checklist replacement that drops a ticked item must report it, not silently discard it");
      assert.match(toolText(dropped), /Lost tick.*Review carefully/s);
      const droppedTask = (await host.store.loadPhase(phase.id)).tasks[0];
      assert.deepEqual(droppedTask.checklist.map((item) => item.title), ["Execute"]);
      assert.equal(droppedTask.checklist[0].checked, false);

      for (const [tool, arguments_] of [
        ["feature_update", { featureId: "F001", acceptedDecisions: [] }],
        ["phase_update", { phaseId: "P001", acceptedDecisions: [] }],
        ["task_update", { taskId: "T001", acceptedDecisions: [] }],
      ]) {
        const rejected = await host.runTool(tool, arguments_);
        assert.equal(rejected.isError, true);
        assert.equal(toolDetails(rejected).updated, false);
        assert.equal(toolDetails(rejected).errorCode, "ACCEPTED_DECISION_SEMANTIC_MUTATION_REQUIRED");
      }
    } finally {
      await closePiHost(host);
    }
  });

  test("requirements: create without lifecycle status, then update product outcome", async () => {
    const host = await createPiHost({ name: "t242-req", seed: "minimal" });
    try {
      const phaseId = (await host.store.loadAllPhases())[0].id;
      const created = await host.runTool("requirement_create", {
        title: "Auth requirement",
        description: "The auth feature must work.",
        linkedPhaseIds: [phaseId],
      });
      assert.match(toolText(created), /Requirement created: /);
      let reqs = (await host.store.loadRequirements()).requirements;
      const req = reqs.find((r) => r.title === "Auth requirement");
      assert.ok(req, "requirement created");
      assert.ok(req.linkedPhaseIds.includes(phaseId), "linked to the phase");

      assert.equal(Object.hasOwn(req, "status"), false, "top-level Requirement has no lifecycle status");

      const rejectedStatus = await host.runTool("requirement_update", { requirementId: req.id, status: "in-progress" });
      assert.equal(rejectedStatus.isError, true);
      assert.equal(toolDetails(rejectedStatus).updated, false);
      assert.equal(toolDetails(rejectedStatus).errorCode, "NO_MUTABLE_FIELDS_RECEIVED");

      const updated = await host.runTool("requirement_update", { requirementId: req.id, title: "Auth outcome" });
      assert.match(toolText(updated), /Requirement updated: /);
      reqs = (await host.store.loadRequirements()).requirements;
      assert.equal(reqs.find((r) => r.id === req.id).title, "Auth outcome");
      assert.equal(Object.hasOwn(reqs.find((r) => r.id === req.id), "status"), false);
    } finally {
      await closePiHost(host);
    }
  });

  test("description freshness reports exact stale parents and explicit leaf-to-root reconciliation", async () => {
    const host = await createPiHost({ name: "t381-description-freshness", seed: "minimal" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const taskUpdate = await host.runTool("task_update", { taskId: "T001", description: "Changed task context that invalidates only its owning parents." });
      assert.deepEqual(toolDetails(taskUpdate).staleParentRefs, ["P001(F001)", "F001"]);
      assert.doesNotMatch(toolText(taskUpdate), /Parent description review required/);

      const preview = await host.runTool("description_freshness", {});
      assert.deepEqual(toolDetails(preview).staleParentRefs, ["P001(F001)", "F001"]);
      assert.deepEqual(toolDetails(preview).reconciliationPreview.map((step) => step.ownerRef), ["P001(F001)", "F001"]);
      assert.match(toolText(preview), /explicitly update/i);

      await new Promise((resolve) => setTimeout(resolve, 5));
      const phaseUpdate = await host.runTool("phase_update", { phaseId: "P001", description: "Reconciled phase context." });
      assert.deepEqual(toolDetails(phaseUpdate).staleParentRefs, ["F001"]);

      await new Promise((resolve) => setTimeout(resolve, 5));
      await host.runTool("feature_update", { featureId: "F001", description: "Reconciled feature context." });
      const fresh = await host.runTool("description_freshness", {});
      assert.equal(toolDetails(fresh).reconciliationRequired, false);
      assert.deepEqual(toolDetails(fresh).staleParentRefs, []);
    } finally {
      await closePiHost(host);
    }
  });

  test("handoffs: compact proposal, explicit confirmation, list/show/clear with archive, terminal-phase rejection", async () => {
    const host = await createPiHost({ name: "t242-handoff", seed: "minimal" });
    try {
      const phase = async () => (await host.store.loadAllPhases())[0];
      const prepared = await host.runTool("handoff_prepare", { phaseRef: "P001" });
      // The scaffold lives in the structured details; the text channel points at it
      // instead of carrying a second copy (T408).
      assert.match(toolText(prepared), /scaffold is provided in the structured result's draftTemplate field/);
      assert.equal(toolText(prepared).includes(toolDetails(prepared).draftTemplate), false, "the scaffold must not travel in both channels");
      assert.match(toolText(prepared), /Required human inputs before drafting/);
      assert.match(toolText(prepared), /Planner-generated metadata \(do not add these to Markdown\)/);
      assert.match(toolText(prepared), /Completeness audit and cold-start evidence are planner-owned metadata/);
      assert.match(toolDetails(prepared).draftTemplate, /## Current and partial state/);
      assert.match(toolDetails(prepared).draftTemplate, /## Supporting documents/);
      assert.equal(Object.hasOwn(toolDetails(prepared), "coldStartSourceReviews"), false);
      assert.equal(Object.hasOwn(toolDetails(prepared), "coldStartInventoryCategories"), false);
      assert.match(toolDetails(prepared).evidenceContract, /derived from persisted state/);
      assert.equal(toolDetails(prepared).phaseWorkMap.total, 1);
      assert.match(toolDetails(prepared).phaseWorkMap.content, /P001\(F001\)\/T001/);

      // Proposal only — no confirmation flag, nothing written.
      const proposal = await host.runTool("handoff_write", { phaseRef: "P001", content: "Body of the handoff.", completenessAudit: completeHandoffAudit() });
      assert.match(toolText(proposal), /Proposal only/);
      assert.equal(toolDetails(proposal).confirmationRequired, true);
      assert.match(toolDetails(proposal).phaseRef, /P001/);
      assert.equal((await phase()).handoff, "", "proposal must not write");

      const missingReason = await host.runTool("handoff_write", {
        phaseRef: "P001",
        title: "P001 — missing reason",
        content: canonicalHandoff("P001 — missing reason", "The Markdown body deliberately contains no generated metadata."),
        confirmed: true,
        ...(await preparedHandoffArgs(host)),
      });
      assert.equal(missingReason.isError, true);
      assert.equal(toolDetails(missingReason).errorCode, "HANDOFF_REASON_REQUIRED");
      assert.equal((await phase()).handoff, "", "missing reason must not write");

      // Compact confirmed writes omit duplicate audit and cold-start inventory prose.
      const compactArgs = await preparedHandoffArgs(host);
      delete compactArgs.completenessAudit;
      delete compactArgs.coldStartInventory;
      const compact = await host.runTool("handoff_write", {
        phaseRef: "P001",
        title: "P001 — compact handoff",
        reason: "Fixture verifies compact resume context.",
        content: canonicalHandoff("P001 — compact handoff", "The compact body contains the resume-critical state and next action."),
        confirmed: true,
        ...compactArgs,
      });
      assert.equal(compact.isError, undefined);
      assert.equal(toolDetails(compact).persisted, true);
      assert.notEqual((await phase()).handoff, "");

      // Confirmed write with a meaningful title.
      const written = await host.runTool("handoff_write", {
        phaseRef: "P001",
        title: "P001 — Auth API phase: fixture handoff",
        reason: "Fixture session boundary requires a cold-resume handoff.",
        content: canonicalHandoff("P001 — Auth API phase: fixture handoff", "Body of the handoff."),
        confirmed: true,
        ...(await preparedHandoffArgs(host)),
      });
      assert.match(toolText(written), /candidate persisted on P001\(F001\), but it is NOT resume-ready yet/);
      assert.equal(toolDetails(written).persisted, true);
      assert.equal(toolDetails(written).resumeReady, false);
      assert.equal(toolDetails(written).verificationRequired, true);
      assert.match((await phase()).handoff, /^# P001 — Auth API phase: fixture handoff/);

      // List + show round-trip.
      const list = await host.runTool("handoff_list", {});
      assert.match(toolText(list), /P001\(F001\)/);
      assert.match(toolText(list), /fixture handoff/);
      assert.equal(toolDetails(list).page, 1);
      assert.equal(Object.hasOwn(toolDetails(list).handoffs[0], "content"), false, "compact list must not embed full bodies");
      const shown = await host.runTool("handoff_show", { phaseRef: "P001" });
      // The capsule body is readable prose and travels in the text channel only;
      // the structured details keep the machine-readable evidence about it (T408).
      assert.match(toolText(shown), /Body of the handoff\./);
      assert.equal(Object.hasOwn(toolDetails(shown), "content"), false, "the body must not travel in both channels");
      assert.equal(typeof toolDetails(shown).contentHash, "string");
      assert.equal(toolDetails(shown).truncated, false);
      assert.equal(toolDetails(shown).handoffAudit.version, 1);
      assert.equal(toolDetails(shown).persistenceVerified, true);
      assert.equal(toolDetails(shown).resumeReady, false);
      assert.equal(toolDetails(shown).phaseWorkMap.total, 1);
      assert.match(toolText(shown), /Before proposing new work, reread the canonical phase and relevant sibling task full view/);

      const gaps = await host.runTool("handoff_verify", {
        phaseRef: "P001",
        expectedContentHash: toolDetails(shown).contentHash,
        sourceReviews: readBackSourceReviews(),
        omissionsFound: ["A prior rewrite is absent."],
      });
      assert.equal(gaps.isError, true);
      assert.equal(toolDetails(gaps).errorCode, "HANDOFF_READBACK_GAPS_FOUND");
      assert.equal((await phase()).handoffAudit.resumeReadyAt, "");

      const verified = await host.runTool("handoff_verify", {
        phaseRef: "P001",
        expectedContentHash: toolDetails(shown).contentHash,
        sourceReviews: readBackSourceReviews(),
        omissionsFound: [],
      });
      assert.equal(toolDetails(verified).resumeReady, true);
      assert.match(toolText(verified), /is resume-ready after persisted read-back/);
      assert.equal(toolDetails(await host.runTool("handoff_list", {})).handoffs[0].resumeReady, true);

      // Clear archives and empties.
      const cleared = await host.runTool("handoff_clear", { phaseRef: "P001" });
      assert.match(toolText(cleared), /✅ Cleared handoff on P001\(F001\)/);
      assert.equal((await phase()).handoff, "");
      assert.equal(toolDetails(await host.runTool("handoff_list", {})).count, 0);
      const archiveDir = join(host.planRoot, ".local", "handoff-archive");
      const archived = await readdir(archiveDir);
      assert.ok(archived.length > 0, "archived handoff file exists");

      // Terminal phase (done) rejects new handoffs; the phase stays clean.
      await host.runTool("task_complete", { taskId: "T001", force: true, description_update: "Fixture completed and verified through the adapter mutation test." });
      assert.equal((await phase()).status, "done");
      const late = await host.runTool("handoff_write", {
        phaseRef: "P001", title: "P001 — late handoff", reason: "Fixture terminal-phase rejection coverage.", content: canonicalHandoff("P001 — late handoff", "Late handoff."), confirmed: true,
        ...(await preparedHandoffArgs(host)),
      });
      assert.match(toolText(late), /Cannot write a handoff on done phase/);
      assert.equal((await phase()).handoff, "");
    } finally {
      await closePiHost(host);
    }
  });

  test("handoff_prepare rejects a bad supporting-document manifest before any body is drafted or sent, and handoff_write still catches a document deleted after prepare", async () => {
    const host = await createPiHost({ name: "t407-prepare-supporting-documents", seed: "minimal" });
    try {
      const phase = async () => (await host.store.loadAllPhases())[0];

      // Bad path fails at prepare, with no body ever sent.
      const badManifest = await host.runTool("handoff_prepare", {
        phaseRef: "P001",
        supportingDocuments: [{ path: ".planner/docs/does-not-exist.md", description: "Content that was never written to disk." }],
      });
      assert.equal(badManifest.isError, true);
      assert.equal(toolDetails(badManifest).errorCode, "HANDOFF_SUPPORTING_DOCUMENT_INVALID");
      assert.match(toolDetails(badManifest).recovery, /supportingDocuments/);
      assert.match(toolDetails(badManifest).recovery, /optional/i);
      assert.match(toolText(badManifest), /Recovery:.*supportingDocuments/);
      assert.equal((await phase()).handoff, "", "no handoff body was sent or persisted");

      // The same guidance is surfaced proactively, read before drafting.
      const prepared = await host.runTool("handoff_prepare", { phaseRef: "P001" });
      assert.match(toolText(prepared), /Supporting documents:.*supportingDocuments is optional/);
      // Guidance is prose the agent reads: text channel only (T412).
      assert.match(toolText(prepared), /Supporting documents:.*optional/i);
      assert.equal(Object.hasOwn(toolDetails(prepared), "supportingDocumentsGuidance"), false);

      // Valid at prepare time.
      await mkdir(join(host.planRoot, "docs"), { recursive: true });
      const docPath = join(host.planRoot, "docs", "t407-detail.md");
      await writeFile(docPath, "# Detail\n\nSubstantive linked content that will be removed before write.\n", "utf8");
      const supportingDocuments = [{ path: ".planner/docs/t407-detail.md", description: "Substantive linked content for resumption." }];
      const preparedWithManifest = await host.runTool("handoff_prepare", { phaseRef: "P001", supportingDocuments });
      assert.equal(preparedWithManifest.isError, undefined);

      // Deleted between prepare and write: the write-time check is still the authority.
      await rm(docPath);
      const preparedArgs = await preparedHandoffArgs(host);
      const write = await host.runTool("handoff_write", {
        phaseRef: "P001",
        title: "P001 — deleted supporting document",
        reason: "Fixture verifies write-time authority after prepare-time validation.",
        content: `${canonicalHandoff("P001 — deleted supporting document", "Body linking a supporting document removed after prepare.")}\n- .planner/docs/t407-detail.md — substantive linked content for resumption.`,
        confirmed: true,
        supportingDocuments,
        ...preparedArgs,
      });
      assert.equal(write.isError, true);
      assert.equal(toolDetails(write).errorCode, "HANDOFF_SUPPORTING_DOCUMENT_INVALID");
      assert.equal((await phase()).handoff, "");
    } finally {
      await closePiHost(host);
    }
  });

  test("handoff_write retains content after a core-level write failure; a retry omitting content succeeds (T409)", async () => {
    const host = await createPiHost({ name: "t409-retain-and-retry", seed: "minimal" });
    try {
      const phase = async () => (await host.store.loadAllPhases())[0];
      const prepared = await preparedHandoffArgs(host);
      const content = canonicalHandoff("P001 — retained content for retry", "Body that must survive a retry without being resent.");

      // First attempt fails deep inside the write contract (missing durable
      // phase-context evidence), not on an adapter-level preflight gate — so
      // PlanStore.refreshPhaseHandoff actually retains the submitted content.
      const { phaseNoUpdateReason: _drop, ...preparedWithoutPhaseReason } = prepared;
      const failed = await host.runTool("handoff_write", {
        phaseRef: "P001",
        reason: "Fixture handoff reason for a cold resume.",
        content,
        confirmed: true,
        ...preparedWithoutPhaseReason,
      });
      assert.match(toolText(failed), /phaseNoUpdateReason/);
      assert.match(toolText(failed), /omit content\/markdown_content/);
      assert.equal((await phase()).handoff, "", "the failed attempt must not mutate the phase");

      // Retry: same phaseRef + expectedHandoffUpdatedAt, correct only the
      // field that actually failed, and omit content/markdown_content entirely.
      const retried = await host.runTool("handoff_write", {
        phaseRef: "P001",
        reason: "Fixture handoff reason for a cold resume.",
        confirmed: true,
        ...prepared,
      });
      assert.equal(retried.isError, undefined);
      assert.equal(toolDetails(retried).persisted, true);
      assert.match((await phase()).handoff, /Body that must survive a retry without being resent\./);
    } finally {
      await closePiHost(host);
    }
  });

  test("planner-web start retries ANY listen failure once on a random free port", async () => {
    const host = await createPiHost({ name: "t242-retry", seed: "minimal" });
    const blocker = createServer(() => {});
    try {
      // Hold a port so the persisted canonical port is guaranteed busy at bind
      // time: pickProjectPort accepts the explicit port (webPort === explicit),
      // serve() then fails with EADDRINUSE, and the adapter must retry once on
      // port 0 — a planner start must never silently end up serverless.
      await new Promise((resolve) => blocker.listen(0, "0.0.0.0", resolve));
      const busyPort = blocker.address().port;
      const project = await host.store.loadProject();
      project.webPort = busyPort;
      await host.store.saveProject(project);

      const started = await host.runTool("planner-web", { action: "start", port: busyPort });
      assert.match(toolText(started), /Web UI started/);
      assert.doesNotMatch(toolText(started), new RegExp(`port: ${busyPort}`), "fell back off the busy port");

      const notifies = host.ui.notifyCalls.map((n) => n.message);
      assert.ok(
        notifies.some((m) => new RegExp(`port ${busyPort} unavailable`).test(m) && /started on http:\/\//.test(m)),
        `retry notify present, got: ${JSON.stringify(notifies)}`,
      );

      const status = await host.runTool("planner-web", { action: "status" });
      assert.equal(toolDetails(status).running, true);
      assert.notEqual(toolDetails(status).port, busyPort);
    } finally {
      blocker.close();
      await closePiHost(host);
    }
  });

  test("public management handlers exercise real reads, writes, deletes, and compatibility aliases", async () => {
    const host = await createPiHost({ name: "t324-public-handlers", seed: "minimal" });
    try {
      assert.match(
        toolText(await host.runTool("project_set_language_preferences", {})),
        /Nothing to update/,
      );
      const language = await host.runTool("project_set_language_preferences", {
        contentLanguage: "",
        chatLanguage: "English",
      });
      assert.match(toolText(language), /Saved language preferences: content=English, chat=English/);

      const project = await host.runTool("project_update", {
        description: "Updated through the public Pi management handler.",
        goal: "Exercise the real management surface.",
        scope: ["public handlers", " "],
        outOfScope: ["production behavior changes", " "],
        technologies: ["TypeScript", " "],
        tools: ["Node.js test runner", " "],
        globalRules: ["Keep integration fixtures isolated", " "],
        decisions: ["Exercise handlers through the public adapter", " "],
      });
      assert.match(toolText(project), /Project updated:/);
      assert.equal(toolDetails(project).goal, "Exercise the real management surface.");

      assert.match(toolText(await host.runTool("requirement_list", {})), /Users can authenticate|No requirements/);
      assert.match(toolText(await host.runTool("plan_get", {})), /Plan "/);
      assert.match(toolText(await host.runTool("plan_render", {})), /Regenerated \d+ files/);
      assert.match(toolText(await host.runTool("phase_list", { featureRef: "F001" })), /P001\(F001\)/);
      assert.match(toolText(await host.runTool("phase_list", { status: "planned" })), /P001\(F001\)/);
      assert.match(toolText(await host.runTool("phase_list", { status: "done" })), /No phases/);
      assert.match(toolText(await host.runTool("phase_get", { phaseId: "P001", full: true })), /Auth API phase/);
      assert.match(toolText(await host.runTool("feature_get", { featureId: "F001", full: true })), /Authentication/);
      assert.match(toolText(await host.runTool("feature_get", { featureId: "F001" })), /F001/);

      assert.match(toolText(await host.runTool("plan_get_handoff", {})), /no phase handoffs set/);
      const proposedHandoff = await host.runTool("plan_write_handoff", {
        phaseRef: "P001",
        confirmed: false,
        title: "P001 — public handler compatibility coverage",
        reason: "Exercise the proposal branch.",
      });
      assert.match(toolText(proposedHandoff), /Proposal only/);
      const writtenHandoff = await host.runTool("plan_write_handoff", {
        phaseRef: "P001",
        confirmed: true,
        title: "P001 — public handler compatibility coverage",
        reason: "Exercise the deprecated compatibility alias.",
        whatWasBeingDone: "Validating the public compatibility surface.",
        howToResume: "Run the adapter integration suite.",
        extraSections: [
          { heading: "Files touched", body: "packages/pi-adapter/test/mutations.test.mjs" },
          { heading: "", body: "This empty heading is intentionally filtered." },
        ],
      });
      assert.match(toolText(writtenHandoff), /deprecated and write-disabled/);
      assert.equal(toolDetails(writtenHandoff).writeDisabled, true);
      const deprecatedList = await host.runTool("plan_get_handoff", {});
      assert.match(toolText(deprecatedList), /no phase handoffs set/);
      const deletedHandoff = await host.runTool("plan_delete_handoff", { phaseRef: "P001" });
      assert.match(toolText(deletedHandoff), /plan_delete_handoff is deprecated/);

      assert.match(toolText(await host.runTool("plan_authorize_bypass", { durationMinutes: 1 })), /Guard bypass authorized/);
      assert.match(toolText(await host.runTool("plan_clear_bypass", {})), /Guard bypass revoked/);

      const createdFeature = await host.runTool("feature_create", {
        name: "Disposable management feature",
        description: LONG_DESC,
      });
      assert.match(toolText(createdFeature), /Feature created: F002/);
      const createdPhase = await host.runTool("phase_create", {
        featureId: "F002",
        title: "Disposable management phase",
        description: LONG_DESC,
      });
      assert.match(toolText(createdPhase), /Phase created: P002\(F002\)/);
      const createdTask = await host.runTool("task_create", {
        featureId: "F001",
        phaseId: "P001",
        title: "Disposable management task",
        description: LONG_DESC,
      });
      assert.match(toolText(createdTask), /T002/);
      const createdRequirement = await host.runTool("requirement_create", {
        title: "Disposable management requirement",
        description: "A requirement used to exercise the public deletion handler.",
        linkedPhaseIds: ["P001"],
      });
      const requirementId = toolDetails(createdRequirement).requirement.id;
      assert.equal(toolDetails(createdRequirement).created, true);
      assert.ok(requirementId);
      assert.match(
        toolText(await host.runTool("task_list", { featureRef: "F001", phaseRef: "P001", status: "planned" })),
        /T002/,
      );

      assert.match(toolText(await host.runTool("task_delete", { taskId: "T002" })), /Task deleted: T002/);
      assert.match(toolText(await host.runTool("requirement_delete", { requirementId })), /Requirement deleted:/);
      assert.match(toolText(await host.runTool("phase_delete", { phaseId: "P002" })), /Phase deleted: P002/);
      const cascadePhase = await host.runTool("phase_create", {
        featureId: "F002",
        title: "Cascade deletion phase",
        description: LONG_DESC,
      });
      assert.match(toolText(cascadePhase), /Phase created: P003\(F002\)/);
      assert.match(toolText(await host.runTool("feature_delete", { featureId: "F002", cascade: true })), /cascade: 1 phases/);

      const stopped = await host.runTool("planner-stop", {});
      assert.match(toolText(stopped), /Planner disabled\. Web UI shut down/);
    } finally {
      await closePiHost(host);
    }
  });

  test("a distinct Pi logical session cannot reuse another session's attestations", async () => {
    const first = await createPiHost({ name: "t337-session-one", seed: "minimal", keepRootOnClose: true, sessionId: "logical-session-one" });
    const root = first.root;
    try {
      await first.emit("session_start", { type: "session_start", reason: "startup" });
      await readTaskContext(first, "T001");
      assert.equal(toolDetails(await first.runTool("task_start", { taskId: "T001" })).started, true);
    } finally {
      await closePiHost(first);
    }

    const second = await createPiHost({ name: "t337-session-two", root, sessionId: "logical-session-two" });
    try {
      await second.emit("session_start", { type: "session_start", reason: "resume" });
      const denied = await second.runTool("task_start", { taskId: "T001" });
      assert.equal(toolDetails(denied).errorCode, "CONTEXT_READ_REQUIRED");
      assert.deepEqual(toolDetails(denied).contextEligibility.requiredReads.map((read) => read.kind), ["task", "phase", "feature"]);
      assert.deepEqual(toolDetails(denied).nextActions, [
        "task_get P001(F001)/T001 with full=true",
        "phase_get P001(F001) with full=true",
        "feature_get F001 with full=true",
        "requirement_list with phaseRef=P001(F001)",
        "Retry task_start P001(F001)/T001",
      ]);
    } finally {
      await closePiHost(second);
    }
  });

  test("Pi logical sessions can start different tasks concurrently", async () => {
    const first = await createPiHost({ name: "t337-concurrent-one", seed: "minimal", keepRootOnClose: true, sessionId: "logical-session-one" });
    const root = first.root;
    try {
      await first.emit("session_start", { type: "session_start", reason: "startup" });
      const create = await first.runTool("task_create", {
        featureId: "F001",
        phaseId: "P001",
        title: "Concurrent sibling",
        description: "src/task-start.ts:1 deliberately select temporary work while preserving the prior checkpoint.",
      });
      assert.match(toolText(create), /Task created/);

      const second = await createPiHost({ name: "t337-concurrent-two", root, sessionId: "logical-session-two" });
      try {
        await second.emit("session_start", { type: "session_start", reason: "resume" });
        const siblingTask = (await first.store.loadAllPhases())[0].tasks.find((task) => task.title === "Concurrent sibling");
        assert.ok(siblingTask);
        await readTaskContext(first, "T001");
        await readTaskContext(second, `T${String(siblingTask.number).padStart(3, "0")}`);

        const starts = await Promise.all([
          first.runTool("task_start", { taskId: "T001" }),
          second.runTool("task_start", { taskId: `T${String(siblingTask.number).padStart(3, "0")}` }),
        ]);
        assert.equal(toolDetails(starts[0]).started, true);
        assert.equal(toolDetails(starts[1]).started, true);
        assert.equal(toolDetails(starts[0]).task.activeOwnerSession, "pi:logical-session-one");
        assert.equal(toolDetails(starts[1]).task.activeOwnerSession, "pi:logical-session-two");
        const active = (await first.store.loadAllPhases()).flatMap((phase) => phase.tasks).filter((task) => task.status === "in-progress");
        assert.equal(active.length, 2);
        assert.deepEqual(active.map((task) => task.activeOwnerSession).sort(), ["pi:logical-session-one", "pi:logical-session-two"]);
      } finally {
        await closePiHost(second);
      }
    } finally {
      await closePiHost(first);
    }
  });

  test("Pi task rejection archives the phase handoff with a terminal reason", async () => {
    const host = await createPiHost({ name: "t379-rejected-handoff", seed: "minimal" });
    try {
      const phase = (await host.store.loadAllPhases())[0];
      await host.store.setPhaseHandoff(phase.id, "# rejected through Pi\n\n- [.planner/docs/p097-closeout.md](.planner/docs/p097-closeout.md)");

      const updated = await host.runTool("task_update", {
        taskId: "T001",
        status: "rejected",
        motivation: "The capability is no longer part of the accepted scope.",
      });
      assert.match(toolText(updated), /\(rejected\)/);

      const persisted = (await host.store.loadAllPhases())[0];
      assert.equal(persisted.status, "rejected");
      assert.equal(persisted.handoff, "");
      assert.equal(persisted.handoffHistory[0].reason, "phase-rejected");
      assert.equal(toolDetails(await host.runTool("handoff_list", {})).count, 0);
      const archived = await host.runTool("handoff_show", { phaseRef: "P001" });
      assert.match(toolText(archived), /Archived terminal-phase handoff/);
      assert.match(toolText(archived), /rejected through Pi/);
      assert.match(toolText(archived), /.planner\/docs\/p097-closeout\.md/);
      assert.equal(toolDetails(archived).archived, true);
      assert.equal(toolDetails(archived).archiveReason, "phase-rejected");
      assert.equal(toolDetails(archived).active, false);
    } finally {
      await closePiHost(host);
    }
  });

  test("plan_repair runs and reports a healthy integrity matrix", async () => {
    const host = await createPiHost({ name: "t242-repair", seed: "minimal" });
    try {
      const repaired = await host.runTool("plan_repair", {});
      assert.match(toolText(repaired), /Repair complete\./);
      const details = toolDetails(repaired);
      assert.deepEqual(details.integrity.duplicatePhaseIds, []);
      assert.deepEqual(details.integrity.danglingPhaseIds, []);
    } finally {
      await closePiHost(host);
    }
  });
});
