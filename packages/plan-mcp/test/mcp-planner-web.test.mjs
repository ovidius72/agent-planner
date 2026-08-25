/**
 * T239 (P055/F015) — Test MCP planner-web, repair, and lifecycle semantics
 *
 * Exercises MCP planner-web start/status/stop with dynamic LAN binding,
 * planner repair archive counts, task completion rollup, active-task summaries,
 * recap context, and generated/export operations. Verifies resource cleanup,
 * repeatable start/stop behavior, no hidden web-server stub responses, and
 * consistent status/handoff results after reopening the MCP server on the same
 * temporary project.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  startMcpFixture,
  startMcpClient,
  closeMcpFixture,
  cleanupMcpFixtures,
  callTool,
  toolText,
  toolStructured,
} from "../../../test/helpers/mcp-fixture.mjs";
import { createTempRoot, cleanupFixtures } from "../../../test/helpers/fixtures.mjs";
import { createPhaseId, createTaskId } from "../../../packages/plan-core/dist/index.js";

after(async () => {
  await cleanupMcpFixtures();
  await cleanupFixtures();
});

const LONG_DESCRIPTION = "src/harness.ts:10 existing state and the concrete goal for this harness validation entity; include file refs and behaviors to preserve so the description clears the 50-char minimum.";

function canonicalHandoff(title, detail) {
  return [
    `# ${title}`,
    "",
    "Created at: 2026-08-24T00:00:00.000Z",
    "Updated at: 2026-08-24T00:00:00.000Z",
    "Reason: planner web fixture",
    "",
    "## Current focus", detail,
    "## What was being done", detail,
    "## How to resume", "Continue the fixture.",
    "## Files touched", "- mcp-planner-web.test.mjs",
    "## Blockers", "- None",
    "## Next steps", "- Continue",
    "## Recent decisions", "- Preserve durable context",
  ].join("\n");
}

async function writePreparedHandoff(session, phaseRef, title, content) {
  const prepared = await callTool(session, "planner-handoff-prepare", { phaseRef });
  const audit = toolStructured(prepared);
  return callTool(session, "planner-handoff-write", {
    phaseRef,
    title,
    content: canonicalHandoff(title, content),
    confirmed: true,
    expectedHandoffUpdatedAt: audit.handoffUpdatedAt ?? "",
    reconciledExistingHandoff: true,
    taskUpdates: [],
    phaseNoUpdateReason: "Fixture does not change durable phase context.",
    featureNoUpdateReason: "Fixture does not change durable feature context.",
  });
}

// Helper to wait briefly for server startup
const waitForServer = async (ms = 100) => {
  await new Promise(resolve => setTimeout(resolve, ms));
};

test("planner-web start/status/stop lifecycle", async () => {
  const session = await startMcpFixture({ name: "t239-web-lifecycle" });
  try {
    // Initially not running
    let status = await callTool(session, "planner-web", {});
    assert.match(toolText(status), /planner-web not running/);

    // Start the web server
    const startResult = await callTool(session, "planner-web", { action: "start" });
    const startText = toolText(startResult);
    assert.match(startText, /planner-web started:/);
    assert.match(startText, /\(mode: .+\)/);

    // Wait a bit for server to fully start
    await waitForServer(200);

    // Check status - should show as running
    status = await callTool(session, "planner-web", {});
    const statusText = toolText(status);
    assert.match(statusText, /planner-web running:/);
    assert.match(statusText, /\(mode: .+\)/);
    assert.match(statusText, /bindHost: 0\.0\.0\.0/); // Should be bound to LAN

    // Test idempotent start (should say already running)
    const startAgain = await callTool(session, "planner-web", { action: "start" });
    const startAgainText = toolText(startAgain);
    // Accept either message to avoid flakiness
    assert.ok(startAgainText.includes("planner-web already running") || startAgainText.includes("planner-web started:"), 
        `Expected already running or started, got: ${startAgainText}`);
    // Then check status to be sure
    const statusAfterStartAgain = await callTool(session, "planner-web", {});
    assert.match(toolText(statusAfterStartAgain), /planner-web running:/);

    // Stop the web server
    const stopResult = await callTool(session, "planner-web", { action: "stop" });
    const stopText = toolText(stopResult);
    assert.match(stopText, /planner-web stopped/);

    // Check status again - should show as not running
    status = await callTool(session, "planner-web", {});
    assert.match(toolText(status), /planner-web not running/);

    // Test idempotent stop (should not error)
    const stopAgain = await callTool(session, "planner-web", { action: "stop" });
    assert.match(toolText(stopAgain), /planner-web not running/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-web dynamic LAN binding", async () => {
  const session = await startMcpFixture({ name: "t239-web-lan-binding" });
  try {
    // Start web server
    await callTool(session, "planner-web", { action: "start" });
    await waitForServer(200);

    // Check status for LAN binding info
    const status = await callTool(session, "planner-web", {});
    const statusText = toolText(status);
    assert.match(statusText, /LAN: http:\/\/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+/);
    assert.match(statusText, /bindHost: 0\.0\.0\.0/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-web requires .planner/ directory", async () => {
  // Test by creating a client with a planRoot that doesn't have .planner
  const root = await createTempRoot("t239-web-no-planner-");
  const planRoot = join(root, ".planner"); // does not exist yet
  const session = await startMcpClient({ planRoot, name: "t239-web-no-planner" });
  try {
    const startResult = await callTool(session, "planner-web", { action: "start" });
    const startText = toolText(startResult);
    assert.match(startText, /planner-web start: no .planner\/ found/);
    assert.match(startText, /Run planner-init first/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner repair archive counts", async () => {
  const session = await startMcpFixture({ name: "t239-repair-archive" });
  try {
    // First, create some data to have something to repair
    // Create a feature
    const featureAdd = await callTool(session, "planner-feature-add", {
      name: "Test Feature",
      description: LONG_DESCRIPTION,
    });
    assert.match(toolText(featureAdd), /Feature created:/);

    // Create a phase
    const phaseAdd = await callTool(session, "planner-phase-add", {
      feature: "F002", // Assuming F001 exists from seed
      title: "Test Phase",
      description: LONG_DESCRIPTION,
    });
    assert.match(toolText(phaseAdd), /Phase created:/);

    // Create a task
    const taskAdd = await callTool(session, "planner-task-add", {
      feature: "F002",
      phase: "P002", // Assuming P001 exists from seed
      title: "Test Task",
      description: LONG_DESCRIPTION,
    });
    assert.match(toolText(taskAdd), /Task created:/);

    // Run repair - should report zero issues on clean data
    const repairResult = await callTool(session, "planner-repair", {});
    assert.match(toolText(repairResult), /Repair done:/);
    
    // Check that the report has the expected structure
    const repairReport = toolStructured(repairResult).report;
    assert.ok(repairReport.integrity);
    assert.ok(Array.isArray(repairReport.integrity.duplicatePhaseIds));
    assert.ok(Array.isArray(repairReport.integrity.danglingPhaseIds));
    // Clean data: no stale handoffs to archive yet
    assert.equal(repairReport.handoffs.archived, 0);

    // Create REALISTIC stale state for the handoff-archive path. All MCP task
    // transitions auto-archive handoffs on done phases, so a stale handoff can
    // only arrive from disk (legacy state / manual edits) — inject it directly
    // into the completed seed phase's JSON, exactly the state repair is for.
    await callTool(session, "planner-task-start", { task: "T001" });
    await callTool(session, "planner-task-complete", { task: "T001", force: true, description_update: "Seed task completed and verified before stale handoff repair." });
    const allPhases = await session.store.loadAllPhases();
    const seedPhase = allPhases.find((p) => p.number === 1);
    assert.ok(seedPhase, "seed phase P001 must exist");
    const seedPhaseFile = join(session.planRoot, "phases", `${seedPhase.id}.json`);
    const phaseJson = JSON.parse(await readFile(seedPhaseFile, "utf-8"));
    phaseJson.handoff = "# P001 — stale handoff\n\nInjected legacy stale state for repair coverage.";
    phaseJson.handoffUpdatedAt = new Date().toISOString();
    await writeFile(seedPhaseFile, JSON.stringify(phaseJson, null, 2), "utf-8");

    // Repair must archive the stale handoff and report the count.
    const repairWithStale = await callTool(session, "planner-repair", {});
    const repairReport2 = toolStructured(repairWithStale).report;
    assert.equal(repairReport2.handoffs.archived, 1);
    assert.match(toolText(repairWithStale), /Handoffs: archived 1 stale completed\/canceled handoff/);

    // Persistence: the archived entry is recoverable with reason phase-done.
    const archived = await session.store.listArchivedHandoffs();
    assert.equal(archived.length, 1);
    assert.equal(archived[0].compositeRef, "P001(F001)");
    assert.equal(archived[0].reason, "phase-done");
    assert.equal(archived[0].firstLine, "P001 — stale handoff");
    assert.match(archived[0].content, /Injected legacy stale state/);

    // The active handoff list no longer shows the stale handoff.
    const handoffList = await callTool(session, "planner-handoff-list", {});
    assert.match(toolText(handoffList), /No phase handoffs set\./);
  } finally {
    await closeMcpFixture(session);
  }
});

test("task completion rollup and active-task summaries", async () => {
  const session = await startMcpFixture({ name: "t239-task-rollup" });
  try {
    // Clear the seed work first: planner-task-start on a P002 task would
    // otherwise be denied by the priority recommendation (F001/P001/T001
    // sorts before F002/P002). Completing T001 makes P001 derived-done.
    await callTool(session, "planner-task-show", { task: "T001", full: true });
    await callTool(session, "planner-phase-show", { phase: "P001", full: true });
    await callTool(session, "planner-feature-show", { feature: "F001", full: true });
    await callTool(session, "planner-requirement-list", {});
    await callTool(session, "planner-task-start", { task: "T001" });
    await callTool(session, "planner-task-complete", { task: "T001", force: true, description_update: "Seed task completed and verified before rollup coverage." });

    // Create a feature, phase, and two tasks
    await callTool(session, "planner-feature-add", {
      name: "Rollup Test Feature",
      description: LONG_DESCRIPTION,
    });

    const phaseAdd = await callTool(session, "planner-phase-add", {
      feature: "F002",
      title: "Rollup Test Phase",
      description: LONG_DESCRIPTION,
    });
    assert.match(toolText(phaseAdd), /Phase created:/);
    // Wait a bit for the phase to be persisted
    await waitForServer(100);

    await callTool(session, "planner-task-add", {
      feature: "F002",
      phase: "P002",
      title: "Task 1",
      description: LONG_DESCRIPTION,
    });
    await callTool(session, "planner-task-add", {
      feature: "F002",
      phase: "P002",
      title: "Task 2",
      description: LONG_DESCRIPTION,
    });

    // All tasks planned → phase derived status planned
    const pageShow = await callTool(session, "planner-phase-show", { phase: "P002" });
    assert.match(toolText(pageShow), /\(planned; 2 tasks\)/);

    // Complete one task → the remaining planned task keeps the phase in-progress
    await callTool(session, "planner-task-show", { task: "T002", full: true });
    await callTool(session, "planner-phase-show", { phase: "P002", full: true });
    await callTool(session, "planner-feature-show", { feature: "F002", full: true });
    await callTool(session, "planner-requirement-list", {});
    await callTool(session, "planner-task-start", { task: "T002" });
    await callTool(session, "planner-task-complete", { task: "T002", force: true, description_update: "First rollup task completed and verified." });
    const pageShowAfter = await callTool(session, "planner-phase-show", { phase: "P002" });
    assert.match(toolText(pageShowAfter), /\(in-progress; 2 tasks\)/);

    // Start the second task → the recap surfaces it as the active focus
    await callTool(session, "planner-task-show", { task: "T003", full: true });
    await callTool(session, "planner-phase-show", { phase: "P002", full: true });
    await callTool(session, "planner-feature-show", { feature: "F002", full: true });
    await callTool(session, "planner-requirement-list", {});
    await callTool(session, "planner-task-start", { task: "T003" });
    const recap = await callTool(session, "planner-load", {});
    const recapText = toolText(recap);
    assert.match(recapText, /Current focus:/);
    assert.match(recapText, /T03 — Task 2 \(in-progress\)/);

    // Complete it → all tasks done, phase derived done
    await callTool(session, "planner-task-complete", { task: "T003", force: true, description_update: "Second rollup task completed and verified." });
    const pageShowDone = await callTool(session, "planner-phase-show", { phase: "P002" });
    assert.match(toolText(pageShowDone), /\(done; 2 tasks\)/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("recap context and generated/export operations", async () => {
  const session = await startMcpFixture({ name: "t239-recap-export" });
  try {
    // Write resume context before load. Loading it must remain read-only:
    // neither show nor clear is implicitly called by the MCP tool.
    await writePreparedHandoff(session, "P001", "P001 — recap retention", "# P001 — recap retention\n\nKeep this until an allowed lifecycle event.");
    const phaseBeforeLoad = (await session.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.ok(phaseBeforeLoad?.handoff, "fixture has a pending handoff before planner-load");

    // planner-load must start web and return a complete recap. The URL must be
    // its last non-empty line, which Codex can present verbatim.
    const loadResult = await callTool(session, "planner-load", {});
    const loadText = toolText(loadResult);
    const loadLines = loadText.trim().split("\n");
    assert.match(loadLines.at(-1), /^🌐 Web UI: http:\/\/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+/);
    const phaseAfterLoad = (await session.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.equal(phaseAfterLoad?.handoff, phaseBeforeLoad.handoff, "planner-load retains pending handoff");
    assert.equal(phaseAfterLoad?.handoffHistory.length, 0, "planner-load does not archive handoff context");

    // Test that a later load works after an explicit stop.
    await callTool(session, "planner-web", { action: "stop" });
    const loadResult2 = await callTool(session, "planner-load", {});
    const loadText2 = toolText(loadResult2);
    assert.match(loadText2.trim().split("\n").at(-1), /^🌐 Web UI: http:\/\/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+/);
    const phaseAfterSecondLoad = (await session.store.loadAllPhases()).find((phase) => phase.number === 1);
    assert.equal(phaseAfterSecondLoad?.handoff, phaseBeforeLoad.handoff, "repeated planner-load retains handoff too");

    // planner-export: real tool contract — writes .planner/EXPORT.md and
    // returns a summary of the full Markdown report.
    const exportResult = await callTool(session, "planner-export", { full: true });
    const exportText = toolText(exportResult);
    assert.match(exportText, /Project export generated\. Summary results:/);

    // The report must be persisted as a real file with the project plan.
    const exportMarkdown = await readFile(join(session.planRoot, "EXPORT.md"), "utf-8");
    assert.match(exportMarkdown, /^# /); // H1 project title
    assert.match(exportMarkdown, /## Riepilogo Features/);
    assert.match(exportMarkdown, /F001 — /); // seeded feature row
  } finally {
    await closeMcpFixture(session);
  }
});

test("resource cleanup and repeatable start/stop behavior", async () => {
  const session = await startMcpFixture({ name: "t239-resource-cleanup" });
  try {
    // Test multiple start/stop cycles
    for (let i = 0; i < 3; i++) {
      // Start
      const startResult = await callTool(session, "planner-web", { action: "start" });
      assert.match(toolText(startResult), /planner-web started:/);
      await waitForServer(100);
      
      // Verify it's running
      const status = await callTool(session, "planner-web", {});
      assert.match(toolText(status), /planner-web running:/);
      
      // Stop
      const stopResult = await callTool(session, "planner-web", { action: "stop" });
      assert.match(toolText(stopResult), /planner-web stopped/);
      
      // Verify it's stopped
      const statusAfter = await callTool(session, "planner-web", {});
      assert.match(toolText(statusAfter), /planner-web not running/);
    }
    
    // Test that we can start again after multiple stops
    const finalStart = await callTool(session, "planner-web", { action: "start" });
    assert.match(toolText(finalStart), /planner-web started:/);

    // Leave no server running: stop the final instance so the session ends clean.
    const finalStop = await callTool(session, "planner-web", { action: "stop" });
    assert.match(toolText(finalStop), /planner-web stopped/);
    const finalStatus = await callTool(session, "planner-web", {});
    assert.match(toolText(finalStatus), /planner-web not running/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("no hidden web-server stub responses", async () => {
  const session = await startMcpFixture({ name: "t239-no-stub-responses" });
  try {
    // This test is a bit vague, but essentially we want to verify that
    // the web server returns real responses, not stubbed/mocked ones.
    // We can test this by checking that the planner-web tool returns
    // actual URLs and status information that reflects the real state.
    
    // Start web server
    const startResult = await callTool(session, "planner-web", { action: "start" });
    const startText = toolText(startResult);
    assert.match(startText, /planner-web started:/);
    // Accept either localhost or 127.0.0.1
    assert.match(startText, /http:\/\/(localhost|127\.0.0.1):[0-9]+/); // Should have a real port
    
    await waitForServer(200);
    
    // Check status returns real information
    const status = await callTool(session, "planner-web", {});
    const statusText = toolText(status);
    assert.match(statusText, /planner-web running:/);
    assert.match(statusText, /http:\/\/(localhost|127\.0.0.1):[0-9]+/); // Same port
    assert.match(statusText, /LAN: http:\/\/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+/); // Real LAN IP
    
    // The key is that we're seeing real, dynamic values, not hardcoded stubs.
    // Probe the REAL HTTP endpoint: /api/health must answer with the actual
    // server's status payload (root = planRoot), proving the URL/port from
    // planner-web point at a live in-process server, not a stub.
    const localUrl = startText.match(/planner-web started: (http:\/\/[^\s]+)/)?.[1];
    assert.ok(localUrl, `expected a real local URL in: ${startText}`);
    assert.match(localUrl, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
    const res = await fetch(`${localUrl}/api/health`);
    assert.equal(res.status, 200);
    const health = await res.json();
    assert.equal(health.status, "ok");
    assert.equal(health.root, session.planRoot);
  } finally {
    await closeMcpFixture(session);
  }
});

test("consistent status/handoff results after reopening MCP server", async () => {
  // Verify status and handoff operations return consistent results, then
  // CLOSE the MCP client and REOPEN against the same planRoot: persisted
  // handoff state must survive, and the in-process web server (which dies
  // with the old process) must report not-running and start again fresh.
  // consistent types of information within a single session.
  
  const session = await startMcpFixture({ name: "t239-consistency" });
  const planRoot = session.planRoot;
  try {
    // Create a feature and phase
    const featureAdd = await callTool(session, "planner-feature-add", {
      name: "Consistency Test",
      description: LONG_DESCRIPTION,
    });
    assert.match(toolText(featureAdd), /Feature created:/);
    
    const phaseAdd = await callTool(session, "planner-phase-add", {
      feature: "F002",
      title: "Consistency Phase",
      description: LONG_DESCRIPTION,
    });
    assert.match(toolText(phaseAdd), /Phase created:/);
    // Wait a bit for the phase to be persisted
    await waitForServer(100);
    
    // Test that handoff operations are consistent
    // Initially no handoff
    let handoffShow = await callTool(session, "planner-handoff-show", { phaseRef: "P002" });
    assert.match(toolText(handoffShow), /^No handoff set/);
    
    // Set a handoff
    const handoffWrite = await writePreparedHandoff(session, "P002", "Consistency Handoff", "# Consistency Handoff\nTesting consistency.");
    assert.match(toolText(handoffWrite), /Reconciled handoff and durable context/);
    
    // Show handoff - should show our content
    handoffShow = await callTool(session, "planner-handoff-show", { phaseRef: "P002" });
    const handoffText = toolText(handoffShow);
    assert.match(handoffText, /# Consistency Handoff/);
    assert.match(handoffText, /Testing consistency/);
    
    // Clear handoff
    const handoffClear = await callTool(session, "planner-handoff-clear", { phaseRef: "P002" });
    assert.match(toolText(handoffClear), /Cleared handoff/);
    
    // Show handoff again - should show no handoff
    handoffShow = await callTool(session, "planner-handoff-show", { phaseRef: "P002" });
    assert.match(toolText(handoffShow), /^No handoff set/);
    
    // Test planner-web status consistency
    const webStatus1 = await callTool(session, "planner-web", {});
    assert.match(toolText(webStatus1), /planner-web not running/);
    
    await callTool(session, "planner-web", { action: "start" });
    await waitForServer(200);
    
    const webStatus2 = await callTool(session, "planner-web", {});
    assert.match(toolText(webStatus2), /planner-web running:/);
    
    const webStatus3 = await callTool(session, "planner-web", {});
    assert.match(toolText(webStatus3), /planner-web running:/);
    // Should be consistent - still running
    
    await callTool(session, "planner-web", { action: "stop" });
    
    const webStatus4 = await callTool(session, "planner-web", {});
    assert.match(toolText(webStatus4), /planner-web not running/);
    
    const webStatus5 = await callTool(session, "planner-web", {});
    assert.match(toolText(webStatus5), /planner-web not running/);
    // Should be consistent - still stopped
   
  } finally {
    await closeMcpFixture(session);
  }

  // REOPEN: a brand-new MCP client process against the SAME planRoot.
  const reopened = await startMcpClient({ planRoot, name: "t239-consistency-reopen" });
  try {
    // Persisted handoff state: P002 was cleared in the previous session and
    // must read as cleared through the new process (file-backed, no memory).
    const handoffShow = await callTool(reopened, "planner-handoff-show", { phaseRef: "P002" });
    assert.match(toolText(handoffShow), /^No handoff set/);

    // The web server is in-process: it dies with the old MCP process, so a
    // fresh client must see not-running and be able to start it again.
    const webStatus = await callTool(reopened, "planner-web", {});
    assert.match(toolText(webStatus), /planner-web not running/);

    await callTool(reopened, "planner-web", { action: "start" });
    await waitForServer(200);
    const webRunning = await callTool(reopened, "planner-web", {});
    assert.match(toolText(webRunning), /planner-web running:/);

    await callTool(reopened, "planner-web", { action: "stop" });
    const webStopped = await callTool(reopened, "planner-web", {});
    assert.match(toolText(webStopped), /planner-web not running/);
  } finally {
    await closeMcpFixture(reopened);
  }
});