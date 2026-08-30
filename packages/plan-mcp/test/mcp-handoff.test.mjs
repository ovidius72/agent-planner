/**
 * T238 (P055/F015) — Test MCP handoff proposal and confirmation contract.
 *
 * Uses the real MCP server harness (same as T236/T237) to verify the handoff
 * tools: planner-handoff-prepare, planner-handoff-write, planner-handoff-show,
 * planner-handoff-list, planner-handoff-clear.
 *
 * Contract:
 *  - planner-handoff-prepare returns a generic proposal (no phaseRef needed).
 *  - planner-handoff-write without confirmed=true returns a proposal that
 *    includes the exact composite ref the agent must present to the user for
 *    confirmation.
 *  - planner-handoff-write with confirmed=true writes the handoff; the written
 *    handoff can be read back via planner-handoff-show and seen in
 *    planner-handoff-list.
 *  - Writing a handoff to a done/canceled phase is rejected (or does not persist).
 *  - All tools require an explicit phaseRef; there is no implicit fallback to
 *    the first in‑progress phase.
 *  - Proposal responses are actionable and contain the exact target (phase
 *    composite ref) that the agent should show to the user.
 *  - Replacing a handoff archives the previous content (reason `superseded`):
 *    the active list shows only the newest, and the archive stays recoverable
 *    via the real PlanStore (archive listing is not exposed by MCP tools).
 *  - Clearing a handoff archives it (reason `manual`) and empties the active
 *    list, with the content still recoverable from the store archive.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  startMcpFixture,
  closeMcpFixture,
  cleanupMcpFixtures,
  callTool,
  expectToolError,
  toolText,
} from "../../../test/helpers/mcp-fixture.mjs";
import { canonicalAuditedHandoff, completeHandoffAudit } from "../../../test/helpers/handoff-audit.mjs";
import { PhaseSchema, createPhaseId } from "../../plan-core/dist/index.js";

after(async () => {
  await cleanupMcpFixtures();
});

const LONG = "src/mcp-handoff.ts:10 existing state and the concrete goal for this entity; include file refs and behaviors to preserve so the description clears the 50-char minimum.";

async function preparedHandoffArgs(session, phaseRef = "P001") {
  const prepared = await callTool(session, "planner-handoff-prepare", { phaseRef });
  const audit = prepared.structuredContent ?? {};
  return {
    expectedHandoffUpdatedAt: audit.handoffUpdatedAt ?? "",
    reconciledExistingHandoff: true,
    completenessAudit: completeHandoffAudit(),
    taskUpdates: [],
    phaseNoUpdateReason: "Fixture does not change durable phase context.",
    featureNoUpdateReason: "Fixture does not change durable feature context.",
  };
}

function canonicalHandoff(title, detail) {
  return canonicalAuditedHandoff(title, detail, { file: "mcp-handoff.test.mjs", reason: "test fixture" });
}

async function writePreparedHandoff(session, input) {
  return callTool(session, "planner-handoff-write", {
    ...input,
    content: canonicalHandoff(input.title, input.content),
    confirmed: true,
    ...(await preparedHandoffArgs(session, input.phaseRef)),
  });
}

test("planner-handoff-prepare returns a generic proposal", async () => {
  const session = await startMcpFixture({ name: "t238-prepare" });
  try {
    const res = await callTool(session, "planner-handoff-prepare", {});
    const text = toolText(res);
    // Should contain the instructional lines
    assert.match(text, /First identify the exact feature and phase actually discussed/);
    assert.match(text, /Tell the user:/);
    assert.match(text, /I propose writing this handoff on P00x\(F00x\) — <phase title>\. Confirm\?/);
    assert.match(text, /call planner-handoff-prepare again with that exact phaseRef/);
    assert.match(text, /reconcile its current handoff and missing task evidence/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-handoff-write without confirmed returns a proposal with exact composite ref", async () => {
  const session = await startMcpFixture({ name: "t238-write-proposal" });
  try {
    // Ensure we have a phase to target (seed phase P001)
    const res = await callTool(session, "planner-handoff-write", {
      // No confirmed flag -> should return a proposal
      // We need to provide a phaseRef; use the seed phase P001(F001)
      phaseRef: "P001",
      // The write tool requires content (string) and confirmed boolean.
      // For a proposal, set confirmed: false.
      title: "dummy proposal",
      content: "dummy content",
      confirmed: false,
      completenessAudit: completeHandoffAudit(),
    });
    const text = toolText(res);
    // Should be a proposal, not a success.
    assert.match(text, /^Proposal only:/);
    // Must contain the exact composite ref of the seed phase.
    assert.match(text, /I would refresh this handoff on P001\(F001\)/);
    // Must ask the user to confirm.
    assert.match(text, /Ask the user to confirm/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-handoff-write with confirmed=true writes the handoff and can be read back", async () => {
  const session = await startMcpFixture({ name: "t238-write-confirmed" });
  try {
    // First, write a handoff with confirmed=true
    const writeRes = await writePreparedHandoff(session, {
      phaseRef: "P001",
      title: "P001 — Test handoff",
      content: "# Test handoff\nThis is a test handoff for T238.",
    });
    const writeText = toolText(writeRes);
    assert.match(writeText, /Reconciled handoff and durable context on P001\(F001\)/);

    // Now show the handoff
    const showRes = await callTool(session, "planner-handoff-show", { phaseRef: "P001" });
    const showText = toolText(showRes);
    assert.match(showText, /# P001 — Test handoff/);
    assert.match(showText, /This is a test handoff for T238/);
    // Should also show the phase ref in the header? The tool returns the content only.
    // But we can also check that the handoff is not empty.
    assert.doesNotMatch(showText, /^No handoff set/);

    // List handoffs should show this phase
    const listRes = await callTool(session, "planner-handoff-list", {});
    const listText = toolText(listRes);
    assert.match(listText, /P001\(F001\)/);
    assert.match(listText, /Test handoff/);
    assert.equal(listRes.structuredContent.page, 1);
    assert.equal(listRes.structuredContent.totalPages, 1);
    assert.equal(Object.hasOwn(listRes.structuredContent.handoffs[0], "content"), false, "compact list must never embed full handoff bodies");
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-handoff-write returns typed completeness diagnostics before mutation", async () => {
  const session = await startMcpFixture({ name: "t352-completeness-required" });
  try {
    const prepared = await callTool(session, "planner-handoff-prepare", { phaseRef: "P001" });
    const audit = prepared.structuredContent ?? {};
    const result = await callTool(session, "planner-handoff-write", {
      phaseRef: "P001",
      title: "P001 — missing completeness audit",
      content: canonicalHandoff("P001 — missing completeness audit", "The body is operational but the audit payload is intentionally absent."),
      confirmed: true,
      expectedHandoffUpdatedAt: audit.handoffUpdatedAt ?? "",
      reconciledExistingHandoff: true,
      taskUpdates: [],
      phaseNoUpdateReason: "Fixture does not change durable phase context.",
      featureNoUpdateReason: "Fixture does not change durable feature context.",
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.errorCode, "HANDOFF_COMPLETENESS_AUDIT_REQUIRED");
    assert.ok(result.structuredContent.missingCategories.includes("branch-worktree"));
    assert.equal((await session.store.loadAllPhases())[0].handoff, "");
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-handoff-list paginates compact summaries without body amplification", async () => {
  const session = await startMcpFixture({ name: "t352-compact-pagination" });
  try {
    const feature = (await session.store.loadFeatures()).features[0];
    const now = new Date().toISOString();
    for (let number = 1; number <= 12; number += 1) {
      const phaseId = createPhaseId();
      const phase = PhaseSchema.parse({
        id: phaseId,
        featureId: feature.id,
        number: number + 10,
        slug: `handoff-page-${number}`,
        title: `Handoff page ${number}`,
        description: "Pagination fixture",
        createdAt: now,
        updatedAt: now,
      });
      await session.store.savePhase(phase);
      await session.store.setPhaseHandoff(phaseId, `# Compact summary ${number}\n\n${"body detail ".repeat(300)}`);
    }
    const listed = await callTool(session, "planner-handoff-list", { page: 2, pageSize: 5 });
    assert.equal(listed.structuredContent.page, 2);
    assert.equal(listed.structuredContent.pageSize, 5);
    assert.equal(listed.structuredContent.total, 12);
    assert.equal(listed.structuredContent.totalPages, 3);
    assert.equal(listed.structuredContent.handoffs.length, 5);
    assert.ok(listed.structuredContent.handoffs.every((entry) => !Object.hasOwn(entry, "content")));
    assert.ok(JSON.stringify(listed.structuredContent).length < 10_000, "paginated structured output stays bounded");
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-handoff-show keeps oversized legacy handoffs readable but transport-bounded", async () => {
  const session = await startMcpFixture({ name: "t352-legacy-bounded-show" });
  try {
    const phase = (await session.store.loadAllPhases())[0];
    await session.store.setPhaseHandoff(phase.id, `# Legacy oversized handoff\n\n${"x".repeat(30_000)}`);
    const shown = await callTool(session, "planner-handoff-show", { phaseRef: "P001" });
    assert.equal(shown.structuredContent.truncated, true);
    assert.equal(shown.structuredContent.fullLength > 24_000, true);
    assert.equal(shown.structuredContent.content.length, 24_000);
    assert.match(shown.structuredContent.content, /Legacy handoff truncated for transport safety/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-task-start retains a pending handoff", async () => {
  const session = await startMcpFixture({ name: "t243-task-start-retention" });
  try {
    await writePreparedHandoff(session, {
      phaseRef: "P001",
      title: "P001 — MCP retention handoff",
      content: "MCP task start must keep this handoff.",
    });

    await callTool(session, "planner-task-show", { task: "T001", full: true });
    await callTool(session, "planner-phase-show", { phase: "P001", full: true });
    await callTool(session, "planner-feature-show", { feature: "F001", full: true });
    await callTool(session, "planner-requirement-list", {});
    await callTool(session, "planner-task-start", { task: "T001" });
    const phase = (await session.store.loadAllPhases())[0];
    assert.equal(phase.tasks[0].status, "in-progress");
    assert.match(phase.handoff, /MCP task start must keep this handoff\./);
    assert.equal(phase.handoffHistory.length, 0, "MCP task start does not archive the handoff");
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-handoff-write rejects writing to a done phase", async () => {
  const session = await startMcpFixture({ name: "t238-write-done" });
  try {
    // First, create a second feature/phase to avoid messing with seed? We'll just use seed phase and mark it done.
    // We need to complete the only task in the seed phase to make the phase derived status done? Actually phase status is derived from tasks.
    // Let's instead directly manipulate via MCP? There's no tool to set phase status directly; we can complete its tasks.
    // Seed phase P001 has one task T001. We'll complete it.
    // Start and complete the task.
    await callTool(session, "planner-task-start", { task: "T001" });
    await callTool(session, "planner-task-complete", { task: "T001", force: true, description_update: "Seed task completed and verified for terminal handoff coverage." });
    // Now the phase should be derived as done (since all tasks done).
    // Try to write handoff to P001.
    const res = await writePreparedHandoff(session, {
      phaseRef: "P001",
      title: "Should not be written",
      content: "dummy",
    });
    const text = toolText(res);
    // Expect an error indicating that done/canceled phases reject new handoffs.
    // From the write tool handler: "If the phase is done/canceled, do not write an operational handoff."
    // Likely returns an error text.
    assert.match(text, /Cannot write a handoff on done phase/);
    assert.match(text, /completed phases have no pending handoff/);
    // Ensure no handoff was actually written (show should say no handoff).
    const showRes = await callTool(session, "planner-handoff-show", { phaseRef: "P001" });
    const showText = toolText(showRes);
    assert.match(showText, /^No handoff set on P001\(F001\)\./);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-handoff-list and handoff clear workflow", async () => {
  const session = await startMcpFixture({ name: "t238-list-clear" });
  try {
    // Initially no handoffs
    let listRes = await callTool(session, "planner-handoff-list", {});
    assert.match(toolText(listRes), /^No phase handoffs set\./);

    // Write a handoff
    await writePreparedHandoff(session, {
      phaseRef: "P001",
      title: "Handoff for list/clear",
      content: "---\n",
    });

    // Now list should show it
    listRes = await callTool(session, "planner-handoff-list", {});
    const listText = toolText(listRes);
    assert.match(listText, /Phase handoffs — page 1\/1 \(1 total\):/);
    assert.match(listText, /P001\(F001\)/);
    assert.match(listText, /Handoff for list\/clear/);

    const clearRes = await callTool(session, "planner-handoff-clear", { phaseRef: "P001" });
    assert.match(toolText(clearRes), /Cleared handoff on P001\(F001\)/);
    // After clear, list should show none again
    listRes = await callTool(session, "planner-handoff-list", {});
    assert.match(toolText(listRes), /^No phase handoffs set\./);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-handoff tools require explicit phaseRef; no implicit fallback", async () => {
  const session = await startMcpFixture({ name: "t238-no-fallback" });
  try {
    // Attempt to call handoff-show without phaseRef should result in a validation error (isError true).
    const res = await callTool(session, "planner-handoff-show", {}, { expectError: true });
    const text = toolText(res);
    // Should be a schema error about missing phaseRef.
    assert.match(text, /phaseRef/);
    assert.match(text, /expected string/);

    // Same for handoff-write
    const res2 = await callTool(session, "planner-handoff-write", { title: "x", confirmed: true }, { expectError: true });
    assert.match(toolText(res2), /phaseRef/);
    assert.match(toolText(res2), /expected string/);

    // handoff-clear also requires phaseRef
    const res3 = await callTool(session, "planner-handoff-clear", {}, { expectError: true });
    assert.match(toolText(res3), /phaseRef/);
    assert.match(toolText(res3), /expected string/);

    // handoff-list does NOT require phaseRef (it's optional). So we can call it without args.
    const listRes = await callTool(session, "planner-handoff-list", {});
    // Should not error; just list (maybe empty).
    // We'll just ensure no throw.
  } finally {
    await closeMcpFixture(session);
  }
});

test("handoff proposal is actionable and contains exact target for user confirmation", async () => {
  const session = await startMcpFixture({ name: "t238-proposal-actionable" });
  try {
    // Trigger a proposal via write without confirmed
    const res = await callTool(session, "planner-handoff-write", {
      phaseRef: "P001",
      title: "dummy",
      content: "dummy",
      confirmed: false,
      completenessAudit: completeHandoffAudit(),
    });
    const text = toolText(res);
    // The proposal must contain the exact composite ref that the agent should present to the user.
    assert.match(text, /I would refresh this handoff on P001\(F001\)\./);
    // The rest of the sentence tells the user what to do.
    assert.match(text, /Ask the user to confirm/);
    // Ensure the proposal does NOT contain a raw UUID (should use composite ref).
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assert.ok(!uuidRegex.test(text), "proposal must not leak raw UUID");
  } finally {
    await closeMcpFixture(session);
  }
});

test("refresh reconciles one active handoff without creating a superseded archive", async () => {
  const session = await startMcpFixture({ name: "t238-replacement-archive" });
  try {
    // H1 confirmed via MCP
    await writePreparedHandoff(session, {
      phaseRef: "P001",
      title: "H1 — first version",
      content: "First handoff content for the replacement test.",
    });
    // H2 reconciles still-relevant H1 content into the same active handoff.
    await writePreparedHandoff(session, {
      phaseRef: "P001",
      title: "H2 — second version",
      content: "First handoff content remains relevant. Second handoff content adds the latest state.",
    });

    // Active list contains ONLY H2
    const listRes = await callTool(session, "planner-handoff-list", {});
    const listText = toolText(listRes);
    assert.match(listText, /Phase handoffs — page 1\/1 \(1 total\):/);
    assert.match(listText, /P001\(F001\)/);
    assert.match(listText, /H2 — second version/);
    assert.doesNotMatch(listText, /H1 — first version/);

    // Refresh keeps a single active body and does not create superseded history.
    const archived = await session.store.listArchivedHandoffs();
    const mine = archived.filter((entry) => entry.compositeRef === "P001(F001)");
    assert.equal(mine.length, 0);
    const shown = toolText(await callTool(session, "planner-handoff-show", { phaseRef: "P001" }));
    assert.match(shown, /First handoff content remains relevant/);
    assert.match(shown, /Second handoff content adds the latest state/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("clear archives the handoff with reason manual and empties the active list", async () => {
  const session = await startMcpFixture({ name: "t238-clear-archive" });
  try {
    // H1 confirmed via MCP
    await writePreparedHandoff(session, {
      phaseRef: "P001",
      title: "H1 — clear archive",
      content: "Content archived by a manual clear.",
    });

    const clearRes = await callTool(session, "planner-handoff-clear", { phaseRef: "P001" });
    assert.match(toolText(clearRes), /Cleared handoff on P001\(F001\)/);

    // Active list empty after clear
    const listRes = await callTool(session, "planner-handoff-list", {});
    assert.match(toolText(listRes), /^No phase handoffs set\./);

    // Archive (store-only surface): reason `manual` + recoverable content
    const archived = await session.store.listArchivedHandoffs();
    const mine = archived.filter((e) => e.compositeRef === "P001(F001)");
    assert.equal(mine.length, 1, "expected exactly one archived entry for P001(F001)");
    assert.equal(mine[0].reason, "manual");
    assert.equal(mine[0].firstLine, "H1 — clear archive");
    assert.match(mine[0].content, /Content archived by a manual clear\./);
  } finally {
    await closeMcpFixture(session);
  }
});
