/**
 * P052 foundation consistency test (F015).
 *
 * Validates that the surface inventory, scenario matrix, fixtures, and runner
 * are coherent: unique ids, valid enum values, fixture names exist, surface
 * references resolve, and expectation contracts are well-formed. Runs with the
 * real PlanStore/filesystem via the shared fixtures — no mocks.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { surfacesByHarness, surfaceById, surfaceCount } from "./surfaces.mjs";
import { scenarios, scenarioById, scenariosByGroup, scenarioCount, scenariosForHarness } from "./scenario-matrix.mjs";
import { createPlannerFixture, readPlanSnapshot, cleanupFixtures, trackedRoots, BASE_TIME } from "./helpers/fixtures.mjs";
import { registerExecutor, missingExecutors, assertScenarioExpectations, normalizeToolResult } from "./helpers/runner.mjs";

after(async () => {
  await cleanupFixtures();
});

test("surface inventory is coherent", () => {
  assert.ok(surfaceCount() >= 200, `expected >=200 surfaces, got ${surfaceCount()}`);
  const ids = [];
  for (const list of Object.values(surfacesByHarness)) {
    for (const entry of list) {
      assert.ok(entry.id, "surface id required");
      assert.ok(entry.kind, "surface kind required");
      assert.ok(entry.name, "surface name required");
      ids.push(entry.id);
    }
  }
  assert.equal(new Set(ids).size, ids.length, "surface ids must be unique");
  for (const id of ids) assert.ok(surfaceById.has(id), `surfaceById missing ${id}`);
});

test("scenario matrix is coherent", () => {
  assert.ok(scenarioCount() >= 40, `expected >=40 scenarios, got ${scenarioCount()}`);
  const ids = scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "scenario ids must be unique");
  for (const s of scenarios) {
    assert.ok(s.title, `${s.id}: title required`);
    assert.ok(s.group, `${s.id}: group required`);
    assert.ok(s.expects && typeof s.expects === "object", `${s.id}: expects required`);
    assert.ok(Array.isArray(s.harnesses) && s.harnesses.length > 0, `${s.id}: harnesses required`);
    for (const h of s.harnesses) {
      assert.ok(["core", "api", "mcp", "pi", "ui", "e2e"].includes(h), `${s.id}: bad harness ${h}`);
    }
    for (const surfaceId of s.surfaces ?? []) {
      assert.ok(surfaceById.has(surfaceId), `${s.id}: unknown surface ref ${surfaceId}`);
    }
  }
  // Every group must contain at least one scenario and every scenario belongs to a group.
  assert.deepEqual(
    [...new Set(scenarios.map((s) => s.group))].sort(),
    Object.keys(scenariosByGroup).sort(),
    "group index must match scenario groups",
  );
});

test("every surface is covered by a scenario or explicitly deferred", () => {
  const used = new Set();
  for (const s of scenarios) for (const sid of s.surfaces ?? []) used.add(sid);
  const all = Object.values(surfacesByHarness).flat();
  const f015Phases = new Set(["P052", "P053", "P054", "P055", "P056", "P057", "P058", "P059", "P060"]);
  const silentlyUncovered = all.filter((entry) => !used.has(entry.id) && !entry.coverage);
  assert.equal(
    silentlyUncovered.length,
    0,
    `silently uncovered surfaces (no scenario, no coverage field): ${silentlyUncovered.map((e) => e.id).join(", ")}`,
  );
  for (const entry of all) {
    if (used.has(entry.id)) continue;
    assert.ok(entry.coverage, `${entry.id}: no scenario covers it and no coverage field`);
    assert.match(entry.coverage.phase, /^P\d{3}$/, `${entry.id}: coverage.phase malformed: ${entry.coverage.phase}`);
    assert.ok(f015Phases.has(entry.coverage.phase), `${entry.id}: coverage.phase ${entry.coverage.phase} is not an F015 phase`);
    assert.ok(
      entry.coverage.reason && entry.coverage.reason.length >= 10,
      `${entry.id}: coverage.reason required (>=10 chars)`,
    );
  }
  assert.ok(used.size >= 120, `matrix should reference >=120 surfaces, got ${used.size}`);
});

test("every declared harness has at least one matching surface", () => {
  for (const s of scenarios) {
    for (const h of s.harnesses) {
      if (h === "core") continue; // core helpers exercised transitively via boundaries
      const prefix = h === "e2e" ? "ui" : h;
      const matching = (s.surfaces ?? []).filter((sid) => sid.startsWith(`${prefix}.`));
      assert.ok(
        matching.length >= 1,
        `${s.id}: harness "${h}" declared but no surface with prefix "${prefix}." in [${(s.surfaces ?? []).join(",")}]`,
      );
    }
  }
});

test("scenario surfaces are consistent with their harnesses", () => {
  for (const s of scenarios) {
    for (const sid of s.surfaces ?? []) {
      const prefix = sid.split(".")[0];
      if (prefix === "core") continue; // core helpers are exercised transitively via boundaries
      const ok =
        prefix === "ui"
          ? s.harnesses.includes("ui") || s.harnesses.includes("e2e")
          : s.harnesses.includes(prefix);
      assert.ok(ok, `${s.id}: surface ${sid} not consistent with harnesses [${s.harnesses.join(",")}]`);
    }
  }
});

test("all fixture names referenced by scenarios exist", async () => {
  const known = new Set(["empty", "minimal", "full", "terminal", "resume-needed", "legacy-single-file"]);
  for (const s of scenarios) {
    assert.ok(known.has(s.fixture), `${s.id}: unknown fixture "${s.fixture}"`);
  }
  // Smoke: create every known fixture with the real store.
  for (const seed of known) {
    const fixture = await createPlannerFixture({ name: `consistency-${seed}`, seed });
    const snapshot = await readPlanSnapshot(fixture.planRoot);
    assert.ok(snapshot.manifest, `${seed}: manifest missing`);
    assert.ok(snapshot.project, `${seed}: project missing`);
    assert.ok(snapshot.requirements, `${seed}: requirements missing`);
    await fixture.store.repair(); // must not throw on any seed
  }
});

test("fixtures produce expected entity counts", async () => {
  const minimal = await createPlannerFixture({ name: "counts-minimal", seed: "minimal" });
  assert.equal((await minimal.store.loadFeatures()).features.length, 1);
  assert.equal((await minimal.store.loadAllPhases()).length, 1);
  const full = await createPlannerFixture({ name: "counts-full", seed: "full" });
  assert.equal((await full.store.loadFeatures()).features.length, 3);
  const phases = await full.store.loadAllPhases();
  assert.equal(phases.length, 5);
  assert.equal(phases.reduce((n, p) => n + p.tasks.length, 0), 7);
  assert.equal((await full.store.listHandoffs()).length, 1, "full: one pending handoff");
  assert.equal((await full.store.listArchivedHandoffs()).length, 1, "full: one archived handoff");
});

test("deterministic timestamps in fixtures", async () => {
  const a = await createPlannerFixture({ name: "det-a", seed: "minimal" });
  const b = await createPlannerFixture({ name: "det-b", seed: "minimal" });
  const [phasesA, phasesB] = [await a.store.loadAllPhases(), await b.store.loadAllPhases()];
  assert.equal(phasesA[0].createdAt, BASE_TIME);
  assert.equal(phasesB[0].createdAt, BASE_TIME);
  assert.equal(phasesA[0].tasks[0].title, phasesB[0].tasks[0].title);
});

test("runner: expectations and normalization", async () => {
  // normalizeToolResult handles MCP/Pi wire format
  const n = normalizeToolResult({ content: [{ type: "text", text: "✅ ok" }], structuredContent: { a: 1 } });
  assert.equal(n.ok, true);
  assert.equal(n.text, "✅ ok");
  assert.deepEqual(n.data, { a: 1 });

  await assertScenarioExpectations(
    { id: "t", harnesses: ["core"], expects: { ok: false, errorMatch: /motivation/ } },
    { ok: false, error: "requires a motivation" },
    {},
  );

  // Failure path surfaces a descriptive error
  assert.throws(
    () => assertScenarioExpectations(
      { id: "t", harnesses: ["core"], expects: { ok: true, data: { n: (v) => v === 3 } } },
      { ok: true, data: { n: 5 } },
      {},
    ),
    /data\.n mismatch/,
  );
});

test("executor registry is query-safe; per-harness executors land with P053–P059", () => {
  // P052 ships the registry + guards (see registerExecutor test below). Harness
  // executors are registered by the owning phases: api→P054, mcp→P055, pi→P056,
  // ui/e2e→P057–P059. This test only pins what P052 guarantees — the matrix
  // declares scenarios for every harness and the query is shape-safe — so it
  // stays green both now (no executors registered) and after P053–P059 land
  // (missing shrinks, assertions still hold). Full registration coverage is
  // asserted by each harness runner's own test in its owning phase.
  for (const harness of ["api", "mcp", "pi"]) {
    const scenarios = scenariosForHarness(harness);
    const missing = missingExecutors(harness);
    assert.ok(Array.isArray(missing), `${harness}: missingExecutors must return an array`);
    assert.ok(scenarios.length >= 1, `${harness}: matrix must declare scenarios for this harness`);
    for (const id of missing) {
      assert.ok(
        scenarios.some((s) => s.id === id),
        `${harness}: missing id "${id}" is not a declared scenario for this harness`,
      );
    }
  }
  // e2e scenarios are declared for the Playwright runner (P058/P059)
  assert.ok(scenariosForHarness("e2e").length >= 3, "e2e scenarios must exist");
});

test("fixture cleanup drains the registry", async () => {
  const before = trackedRoots().length;
  await createPlannerFixture({ name: "cleanup-me", seed: "minimal" });
  await createPlannerFixture({ name: "cleanup-me2", seed: "full" });
  assert.ok(trackedRoots().length >= before + 2, "registry must grow");
  await cleanupFixtures();
  assert.equal(trackedRoots().length, 0, "registry must drain after cleanup");
});

test("registerExecutor guards unknown harnesses and scenarios", () => {
  assert.throws(() => registerExecutor("nope", "bootstrap.init.valid", async () => ({ ok: true })), /Unknown harness/);
  assert.throws(() => registerExecutor("core", "nope.scenario", async () => ({ ok: true })), /Unknown scenario/);
});
