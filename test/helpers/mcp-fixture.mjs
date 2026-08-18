/**
 * T236 (P055/F015) — Real MCP client/server integration harness.
 *
 * Starts the ACTUAL published MCP server (packages/plan-mcp/dist/index.js —
 * the same entrypoint Claude Code consumes via the `agent-plan-mcp` bin)
 * against an isolated real-planner fixture, and connects the MCP SDK Client
 * over a REAL stdio subprocess transport. No mocks: real server process,
 * real PlanStore, real filesystem.
 *
 * Helpers:
 *  - startMcpClient({ planRoot })        — raw client against an arbitrary
 *                                          .planner root (e.g. for planner-init)
 *  - startMcpFixture({ name, seed })     — fixture + client (seeded .planner)
 *  - closeMcpFixture(session)            — close one session
 *  - cleanupMcpFixtures()                — drain every open session + temp roots
 *  - discoverTools(session)              — listTools() (published schema surface)
 *  - callTool(session, name, args)       — invocation with diagnostics
 *  - expectToolError(result, pattern)    — error assertions (schema/throw vs
 *                                          semantic text errors)
 *  - toolText(result) / toolStructured(result) — content extraction
 *
 * Diagnostics contract (mirrors server-fixture.mjs): invocation failures and
 * unexpected isError flags throw with full method/args/stderr context; the
 * connect path surfaces captured server stderr on failure.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createPlannerFixture, cleanupFixtures, packageDist } from "./fixtures.mjs";

// The MCP SDK is a dependency of plan-mcp (pnpm nests it under
// packages/plan-mcp/node_modules, not the repo root), so resolve it through
// the package's own node_modules regardless of where this helper is imported.
const sdkRequire = createRequire(join(dirname(packageDist("plan-mcp")), "resolve-sdk.cjs"));
const { Client } = sdkRequire("@modelcontextprotocol/sdk/client");
const { StdioClientTransport } = sdkRequire("@modelcontextprotocol/sdk/client/stdio.js");

/** Every live MCP session created in this process (drained on cleanup). */
const sessions = new Set();

/** Close every open session and remove all fixture temp roots. */
export async function cleanupMcpFixtures() {
  const open = [...sessions];
  sessions.clear();
  await Promise.all(open.map((session) => session.close().catch(() => {})));
  await cleanupFixtures();
}

/** Close one session (its temp root is still removed by cleanupFixtures). */
export async function closeMcpFixture(session) {
  sessions.delete(session);
  await session.close();
}

/**
 * Connect an MCP SDK Client to the real published server binary via stdio.
 * The server resolves its planner from AGENT_PLAN_ROOT, so planRoot points at
 * the target .planner directory (may not exist yet — planner-init creates it).
 */
export async function startMcpClient({ planRoot, name = "agent-plan-test" } = {}) {
  if (!planRoot) throw new Error("startMcpClient: planRoot is required");
  const serverPath = packageDist("plan-mcp");
  const client = new Client({ name, version: "0.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: dirname(serverPath),
    env: { ...process.env, AGENT_PLAN_ROOT: planRoot },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on?.("data", (chunk) => {
    stderr += chunk.toString();
  });
  transport.onerror = (error) => {
    if (stderr) error.message += `\nSTDERR:\n${stderr}`;
  };

  const session = {
    client,
    transport,
    planRoot,
    /** Captured server stderr so far (diagnostics). */
    stderr: () => stderr,
    async close() {
      await transport.close();
    },
  };
  try {
    await client.connect(transport);
  } catch (cause) {
    await transport.close().catch(() => {});
    throw new Error(`MCP client connect failed (planRoot: ${planRoot}, server: ${serverPath})\n${stderr}`, { cause });
  }
  sessions.add(session);
  return session;
}

/**
 * Create an isolated seeded fixture + MCP client against it. Returns
 * { root, planRoot, store, client, transport, close } — store lets tests
 * assert persisted state directly (real PlanStore, same filesystem).
 */
export async function startMcpFixture({ name = "mcp", seed = "minimal", opts = {} } = {}) {
  const fixture = await createPlannerFixture({ name, seed, opts });
  const session = await startMcpClient({ planRoot: fixture.planRoot, name: `harness-${name}` });
  return { ...fixture, ...session };
}

// ── Content extraction ─────────────────────────────────────────────────────

/** Concatenated text content of a tool result. */
export function toolText(result) {
  return (result.content ?? []).map((entry) => entry.text ?? "").join("\n");
}

/** structuredContent payload, or null when absent. */
export function toolStructured(result) {
  return result.structuredContent ?? null;
}

// ── Invocation + diagnostics ───────────────────────────────────────────────

function diagnostic({ name, args, result, cause }) {
  const lines = [`[mcp-fixture] ${name}`];
  if (args && Object.keys(args).length) lines.push(`  args: ${JSON.stringify(args)}`);
  if (result) lines.push(`  isError: ${String(result.isError)}`);
  lines.push(`  text: ${typeof result === "string" ? result : JSON.stringify(result?.content ?? null)}`);
  if (cause) lines.push(`  cause: ${cause.message}`);
  return lines.join("\n");
}

/**
 * Invoke a tool with diagnostics. By default a network/protocol failure
 * throws with context; `expectError` asserts the SDK-level isError flag
 * (schema validation failures and handler throws are surfaced by the server
 * as isError results, while semantic errors are returned as plain text).
 */
export async function callTool(session, name, args = {}, { expectError } = {}) {
  let result;
  try {
    result = await session.client.callTool({ name, arguments: args });
  } catch (cause) {
    throw new Error(diagnostic({ name, args, cause }), { cause });
  }
  if (expectError !== undefined && result.isError !== expectError) {
    throw new Error(diagnostic({ name, args, result }), {
      cause: new Error(`expected isError=${expectError}, got ${result.isError}`),
    });
  }
  return result;
}

/**
 * Assert a tool result is an error and its text matches `pattern`.
 * Handles both shapes: schema/throw failures (isError:true, message in
 * content) and semantic errors returned as plain text results. Returns the
 * error text for further assertion.
 */
export function expectToolError(result, pattern = /error/i) {
  const text = toolText(result);
  assert.match(text, pattern, `tool error text should match ${pattern}`);
  return text;
}

// ── Tool discovery (published schema surface) ──────────────────────────────

/**
 * List the tools registered by the running server. This validates the
 * PUBLISHED MCP schema surface (what a host like Claude Code actually sees)
 * rather than importing private handler functions.
 */
export async function discoverTools(session) {
  const { tools } = await session.client.listTools();
  return tools;
}
