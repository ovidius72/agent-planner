/**
 * T240 (P056/F015) — Pi adapter host and registration harness tests.
 *
 * Verifies the fake Pi host (test/helpers/pi-host-fixture.mjs):
 *  - captures the REAL adapter's registrations (command, tools, and hooks)
 *  - supplies a realistic ExtensionContext (ui/sessionManager/cwd)
 *  - keeps adapter-to-core persistence REAL (real PlanStore on temp .planner)
 *  - drives command handlers and tool executes with notifications, prompts,
 *    and message events
 *  - cleans up deterministically (server stopped, temp root removed, state reset)
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PlanStore } from "../../plan-core/dist/index.js";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";

after(async () => {
  await cleanupPiHosts();
});

const LONG_DESCRIPTION = "src/harness.ts:10 existing state and the concrete goal for this host-validation entity; include file refs and behaviors to preserve so the description clears the 50-char minimum.";
const PI_ADAPTER_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;
const CORE_VERSION = JSON.parse(readFileSync(new URL("../../plan-core/package.json", import.meta.url), "utf-8")).version;
const SERVER_VERSION = JSON.parse(readFileSync(new URL("../../plan-server/package.json", import.meta.url), "utf-8")).version;

// The lifecycle events the real adapter subscribes to (packages/pi-adapter/src/index.ts).
const EXPECTED_HOOKS = [
  "before_agent_start",
  "message_end",
  "session_before_compact",
  "session_before_switch",
  "session_shutdown",
  "session_start",
  "tool_call",
  "tool_result",
  "turn_start",
];

describe("pi-adapter host harness", () => {
  test("registration surface: command, tools, and lifecycle hooks are captured", async () => {
    const host = await createPiHost({ name: "t240-registration", seed: "minimal" });
    try {
      // The grouped /planner command.
      assert.equal(host.commands.size, 1);
      const planner = host.commands.get("planner");
      assert.ok(planner, "planner command registered");
      assert.equal(typeof planner.handler, "function");
      assert.equal(typeof planner.getArgumentCompletions, "function");
      const completions = planner.getArgumentCompletions("task");
      assert.ok(Array.isArray(completions) && completions.length > 0);
      assert.ok(completions.some((c) => c.value === "task start"), "task subcommand completion");
      assert.ok(planner.getArgumentCompletions("ver").some((c) => c.value === "version"), "version subcommand completion");
      const ideaCompletions = planner.getArgumentCompletions("idea").map((completion) => completion.value);
      assert.deepEqual(ideaCompletions, [
        "idea list",
        "idea add",
        "idea show",
        "idea update",
        "idea delete",
        "idea promote",
      ], "every interactive Ideas action must be discoverable from /planner completion");

      // All 69 tools with the required definition fields.
      assert.equal(host.tools.size, 69);
      for (const name of ["plan_init", "description_freshness", "feature_create", "phase_discuss", "task_pause", "task_switch", "task_start", "task_reopen", "task_dependency_add", "task_dependency_delete", "decision_record", "accepted_decision_create", "accepted_decision_update", "accepted_decision_delete", "handoff_prepare", "handoff_write", "handoff_verify", "planner-web", "planner-load", "planner-stop", "project_guidelines_show", "project_guidelines_update", "project_context_migrate", "idea_list", "idea_show", "idea_create", "idea_update", "idea_delete", "idea_promotion_begin", "idea_promotion_finalize"]) {
        const tool = host.tools.get(name);
        assert.ok(tool, `tool ${name} registered`);
        assert.ok(tool.label && tool.description, `tool ${name} has label/description`);
        assert.ok(tool.parameters, `tool ${name} has a parameter schema`);
        assert.equal(typeof tool.execute, "function", `tool ${name} has execute`);
      }

      const requirementList = host.tools.get("requirement_list");
      assert.ok(requirementList.parameters.properties.phaseRef, "requirement_list exposes optional target-scoped phaseRef delivery");
      assert.ok(!requirementList.parameters.required?.includes("phaseRef"), "unscoped requirement inventory remains backward compatible");

      // Every lifecycle hook the adapter subscribes to.
      for (const event of EXPECTED_HOOKS) {
        assert.equal(typeof host.handlers.get(event), "function", `hook ${event} registered`);
      }

      // The fake host surface stays limited: no stray registrations.
      assert.equal(host.sentMessages.length, 0);
    } finally {
      await closePiHost(host);
    }
  });

  test("/planner idea add is reachable through the interactive command dispatcher", async () => {
    const host = await createPiHost({ name: "t378-idea-command", seed: "minimal" });
    try {
      host.ui.editorAnswer = "Captured from the interactive Pi command.";
      await host.runCommand("idea add Discoverable idea");
      const ideas = (await host.store.loadIdeas()).ideas;
      assert.equal(ideas.length, 1);
      assert.equal(ideas[0].title, "Discoverable idea");
      assert.equal(ideas[0].description, "Captured from the interactive Pi command.");
      assert.match(host.ui.notifyCalls.at(-1)?.message ?? "", /Idea created: I001/);
    } finally {
      await closePiHost(host);
    }
  });

  test("/planner version reports loaded runtime provenance and compatibility without requiring a planner", async () => {
    const host = await createPiHost({ name: "t293-version", seed: null });
    try {
      await host.runCommand("version");
      const message = host.ui.notifyCalls.at(-1)?.message ?? "";
      assert.match(message, new RegExp(`@agent-plan/pi-adapter: loaded ${PI_ADAPTER_VERSION.replaceAll(".", "\\.")}`));
      assert.match(message, new RegExp(`@agent-plan/core: loaded ${CORE_VERSION.replaceAll(".", "\\.")}`));
      assert.match(message, new RegExp(`@agent-plan/server: loaded ${SERVER_VERSION.replaceAll(".", "\\.")}`));
      assert.match(message, /Plan schema: manifest schemaVersion 1/);
      assert.match(message, /Allocation registry: v1; supported kinds: feature, phase, task, idea/);
      assert.equal(existsSync(host.planRoot), false, "version lookup must not initialize planner state");
    } finally {
      await closePiHost(host);
    }
  });

  test("planner overviews provide authoritative active-task evidence", async () => {
    const host = await createPiHost({ name: "t384-active-evidence", seed: "minimal" });
    try {
      const initial = await host.runTool("plan_get", {});
      assert.equal(toolDetails(initial).activeTaskState, "none");
      assert.deepEqual(toolDetails(initial).activeTasks, []);
      assert.match(toolText(initial), /Active tasks: none \(verified from all persisted phase task statuses\)/);

      const phase = (await host.store.loadAllPhases())[0];
      await host.store.updatePhase(phase.id, (current) => ({
        ...current,
        tasks: current.tasks.map((task, index) => index === 0 ? { ...task, status: "in-progress" } : task),
      }));
      await host.runCommand("show");
      const message = host.ui.notifyCalls.at(-1)?.message ?? "";
      assert.match(message, /Active tasks \(1\):/);
      assert.match(message, /P001\(F001\)\/T001 — Implement login \(in-progress\)/);
    } finally {
      await closePiHost(host);
    }
  });

  test("session_start keeps the planner disabled by default and notifies", async () => {
    const host = await createPiHost({ name: "t240-startup", seed: "minimal" });
    try {
      await host.emit("session_start", { type: "session_start", reason: "startup" });

      // The adapter detected the existing .planner and told the user how to enable.
      const notifyText = host.ui.notifyCalls.map((n) => n.message).join("\n");
      assert.match(notifyText, /Planner detected in this project/);
      assert.match(notifyText, /\/planner load/);

      // Disabled by default: before_agent_start must NOT inject any context
      // block, and message_end must NOT append a Web UI address.
      const before = await host.emit("before_agent_start", {
        type: "before_agent_start",
        prompt: "hello",
        systemPrompt: "base-system-prompt",
        systemPromptOptions: {},
      });
      assert.equal(before, undefined);

      const end = await host.emit("message_end", {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      });
      assert.equal(end, undefined);
    } finally {
      await closePiHost(host);
    }
  });

  test("tool invocation round-trip persists to a real PlanStore", async () => {
    const host = await createPiHost({ name: "t240-tool-invoke", seed: null });
    try {
      // plan_init against a bare temp root creates a REAL .planner via ctx.cwd.
      const init = await host.runTool("plan_init", {
        projectName: "Host Test Project",
        description: "Short description for the host test.",
        goal: "Prove tool invocation reaches a real store.",
      });
      assert.match(toolText(init), /\.planner\/ initialized for "Host Test Project"/);

      const st = new PlanStore(host.planRoot);
      assert.equal(await st.exists(), true);
      const project = await st.loadProject();
      assert.equal(project.name, "Host Test Project");
      assert.equal(project.goal, "Prove tool invocation reaches a real store.");

      // A follow-up mutation via the adapter reads/writes the same real store.
      const created = await host.runTool("feature_create", {
        name: "Feature One",
        description: LONG_DESCRIPTION,
      });
      assert.match(toolText(created), /✅ Feature created:/);
      const list = await host.runTool("feature_list", {});
      assert.match(toolText(list), /F001 · /);
      const features = await st.loadFeatures();
      assert.equal(features.features.length, 1);
      assert.equal(features.features[0].name, "Feature One");
    } finally {
      await closePiHost(host);
    }
  });

  test("mutation tools return typed no-op and persisted outcome details", async () => {
    const host = await createPiHost({ name: "t367-mutation-outcomes", seed: "minimal" });
    try {
      const requirement = (await host.store.loadRequirements()).requirements[0];
      const requirementNoop = await host.runTool("requirement_update", { requirementId: requirement.id });
      assert.equal(requirementNoop.isError, true);
      assert.equal(toolDetails(requirementNoop).errorCode, "NO_MUTABLE_FIELDS_RECEIVED");
      assert.equal((await host.store.loadRequirements()).requirements[0].updatedAt, requirement.updatedAt, "no-field requirement update must not restamp persisted data");

      const requirementUpdate = await host.runTool("requirement_update", { requirementId: requirement.id, title: "Updated requirement" });
      assert.equal(toolDetails(requirementUpdate).updated, true);
      // T417: the reply echoes changed fields, not the whole entity.
      assert.deepEqual(toolDetails(requirementUpdate).updatedFields, ["title"]);
      assert.equal(toolDetails(requirementUpdate).changed.title, "Updated requirement");

      const ideaCreate = await host.runTool("idea_create", { title: "Outcome idea" });
      assert.equal(toolDetails(ideaCreate).created, true);
      const ideaNoop = await host.runTool("idea_update", { idea: "I001" });
      assert.equal(ideaNoop.isError, true);
      assert.equal(toolDetails(ideaNoop).errorCode, "NO_MUTABLE_FIELDS_RECEIVED");
    } finally {
      await closePiHost(host);
    }
  });

  test("accepted decision tools create, update, and delete semantic owner entries", async () => {
    const host = await createPiHost({ name: "t369-accepted-decisions", seed: "minimal" });
    try {
      const created = await host.runTool("accepted_decision_create", {
        targetType: "task",
        targetRef: "P001/T001",
        title: "Preserve task decisions",
        decision: "Keep task decisions local to the task.",
      });
      assert.equal(toolDetails(created).created, true);
      const decisionId = toolDetails(created).acceptedDecision.id;
      const taskBefore = (await host.store.loadAllPhases())[0].tasks[0];
      assert.equal(taskBefore.acceptedDecisions[0].id, decisionId);

      const updated = await host.runTool("accepted_decision_update", {
        targetType: "task",
        targetRef: "P001/T001",
        decisionId,
        rationale: "Mutation parity needs entry-level updates.",
      });
      assert.equal(toolDetails(updated).updated, true);
      assert.equal(toolDetails(updated).acceptedDecision.acceptedAt, toolDetails(created).acceptedDecision.acceptedAt);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].acceptedDecisions[0].rationale, "Mutation parity needs entry-level updates.");

      const noFields = await host.runTool("accepted_decision_update", { targetType: "task", targetRef: "P001/T001", decisionId });
      assert.equal(noFields.isError, true);
      assert.equal(toolDetails(noFields).errorCode, "NO_MUTABLE_FIELDS_RECEIVED");

      const unconfirmed = await host.runTool("accepted_decision_delete", { targetType: "task", targetRef: "P001/T001", decisionId, confirmed: false });
      assert.equal(toolDetails(unconfirmed).confirmRequired, true);
      const deleted = await host.runTool("accepted_decision_delete", { targetType: "task", targetRef: "P001/T001", decisionId, confirmed: true });
      assert.equal(toolDetails(deleted).deleted, true);
      assert.equal((await host.store.loadAllPhases())[0].tasks[0].acceptedDecisions.length, 0);

      const missingTarget = await host.runTool("accepted_decision_create", {
        targetType: "feature",
        targetRef: "F999",
        title: "Must not report success",
      });
      assert.equal(missingTarget.isError, true);
      assert.deepEqual(toolDetails(missingTarget), { created: false, errorCode: "ACCEPTED_DECISION_TARGET_NOT_FOUND" });

      const missingDecision = await host.runTool("accepted_decision_update", {
        targetType: "project",
        decisionId: "missing-decision",
        title: "Must not report success",
      });
      assert.equal(missingDecision.isError, true);
      assert.equal(toolDetails(missingDecision).updated, false);
      assert.equal(toolDetails(missingDecision).errorCode, "ACCEPTED_DECISION_NOT_FOUND");
    } finally {
      await closePiHost(host);
    }
  });

  test("full reads, task start, and agent context deliver canonical Accepted Decisions", async () => {
    const host = await createPiHost({ name: "t368-decision-context", seed: "minimal" });
    try {
      const targets = [
        { targetType: "project", title: "Project decision" },
        { targetType: "feature", targetRef: "F001", title: "Feature decision" },
        { targetType: "phase", targetRef: "P001", title: "Phase decision" },
        { targetType: "task", targetRef: "T001", title: "Task decision" },
      ];
      for (const target of targets) {
        const created = await host.runTool("accepted_decision_create", {
          ...target,
          decision: `Apply ${target.title}.`,
          rationale: `Rationale for ${target.title}.`,
          implementationNotes: `Implementation notes for ${target.title}.`,
        });
        assert.equal(toolDetails(created).created, true);
      }

      const plan = await host.runTool("plan_get", {});
      assert.match(toolText(plan), /Project decision/);
      assert.equal(toolDetails(plan).project.acceptedDecisions[0].rationale, "Rationale for Project decision.");

      for (const [tool, params, title] of [
        ["feature_get", { featureId: "F001", full: true }, "Feature decision"],
        ["phase_get", { phaseId: "P001", full: true }, "Phase decision"],
        ["task_get", { taskId: "T001", full: true }, "Task decision"],
      ]) {
        const result = await host.runTool(tool, params);
        assert.match(toolText(result), new RegExp(title));
        assert.match(toolText(result), new RegExp(`Rationale for ${title}`));
        assert.equal(toolDetails(result)[tool.split("_")[0]].acceptedDecisions[0].implementationNotes, `Implementation notes for ${title}.`);
      }

      await host.runTool("requirement_list", { phaseRef: "P001" });
      const started = await host.runTool("task_start", { taskId: "T001" });
      for (const title of targets.map((target) => target.title)) assert.match(toolText(started), new RegExp(title));

      const loaded = await host.runTool("planner-load", {});
      assert.doesNotMatch(toolText(loaded), /Project decision/, "Accepted Decision agent context must not leak into the human recap");
      const before = await host.emit("before_agent_start", {
        type: "before_agent_start",
        prompt: "continue",
        systemPrompt: "base-system-prompt",
        systemPromptOptions: {},
      });
      for (const title of targets.map((target) => target.title)) assert.match(before.systemPrompt, new RegExp(title));
      assert.match(before.systemPrompt, /Implementation notes for Task decision/);
    } finally {
      await closePiHost(host);
    }
  });

  test("accepted decisions on a task remain visible after that task and its phase complete", async () => {
    const host = await createPiHost({ name: "t405-post-completion-visibility", seed: "minimal" });
    try {
      const created = await host.runTool("accepted_decision_create", {
        targetType: "task", targetRef: "T001",
        title: "Task decision surviving completion",
        decision: "Keep this visible after completion.",
        rationale: "Completion must not hide durable decisions.",
        implementationNotes: "None required.",
      });
      const acceptedDecisionId = toolDetails(created).acceptedDecision.id;

      await host.runTool("task_get", { taskId: "T001", full: true });
      await host.runTool("phase_get", { phaseId: "P001", full: true });
      await host.runTool("feature_get", { featureId: "F001", full: true });
      await host.runTool("requirement_list", { phaseRef: "P001" });
      assert.match(toolText(await host.runTool("task_start", { taskId: "T001" })), /Task started/);
      const completed = await host.runTool("task_complete", { taskId: "T001", force: true, description_update: "Completed to verify accepted decisions remain visible after completion." });
      assert.match(toolText(completed), /Task completed/);

      const persistedTask = (await host.store.loadAllPhases())[0].tasks[0];
      assert.equal(persistedTask.status, "done");
      assert.equal(persistedTask.acceptedDecisions.some((entry) => entry.id === acceptedDecisionId), true, "accepted decision remains visible after task completion");

      const shown = await host.runTool("task_get", { taskId: "T001", full: true });
      assert.match(toolText(shown), /Task decision surviving completion/, "task_get still surfaces the decision after the task is done");
    } finally {
      await closePiHost(host);
    }
  });

  test("planner-load delivers the complete attested project-level context; task_start advises after it goes stale", async () => {
    const host = await createPiHost({ name: "t404-project-context", seed: "minimal" });
    try {
      await host.emit("session_start", { type: "session_start", reason: "startup" });
      await host.store.updateProject((project) => ({
        ...project,
        description: "Fixture project description",
        goal: "Ship the fixture feature",
        scope: ["In-scope area"],
        outOfScope: ["Out-of-scope area"],
        technologies: ["TypeScript"],
        tools: ["pnpm"],
      }));

      const loaded = await host.runTool("planner-load", {});
      const details = toolDetails(loaded);
      assert.equal(details.projectContext.loaded, true);
      assert.equal(details.projectContext.contextComplete, true);
      assert.equal(details.projectContext.project.description, "Fixture project description");
      assert.equal(details.projectContext.project.goal, "Ship the fixture feature");
      assert.deepEqual(details.projectContext.project.scope, ["In-scope area"]);
      assert.deepEqual(details.projectContext.project.outOfScope, ["Out-of-scope area"]);
      assert.deepEqual(details.projectContext.project.technologies, ["TypeScript"]);
      assert.deepEqual(details.projectContext.project.tools, ["pnpm"]);
      assert.equal(details.projectContext.requirements.length, 1);
      assert.equal(details.projectContext.requirements[0].title, "Users can authenticate");
      // The agent-only details channel carries the same content, but it must
      // never appear in the human-facing recap text (parity with MCP's
      // planner-load, and the same "must not leak" invariant as Accepted
      // Decision agent context above).
      assert.match(details.projectContext.text, /Fixture project description/);
      assert.doesNotMatch(toolText(loaded), /Fixture project description/, "project context must not leak into the human recap");

      // A full, genuinely complete project-context read satisfies
      // REQUIREMENTS_READ_REQUIRED task-wide (P102(F005) accepted decision):
      // no further per-task requirement read is needed for T001.
      await host.runTool("task_get", { taskId: "T001", full: true });
      await host.runTool("phase_get", { phaseId: "P001", full: true });
      await host.runTool("feature_get", { featureId: "F001", full: true });
      const started = await host.runTool("task_start", { taskId: "T001" });
      assert.equal(toolDetails(started).started, true);
      assert.equal(toolDetails(started).projectContextStale, false);

      // Project content changes after the attested load. task_start stays
      // scoped to feature/phase/task context (no hard block), but surfaces a
      // targeted, non-blocking refresh advisory instead of silently working
      // from stale project-level context.
      await host.store.updateProject((project) => ({ ...project, goal: "Changed after load" }));
      const alreadyStarted = await host.runTool("task_start", { taskId: "T001" });
      assert.equal(toolDetails(alreadyStarted).started, true);
      assert.equal(toolDetails(alreadyStarted).projectContextStale, true);
      assert.match(toolText(alreadyStarted), /Project-context advisory/);
    } finally {
      await closePiHost(host);
    }
  });

  test("planner-load reports contextComplete:false and does not attest the read when project context exceeds maxChars", async () => {
    const host = await createPiHost({ name: "t404-project-context-oversized", seed: "minimal" });
    try {
      await host.store.updateProject((project) => ({ ...project, description: "x".repeat(2_000) }));
      const loaded = await host.runTool("planner-load", { maxChars: 100 });
      const details = toolDetails(loaded);
      assert.equal(details.projectContext.loaded, false);
      assert.equal(details.projectContext.contextComplete, false);
      assert.ok(Array.isArray(details.projectContext.nextActions) && details.projectContext.nextActions.length > 0);
      assert.ok(details.projectContext.serializedChars > 100);
    } finally {
      await closePiHost(host);
    }
  });

  test("decision_record no longer dual-writes; it redirects to accepted_decision_create", async () => {
    const host = await createPiHost({ name: "t405-decision-record-redirect", seed: "minimal" });
    try {
      const result = await host.runTool("decision_record", {
        featureId: "F001",
        phaseId: "P001",
        title: "Keep paired decision history",
        decision: "Persist the decision on both parents.",
        rationale: "Agents need context at feature and phase scope.",
        implementationNotes: "Append; never replace prior decisions.",
      });
      const details = toolDetails(result);
      assert.equal(details.deprecated, true);
      assert.equal(details.written, false);
      assert.equal(details.redirected, true);
      assert.equal(details.redirectTool, "accepted_decision_create");
      assert.match(toolText(result), /decision_record is deprecated and write-disabled/);
      assert.match(toolText(result), /exactly one owner/);
      assert.match(toolText(result), /accepted_decision_create/);
      const feature = (await host.store.loadFeatures()).features.find((entry) => entry.number === 1);
      const phase = (await host.store.loadAllPhases()).find((entry) => entry.number === 1);
      assert.equal(feature?.acceptedDecisions.some((entry) => entry.title === "Keep paired decision history"), false, "decision_record must not write to the feature");
      assert.equal(phase?.acceptedDecisions.some((entry) => entry.title === "Keep paired decision history"), false, "decision_record must not write to the phase");
    } finally {
      await closePiHost(host);
    }
  });

  test("decision_record performs no write at all, even when the phase store is unwritable", async () => {
    const host = await createPiHost({ name: "t405-decision-record-no-write", seed: "minimal" });
    try {
      const originalUpdatePhase = PlanStore.prototype.updatePhase;
      PlanStore.prototype.updatePhase = async () => { throw new Error("updatePhase must not be called by decision_record"); };
      const originalUpdateFeatures = PlanStore.prototype.updateFeatures;
      PlanStore.prototype.updateFeatures = async () => { throw new Error("updateFeatures must not be called by decision_record"); };
      try {
        const result = await host.runTool("decision_record", {
          featureId: "F001", phaseId: "P001", title: "Must not persist anywhere",
          decision: "Reject any write.", rationale: "Single-owner rule.", implementationNotes: "Redirect only.",
        });
        assert.equal(toolDetails(result).written, false);
      } finally {
        PlanStore.prototype.updatePhase = originalUpdatePhase;
        PlanStore.prototype.updateFeatures = originalUpdateFeatures;
      }
      const feature = (await host.store.loadFeatures()).features.find((entry) => entry.number === 1);
      const phase = (await host.store.loadAllPhases()).find((entry) => entry.number === 1);
      assert.equal(feature?.acceptedDecisions.some((entry) => entry.title === "Must not persist anywhere"), false);
      assert.equal(phase?.acceptedDecisions.some((entry) => entry.title === "Must not persist anywhere"), false);
    } finally {
      await closePiHost(host);
    }
  });

  test("parameterized phase and task commands resolve human phase refs without a fallback picker", async () => {
    const host = await createPiHost({ name: "t269-human-phase-refs", seed: "minimal" });
    try {
      await host.runCommand("phase show P001");
      assert.match(host.ui.notifyCalls.at(-1)?.message ?? "", /Auth API phase/);
      assert.equal(host.ui.selectCalls.length, 0, "phase show P001 must not open a picker");

      host.ui.inputAnswers.push("", "", "", "", "", "", "", "", "");
      await host.runCommand("phase update P001");
      assert.equal(host.ui.selectCalls.length, 0, "phase update P001 must not open a picker");

      let pickedTask = false;
      host.ui.select = async (title, options) => {
        pickedTask = title.includes("Pick a task");
        return options[0];
      };
      host.ui.inputAnswers.push("", "", "");
      await host.runCommand("task update P001");
      assert.equal(pickedTask, true, "task update P001 resolves the phase and only picks its task");
    } finally {
      await closePiHost(host);
    }
  });

  test("nested feature update preserves an F00x argument instead of falling back to init", async () => {
    const host = await createPiHost({ name: "t278-feature-update-ref", seed: "minimal" });
    try {
      const planner = host.commands.get("planner");
      // Pi's session-start autocomplete wrapper owns the real TUI path. It
      // must stop offering a command menu after a known nested command so the
      // argument remains editable instead of being replaced with `init`.
      await host.emit("session_start", { type: "session_start", reason: "startup" });
      assert.equal(typeof host.ui.autocompleteFactory, "function");
      const provider = host.ui.autocompleteFactory({
        getSuggestions: async () => { throw new Error("planner wrapper must not fall through for planner input"); },
        applyCompletion: () => { throw new Error("not used by this assertion"); },
        shouldTriggerFileCompletion: () => true,
      });
      for (const argumentText of [
        "feature update F001",
        "task checklist-toggle T001 C1 on",
        "handoff show P001",
      ]) {
        const input = `/planner ${argumentText}`;
        assert.equal(
          await provider.getSuggestions([input], 0, input.length, {
            force: false,
            signal: new AbortController().signal,
          }),
          null,
          `the real Pi autocomplete wrapper must not replace arguments after ${argumentText}`,
        );
        assert.equal(
          planner.getArgumentCompletions(argumentText),
          null,
          `the registered slash-command provider must also suppress fallback completion after ${argumentText}`,
        );
      }

      host.ui.inputAnswers.push("Auth API renamed through command", "", "", "");
      host.ui.editorAnswers.push("", "", "");
      await host.runCommand("feature update F001");

      assert.equal(host.ui.selectCalls.length, 0, "F001 resolves directly without opening a feature picker");
      const feature = (await host.store.loadFeatures()).features.find((entry) => entry.number === 1);
      assert.equal(feature?.name, "Auth API renamed through command");
    } finally {
      await closePiHost(host);
    }
  });

  test("Escape cancels interactive planner commands before any partial persistence", async () => {
    const host = await createPiHost({ name: "t279-escape-cancels", seed: "minimal" });
    try {
      const beforeFeature = (await host.store.loadFeatures()).features.find((feature) => feature.number === 1);
      assert.ok(beforeFeature);

      // An Escape from the first editor occurs after the title/status prompts,
      // but before the update write. The edited title must not leak through.
      host.ui.inputAnswers.push("Should not persist", "");
      host.ui.editorAnswers.push(undefined);
      await host.runCommand("feature update F001");
      const afterFeature = (await host.store.loadFeatures()).features.find((feature) => feature.number === 1);
      assert.equal(afterFeature?.name, beforeFeature.name);
      assert.match(host.ui.notifyCalls.at(-1)?.message ?? "", /Cancelled — no changes saved\./);

      // Phase discovery used to persist `discovery` before asking its question
      // series. Escape from the middle of that series must preserve its status.
      const beforePhase = (await host.store.loadAllPhases()).find((phase) => phase.number === 1);
      assert.ok(beforePhase);
      host.ui.inputAnswers.push("", undefined);
      await host.runCommand("phase discuss P001");
      const afterPhase = (await host.store.loadAllPhases()).find((phase) => phase.number === 1);
      assert.equal(afterPhase?.status, beforePhase.status);
      assert.equal(afterPhase?.updatedAt, beforePhase.updatedAt);

      // Escape at the first handoff prompt cannot write a partial handoff.
      host.ui.inputAnswers.push(undefined);
      await host.runCommand("handoff write P001");
      assert.equal(await host.store.getPhaseHandoff(afterPhase.id), "");

      // The task-create follow-up is asked before the new task is persisted.
      host.ui.select = async (_title, options) => options[0];
      host.ui.inputAnswers.push("Task that Escape cancels", undefined);
      await host.runCommand("task add");
      const phaseAfterTaskCancel = (await host.store.loadAllPhases()).find((phase) => phase.number === 1);
      assert.equal(phaseAfterTaskCancel?.tasks.some((task) => task.title === "Task that Escape cancels"), false);
    } finally {
      await closePiHost(host);
    }
  });

  test("command invocation preserves a multi-word phase title", async () => {
    const host = await createPiHost({ name: "t269-phase-add-args", seed: "minimal" });
    try {
      host.ui.select = async (_title, options) => options[0];
      host.ui.inputAnswers.push("");
      await host.runCommand("phase add Multi Word Phase Title");

      const phases = await host.store.loadAllPhases();
      assert.ok(phases.some((phase) => phase.title === "Multi Word Phase Title"));
      assert.match(host.ui.notifyCalls.map((entry) => entry.message).join("\n"), /Phase created:.*Multi Word Phase Title/);
    } finally {
      await closePiHost(host);
    }
  });

  test("command invocation round-trip: /planner load starts a real web server and recap; /planner stop halts", async () => {
    const host = await createPiHost({ name: "t240-cmd-load", seed: "minimal" });
    try {
      await host.emit("session_start", { type: "session_start", reason: "startup" });

      // /planner load — no interactive prompt needed.
      await host.runCommand("load");
      const notifyText = host.ui.notifyCalls.map((n) => n.message).join("\n");
      assert.match(notifyText, /Starting web server \(LAN\)/);

      // The recap trigger is delivered via pi.sendMessage with the REAL URL.
      const trigger = host.sentMessages.find((m) => m.message.customType === "planner-resume-trigger");
      assert.ok(trigger, "planner-resume-trigger message sent");
      const recapContent = trigger.message.content;
      assert.match(recapContent, /## Planner recap/);
      assert.match(recapContent, /Progress: Features/);
      assert.doesNotMatch(recapContent, /Planner rules \(extension/);
      assert.doesNotMatch(recapContent, /Keep the planner as the single operational source of truth/);
      const urlMatch = recapContent.match(/Web UI: (http:\/\/127\.0\.0\.1:[0-9]+)/);
      assert.ok(urlMatch, "recap carries the real web UI URL");

      // The web server is REAL: /api/health answers from the planRoot.
      const health = await fetch(`${urlMatch[1]}/api/health`);
      assert.equal(health.status, 200);
      const healthBody = await health.json();
      assert.equal(healthBody.status, "ok");
      assert.equal(healthBody.root, host.planRoot);

      // planner-web tool reports it running with the same URL.
      const webStatus = await host.runTool("planner-web", {});
      assert.equal(toolDetails(webStatus).running, true);
      assert.match(toolText(webStatus), /Web UI running\./);

      // Enabled now: before_agent_start injects the context block into the
      // system prompt, and message_end appends the Web UI address.
      const before = await host.emit("before_agent_start", {
        type: "before_agent_start",
        prompt: "continue",
        systemPrompt: "base-system-prompt",
        systemPromptOptions: {},
      });
      assert.ok(before && typeof before.systemPrompt === "string");
      assert.match(before.systemPrompt, /base-system-prompt/);
      assert.match(before.systemPrompt, /Agent Plan|planner|F001/);
      assert.match(before.systemPrompt, /Planner rules \(extension; agent-only\):/);
      assert.match(before.systemPrompt, /Keep the planner as the single operational source of truth/);

      const end = await host.emit("message_end", {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      });
      assert.ok(end && end.message, "message_end returns an amended message");
      const appendedText = end.message.content.map((c) => c.text ?? "").join("");
      assert.match(appendedText, /🌐 Web UI: http:\/\/127\.0\.0\.1:[0-9]+/);

      // /planner stop: server halted and planner disabled again.
      await host.runCommand("stop");
      const stopNotify = host.ui.notifyCalls.map((n) => n.message).join("\n");
      assert.match(stopNotify, /Planner stopped/);
      const webAfter = await host.runTool("planner-web", {});
      assert.equal(toolDetails(webAfter).running, false);
      const beforeAfter = await host.emit("before_agent_start", {
        type: "before_agent_start",
        prompt: "x",
        systemPrompt: "base",
        systemPromptOptions: {},
      });
      assert.equal(beforeAfter, undefined);
    } finally {
      await closePiHost(host);
    }
  });

  test("deterministic cleanup: shutdown stops the server, removes the root, and is repeatable", async () => {
    const host = await createPiHost({ name: "t240-cleanup", seed: "minimal" });
    const root = host.root;
    const planRoot = host.planRoot;
    // Bring the host to a live state (server + recap flags) before closing.
    await host.emit("session_start", { type: "session_start", reason: "startup" });
    await host.runCommand("load");
    const urlMatch = host.sentMessages
      .find((m) => m.message.customType === "planner-resume-trigger")?.message.content
      .match(/Web UI: (http:\/\/127\.0\.0\.1:[0-9]+)/);
    assert.ok(urlMatch, "web server running before close");
    const beforeHealth = await fetch(`${urlMatch[1]}/api/health`);
    assert.equal(beforeHealth.status, 200);

    // Close: session_shutdown stops the server and resets adapter state.
    await closePiHost(host);

    // The web server is gone (connection refused) and the temp root removed.
    await assert.rejects(fetch(`${urlMatch[1]}/api/health`), /fetch failed/i);
    assert.equal(existsSync(root), false);
    assert.equal(existsSync(planRoot), false);

    // Repeatable: a second host works in the same process (module state reset).
    const host2 = await createPiHost({ name: "t240-cleanup-again", seed: "minimal" });
    try {
      await host2.emit("session_start", { type: "session_start", reason: "startup" });
      const notifyText = host2.ui.notifyCalls.map((n) => n.message).join("\n");
      assert.match(notifyText, /Planner detected in this project/);
      const before = await host2.emit("before_agent_start", {
        type: "before_agent_start",
        prompt: "hi",
        systemPrompt: "base",
        systemPromptOptions: {},
      });
      assert.equal(before, undefined, "fresh host starts disabled");
    } finally {
      await closePiHost(host2);
    }
  });
});
