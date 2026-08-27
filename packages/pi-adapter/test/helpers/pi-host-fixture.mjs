/**
 * T240 (P056/F015) — Pi adapter host and registration harness.
 *
 * Loads the ACTUAL adapter entrypoint (packages/pi-adapter/dist/index.js) with
 * a controlled fake Pi host boundary. The fake implements ONLY the Pi
 * ExtensionAPI surface the adapter touches (on / registerTool / registerCommand
 * / sendMessage / appendEntry plus a recording ExtensionContext with ui,
 * sessionManager and cwd), so adapter-to-core persistence stays REAL: real
 * PlanStore on a real temporary .planner, real in-process web server for
 * planner-web and `/planner load`.
 *
 * The adapter is a module singleton (module-level state), so at most one host
 * is active at a time. Each close() emits session_shutdown, which the adapter
 * uses to stop its web server and reset its module state, then removes the
 * temp root — deterministic per-test cleanup. cleanupPiHosts() drains every
 * live host as a safety net for the after() hook.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createPlannerFixture, createTempRoot, cleanupFixtures } from "../../../../test/helpers/fixtures.mjs";
import { PlanStore } from "../../../plan-core/dist/index.js";
import planPiExtension from "../../dist/index.js";

/** Every live host created in this process (drained by cleanupPiHosts). */
const hosts = new Set();

/** Close every live host and remove all fixture temp roots. */
export async function cleanupPiHosts() {
  const open = [...hosts];
  hosts.clear();
  await Promise.all(open.map((host) => host.close().catch(() => {})));
  await cleanupFixtures();
}

/** Close one host: emits session_shutdown (stops server, resets adapter
 *  state) and removes the temp root immediately. */
export async function closePiHost(host) {
  hosts.delete(host);
  await host.close();
}

/** Extract the text content of a tool result. */
export function toolText(result) {
  return (result.content ?? []).map((entry) => entry.text ?? "").join("\n");
}

/** Extract the structured `details` payload of a tool result. */
export function toolDetails(result) {
  return result.details ?? null;
}

/**
 * Create one isolated Pi host.
 *
 * @param {object} opts
 * @param {string} [opts.name]   fixture name
 * @param {string|null} [opts.seed]  fixture seed ("empty"|"minimal"|"full"|
 *   "terminal"|"resume-needed"|"legacy-single-file"), or null for a bare temp
 *   root with NO .planner (for plan_init tests). Ignored when `root` is given.
 * @param {string} [opts.root]   reuse an EXISTING fixture root (for repeated
 *   sessions over the same project); a PlanStore is opened on <root>/.planner.
 * @param {boolean} [opts.keepRootOnClose]  close() emits session_shutdown but
 *   does NOT remove the root (so a later host can reopen the same project).
 * @param {string} [opts.sessionId] stable Pi logical-session UUID; defaults to
 *   a fresh UUID per host and remains unchanged across session_start reloads.
 */
