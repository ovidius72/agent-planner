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
import { canonicalAuditedHandoff, completeHandoffAudit, completeHandoffColdStartInventory } from "../../../test/helpers/handoff-audit.mjs";

after(async () => {
  await cleanupMcpFixtures();
  await cleanupFixtures();
});

const LONG_DESCRIPTION = "src/harness.ts:10 existing state and the concrete goal for this harness validation entity; include file refs and behaviors to preserve so the description clears the 50-char minimum.";
const MCP_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;
const CORE_VERSION = JSON.parse(readFileSync(new URL("../../plan-core/package.json", import.meta.url), "utf-8")).version;

async function readTaskContext(session, task, phase, feature) {
  await callTool(session, "planner-task-show", { task, full: true });
  await callTool(session, "planner-phase-show", { phase, full: true });
  await callTool(session, "planner-feature-show", { feature, full: true });
  await callTool(session, "planner-requirement-list", { phaseRef: phase });
}

// ── Tool discovery: published schema surface ───────────────────────────────

test("listTools exposes the full published tool set with actionable input schemas", async () => {
  const session = await startMcpFixture({ name: "t236-discovery" });
  try {
    const tools = await discoverTools(session);
    const names = tools.map((tool) => tool.name);

    const expected = [
      "planner-version", "planner-export", "planner-authorize-bypass", "planner-clear-bypass", "planner-init", "planner-idea-list", "planner-idea-show", "planner-idea-create", "planner-idea-update", "planner-idea-delete", "planner-idea-promotion-begin", "planner-idea-promotion-finalize", "planner-requirement-list", "planner-requirement-create", "planner-requirement-update", "planner-requirement-delete",
      "planner-show", "planner-description-freshness", "planner-repair", "planner-cleanup-orphan-phases",
      "planner-project-language", "planner-project-discuss", "planner-project-guidelines-show", "planner-project-guidelines-update", "planner-project-context-migrate",
      "planner-accepted-decision-create", "planner-accepted-decision-update", "planner-accepted-decision-delete",
      "planner-feature-list", "planner-phase-list", "planner-task-list",
      "planner-feature-add", "planner-feature-show", "planner-feature-discuss",
      "planner-feature-update", "planner-feature-delete",
      "planner-phase-add", "planner-phase-show", "planner-phase-discuss",
      "planner-phase-update", "planner-phase-delete",
      "planner-task-add", "planner-task-show", "planner-task-discuss",
      "planner-task-update", "planner-task-checklist-toggle",
      "planner-task-checklist-add", "planner-task-checklist-remove",
      "planner-task-delete", "planner-task-recommend", "planner-task-deviation",
      "planner-task-pause", "planner-task-switch", "planner-task-start", "planner-task-reopen", "planner-task-dependency-add", "planner-task-dependency-delete", "planner-task-complete",
      "planner-handoff-list", "planner-handoff-show", "planner-handoff-write",
      "planner-handoff-prepare", "planner-handoff-verify", "planner-handoff-clear",
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

    // Ideas are both discoverable and actionable through their published schemas.
    const ideaCreate = schema("planner-idea-create");
    assert.ok(ideaCreate.required.includes("title"), "idea-create requires a title");
    const ideaDelete = schema("planner-idea-delete");
    assert.ok(ideaDelete.required.includes("idea") && ideaDelete.required.includes("confirmed"), "idea-delete requires the target and confirmation");
    const ideaPromotion = schema("planner-idea-promotion-begin");
    assert.deepEqual(ideaPromotion.properties.targetType.enum, ["feature", "phase", "task"], "idea promotion publishes every supported target type");

    const requirementList = schema("planner-requirement-list");
    assert.equal(requirementList.properties.phaseRef.type, "string", "requirement-list exposes optional target-scoped phaseRef delivery");
    assert.ok(!requirementList.required?.includes("phaseRef"), "unscoped requirement inventory remains backward compatible");

    const acceptedDecisionCreate = schema("planner-accepted-decision-create");
    assert.ok(acceptedDecisionCreate.required.includes("targetType"), "accepted-decision-create requires a target type");
    assert.deepEqual(acceptedDecisionCreate.properties.targetType.enum, ["project", "feature", "phase", "task"], "accepted decisions can target every canonical owner");
    const acceptedDecisionDelete = schema("planner-accepted-decision-delete");
    assert.ok(acceptedDecisionDelete.required.includes("decisionId") && acceptedDecisionDelete.required.includes("confirmed"), "accepted-decision-delete requires decision id and confirmation");

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

    const phaseDiscuss = schema("planner-phase-discuss");
    for (const field of ["goals", "nonGoals", "dependencies", "risks", "openQuestions", "completionCriteria"]) {
      assert.equal(phaseDiscuss.properties[field].type, "array", `phase-discuss exposes ${field}`);
    }
    const phaseUpdate = schema("planner-phase-update");
    for (const field of ["featureId", "descriptionRef", "goals", "nonGoals", "dependencies", "risks", "openQuestions", "decisions", "completionCriteria"]) {
      assert.ok(phaseUpdate.properties[field], `phase-update exposes ${field}`);
    }

    // task-update exposes complete context plus motivation for restricted transitions
    const taskUpdate = schema("planner-task-update");
    assert.equal(taskUpdate.properties.motivation.type, "string", "task-update exposes motivation");
    assert.equal(taskUpdate.properties.notes.type, "string", "task-update exposes implementation notes");
    assert.equal(taskUpdate.properties.decisions.type, "array", "task-update exposes decisions");
    assert.equal(taskUpdate.properties.descriptionRef.type, "string", "task-update exposes descriptionRef");

    // handoff-write requires confirmed + phaseRef; content is optional (T409)
    // so a retry after a failed write can omit it and reuse the retained body.
    const handoffWrite = schema("planner-handoff-write");
    assert.ok(handoffWrite.required.includes("confirmed"), "handoff-write requires confirmed");
    assert.ok(handoffWrite.required.includes("phaseRef"), "handoff-write requires phaseRef");
    assert.ok(!handoffWrite.required.includes("content"), "handoff-write content is optional to support retention-backed retries");
    assert.ok(handoffWrite.properties.content, "handoff-write still publishes a content schema");
    assert.ok(handoffWrite.properties.completenessAudit, "handoff-write retains the legacy completeness audit contract");
    assert.ok(handoffWrite.properties.coldStartInventory, "handoff-write retains the legacy cold-start inventory contract");
    assert.ok(handoffWrite.properties.coldStartInventory.properties.sourceReviews, "legacy cold-start inventory retains the source-review contract");
    assert.equal(handoffWrite.properties.confirmed.type, "boolean", "confirmed is a boolean");
    const handoffVerify = schema("planner-handoff-verify");
    assert.ok(handoffVerify.required.includes("expectedContentHash"), "handoff-verify requires the shown persisted content hash");
    assert.equal(handoffVerify.required.includes("sourceReviews"), false, "handoff-verify derives legacy source evidence when omitted");
    assert.equal(handoffVerify.required.includes("omissionsFound"), false, "handoff-verify derives omitted gaps from persisted state");

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

test("planner-show exposes explicit persisted active-task evidence", async () => {
  const session = await startMcpFixture({ name: "t384-active-evidence" });
  try {
    const initial = await callTool(session, "planner-show", {});
    assert.equal(toolStructured(initial)?.overview.activeTaskState, "none");
    assert.deepEqual(toolStructured(initial)?.overview.activeTasks, []);
    assert.match(toolText(initial), /Active tasks: none \(verified from all persisted phase task statuses\)/);

    const phase = (await session.store.loadAllPhases())[0];
    await session.store.updatePhase(phase.id, (current) => ({
      ...current,
      tasks: current.tasks.map((task, index) => index === 0 ? { ...task, status: "in-progress" } : task),
    }));
    const active = await callTool(session, "planner-show", {});
    assert.equal(toolStructured(active)?.overview.activeTaskState, "single");
    assert.equal(toolStructured(active)?.overview.activeTasks[0].ref, "P001(F001)/T001");
    assert.match(toolText(active), /P001\(F001\)\/T001 — Implement login \(in-progress\)/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("accepted decision tools preserve identity and acceptedAt across every owner kind", async () => {
  const session = await startMcpFixture({ name: "t369-accepted-decisions" });
  try {
    const targets = [
      { targetType: "project" },
      { targetType: "feature", targetRef: "F001" },
      { targetType: "phase", targetRef: "P001" },
      { targetType: "task", targetRef: "P001/T001" },
    ];
    for (const target of targets) {
      const created = await callTool(session, "planner-accepted-decision-create", {
        ...target,
        title: `${target.targetType} decision`,
        decision: "Use semantic entry-level mutation.",
        rationale: "Preserve canonical decision identity.",
        implementationNotes: "Never replace the owning array from this workflow.",
      });
      const createdDetails = toolStructured(created);
      assert.equal(createdDetails.created, true);
      const acceptedDecision = createdDetails.acceptedDecision;

      const noFields = await callTool(session, "planner-accepted-decision-update", {
        ...target,
        decisionId: acceptedDecision.id,
      });
      expectToolError(noFields, /no mutable fields/i);
      assert.equal(toolStructured(noFields)?.errorCode, "NO_MUTABLE_FIELDS_RECEIVED");

      const updated = await callTool(session, "planner-accepted-decision-update", {
        ...target,
        decisionId: acceptedDecision.id,
        rationale: `Updated ${target.targetType} rationale.`,
      });
      const updatedDetails = toolStructured(updated);
      assert.equal(updatedDetails.updated, true);
      assert.equal(updatedDetails.acceptedDecision.id, acceptedDecision.id);
      assert.equal(updatedDetails.acceptedDecision.acceptedAt, acceptedDecision.acceptedAt);

      const unconfirmed = await callTool(session, "planner-accepted-decision-delete", {
        ...target,
        decisionId: acceptedDecision.id,
        confirmed: false,
      });
      assert.equal(toolStructured(unconfirmed).confirmRequired, true);
      const deleted = await callTool(session, "planner-accepted-decision-delete", {
        ...target,
        decisionId: acceptedDecision.id,
        confirmed: true,
      });
      assert.equal(toolStructured(deleted).deleted, true);
    }

    assert.equal((await session.store.loadProject()).acceptedDecisions.length, 0);
    assert.equal((await session.store.loadFeatures()).features[0].acceptedDecisions.length, 0);
    const phase = (await session.store.loadAllPhases())[0];
    assert.equal(phase.acceptedDecisions.length, 0);
    assert.equal(phase.tasks[0].acceptedDecisions.length, 0);

    const missingTarget = await callTool(session, "planner-accepted-decision-create", {
      targetType: "feature",
      targetRef: "F999",
      title: "Must not report success",
    });
    assert.equal(missingTarget.isError, true);
    assert.deepEqual(toolStructured(missingTarget), { created: false, errorCode: "ACCEPTED_DECISION_TARGET_NOT_FOUND" });

    const missingDecision = await callTool(session, "planner-accepted-decision-update", {
      targetType: "project",
      decisionId: "missing-decision",
      title: "Must not report success",
    });
    assert.equal(missingDecision.isError, true);
    assert.equal(toolStructured(missingDecision)?.updated, false);
    assert.equal(toolStructured(missingDecision)?.errorCode, "ACCEPTED_DECISION_NOT_FOUND");
  } finally {
    await closeMcpFixture(session);
  }
});

test("full reads, task start, and planner-load agentContext deliver canonical Accepted Decisions", async () => {
  const session = await startMcpFixture({ name: "t368-decision-context" });
  try {
    const targets = [
      { targetType: "project", title: "Project decision" },
      { targetType: "feature", targetRef: "F001", title: "Feature decision" },
      { targetType: "phase", targetRef: "P001", title: "Phase decision" },
      { targetType: "task", targetRef: "T001", title: "Task decision" },
    ];
    await callTool(session, "planner-task-add", {
      feature: "F001",
      phase: "P001",
      title: "Sibling capability owner",
      description: "Own the sibling capability that must remain visible in task-start context so agents do not propose duplicate work.",
    });
    for (const target of targets) {
      const created = await callTool(session, "planner-accepted-decision-create", {
        ...target,
        decision: `Apply ${target.title}.`,
        rationale: `Rationale for ${target.title}.`,
        implementationNotes: `Implementation notes for ${target.title}.`,
      });
      assert.equal(toolStructured(created).created, true);
    }

    const overview = await callTool(session, "planner-show", {});
    assert.match(toolText(overview), /Project decision/);
    assert.equal(toolStructured(overview).overview.project.acceptedDecisions[0].rationale, "Rationale for Project decision.");

    for (const [tool, args, key, title] of [
      ["planner-feature-show", { feature: "F001", full: true }, "feature", "Feature decision"],
      ["planner-phase-show", { phase: "P001", full: true }, "phase", "Phase decision"],
      ["planner-task-show", { task: "T001", full: true }, "task", "Task decision"],
    ]) {
      const result = await callTool(session, tool, args);
      assert.match(toolText(result), new RegExp(title));
      assert.match(toolText(result), new RegExp(`Rationale for ${title}`));
      assert.equal(toolStructured(result)[key].acceptedDecisions[0].implementationNotes, `Implementation notes for ${title}.`);
    }

    await callTool(session, "planner-requirement-list", { phaseRef: "P001" });
    const started = await callTool(session, "planner-task-start", { task: "T001" });
    for (const title of targets.map((target) => target.title)) assert.match(toolText(started), new RegExp(title));
    assert.match(toolText(started), /Phase work map — canonical sibling capability ownership/);
    assert.match(toolText(started), /P001\(F001\)\/T002.*Sibling capability owner/s);
    assert.match(toolText(started), /P001\(F001\)\/T002 owns this remaining capability; do not duplicate it/);

    const loaded = await callTool(session, "planner-load", {});
    const loadedText = toolText(loaded);
    const loadedStructured = toolStructured(loaded);
    assert.doesNotMatch(loadedText, /Project decision/, "Accepted Decision agentContext must not leak into the human recap");
    assert.equal(loadedStructured.recap.text, loadedText, "structured clients receive the consolidated recap instead of only the skill payload");
    assert.equal(loadedStructured.webUi.running, true);
    assert.match(loadedStructured.webUi.address, /^http:\/\//);
    const decisionContext = loadedStructured.agentContext.acceptedDecisions;
    assert.equal(decisionContext.truncated, false);
    for (const title of targets.map((target) => target.title)) assert.match(decisionContext.content, new RegExp(title));
    assert.match(decisionContext.content, /Implementation notes for Task decision/);
  } finally {
    await closeMcpFixture(session);
  }
});

test("description freshness reports exact stale parents and explicit leaf-to-root reconciliation", async () => {
  const session = await startMcpFixture({ name: "t381-description-freshness" });
  try {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const taskUpdate = await callTool(session, "planner-task-update", { task: "T001", description: "Changed task context that invalidates only its owning parents." });
    assert.deepEqual(toolStructured(taskUpdate).staleParentRefs, ["P001(F001)", "F001"]);
    assert.doesNotMatch(toolText(taskUpdate), /Parent description review required/);

    const preview = await callTool(session, "planner-description-freshness", {});
    assert.deepEqual(toolStructured(preview).staleParentRefs, ["P001(F001)", "F001"]);
    assert.deepEqual(toolStructured(preview).reconciliationPreview.map((step) => step.ownerRef), ["P001(F001)", "F001"]);
    assert.match(toolText(preview), /without rewriting|explicitly update/i);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const phaseUpdate = await callTool(session, "planner-phase-update", { phase: "P001", description: "Reconciled phase context." });
    assert.deepEqual(toolStructured(phaseUpdate).staleParentRefs, ["F001"]);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await callTool(session, "planner-feature-update", { feature: "F001", description: "Reconciled feature context." });
    const fresh = await callTool(session, "planner-description-freshness", {});
    assert.equal(toolStructured(fresh).reconciliationRequired, false);
    assert.deepEqual(toolStructured(fresh).staleParentRefs, []);
  } finally {
    await closeMcpFixture(session);
  }
});

test("planner-version works without a planner workspace and reports loaded runtime provenance and compatibility", async () => {
  const root = await createTempRoot("agent-plan-mcp-version-");
  const session = await startMcpClient({ planRoot: join(root, ".planner"), name: "t293-version" });
  try {
    const result = await callTool(session, "planner-version", {});
    assert.match(toolText(result), new RegExp(`@agent-plan/mcp: loaded ${MCP_VERSION.replaceAll(".", "\\.")}`));
    assert.match(toolText(result), new RegExp(`@agent-plan/core: loaded ${CORE_VERSION.replaceAll(".", "\\.")}`));
    assert.match(toolText(result), /Plan schema: manifest schemaVersion 1/);
    assert.match(toolText(result), /Allocation registry: v1; supported kinds: feature, phase, task, idea/);
    const structured = toolStructured(result);
    assert.deepEqual(structured?.versions, {
      "@agent-plan/mcp": MCP_VERSION,
      "@agent-plan/core": CORE_VERSION,
    });
    assert.equal(structured?.packages?.["@agent-plan/mcp"]?.loadedVersion, MCP_VERSION);
    assert.equal(structured?.packages?.["@agent-plan/mcp"]?.installedVersion, MCP_VERSION);
    assert.equal(structured?.packages?.["@agent-plan/mcp"]?.runtimeState, "loaded");
    assert.deepEqual(structured?.capabilities?.allocationRegistry?.supportedKinds, ["feature", "phase", "task", "idea"]);
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
    await readTaskContext(session, "T002", "P002", "F002");
    const started = await callTool(session, "planner-task-start", { task: "T002" });
    assert.match(toolText(started), /Task started: P\d+\(F002\)\/T002/);

    const blocked = await callTool(session, "planner-task-complete", { task: "T002", description_update: "Completion evidence supplied while checklist remains open." });
    assert.match(toolText(blocked), /checklist item\(s\) not done/, "complete is guarded by unchecked checklist");

    await callTool(session, "planner-task-checklist-toggle", { task: "T002", item: "C1" });
    await callTool(session, "planner-task-checklist-toggle", { task: "T002", item: "C2" });
    const done = await callTool(session, "planner-task-complete", { task: "T002", description_update: "Checklist task completed and verified through the MCP harness." });
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
    assert.ok(structured.nextTask, "structured content carries nextTask");
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

    const requirement = (await session.store.loadRequirements()).requirements[0];
    const requirementNoop = await callTool(session, "planner-requirement-update", { requirementId: requirement.id });
    assert.equal(requirementNoop.isError, true, "no-field requirement updates are typed no-op failures");
    assert.equal(toolStructured(requirementNoop)?.errorCode, "NO_MUTABLE_FIELDS_RECEIVED");
    assert.equal((await session.store.loadRequirements()).requirements[0].updatedAt, requirement.updatedAt, "no-field requirement update does not restamp persisted data");

    const ideaCreate = await callTool(session, "planner-idea-create", { title: "No-op candidate" });
    assert.equal(toolStructured(ideaCreate)?.created, true);
    const ideaNoop = await callTool(session, "planner-idea-update", { idea: "I001" });
    assert.equal(ideaNoop.isError, true, "no-field idea updates are typed no-op failures");
    assert.equal(toolStructured(ideaNoop)?.errorCode, "NO_MUTABLE_FIELDS_RECEIVED");

    // handoff write without confirmation is proposal-only, never mutates.
    // (confirmed is REQUIRED by the schema, so an explicit false exercises the
    // proposal branch; omitting it is a schema-level -32602 validation error.)
    const proposal = await callTool(session, "planner-handoff-write", {
      phaseRef: "P001",
      title: "T236 — harness proposal",
      content: "proposal body",
      confirmed: false,
      completenessAudit: completeHandoffAudit(),
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
    const prepared = await callTool(session, "planner-handoff-prepare", { phaseRef: "P001(F001)" });
    const audit = toolStructured(prepared);
    const written = await callTool(session, "planner-handoff-write", {
      phaseRef: "P001(F001)",
      title: "T236 — confirmed handoff",
      reason: "Harness fixture session boundary requires a cold-resume handoff.",
      content: canonicalAuditedHandoff("T236 — confirmed handoff", "Handoff body for the harness.", { file: "mcp-harness.test.mjs", reason: "harness fixture" }),
      confirmed: true,
      completenessAudit: completeHandoffAudit(),
      coldStartInventory: completeHandoffColdStartInventory({ file: "mcp-harness.test.mjs" }),
      expectedHandoffUpdatedAt: audit.handoffUpdatedAt ?? "",
      reconciledExistingHandoff: true,
      taskUpdates: [],
      phaseNoUpdateReason: "Harness does not change durable phase context.",
      featureNoUpdateReason: "Harness does not change durable feature context.",
    });
    assert.match(toolText(written), /candidate persisted on P001\(F001\), but it is NOT resume-ready yet/);
    const writtenStructured = toolStructured(written);
    assert.equal(writtenStructured.resumeReady, false);
    assert.equal(writtenStructured.verificationRequired, true);
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
