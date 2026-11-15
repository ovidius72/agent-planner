/**
 * P116(F025)/T461 — Baseline capture of REAL MCP outputs.
 *
 * Runs the actual published MCP server (packages/plan-mcp/dist/index.js)
 * against isolated planner fixtures and captures, from the real tool
 * surface:
 *   - a same-task race between two concurrent sessions (both agents start
 *     the same task at once);
 *   - failed and incomplete replies (unknown task, unknown phase);
 *   - source workspace inference (the server falls back to `cwd/.planner`
 *     when AGENT_PLAN_ROOT is unset);
 *   - real reply bytes and tool-call counts for a scripted resume context
 *     scenario (model tokens are not measurable here and stay null).
 *
 * Expected corrections and uncertain causes are recorded per case in
 * docs/agent-brain/baseline/README.md. Fixtures are mkdtemp-based and every
 * owned server process is stopped by cleanupMcpFixtures().
 */
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  startMcpFixture,
  startMcpClient,
  closeMcpFixture,
  cleanupMcpFixtures,
  callTool,
  toolText,
  toolStructured,
} from "../../../test/helpers/mcp-fixture.mjs";

after(async () => {
  await cleanupMcpFixtures();
});

const bytes = (value) => Buffer.byteLength(value, "utf8");

async function readTaskContext(session, task = "T001") {
  await callTool(session, "planner-task-show", { task, full: true });
  await callTool(session, "planner-phase-show", { phase: "P001", full: true });
  await callTool(session, "planner-feature-show", { feature: "F001", full: true });
  await callTool(session, "planner-requirement-list", { phaseRef: "P001" });
}

describe("T461 baseline (MCP) — same-task race", () => {
  test("two concurrent sessions starting one task: exactly one persisted owner", async () => {
    const a = await startMcpFixture({ name: "baseline-race" });
    try {
      const b = await startMcpClient({ planRoot: a.planRoot, name: "baseline-race-b" });
      await readTaskContext(a);
      await readTaskContext(b);
      const [startA, startB] = await Promise.allSettled([
        callTool(a, "planner-task-start", { task: "T001" }),
        callTool(b, "planner-task-start", { task: "T001" }),
      ]);
      const outcomes = [startA, startB].map((entry) => {
        if (entry.status === "rejected") return { ok: false, error: String(entry.reason?.message ?? entry.reason) };
        const text = toolText(entry.value);
        const structured = toolStructured(entry.value) ?? {};
        return { ok: true, text, started: structured.started ?? /started: true/.test(text) };
      });
      const winners = outcomes.filter((entry) => entry.ok && entry.started === true);
      const losers = outcomes.filter((entry) => entry.ok && entry.started !== true);
      const rejections = outcomes.filter((entry) => !entry.ok);
      assert.equal(winners.length, 1, `baseline: exactly one session starts the task (outcomes: ${JSON.stringify(outcomes).slice(0, 400)})`);
      assert.ok(losers.length + rejections.length >= 1, "the losing session is told it did not start the task");
      // The persisted owner is exactly one session id.
      const persisted = await a.store.loadAllPhases();
      const task = persisted.flatMap((phase) => phase.tasks).find((entry) => entry.number === 1);
      assert.ok(task.activeOwnerSession, "task ends owned");
      if (losers.length === 1) assert.match(losers[0].text, /already started|another session|started: false/i, "loser reply explains the denial");
    } finally {
      await closeMcpFixture(a);
    }
  });
});

describe("T461 baseline (MCP) — failed and incomplete replies", () => {
  test("unknown task and unknown phase produce typed, human-readable errors", async () => {
    const a = await startMcpFixture({ name: "baseline-errors" });
    try {
      const missingTask = await callTool(a, "planner-task-show", { task: "T999", full: true });
      assert.match(toolText(missingTask), /not found|T999/i, "unknown task read replies with a readable failure");
      const missingPhase = await callTool(a, "planner-phase-show", { phase: "P999", full: true });
      assert.match(toolText(missingPhase), /not found|P999/i, "unknown phase read replies with a readable failure");
      // Incomplete arguments do not crash the server: the tool answers with a
      // defined reply (baseline — schema strictness may change with T462).
      const incomplete = await callTool(a, "planner-task-show", {});
      assert.ok(toolText(incomplete).length > 0, "incomplete arguments still produce a defined reply");
    } finally {
      await closeMcpFixture(a);
    }
  });
});