export async function createPiHost({ name = "pi-host", seed = "empty", root, keepRootOnClose = false, sessionId = randomUUID() } = {}) {
  const fixture = root
    ? { root, planRoot: join(root, ".planner"), store: new PlanStore(join(root, ".planner")) }
    : seed === null
      ? { root: await createTempRoot(`agent-plan-pi-${name.replace(/[^a-z0-9-]/gi, "-")}-`), store: null }
      : await createPlannerFixture({ name: `pi-${name}`, seed });
  const rootDir = fixture.root;
  const planRoot = fixture.planRoot ?? join(rootDir, ".planner"); // seed:null → no .planner yet, but the path is deterministic

  // ── recorded registrations ────────────────────────────────────────
  const handlers = new Map();   // event name → handler
  const tools = new Map();      // tool name → ToolDefinition
  const commands = new Map();   // command name → { handler, getArgumentCompletions }
  const sentMessages = [];      // pi.sendMessage calls
  const appendedEntries = [];   // pi.appendEntry calls
  const sessionEntries = [];    // shared with ctx.sessionManager.getEntries()

  // ── recording UI ──────────────────────────────────────────────────
  const ui = {
    notifyCalls: [],
    inputCalls: [],
    selectCalls: [],
    confirmCalls: [],
    editorCalls: [],
    inputAnswers: [],
    selectAnswer: undefined,
    confirmAnswer: true,
    editorAnswer: undefined,
    editorAnswers: [],
    autocompleteFactory: undefined,

    notify(message, type) {
      this.notifyCalls.push({ message: String(message), type });
    },
    async input(title, placeholder) {
      this.inputCalls.push({ title: String(title), placeholder });
      return this.inputAnswers.shift();
    },
    async select(title, options) {
      this.selectCalls.push({ title: String(title), options: [...options] });
      return this.selectAnswer;
    },
    async confirm(title, message) {
      this.confirmCalls.push({ title: String(title), message: String(message) });
      return this.confirmAnswer;
    },
    async editor(title, prefill) {
      this.editorCalls.push({ title: String(title), prefill });
      return this.editorAnswers.length > 0 ? this.editorAnswers.shift() : this.editorAnswer;
    },
    addAutocompleteProvider(factory) {
      this.autocompleteFactory = factory;
    },

    // Inert stubs for the rest of ExtensionUIContext — the adapter must not
    // depend on them, and no test should reach them.
    onTerminalInput() { return () => {}; },
    setStatus() {}, setWorkingMessage() {}, setWorkingVisible() {},
    setWorkingIndicator() {}, setHiddenThinkingLabel() {}, setWidget() {},
    setFooter() {}, setHeader() {}, setTitle() {},
    custom: async () => undefined,
    pasteToEditor() {}, setEditorText() {}, getEditorText: () => "",
    setEditorComponent() {}, getEditorComponent: () => undefined,
    theme: {}, getAllThemes: () => [], getTheme: () => undefined,
    setTheme: () => ({ success: true }),
    getToolsExpanded: () => true, setToolsExpanded() {},
  };

  // ── fake ExtensionContext ─────────────────────────────────────────
  const ctx = {
    cwd: rootDir,
    hasUI: true,
    ui,
    sessionManager: {
      getEntries: () => sessionEntries,
      getSessionId: () => sessionId,
    },
    model: undefined,
    modelRegistry: {},
    signal: undefined,
    isIdle: () => true,
    hasPendingMessages: () => false,
    abort() {},
    shutdown() {},
    getContextUsage: () => undefined,
    compact() {},
    getSystemPrompt: () => "",
    waitForIdle: async () => {},
  };

  // ── fake ExtensionAPI ─────────────────────────────────────────────
  const pi = {
    on(event, handler) { handlers.set(event, handler); },
    registerTool(def) { tools.set(def.name, def); },
    registerCommand(name, opts) { commands.set(name, opts); },
    sendMessage(message, options) { sentMessages.push({ message, options }); },
    appendEntry(customType, data) {
      appendedEntries.push({ customType, data });
      sessionEntries.push({ type: "custom", customType, data });
    },

    // Inert stubs for the unused ExtensionAPI surface.
    registerShortcut() {}, registerFlag() {}, getFlag() {}, registerMessageRenderer() {},
    sendUserMessage() {}, setSessionName() {}, getSessionName() {}, setLabel() {},
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    getActiveTools: () => [], getAllTools: () => [], setActiveTools() {},
    getCommands: () => [], setModel: async () => true,
    getThinkingLevel: () => "high", setThinkingLevel() {},
    registerProvider() {}, getContextUsage: () => undefined,
    compact() {}, getSystemPrompt: () => "", shutdown() {},
  };

  // Load the REAL entrypoint against the fake host.
  planPiExtension(pi);

  const host = {
    root: rootDir,
    planRoot,
    store: fixture.store,
    handlers,
    tools,
    commands,
    sentMessages,
    appendedEntries,
    sessionEntries,
    ui,
    ctx,
    pi,

    /** Invoke a registered lifecycle handler with the host context. */
    async emit(event, payload = {}) {
      const handler = handlers.get(event);
      assert.ok(handler, `no handler registered for ${event}`);
      return handler(payload, ctx);
    },

    /** Run the `/planner` command with the given args string. */
    async runCommand(args) {
      const command = commands.get("planner");
      assert.ok(command, "planner command not registered");
      assert.equal(typeof command.handler, "function", "planner command has no handler");
      return command.handler(String(args), ctx);
    },

    /** Run a registered tool's execute with realistic invocation args. */
    async runTool(name, params = {}, { expectError } = {}) {
      const tool = tools.get(name);
      assert.ok(tool, `tool ${name} not registered`);
      let result;
      try {
        result = await tool.execute("test-call-1", params, undefined, undefined, ctx);
      } catch (cause) {
        throw new Error(`[pi-host] tool ${name} threw: ${cause.message}`, { cause });
      }
      if (expectError !== undefined && !result.isError !== !expectError) {
        throw new Error(`[pi-host] tool ${name}: expected isError=${expectError}, got ${result.isError}`);
      }
      return result;
    },

    /** Close the host: emit session_shutdown, then remove the temp root
     *  (unless keepRootOnClose was set, e.g. for repeated-session tests). */
    async close() {
      const handler = handlers.get("session_shutdown");
      if (handler) await handler({ type: "session_shutdown", reason: "quit" }, ctx).catch(() => {});
      if (!keepRootOnClose) await rm(rootDir, { recursive: true, force: true }).catch(() => {});
    },
  };

  hosts.add(host);
  return host;
}
