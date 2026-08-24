/**
 * Shared scenario runner + result normalization (F015/P052 + P059).
 *
 * Runs the harness-agnostic scenarios from ../scenario-matrix.mjs against one
 * or more harness boundaries (core | api | mcp | pi | ui | e2e). Each harness
 * module (built in P053–P059) registers executors keyed by scenario id; this
 * runner owns:
 *   - normalized result shape across API JSON, MCP structuredContent, and Pi details
 *   - reference / status / error-category extraction for parity assertions
 *   - persisted snapshot normalization for cross-harness comparisons
 *   - expectation assertion (ok / errorMatch / data / snapshot / verify)
 *   - per-harness pass/fail aggregation for coverage/CI reports
 *
 * A scenario is NEVER redefined by a runner — only executed.
 */

import assert from "node:assert/strict";
import { scenarios, scenarioById } from "../scenario-matrix.mjs";
import { createPlannerFixture, cleanupFixtures } from "./fixtures.mjs";

const WORKFLOW_STATUSES = new Set([
  "draft",
  "planned",
  "in-progress",
  "paused",
  "waiting",
  "blocked",
  "done",
  "canceled",
  "rejected",
  "deferred",
]);

const FEATURE_REF_RE = /F\d{3}/g;
const PHASE_REF_RE = /P\d{3}\(F\d{3}\)/g;
const TASK_PHASE_FIRST_RE = /P\d{3}\(F\d{3}\)\/T\d{3}/g;
const TASK_TASK_FIRST_RE = /T\d{3}\(P\d{3}\/F\d{3}\)/g;

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergePayloads(...payloads) {
  const present = payloads.filter((value) => value != null);
  if (present.length === 0) return undefined;
  if (present.every(isPlainObject)) return Object.assign({}, ...present);
  return present[0];
}

function firstLine(text) {
  return String(text ?? "").split(/\r?\n/, 1)[0] ?? "";
}

function pad(number) {
  return String(number).padStart(3, "0");
}

function featureRef(number) {
  return `F${pad(number)}`;
}

function phaseRef(number, featureNumber) {
  return featureNumber ? `P${pad(number)}(${featureRef(featureNumber)})` : `P${pad(number)}`;
}

function taskRef(number, phaseNumber, featureNumber) {
  return phaseNumber && featureNumber
    ? `T${pad(number)}(P${pad(phaseNumber)}/${featureRef(featureNumber)})`
    : `T${pad(number)}`;
}

function collectStrings(value, sink, depth = 0) {
  if (value == null || depth > 5) return;
  if (typeof value === "string") {
    sink.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, sink, depth + 1);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const entry of Object.values(value)) collectStrings(entry, sink, depth + 1);
}

function extractReferences(data, text) {
  const strings = [];
  collectStrings(data, strings);
  if (text) strings.push(text);

  const refs = [];
  const seen = new Set();
  const push = (match) => {
    if (!match || seen.has(match)) return;
    seen.add(match);
    refs.push(match);
  };

  for (const source of strings) {
    for (const match of String(source).match(TASK_PHASE_FIRST_RE) ?? []) push(match);
    for (const match of String(source).match(TASK_TASK_FIRST_RE) ?? []) push(match);
    for (const match of String(source).match(PHASE_REF_RE) ?? []) push(match);
    for (const match of String(source).match(FEATURE_REF_RE) ?? []) push(match);
  }
  return refs;
}

function extractStatus(data, text) {
  const direct = data?.status ?? data?.task?.status ?? data?.phase?.status ?? data?.feature?.status;
  if (typeof direct === "string" && WORKFLOW_STATUSES.has(direct)) return direct;

  const strings = [];
  collectStrings(data, strings);
  if (text) strings.push(text);
  for (const source of strings) {
    const match = String(source).match(/\((draft|planned|in-progress|paused|waiting|blocked|done|canceled|rejected|deferred)\)/i);
    if (match) return match[1].toLowerCase();
  }
  return undefined;
}

function classifyError(error, text) {
  const sample = `${error ?? ""}\n${text ?? ""}`.toLowerCase();
  if (!sample.trim()) return undefined;
  if (/proposal only|confirmationrequired|confirmed=true|ask the user to confirm/.test(sample)) return "confirmation_required";
  if (/ambiguous/.test(sample)) return "ambiguous_ref";
  if (/not found|no \.planner|enoent/.test(sample)) return "not_found";
  if (/governance|discussedat|contextready|context ready/.test(sample)) return "governance";
  if (/requires a motivation|title required|name required|featureid required|phaseid required|feature is required|feature required|belong to a feature|linkedphaseids|required|generic handoff title|provide the handoff text|cannot be created paused|movedid required|invalid kind|input validation error|invalid arguments|invalid input|expected string|received undefined|reading 'trim'|too_small|at least 1 character/.test(sample)) return "validation";
  if (/done phase|completed phases have no pending handoff|resume paused work|pending resume|task start denied|task completion denied|paused lifecycle transitions require|does not belong/.test(sample)) return "state_conflict";
  return "unknown";
}