describe("T461 baseline (MCP) — source workspace inference", () => {
  test("without AGENT_PLAN_ROOT the server infers the planner from process cwd", async () => {
    const a = await startMcpFixture({ name: "baseline-infer" });
    try {
      // Reconnect with the same cwd convention the server uses for inference:
      // no AGENT_PLAN_ROOT, cwd pointing at a folder that contains .planner.
      const { createRequire } = await import("node:module");
      const { packageDist } = await import("../../../test/helpers/fixtures.mjs");
      const { Client } = createRequire(join(packageDist("plan-mcp"), "resolve-sdk.cjs"))("@modelcontextprotocol/sdk/client");
      const { StdioClientTransport } = createRequire(join(packageDist("plan-mcp"), "resolve-sdk.cjs"))("@modelcontextprotocol/sdk/client/stdio.js");
      const projectDir = join(a.root); // a.root contains .planner/
      const client = new Client({ name: "baseline-infer", version: "0.0.0" }, { capabilities: {} });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [packageDist("plan-mcp")],
        cwd: projectDir,
        env: { ...process.env, AGENT_PLAN_ROOT: "" },
        stderr: "pipe",
      });
      let stderr = "";
      transport.stderr?.on?.("data", (chunk) => { stderr += chunk.toString(); });
      await client.connect(transport);
      try {
        const initialized = await callTool({ client, close: async () => {} }, "planner-task-recommend", {});
        const text = toolText(initialized);
        assert.ok(text.length > 0, "cwd-inferred planner answers recommendation calls");
        assert.match(text, /T001|No ready task|recommendation/i, "the answer concerns this fixture's plan");
      } finally {
        await client.close().catch(() => {});
      }
    } finally {
      await closeMcpFixture(a);
    }
  });
});

describe("T461 baseline (MCP) — reply bytes and tool-call counts", () => {
  test("scripted resume context scenario: bounded bytes across counted tool calls", async () => {
    const a = await startMcpFixture({ name: "baseline-measure" });
    try {
      const scenario = [];
      const step = async (tool, args) => {
        const result = await callTool(a, tool, args);
        const text = toolText(result);
        const structured = toolStructured(result);
        scenario.push({
          tool,
          isError: result.isError === true,
          textBytes: bytes(text),
          textChars: text.length,
          structuredBytes: structured ? bytes(JSON.stringify(structured)) : 0,
          duplication: structured && text ? (bytes(JSON.stringify(structured)) / Math.max(bytes(text), 1)).toFixed(2) : null,
        });
        return result;
      };
      await step("planner-task-recommend", {});
      await step("planner-task-show", { task: "T001", full: true });
      await step("planner-phase-show", { phase: "P001", full: true });
      await step("planner-feature-show", { feature: "F001", full: true });
      await step("planner-task-start", { task: "T001" });
      await step("planner-task-recommend", {});

      const totalTextBytes = scenario.reduce((sum, entry) => sum + entry.textBytes, 0);
      const totalStructuredBytes = scenario.reduce((sum, entry) => sum + entry.structuredBytes, 0);
      const report = {
        schemaVersion: 1,
        capturedAt: "2026-11-14T00:00:00.000Z",
        runner: "packages/plan-mcp/test/agent-brain-baseline-mcp.test.mjs",
        scope: "product-scenario",
        scenario: scenario.map(({ tool, isError, textBytes, structuredBytes }) => ({ tool, isError, textBytes, structuredBytes })),
        toolCalls: scenario.length,
        totalTextBytes,
        totalStructuredBytes,
        modelTokens: null,
        note: "Real MCP server over stdio against a minimal seeded fixture; tokens are model-visible only.",
      };
      // Bounded-context invariants for the baseline.
      assert.equal(report.toolCalls, 6);
      assert.ok(report.totalTextBytes < 100_000, `resume context stays bounded (got ${report.totalTextBytes} bytes)`);
      const recommend = scenario[0];
      const recommendAgain = scenario[5];
      assert.equal(recommend.tool, "planner-task-recommend");
      assert.equal(recommendAgain.tool, "planner-task-recommend");
      assert.ok(recommend.textBytes > 0 && recommendAgain.textBytes > 0);
      console.log(`[ab-baseline] mcp resume scenario: ${JSON.stringify(report)}`);
    } finally {
      await closeMcpFixture(a);
    }
  });
});
