/**
 * Shared scenario runner + result normalization (F015/P052 — test foundation).
 *
 * Runs the harness-agnostic scenarios from ../scenario-matrix.mjs against one
 * or more harness boundaries (core | api | mcp | pi | ui | e2e). Each harness
 * module (built in P053–P059) registers executors keyed by scenario id; this
 * runner owns:
 *   - normalized result shape:  { ok, error?, data?, text? }
 *   - expectation assertion (ok / errorMatch / data / verify)
 *   - per-harness pass/fail aggregation for coverage/CI reports
 *
 * A scenario is NEVER redefined by a runner — only executed.
 */

import assert from "node:assert/strict";
import { scenarios, scenarioById } from "../scenario-matrix.mjs";
import { createPlannerFixture, cleanupFixtures } from "./fixtures.mjs";

/** ── Normalizers ───────────────────────────────────────────────────────
 * Mechanical conversion of each boundary's raw result into the normalized
 * shape. Harness executors may also return the normalized shape directly.
 */

/** MCP/Pi tool result → normalized. */
export function normalizeToolResult(result) {
  if (result == null) return { ok: false, error: "null result" };
  const content = result.content ?? [];
  const text = content
    .map((entry) => (typeof entry === "string" ? entry : entry.text ?? ""))
    .filter((entry) => typeof entry === "string")
    .join("\n");
  const structured = result.structuredContent ?? result.data ?? undefined;
  return { ok: result.ok ?? true, error: result.error, text, data: structured, raw: result };
}

/** HTTP response (fetch-like) → normalized. */
export async function normalizeHttpResult(response) {
  let json = null;
  let rawText = "";
  try {
    const text = await response.text();
    rawText = text;
    try { json = JSON.parse(text); } catch { json = null; }
  } catch {}
  const ok = response.status >= 200 && response.status < 400;
  const error = ok ? undefined : (json?.error ?? json?.message ?? `HTTP ${response.status}`);
  return { ok, error, data: json, text: rawText, raw: { status: response.status } };
}

/** Core executor result (already a plain object) → normalized (pass-through). */
export function normalizeCoreResult(result) {
  return { ok: result.ok ?? true, error: result.error, data: result.data, text: result.text ?? "", raw: result.raw };
}

/** Shallow deep-equal for plain data (JSON-safe). */
function matches(expected, actual) {
  if (typeof expected === "function") return expected(actual);
  try {
    assert.deepStrictEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}

/**
 * Assert a scenario's normalized outcome contract against a normalized result.
 * Throws a descriptive Error on mismatch.
 */
export function assertScenarioExpectations(scenario, normalized, ctx) {
  const where = `${scenario.id} (${scenario.harnesses.join("/")})`;
  if (scenario.expects.ok === true && normalized.ok !== true) {
    throw new Error(`${where}: expected ok, got error: ${normalized.error ?? "(none)"}${normalized.text ? ` — text: ${normalized.text.slice(0, 300)}` : ""}`);
  }
  if (scenario.expects.ok === false && normalized.ok !== false) {
    throw new Error(`${where}: expected failure, but call succeeded`);
  }

  const errorMatch = scenario.expects.errorMatch;
  if (errorMatch != null) {
    const errorText = normalized.error ?? normalized.text ?? "";
    if (errorMatch instanceof RegExp) {
      assert.match(String(errorText), errorMatch, `${where}: error did not match ${errorMatch}`);
    } else {
      assert.ok(String(errorText).toLowerCase().includes(String(errorMatch).toLowerCase()), `${where}: error "${String(errorText).slice(0, 200)}" missing "${errorMatch}"`);
    }
  }

  const dataChecks = scenario.expects.data;
  if (dataChecks != null) {
    for (const [key, expected] of Object.entries(dataChecks)) {
      const actual = normalized.data?.[key];
      if (!matches(expected, actual)) {
        throw new Error(`${where}: data.${key} mismatch — expected ${typeof expected === "function" ? "<predicate>" : JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }
  }

  if (typeof scenario.expects.verify === "function") {
    return scenario.expects.verify(ctx); // may return a promise
  }
  return undefined;
}

/** Registry of harness executors: harness name → Map<scenarioId, fn(ctx) → normalized>. */
export const executors = {
  core: new Map(),
  api: new Map(),
  mcp: new Map(),
  pi: new Map(),
  ui: new Map(),
  e2e: new Map(),
};

/** Register an executor for a scenario on a harness. */
export function registerExecutor(harness, scenarioId, fn) {
  const map = executors[harness];
  if (!map) throw new Error(`Unknown harness: ${harness}`);
  if (!scenarioById.has(scenarioId)) throw new Error(`Unknown scenario: ${scenarioId}`);
  map.set(scenarioId, fn);
}

/** Whether every scenario targeting a harness has an executor (coverage of the matrix). */
export function missingExecutors(harness) {
  const map = executors[harness] ?? new Map();
  return scenarios.filter((s) => s.harnesses.includes(harness)).map((s) => s.id).filter((id) => !map.has(id));
}

/**
 * Execute a single scenario against the given harnesses.
 * @param {string} scenarioId
 * @param {string[]} harnesses subset of the scenario's declared harnesses
 * @param {object} options — { seed?: override, opts? }
 * @returns {Promise<{ scenario, results: Record<harness, NormalizedResult> }>}
 */
export async function runScenario(scenarioId, harnesses, options = {}) {
  const scenario = scenarioById.get(scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  const active = harnesses.filter((h) => scenario.harnesses.includes(h));
  const fixture = await createPlannerFixture({
    name: scenarioId.replace(/[^a-z0-9-]/gi, "-"),
    seed: options.seed ?? scenario.fixture,
    opts: options.opts ?? {},
  });
  const results = {};
  const ctx = { ...fixture, scenario, harnesses: active };
  try {
    for (const harness of active) {
      const fn = executors[harness]?.get(scenarioId);
      if (!fn) throw new Error(`No executor for ${scenarioId} on harness "${harness}" (register with registerExecutor)`);
      const normalized = await fn(ctx);
      results[harness] = normalized;
      await assertScenarioExpectations(scenario, normalized, ctx);
    }
  } finally {
    // Executors own their fixture; registry cleanup is handled by test files.
  }
  return { scenario, results, fixture };
}

/**
 * Run every scenario for a harness (optionally filtered by group/category/id).
 * Returns a summary report consumable by CI.
 */
export async function runHarnessSuite(harness, { group, category, ids, concurrency = 1 } = {}) {
  const map = executors[harness] ?? new Map();
  let targets = scenarios.filter((s) => s.harnesses.includes(harness));
  if (group) targets = targets.filter((s) => s.group === group);
  if (category) targets = targets.filter((s) => s.category === category);
  if (ids) targets = targets.filter((s) => ids.includes(s.id));

  const report = { harness, total: targets.length, passed: 0, failed: 0, failures: [], results: [] };
  for (const scenario of targets) {
    if (!map.has(scenario.id)) {
      report.failed++;
      report.failures.push({ id: scenario.id, error: `no executor registered` });
      continue;
    }
    try {
      const { results } = await runScenario(scenario.id, [harness]);
      report.passed++;
      report.results.push({ id: scenario.id, ok: true });
    } catch (err) {
      report.failed++;
      report.failures.push({ id: scenario.id, error: err instanceof Error ? err.message : String(err) });
      report.results.push({ id: scenario.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  report.ok = report.failed === 0;
  return report;
}

export { scenarios, scenarioById };
export { cleanupFixtures };
