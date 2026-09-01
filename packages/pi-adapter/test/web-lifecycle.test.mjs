/**
 * T241 (P056/F015) — Pi startup, load/stop, and web lifecycle tests.
 *
 * Extends the T240 host harness with lifecycle scenarios:
 *  - disabled-by-default startup, no blocking prompt
 *  - /planner load, /planner stop, the `disable` alias, unknown subcommand
 *  - repeated load/stop cycles and planner-web tool state reflection
 *  - before_agent_start context-cache invalidation: web URL appears after
 *    load, disappears after stop, and plan mutations are picked up
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPiHost, closePiHost, cleanupPiHosts, toolText, toolDetails } from "./helpers/pi-host-fixture.mjs";

after(async () => {
  await cleanupPiHosts();
});

/** Run before_agent_start and return the injected systemPrompt (or undefined). */
async function readTaskContext(host) {
  await host.runTool("task_get", { taskId: "T001", full: true });
  await host.runTool("phase_get", { phaseId: "P001", full: true });
  await host.runTool("feature_get", { featureId: "F001", full: true });
  await host.runTool("requirement_list", {});
}

async function injectedPrompt(host, prompt = "continue") {
  const before = await host.emit("before_agent_start", {
    type: "before_agent_start",
    prompt,
    systemPrompt: "base-system-prompt",
    systemPromptOptions: {},
  });
  return before?.systemPrompt;
}