function normalizeResume(snapshot, maps) {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const inProgressTaskRefs = (snapshot.inProgressTaskIds ?? []).map((id) => maps.taskById.get(id) ?? id);
  const currentPhaseRef = maps.phaseById.get(snapshot.currentPhaseId) ?? snapshot.currentPhaseId ?? "";
  const derivedFeatureRef = currentPhaseRef.match(/\((F\d{3})\)/)?.[1] ?? "";
  return {
    ...snapshot,
    inProgressTaskRefs,
    currentFeatureRef: maps.featureById.get(snapshot.currentFeatureId) ?? snapshot.currentFeatureId ?? derivedFeatureRef,
    currentPhaseRef,
    currentTaskRef: maps.taskById.get(snapshot.currentTaskId) ?? snapshot.currentTaskId ?? (inProgressTaskRefs.length === 1 ? inProgressTaskRefs[0] : ""),
  };
}

/** Normalize a persisted .planner snapshot into transport-independent refs. */
export function normalizePersistedSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return undefined;

  const features = Array.isArray(snapshot.features) ? snapshot.features : [];
  const phases = Array.isArray(snapshot.phases) ? snapshot.phases : [];
  const requirements = Array.isArray(snapshot.requirements?.requirements)
    ? snapshot.requirements.requirements
    : Array.isArray(snapshot.requirements)
      ? snapshot.requirements
      : [];

  const featureNumberById = new Map(features.map((feature) => [feature.id, feature.number]));
  const featureById = new Map(features.map((feature) => [feature.id, featureRef(feature.number)]));
  const phaseById = new Map(
    phases.map((phase) => [phase.id, phaseRef(phase.number, featureNumberById.get(phase.featureId))]),
  );
  const taskById = new Map();
  for (const phase of phases) {
    const fnum = featureNumberById.get(phase.featureId);
    for (const task of phase.tasks ?? []) {
      taskById.set(task.id, taskRef(task.number, phase.number, fnum));
    }
  }

  const handoffArchive = Array.isArray(snapshot.handoffArchive)
    ? snapshot.handoffArchive.map((entry) => ({
      reason: entry.reason ?? "",
      phaseRef: phaseById.get(entry.phaseId) ?? entry.phaseId ?? "",
      featureRef: featureById.get(entry.featureId) ?? entry.featureId ?? "",
      firstLine: entry.firstLine ?? firstLine(entry.content),
      file: entry.file ?? "",
    }))
    : [];

  return {
    manifestVersion: snapshot.manifest?.version ?? null,
    project: snapshot.project
      ? {
        name: snapshot.project.name ?? "",
        workDeviationCount: snapshot.project.workDeviations?.length ?? 0,
      }
      : null,
    features: features.map((feature) => ({
      ref: featureById.get(feature.id),
      name: feature.name,
      status: feature.status ?? null,
      phaseRefs: (feature.phaseIds ?? []).map((id) => phaseById.get(id) ?? id),
    })),
    phases: phases.map((phase) => ({
      ref: phaseById.get(phase.id),
      featureRef: featureById.get(phase.featureId) ?? phase.featureId ?? "",
      title: phase.title,
      status: phase.status ?? null,
      handoff: firstLine(phase.handoff),
      taskRefs: (phase.tasks ?? []).map((task) => taskById.get(task.id) ?? task.id),
      tasks: (phase.tasks ?? []).map((task) => ({
        ref: taskById.get(task.id) ?? task.id,
        title: task.title,
        status: task.status,
        started: Boolean(task.startedAt),
        completed: Boolean(task.completedAt),
      })),
    })),
    requirements: requirements.map((requirement) => ({
      title: requirement.title,
      status: requirement.status,
      linkedPhaseRefs: (requirement.linkedPhaseIds ?? []).map((id) => phaseById.get(id) ?? id),
    })),
    workDeviations: (snapshot.project?.workDeviations ?? []).map((deviation) => ({
      state: deviation.state,
      temporaryTaskRef: taskById.get(deviation.temporaryTaskId) ?? deviation.temporaryTaskId ?? "",
      resumeTaskRef: taskById.get(deviation.resumeTaskId) ?? deviation.resumeTaskId ?? "",
      recommendedTaskRef: taskById.get(deviation.recommendedTaskId) ?? deviation.recommendedTaskId ?? "",
      relatedTaskRef: taskById.get(deviation.snapshot?.relatedTaskId) ?? deviation.snapshot?.relatedTaskId ?? "",
    })),
    resume: normalizeResume(snapshot.resume, { featureById, phaseById, taskById }),
    handoffArchive,
    activityCount: snapshot.activity?.entries?.length ?? 0,
  };
}

