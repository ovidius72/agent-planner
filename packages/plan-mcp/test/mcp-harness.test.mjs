/**
 * T236 (P055/F015) — MCP integration harness: published schema surface.
 *
 * Exercises the T236 harness (test/helpers/mcp-fixture.mjs) end to end:
 *  - tool discovery validates the PUBLISHED MCP schema surface — the exact
 *    tool set + input schemas a host (Claude Code / Codex / Pi) sees via
 *    listTools() — never private handler imports
 *  - invocation helpers drive a full CRUD round trip through the real
 *    subprocess server against a real seeded planner, asserting persisted
 *    state via a real PlanStore
 *  - structured-content extraction (handoff write/recommend)
 *  - error assertions: schema-level (isError) and semantic text errors with
 *    no state mutation
 *  - planner-init on an empty root (server bootstraps a fresh .planner)
 *  - cleanup: per-session close + global drain are idempotent and tear down
 *    the subprocess transport
 *
 * No mocks: real server binary, real stdio transport, real PlanStore.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  startMcpFixture,
  startMcpClient,
  closeMcpFixture,
  cleanupMcpFixtures,
  callTool,
  expectToolError,
  toolText,
  toolStructured,
  discoverTools,
} from "../../../test/helpers/mcp-fixture.mjs";
import { createTempRoot, cleanupFixtures } from "../../../test/helpers/fixtures.mjs";

after(async () => {
  await cleanupMcpFixtures();
  await cleanupFixtures();
});

const LONG_DESCRIPTION = "src/harness.ts:10 existing state and the concrete goal for this harness validation entity; include file refs and behaviors to preserve so the description clears the 50-char minimum.";
const MCP_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;
const CORE_VERSION = JSON.parse(readFileSync(new URL("../../plan-core/package.json", import.meta.url), "utf-8")).version;

// ── Tool discovery: published schema surface ───────────────────────────────

test("listTools exposes the full published tool set with actionable input schemas", async () => {
  const session = await startMcpFixture({ name: "t236-discovery" });
  try {
    const tools = await discoverTools(session);
    const names = tools.map((tool) => tool.name);

    const expected = [
      "planner-version", "planner-export", "planner-authorize-bypass", "planner-clear-bypass", "planner-init",
      "planner-show", "planner-repair", "planner-cleanup-orphan-phases",
      "planner-project-language", "planner-project-discuss",
      "planner-feature-list", "planner-phase-list", "planner-task-list",
      "planner-feature-add", "planner-feature-show", "planner-feature-discuss",
      "planner-feature-update", "planner-feature-delete",
      "planner-phase-add", "planner-phase-show", "planner-phase-discuss",
      "planner-phase-update", "planner-phase-delete",
      "planner-task-add", "planner-task-show", "planner-task-discuss",
      "planner-task-update", "planner-task-checklist-toggle",
      "planner-task-checklist-add", "planner-task-checklist-remove",
      "planner-task-delete", "planner-task-recommend", "planner-task-deviation",
      "planner-task-pause", "planner-task-switch", "planner-task-start", "planner-task-complete",
      "planner-handoff-list", "planner-handoff-show", "planner-handoff-write",
      "planner-handoff-prepare", "planner-handoff-clear",
      "planner-web", "planner-load", "planner-disable",
    ];
    for (const toolName of expected) {
      assert.ok(names.includes(toolName), `published tool set must include ${toolName}`);
    }
    // no drift: every discovered tool is a known one
    for (const toolName of names) {
      assert.ok(expected.includes(toolName), `unexpected published tool: ${toolName}`);
    }

    const byName = (toolName) => tools.find((tool) => tool.name === toolName);
    const schema = (toolName) => byName(toolName).inputSchema;

    // feature-add: name + description required, description ≥ 50, status enum
    const featureAdd = schema("planner-feature-add");
    assert.ok(featureAdd.required.includes("name"), "feature-add requires name");
    assert.ok(featureAdd.required.includes("description"), "feature-add requires description");
    assert.equal(featureAdd.properties.description.minLength, 50, "feature-add description enforces 50-char minimum");
    const statusEnum = featureAdd.properties.status.enum;
    assert.ok(statusEnum.includes("in-progress") && statusEnum.includes("blocked"), "feature-add status enum covers lifecycle values");

    // phase-add: title + description required; feature optional but documented
    const phaseAdd = schema("planner-phase-add");
    assert.ok(phaseAdd.required.includes("title"), "phase-add requires title");
    assert.ok(phaseAdd.required.includes("description"), "phase-add requires description");
    assert.equal(phaseAdd.properties.description.minLength, 50, "phase-add description enforces 50-char minimum");

    // task-update exposes motivation for restricted transitions
    const taskUpdate = schema("planner-task-update");
    assert.equal(taskUpdate.properties.motivation.type, "string", "task-update exposes motivation");

    // handoff-write requires confirmed + phaseRef + content
    const handoffWrite = schema("planner-handoff-write");
    assert.ok(handoffWrite.required.includes("confirmed"), "handoff-write requires confirmed");
    assert.ok(handoffWrite.required.includes("phaseRef"), "handoff-write requires phaseRef");
    assert.ok(handoffWrite.required.includes("content"), "handoff-write requires content");
    assert.equal(handoffWrite.properties.confirmed.type, "boolean", "confirmed is a boolean");

    // task-checklist-toggle requires task + item
    const toggle = schema("planner-task-checklist-toggle");
    assert.ok(toggle.required.includes("task") && toggle.required.includes("item"), "checklist-toggle requires task and item");

    // planner-web action enum with status default
    const web = schema("planner-web");
    assert.deepEqual(web.properties.action.enum, ["start", "stop", "status"]);
    assert.equal(web.properties.action.default, "status");
    assert.equal(session.client.getServerVersion()?.version, MCP_VERSION, "MCP handshake advertises the installed package version");
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-version works without a planner workspace and reports loaded package manifests", async () => {
  const root = await createTempRoot("agent-plan-mcp-version-");
  const session = await startMcpClient({ planRoot: join(root, ".planner"), name: "t293-version" });
  try {
    const result = await callTool(session, "planner-version", {});
    assert.match(toolText(result), new RegExp(`@agent-plan/mcp: ${MCP_VERSION.replaceAll(".", "\\.")}`));
    assert.match(toolText(result), new RegExp(`@agent-plan/core: ${CORE_VERSION.replaceAll(".", "\\.")}`));
    assert.deepEqual(toolStructured(result)?.versions, {
      "@agent-plan/mcp": MCP_VERSION,
      "@agent-plan/core": CORE_VERSION,
    });
  } finally {
    await closeMcpFixture(session);
  }
});

// ── Invocation + persisted state (CRUD round trip through the harness) ─────

test("harness drives a CRUD round trip; composite refs in output, state persisted", async () => {
  const session = await startMcpFixture({ name: "t236-crud" });
  try {
    // feature create → composite F002 (seed already has F001), no raw UUID leak
    const featureAdd = await callTool(session, "planner-feature-add", {
      name: "Harness feature",
      description: LONG_DESCRIPTION,
    });
    const featureText = toolText(featureAdd);
    assert.match(featureText, /✅ Feature created: F002/);
    const feature = (await session.store.loadFeatures()).features.find((entry) => entry.name === "Harness feature");
    assert.ok(feature, "feature persisted on real filesystem");

    // phase create linked by composite ref
    const phaseAdd = await callTool(session, "planner-phase-add", {
      title: "Harness phase",
      feature: "F002",
      description: LONG_DESCRIPTION,
    });
    assert.match(toolText(phaseAdd), /✅ Phase created: P\d+\(F002\)/);
    const phase = (await session.store.loadAllPhases()).find((entry) => entry.title === "Harness phase");
    assert.ok(phase, "phase persisted");
    assert.equal(phase.featureId, feature.id, "phase linked to the resolved feature id");

    // task create with a checklist; composite ref in output, no raw UUID
    const taskAdd = await callTool(session, "planner-task-add", {
      feature: "F002",
      phase: "P002",
      title: "Harness task",
      description: LONG_DESCRIPTION,
      checklist: ["Step one", "Step two"],
    });
    const taskText = toolText(taskAdd);
    assert.match(taskText, /✅ Task created: P\d+\(F002\)\/T\d+/);
    const task = (await session.store.loadPhase(phase.id)).tasks.find((entry) => entry.title === "Harness task");
    assert.ok(task, "task persisted");
    assert.ok(!taskText.includes(task.id), "task output uses the composite ref, never the raw UUID");
    assert.equal(task.checklist.length, 2, "checklist seeded via task-add");

    // lifecycle: start → complete guarded by checklist → toggle → complete
    // (seed T001 is the default ready candidate; make F002/T002 the
    // highest-priority ready work so the recommended task matches)
    await callTool(session, "planner-feature-update", { feature: "F002", priority: 5 });
    await callTool(session, "planner-task-update", { task: "T002", priority: 5 });
    const started = await callTool(session, "planner-task-start", { task: "T002" });
    assert.match(toolText(started), /Task started: P\d+\(F002\)\/T002/);

    const blocked = await callTool(session, "planner-task-complete", { task: "T002" });
    assert.match(toolText(blocked), /checklist item\(s\) not done/, "complete is guarded by unchecked checklist");

    await callTool(session, "planner-task-checklist-toggle", { task: "T002", item: "C1" });
    await callTool(session, "planner-task-checklist-toggle", { task: "T002", item: "C2" });
    const done = await callTool(session, "planner-task-complete", { task: "T002" });
    assert.match(toolText(done), /Task completed: P\d+\(F002\)\/T002.*\(done\)/);
    const completed = (await session.store.loadPhase(phase.id)).tasks.find((entry) => entry.id === task.id);
    assert.equal(completed.status, "done");
    assert.ok(completed.completedAt, "completedAt stamped");

    // structured-content extraction (T002 done → T001 is now the ready pick)
    const recommend = await callTool(session, "planner-task-recommend", {});
    const structured = toolStructured(recommend);
    assert.ok(structured, "task-recommend returns structuredContent");
    assert.equal(structured.kind, "priority", "structured content carries the selection kind");
    assert.ok(typeof structured.taskId === "string" && structured.taskId.length > 0, "structured content carries a resolved task id");
  } finally {
    await closeMcpFixture(session);
  }
});

// ── Error assertions ───────────────────────────────────────────────────────

test("error helpers catch schema-level and semantic errors without mutating state", async () => {
  const session = await startMcpFixture({ name: "t236-errors" });
  try {
    // schema-level: description below the 50-char minimum → isError result
    const shortDesc = await callTool(session, "planner-feature-add", {
      name: "Too short",
      description: "too short",
    });
    assert.equal(shortDesc.isError, true, "zod validation failure surfaces as isError");
    expectToolError(shortDesc, /50|at least/i);
    const features = (await session.store.loadFeatures()).features;
    assert.equal(features.some((entry) => entry.name === "Too short"), false, "schema failure does not persist");

    // semantic: unknown ref → plain-text error, no state change
    const before = (await session.store.loadFeatures()).features.map((entry) => entry.name);
    const missing = await callTool(session, "planner-feature-update", {
      feature: "F999",
      name: "Ghost",
    });
    assert.equal(missing.isError, undefined, "semantic errors are plain text results, not isError");
    expectToolError(missing, /Feature not found: F999/);
    const after = (await session.store.loadFeatures()).features.map((entry) => entry.name);
    assert.deepEqual(after, before, "semantic failure leaves data unchanged");

    // handoff write without confirmation is proposal-only, never mutates.
    // (confirmed is REQUIRED by the schema, so an explicit false exercises the
    // proposal branch; omitting it is a schema-level -32602 validation error.)
    const proposal = await callTool(session, "planner-handoff-write", {
      phaseRef: "P001",
      title: "T236 — harness proposal",
      content: "proposal body",
      confirmed: false,
    });
    assert.equal(proposal.isError, undefined, "proposal is a plain text result");
    expectToolError(proposal, /Proposal only|confirmationRequired/i);
    const phase = (await session.store.loadAllPhases()).find((entry) => entry.number === 1);
    assert.equal(phase.handoff, "", "proposal-only handoff write does not persist");
  } finally {
    await closeMcpFixture(session);
  }
});

// ── Structured content + handoff lifecycle ─────────────────────────────────

test("handoff write (confirmed) + show return structured phase identifiers", async () => {
  const session = await startMcpFixture({ name: "t236-handoff" });
  try {
    const written = await callTool(session, "planner-handoff-write", {
      phaseRef: "P001(F001)",
      title: "T236 — confirmed handoff",
      content: "Handoff body for the harness.",
      confirmed: true,
    });
    assert.match(toolText(written), /✅ Wrote handoff on P001\(F001\)/);
    const writtenStructured = toolStructured(written);
    assert.equal(writtenStructured.phaseRef, "P001(F001)", "structured phaseRef");
    assert.ok(writtenStructured.phaseId, "structured phaseId present");

    const shown = await callTool(session, "planner-handoff-show", { phaseRef: "P001" });
    assert.match(toolText(shown), /Handoff body for the harness\./);
    const shownStructured = toolStructured(shown);
    assert.equal(shownStructured.phaseId, writtenStructured.phaseId, "show returns the same phaseId");

    const listed = await callTool(session, "planner-handoff-list", {});
    assert.match(toolText(listed), /P001\(F001\) — T236 — confirmed handoff/);
  } finally {
    await closeMcpFixture(session);
  }
});

// ── planner-init on an empty root ──────────────────────────────────────────

test("planner-init bootstraps an empty root through the real server", async () => {
  const root = await createTempRoot("t236-init-");
  const planRoot = join(root, ".planner"); // does not exist yet
  const session = await startMcpClient({ planRoot, name: "t236-init" });
  try {
    const created = await callTool(session, "planner-init", {
      projectName: "Harness init project",
      description: "Initialized by the T236 harness.",
    });
    assert.match(toolText(created), /\.planner\/ initialized/);

    // second init is a no-op
    const again = await callTool(session, "planner-init", { projectName: "Harness init project" });
    assert.match(toolText(again), /already exists/);

    // real persisted project
    const shown = await callTool(session, "planner-show", {});
    assert.match(toolText(shown), /Harness init project/);
    assert.match(toolText(shown), /Features: 0/);
  } finally {
    await closeMcpFixture(session);
  }
});

// ── Cleanup ────────────────────────────────────────────────────────────────

test("close tears down the subprocess; drain is idempotent", async () => {
  const session = await startMcpFixture({ name: "t236-cleanup" });
  const probe = await callTool(session, "planner-show", {});
  assert.ok(toolText(probe).length > 0, "session is live");

  await closeMcpFixture(session);
  // double close is safe
  await session.close();

  // transport is closed: further calls fail rather than hang
  await assert.rejects(
    session.client.callTool({ name: "planner-show", arguments: {} }),
    /not connected|closed|transport/i,
  );
});