describe("pi-adapter web lifecycle", () => {
  test("startup: planner disabled by default, no blocking prompt", async () => {
    const host = await createPiHost({ name: "t241-startup", seed: "minimal" });
    try {
      await host.emit("session_start", { type: "session_start", reason: "startup" });

      // Detected but NOT enabled — and crucially no modal prompt blocks the host.
      const notifyText = host.ui.notifyCalls.map((n) => n.message).join("\n");
      assert.match(notifyText, /Planner detected in this project/);
      assert.equal(host.ui.inputCalls.length, 0, "no input prompt at startup");
      assert.equal(host.ui.confirmCalls.length, 0, "no confirm prompt at startup");
      assert.equal(host.ui.selectCalls.length, 0, "no select prompt at startup");

      // No context injection and the web lifecycle tool reports not running.
      const prompt = await injectedPrompt(host);
      assert.equal(prompt, undefined);
      const status = await host.runTool("planner-web", {});
      assert.equal(toolDetails(status).running, false);
    } finally {
      await closePiHost(host);
    }
  });

  test("planner-web start from a disabled session starts only the Web UI", async () => {
    const host = await createPiHost({ name: "t321-web-only-start", seed: "minimal" });
    try {
      await host.emit("session_start", { type: "session_start", reason: "startup" });
      assert.equal(await injectedPrompt(host), undefined, "planner context is disabled at startup");

      const started = await host.runTool("planner-web", { action: "start", visibility: "local" });
      assert.equal(toolDetails(started).running, true, "Web UI starts independently");
      assert.equal(await injectedPrompt(host), undefined, "Web UI startup does not enable planner context");
      assert.equal(
        host.sentMessages.filter((message) => message.message.customType === "planner-resume-trigger").length,
        0,
        "Web UI startup does not emit a planner recap",
      );

      const guidelines = await host.runTool("project_guidelines_update", {
        content: "Use English in source code. Run focused verification before claiming success.",
      });
      assert.match(toolText(guidelines), /Project Guidelines updated\./);
      const legacyContext = await host.runTool("project_update", {
        globalRules: ["Keep generated output deterministic."],
        decisions: ["Use automatic migration on explicit planner load."],
      });
      assert.match(toolText(legacyContext), /Project updated/);
      await rm(join(host.planRoot, "skills", "grill-me", "SKILL.md"));

      const loaded = await host.runTool("planner-load", {});
      assert.equal(toolDetails(loaded).enabled, true, "explicit planner-load enables the planner");
      assert.equal(toolDetails(loaded).preparation.migrated, true);
      assert.match(toolText(loaded), /Migrated legacy project context: 1 guideline, 1 accepted decision/);
      assert.match(toolText(loaded), /## Planner recap/);
      assert.match(toolText(loaded), /## Project Guidelines/);
      assert.match(toolText(loaded), /Use English in source code\. Run focused verification before claiming success\./);
      assert.doesNotMatch(toolText(loaded), /## Managed-copy policy/, "agent-only planner skill must not leak into the human recap text");
      assert.doesNotMatch(toolText(loaded), /Interview me relentlessly about every aspect/, "idea discussion skill must not leak into the human recap text");
      assert.match(toolDetails(loaded).plannerSkill.status, /^(created|current|updated)$/);
      assert.match(await readFile(join(host.planRoot, "skills", "grill-me", "SKILL.md"), "utf8"), /^<!-- agent-plan-managed-skill sha256:/);
      const prompt = await injectedPrompt(host);
      assert.match(prompt, /\[Plan Context/);
      assert.match(prompt, /# Agent Plan operating guide/);
      assert.match(prompt, /## Handoff protocol/);
      assert.doesNotMatch(prompt, /Interview me relentlessly about every aspect/, "idea discussion skill must not load on ordinary agent turns");

      await readTaskContext(host);
      const taskStart = await host.runTool("task_start", { taskId: "T001" });
      assert.equal(toolDetails(taskStart).started, true, "planner-load records the project-guidelines read attestation");
      assert.equal(
        host.sentMessages.filter((message) => message.message.customType === "planner-resume-trigger").length,
        0,
        "tool-based planner load returns the recap directly without a hidden trigger turn",
      );
      const repeated = await host.runTool("planner-load", {});
      assert.equal(toolDetails(repeated).preparation.migrated, false);
      assert.doesNotMatch(toolText(repeated), /Migrated legacy project context/, "no-op loads remain quiet");
    } finally {
      await closePiHost(host);
    }
  });

  test("load enables, stop and its `disable` alias halt, unknown subcommand warns", async () => {
    const host = await createPiHost({ name: "t241-aliases", seed: "minimal" });
    try {
      await host.runTool("project_update", { globalRules: ["Keep generated output deterministic."] });
      // load → migration + running + recap trigger.
      await host.runCommand("load");
      let notifyText = host.ui.notifyCalls.map((n) => n.message).join("\n");
      assert.match(notifyText, /Starting web server \(LAN\)/);
      const loadTriggers = host.sentMessages.filter((m) => m.message.customType === "planner-resume-trigger");
      assert.equal(loadTriggers.length, 1);
      assert.match(loadTriggers[0].message.content, /\[agent-only planner usage skill/);
      assert.doesNotMatch(loadTriggers[0].message.content, /Interview me relentlessly about every aspect/, "Pi command load must not inject grill-me before an Ideas workflow");
      assert.match(loadTriggers[0].message.content, /# Agent Plan operating guide/);
      assert.match(loadTriggers[0].message.content, /--- RECAP ---/);
      assert.match(loadTriggers[0].message.content, /Migrated legacy project context: 1 guideline/);
      let status = await host.runTool("planner-web", {});
      assert.equal(toolDetails(status).running, true);

      // stop → halted; context injection disabled again.
      await host.runCommand("stop");
      notifyText = host.ui.notifyCalls.map((n) => n.message).join("\n");
      assert.match(notifyText, /Planner stopped/);
      status = await host.runTool("planner-web", {});
      assert.equal(toolDetails(status).running, false);
      assert.equal(await injectedPrompt(host), undefined);

      // The `disable` alias behaves identically.
      await host.runCommand("load");
      const repeatedTrigger = host.sentMessages.filter((m) => m.message.customType === "planner-resume-trigger").at(-1);
      assert.doesNotMatch(repeatedTrigger.message.content, /Migrated legacy project context/, "repeated command load remains quiet");
      assert.equal(toolDetails(await host.runTool("planner-web", {})).running, true);
      await host.runCommand("disable");
      assert.equal(toolDetails(await host.runTool("planner-web", {})).running, false);
      assert.match(host.ui.notifyCalls.map((n) => n.message).join("\n"), /Planner stopped/);

      // Unknown subcommand → warning notify, state unchanged.
      await host.runCommand("frobnicate");
      assert.match(host.ui.notifyCalls.at(-1).message, /Unknown/);
      assert.equal(toolDetails(await host.runTool("planner-web", {})).running, false);
    } finally {
      await closePiHost(host);
    }
  });

  test("planner-load aborts with a typed diagnostic before enabling on preparation failure", async () => {
    const host = await createPiHost({ name: "t362-preparation-failure", seed: "minimal" });
    try {
      await writeFile(join(host.planRoot, "project.json"), "{ invalid json", "utf8");
      const result = await host.runTool("planner-load", {});
      assert.equal(toolDetails(result).errorCode, "PLANNER_SESSION_PREPARATION_FAILED");
      assert.equal(toolDetails(result).enabled, false);
      assert.equal(toolDetails(result).running, false);
      assert.match(toolText(result), /Planner load aborted/);
    } finally {
      await closePiHost(host);
    }
  });

  test("repeated load/stop cycles stay consistent and planner-web tools reflect state", async () => {
    const host = await createPiHost({ name: "t241-cycles", seed: "minimal" });
    try {
      // Cycle 1: load → load again (idempotent: no second server start, recap re-sent).
      await host.runCommand("load");
      const url1 = host.sentMessages
        .find((m) => m.message.customType === "planner-resume-trigger")?.message.content
        .match(/Web UI: (http:\/\/127\.0\.0\.1:[0-9]+)/)?.[1];
      assert.ok(url1, "first load produced a URL");

      await host.runCommand("load");
      const startNotifies = host.ui.notifyCalls.filter((n) => /Starting web server/.test(n.message)).length;
      assert.equal(startNotifies, 1, "second load does not restart the server");
      assert.equal(host.sentMessages.filter((m) => m.message.customType === "planner-resume-trigger").length, 2);
      const url2 = host.sentMessages
        .filter((m) => m.message.customType === "planner-resume-trigger")
        .at(-1)?.message.content
        .match(/Web UI: (http:\/\/127\.0\.0\.1:[0-9]+)/)?.[1];
      assert.equal(url2, url1, "second load reuses the running server");

      // Stop; then a third load starts a fresh server. The OS may legally reuse
      // the released dynamic port, so identity of the URL is not an invariant.
      await host.runCommand("stop");
      assert.equal(toolDetails(await host.runTool("planner-web", {})).running, false);

      await host.runCommand("load");
      const url3 = host.sentMessages
        .filter((m) => m.message.customType === "planner-resume-trigger")
        .at(-1)?.message.content
        .match(/Web UI: (http:\/\/127\.0\.0\.1:[0-9]+)/)?.[1];
      assert.ok(url3, "fresh server exposes a URL after stop");
      assert.equal(toolDetails(await host.runTool("planner-web", {})).running, true);

      // Tool-level start/stop reflect and drive the same state.
      await host.runTool("planner-web", { action: "stop" });
      assert.equal(toolDetails(await host.runTool("planner-web", {})).running, false);
      const started = await host.runTool("planner-web", { action: "start" });
      assert.equal(toolDetails(started).running, true);
      await host.runTool("planner-web", { action: "stop" });
      assert.equal(toolDetails(await host.runTool("planner-web", {})).running, false);

      // Command state agrees after the tool cycle: the tools toggle the server
      // but leave the hook enabled — the next turn's block reflects the stopped
      // dashboard instead of returning undefined.
      const afterStop = await injectedPrompt(host);
      assert.match(afterStop, /Web UI: not running\. Start it with '\/planner web start'\./);
    } finally {
      await closePiHost(host);
    }
  });

  test("context cache invalidation: URL after load, mutations picked up, absent after stop", async () => {
    const host = await createPiHost({ name: "t241-context", seed: "minimal" });
    try {
      await host.emit("session_start", { type: "session_start", reason: "startup" });
      await host.runCommand("load");

      // Recap turn (slow path): URL + startup protocol.
      const recapPrompt = await injectedPrompt(host);
      assert.match(recapPrompt, /🌐 WEB UI RUNNING: http:\/\/127\.0\.0\.1:[0-9]+/);
      assert.match(recapPrompt, /STARTUP RESUME PROTOCOL \(mandatory\)/);

      // Steady turn: cache hit — no protocol, URL still present.
      const steadyPrompt = await injectedPrompt(host);
      assert.doesNotMatch(steadyPrompt, /STARTUP RESUME PROTOCOL/);
      assert.match(steadyPrompt, /🌐 WEB UI RUNNING: http:\/\/127\.0\.0\.1:[0-9]+/);
      assert.match(steadyPrompt, /in-progress tasks: \(none\)/);

      // Real plan mutation (task_start through the adapter) invalidates the
      // cache: the next turn's block shows the in-progress task.
      await readTaskContext(host);
  await host.runTool("task_start", { taskId: "T001" });
      const mutatedPrompt = await injectedPrompt(host);
      assert.match(mutatedPrompt, /in-progress tasks: P001\(F001\)\/T001 — Implement login/);
      assert.match(mutatedPrompt, /current task pointer: P001\(F001\)\/T001 — Implement login/);
      assert.match(mutatedPrompt, /🌐 WEB UI RUNNING:/);

      // Tool-level stop (hook stays enabled) invalidates the cache: the block
      // must NOT keep claiming the web UI is running (regression guard for the
      // stopServer fix).
      await host.runTool("planner-web", { action: "stop" });
      const stoppedPrompt = await injectedPrompt(host);
      assert.doesNotMatch(stoppedPrompt, /🌐 WEB UI RUNNING/);
      assert.match(stoppedPrompt, /Web UI: not running\. Start it with '\/planner web start'\./);

      // Tool-level start brings the URL back.
      await host.runTool("planner-web", { action: "start" });
      const restartedPrompt = await injectedPrompt(host);
      assert.match(restartedPrompt, /🌐 WEB UI RUNNING: http:\/\/127\.0\.0\.1:[0-9]+/);

      // Command stop disables the hook entirely: no injection at all.
      await host.runCommand("stop");
      assert.equal(await injectedPrompt(host), undefined);

      // Re-load restores the URL on the next recap turn.
      await host.runCommand("load");
      const reloadedPrompt = await injectedPrompt(host);
      assert.match(reloadedPrompt, /🌐 WEB UI RUNNING: http:\/\/127\.0\.0\.1:[0-9]+/);
    } finally {
      await closePiHost(host);
    }
  });
});
