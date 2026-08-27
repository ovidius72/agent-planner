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
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";

after(async () => {
  await cleanupPiHosts();
});

const LONG_DESC =
  "src/harness.ts:10 existing state and the concrete goal for this mutation-test entity; include file refs and behaviors to preserve so the description clears the minimum.";

async function readTaskContext(host, taskId, phaseId = "P001", featureId = "F001") {
  await host.runTool("task_get", { taskId, full: true });
  await host.runTool("phase_get", { phaseId, full: true });
  await host.runTool("feature_get", { featureId, full: true });
  await host.runTool("requirement_list", {});
}

function canonicalHandoff(title, detail) {
  return [
    `# ${title}`,
    "",
    "Created at: 2026-08-24T00:00:00.000Z",
    "Updated at: 2026-08-24T00:00:00.000Z",
    "Reason: mutation fixture",
    "",
    "## Current focus", detail,
    "## What was being done", detail,
    "## How to resume", "Continue the fixture.",
    "## Files touched", "- mutations.test.mjs",
    "## Blockers", "- None",
    "## Next steps", "- Continue",
    "## Recent decisions", "- Preserve durable context",
  ].join("\n");
}

async function preparedHandoffArgs(host, phaseRef = "P001") {
  const prepared = await host.runTool("handoff_prepare", { phaseRef });
  return {
    expectedHandoffUpdatedAt: toolDetails(prepared).handoffUpdatedAt ?? "",
    reconciledExistingHandoff: true,
    taskUpdates: [],
    phaseNoUpdateReason: "Fixture does not change durable phase context.",
    featureNoUpdateReason: "Fixture does not change durable feature context.",
  };
}

describe("pi-adapter mutations, validation, requirements, handoffs", () => {
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
      const badRef = await host.runTool("handoff_write", { phaseRef: "P999", content: "x", confirmed: true });
      assert.match(toolText(badRef), /Phase not found/);
      await assertFileUntouched("missing phase ref");

      // Handoff text/title validations are rejected without touching the phase.
      const empty = await host.runTool("handoff_write", { phaseRef: "P001", confirmed: true });
      assert.match(toolText(empty), /Provide the handoff text/);
      await assertFileUntouched("empty handoff text");
      const generic = await host.runTool("handoff_write", { phaseRef: "P001", content: "Handoff" });
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
      assert.deepEqual(toolDetails(deniedWithoutRequirements).nextActions, ["requirement_list", "Retry task_start P001(F001)/T001"]);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, "planned");

      // Start — response carries the composite ref only after requirements are read.
      await host.runTool("requirement_list", {});
      const started = await host.runTool("task_start", { taskId: "T001" });
      assert.match(toolText(started), /✅ Task started:/);
      assert.match(toolText(started), /P001\(F001\)/);
      assert.match(toolText(started), /Implement login/);
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

  test("requirements: create with links, then update status", async () => {
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

      const updated = await host.runTool("requirement_update", { requirementId: req.id, status: "in-progress" });
      assert.match(toolText(updated), /Requirement updated: /);
      reqs = (await host.store.loadRequirements()).requirements;
      assert.equal(reqs.find((r) => r.title === "Auth requirement").status, "in-progress");
    } finally {
      await closePiHost(host);
    }
  });

  test("handoffs: proposal, explicit confirmation, list/show/clear with archive, terminal-phase rejection", async () => {
    const host = await createPiHost({ name: "t242-handoff", seed: "minimal" });
    try {
      const phase = async () => (await host.store.loadAllPhases())[0];

      // Proposal only — no confirmation flag, nothing written.
      const proposal = await host.runTool("handoff_write", { phaseRef: "P001", content: "Body of the handoff." });
      assert.match(toolText(proposal), /Proposal only/);
      assert.equal(toolDetails(proposal).confirmationRequired, true);
      assert.match(toolDetails(proposal).phaseRef, /P001/);
      assert.equal((await phase()).handoff, "", "proposal must not write");

      // Confirmed write with a meaningful title.
      const written = await host.runTool("handoff_write", {
        phaseRef: "P001",
        title: "P001 — Auth API phase: fixture handoff",
        content: canonicalHandoff("P001 — Auth API phase: fixture handoff", "Body of the handoff."),
        confirmed: true,
        ...(await preparedHandoffArgs(host)),
      });
      assert.match(toolText(written), /✅ Reconciled handoff and durable context on P001\(F001\)/);
      assert.match((await phase()).handoff, /^# P001 — Auth API phase: fixture handoff/);

      // List + show round-trip.
      const list = await host.runTool("handoff_list", {});
      assert.match(toolText(list), /P001\(F001\)/);
      assert.match(toolText(list), /fixture handoff/);
      const shown = await host.runTool("handoff_show", { phaseRef: "P001" });
      assert.match(toolText(shown), /Body of the handoff\./);

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
        phaseRef: "P001", title: "P001 — late handoff", content: canonicalHandoff("P001 — late handoff", "Late handoff."), confirmed: true,
        ...(await preparedHandoffArgs(host)),
      });
      assert.match(toolText(late), /Cannot write a handoff on done phase/);
      assert.equal((await phase()).handoff, "");
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
      const requirementId = toolDetails(createdRequirement).id;
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
        "requirement_list",
        "Retry task_start P001(F001)/T001",
      ]);
    } finally {
      await closePiHost(second);
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