function finalizeNormalized({ ok, error, data, text, raw }) {
  const resolvedError = error ?? (ok ? undefined : text || undefined);
  const snapshot = normalizePersistedSnapshot(
    data?.snapshot
      ?? data?.persistedSnapshot
      ?? data?.planSnapshot
      ?? raw?.snapshot,
  );
  const references = extractReferences(data, text);
  return {
    ok,
    error: resolvedError,
    errorCategory: ok ? undefined : classifyError(resolvedError, text),
    status: extractStatus(data, text),
    reference: references[0] ?? undefined,
    references,
    snapshot,
    data,
    text,
    raw,
  };
}

/** ── Normalizers ───────────────────────────────────────────────────────
 * Mechanical conversion of each boundary's raw result into the normalized
 * shape. Harness executors may also return the normalized shape directly.
 */

/** MCP/Pi tool result → normalized. */
export function normalizeToolResult(result) {
  if (result == null) return finalizeNormalized({ ok: false, error: "null result", text: "", data: undefined, raw: result });
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((entry) => (typeof entry === "string" ? entry : entry?.text ?? ""))
    .filter((entry) => typeof entry === "string")
    .join("\n");
  const data = mergePayloads(result.structuredContent, result.details, result.data);
  const inferredCategory = classifyError(result.error, text);
  const ok = result.ok ?? (typeof result.isError === "boolean" ? !result.isError : (inferredCategory == null || inferredCategory === "unknown"));
  return finalizeNormalized({ ok, error: result.error, data, text, raw: result });
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
  const error = ok ? undefined : (json?.message ?? json?.error ?? `HTTP ${response.status}`);
  return finalizeNormalized({
    ok,
    error,
    data: json,
    text: rawText,
    raw: { status: response.status },
  });
}

/** Core executor result (already a plain object) → normalized. */
export function normalizeCoreResult(result) {
  return finalizeNormalized({
    ok: result.ok ?? true,
    error: result.error,
    data: result.data,
    text: result.text ?? "",
    raw: result.raw ?? result,
  });
}

/** Shallow expectation match for JSON-safe data plus predicates/regex. */
function matches(expected, actual) {
  if (typeof expected === "function") return expected(actual);
  if (expected instanceof RegExp) return expected.test(String(actual ?? ""));
  try {
    assert.deepStrictEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}

function assertField(where, label, expected, actual) {
  if (!matches(expected, actual)) {
    throw new Error(
      `${where}: ${label} mismatch — expected ${expected instanceof RegExp ? expected : typeof expected === "function" ? "<predicate>" : JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
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

  if (scenario.expects.errorCategory != null) {
    assertField(where, "errorCategory", scenario.expects.errorCategory, normalized.errorCategory);
  }
  if (scenario.expects.status != null) {
    assertField(where, "status", scenario.expects.status, normalized.status);
  }
  if (scenario.expects.reference != null) {
    assertField(where, "reference", scenario.expects.reference, normalized.reference);
  }
  if (scenario.expects.textIncludes != null) {
    const haystack = normalized.text ?? "";
    const needles = Array.isArray(scenario.expects.textIncludes)
      ? scenario.expects.textIncludes
      : [scenario.expects.textIncludes];
    for (const needle of needles) {
      if (needle instanceof RegExp) assert.match(haystack, needle, `${where}: text missing ${needle}`);
      else assert.ok(haystack.includes(String(needle)), `${where}: text missing ${needle}`);
    }
  }

  const dataChecks = scenario.expects.data;
  if (dataChecks != null) {
    for (const [key, expected] of Object.entries(dataChecks)) {
      assertField(where, `data.${key}`, expected, normalized.data?.[key]);
    }
  }

  const snapshotChecks = scenario.expects.snapshot;
  if (snapshotChecks != null) {
    for (const [key, expected] of Object.entries(snapshotChecks)) {
      assertField(where, `snapshot.${key}`, expected, normalized.snapshot?.[key]);
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
      await runScenario(scenario.id, [harness]);
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
