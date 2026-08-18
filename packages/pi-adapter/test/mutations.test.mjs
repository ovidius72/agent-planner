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
      // Start — response carries the composite ref via the phase context block.
      const started = await host.runTool("task_start", { taskId: "T001" });
      assert.match(toolText(started), /✅ Task started:/);
      assert.match(toolText(started), /P001\(F001\)/);
      assert.match(toolText(started), /Implement login/);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].status, "in-progress");

      // Complete without force is gated by the unchecked checklist item.
      const gated = await host.runTool("task_complete", { taskId: "T001" });
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

  test("explicit task starts bypass priority and multi-active advice without bypassing lifecycle tools", async () => {
    const host = await createPiHost({ name: "t281-explicit-start", seed: "minimal" });
    try {
      for (const title of ["Explicit lower-priority task", "Explicit task after an active-work conflict"]) {
        await host.runTool("task_create", {
          featureId: "F001",
          phaseId: "P001",
          title,
          description: "src/task-start.ts:1 start this user-selected task despite a different automatic priority recommendation.",
        });
      }

      const priorityOverride = await host.runTool("task_start", { taskId: "T002" });
      assert.match(toolText(priorityOverride), /✅ Task started: P001\(F001\)\/T002/);
      assert.match(toolText(priorityOverride), /Priority advisory/);

      const secondActive = await host.runTool("task_start", { taskId: "T001" });
      assert.match(toolText(secondActive), /✅ Task started: P001\(F001\)\/T001/);
      assert.match(toolText(secondActive), /Active-task advisory.*Explicit task request honored/i);

      const multiActive = await host.runTool("task_start", { taskId: "T003" });
      assert.match(toolText(multiActive), /✅ Task started: P001\(F001\)\/T003/);
      assert.match(toolText(multiActive), /active-work conflict.*Explicit task request honored/i);
      assert.deepEqual((await host.store.loadAllPhases())[0].tasks.map((task) => task.status), ["in-progress", "in-progress", "in-progress"]);
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

      // Reorder knob: priority is persisted and reflected by list ordering.
      await host.runTool("task_update", { taskId: "T001", priority: 1 });
      assert.equal((await task()).priority, 1);
      const list = await host.runTool("task_list", {});
      assert.match(toolText(list), /T001/);
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
        content: "Body of the handoff.",
        confirmed: true,
      });
      assert.match(toolText(written), /✅ Wrote handoff on P001\(F001\)/);
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
      await host.runTool("task_complete", { taskId: "T001", force: true });
      assert.equal((await phase()).status, "done");
      await assert.rejects(
        host.runTool("handoff_write", { phaseRef: "P001", title: "P001 — late handoff", content: "x", confirmed: true }),
        /Cannot write a handoff on done phase/,
      );
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
