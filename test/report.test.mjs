/**
 * Report generator verification (F015/T227).
 *
 * Verifies the CI report pipeline added by T227:
 *   - scripts/reporters/json.mjs  — node:test custom reporter → results.json
 *   - scripts/report.mjs          — pure generator → report.json + report.html
 *   - scripts/test-all.mjs        — wiring: runs the suite and produces all
 *                                   four artifacts (results.json, coverage.lcov,
 *                                   report.json, report.html)
 *
 * Checks: LCOV parsing correctness (hand-computed fixtures), report schema,
 * HTML content, determinism (same inputs → identical bytes), and a real
 * end-to-end smoke run of the wiring (unit scope, --no-build) asserting the
 * produced files exist and are coherent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildReport, parseLcov, renderHtml } from "../scripts/report.mjs";
import { COVERAGE } from "../test/coverage.config.mjs";

const root = join(import.meta.dirname, "..");

const FIXTURE_LCov = [
  "TN:",
  "SF:packages/plan-core/dist/a.js",
  "FN:1,foo",
  "FN:2,bar",
  "FNDA:1,1,foo",
  "FNDA:0,2,bar",
  "FNF:2",
  "FNH:1",
  "DA:1,1",
  "DA:2,1",
  "DA:3,0",
  "LF:3",
  "LH:2",
  "BRDA:1,0,0,1",
  "BRDA:2,0,0,0",
  "BRF:2",
  "BRH:1",
  "end_of_record",
  "SF:packages/plan-core/dist/b.js",
  "LF:4",
  "LH:4",
  "FNF:1",
  "FNH:1",
  "BRF:0",
  "BRH:0",
  "end_of_record",
].join("\n");

const FIXTURE_RESULTS = {
  schemaVersion: 2,
  summary: { tests: 6, pass: 5, fail: 1, skip: 0, duration_ms: 123 },
  files: [
    { file: "packages/plan-core/test/a.test.mjs", tests: 4, passed: 4, failed: 0, skipped: 0, duration_ms: 50 },
    { file: "packages/plan-core/test/b.test.mjs", tests: 2, passed: 1, failed: 1, skipped: 0, duration_ms: 73 },
  ],
  failures: [{ name: "b rejects invalid input", file: "packages/plan-core/test/b.test.mjs", error: { message: "boom", stack: "at b.test.mjs:3" } }],
};

function buildFixture(scope = "unit") {
  return buildReport({ results: FIXTURE_RESULTS, lcovText: FIXTURE_LCov, scope });
}

test("parseLcov computes per-file line/branch/function percentages", () => {
  const files = parseLcov(FIXTURE_LCov);
  assert.equal(files.length, 2);
  const [a, b] = files;
  // a.js: lines 2/3 → 66.67% · branches 1/2 → 50% · functions 1/2 → 50%
  assert.deepEqual({ ...a.lines }, { found: 3, hit: 2 });
  assert.deepEqual({ ...a.branches }, { found: 2, hit: 1 });
  assert.deepEqual({ ...a.functions }, { found: 2, hit: 1 });
  // b.js: lines 4/4 · branches none (BRF:0 → pct null via buildReport)
  assert.deepEqual({ ...b.lines }, { found: 4, hit: 4 });
  assert.equal(b.branches.found, 0);
  assert.equal(b.branches.hit, 0);
  const report = buildReport({ results: FIXTURE_RESULTS, lcovText: FIXTURE_LCov, scope: "unit" });
  assert.equal(report.files[1].branches.pct, null); // no branches → N/A, not hidden as 0
});

test("buildReport aggregates coverage and preserves test summary (schemaVersion 2)", () => {
  const r = buildFixture();
  assert.equal(r.schemaVersion, 2);
  assert.equal(r.scope, "unit");
  assert.deepEqual(r.summary, { tests: 6, pass: 5, fail: 1, skip: 0, duration_ms: 123 });
  assert.equal(r.testFiles.length, 2);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].message, "boom");
  // aggregated coverage: lines 6/7 = 85.71, functions 2/3 = 66.67, branches 1/2 = 50
  assert.equal(r.coverage.lines, 85.71);
  assert.equal(r.coverage.functions, 66.67);
  assert.equal(r.coverage.branches, 50);
  // baseline thresholds from test/coverage.config.mjs for unit scope
  assert.equal(r.thresholdMode, "baseline");
  assert.equal(r.coverage.thresholds.lines, 79);
  assert.equal(r.coverage.met.lines, true); // 85.71 ≥ 79
  assert.equal(r.coverage.met.functions, false); // 66.67 < 77 → honestly red
  assert.equal(r.coverage.met.branches, false); // 50 < 72 → honestly red
});

test("renderHtml is self-contained and shows summary, failures, and coverage", () => {
  const html = renderHtml(buildFixture());
  assert.match(html, /Test Report/);
  assert.match(html, /PASS|FAIL/);
  assert.match(html, />6<\/b>tests/);
  assert.match(html, /Test files \(2\)/);
  assert.match(html, /b rejects invalid input/);
  assert.match(html, /Coverage by file \(2\)/);
  assert.match(html, /Coverage \(baseline thresholds\)/);
  assert.match(html, /85\.71%/); // lines pct rendered
  assert.match(html, /schemaVersion 2/);
  // deterministic: no timestamps
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(html));
});

test("gated mode: --gate selects FINAL thresholds and labels the HTML report", () => {
  const g = buildReport({ results: FIXTURE_RESULTS, lcovText: FIXTURE_LCov, scope: "unit", gate: true });
  assert.equal(g.thresholdMode, "gate");
  assert.deepEqual(g.thresholds, COVERAGE.gate);
  assert.deepEqual(g.coverage.thresholds, COVERAGE.gate);
  // met computed against the FINAL gate, not the baseline
  assert.equal(g.coverage.met.lines, true); // 85.71 ≥ 80
  assert.equal(g.coverage.met.functions, false); // 66.67 < 80
  assert.equal(g.coverage.met.branches, false); // 50 < 70
  const html = renderHtml(g);
  assert.match(html, /Coverage \(FINAL gate thresholds\)/);
  assert.match(html, /≥ 80%/);
  // baseline mode keeps its label even for the same fixture
  const b = buildReport({ results: FIXTURE_RESULTS, lcovText: FIXTURE_LCov, scope: "unit" });
  assert.equal(b.thresholdMode, "baseline");
  assert.notEqual(JSON.stringify(g), JSON.stringify(b), "modes must produce distinct reports");
});

test("CLI: report.mjs --gate and baseline runs render distinct threshold modes deterministically", () => {
  const dir = mkdtempSync(join(tmpdir(), "ap-report-mode-"));
  try {
    const resultsFile = join(dir, "results.json");
    const lcovFile = join(dir, "coverage.lcov");
    writeFileSync(resultsFile, JSON.stringify(FIXTURE_RESULTS));
    writeFileSync(lcovFile, FIXTURE_LCov);
    const run = (args) => spawnSync(process.execPath, ["scripts/report.mjs", resultsFile, lcovFile, join(dir, args.gate ? "gated" : "base"), "--scope", "unit", ...(args.gate ? ["--gate"] : [])], { cwd: root, encoding: "utf8" });
    const base = run({ gate: false });
    assert.equal(base.status, 0, base.stderr);
    const gated = run({ gate: true });
    assert.equal(gated.status, 0, gated.stderr);
    const baseJson = JSON.parse(readFileSync(join(dir, "base", "report.json"), "utf8"));
    const gatedJson = JSON.parse(readFileSync(join(dir, "gated", "report.json"), "utf8"));
    assert.equal(baseJson.thresholdMode, "baseline");
    assert.deepEqual(baseJson.coverage.thresholds, COVERAGE.baseline.unit);
    assert.equal(gatedJson.thresholdMode, "gate");
    assert.deepEqual(gatedJson.coverage.thresholds, COVERAGE.gate);
    assert.match(gated.stdout, /\(FINAL gate\)/);
    assert.match(readFileSync(join(dir, "gated", "report.html"), "utf8"), /FINAL gate thresholds/);
    assert.match(readFileSync(join(dir, "base", "report.html"), "utf8"), /baseline thresholds/);
    // both modes deterministic: identical inputs + same flag → identical bytes
    const rerun = spawnSync(process.execPath, ["scripts/report.mjs", resultsFile, lcovFile, join(dir, "gated2"), "--scope", "unit", "--gate"], { cwd: root, encoding: "utf8" });
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(
      readFileSync(join(dir, "gated", "report.json"), "utf8"),
      readFileSync(join(dir, "gated2", "report.json"), "utf8"),
    );
    assert.equal(
      readFileSync(join(dir, "gated", "report.html"), "utf8"),
      readFileSync(join(dir, "gated2", "report.html"), "utf8"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report generation is deterministic: identical inputs → identical bytes", () => {
  const a = buildFixture();
  const b = buildFixture();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(renderHtml(a), renderHtml(b));
  // write to disk twice and compare bytes
  const dir = mkdtempSync(join(tmpdir(), "ap-report-det-"));
  try {
    const run = (out) => {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "report.json"), JSON.stringify(a, null, 2) + "\n");
      writeFileSync(join(out, "report.html"), renderHtml(a));
    };
    run(join(dir, "r1"));
    run(join(dir, "r2"));
    assert.equal(readFileSync(join(dir, "r1", "report.json"), "utf8"), readFileSync(join(dir, "r2", "report.json"), "utf8"));
    assert.equal(readFileSync(join(dir, "r1", "report.html"), "utf8"), readFileSync(join(dir, "r2", "report.html"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("end-to-end: test-all.mjs unit --no-build emits all four report artifacts", { timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ap-report-e2e-"));
  try {
    // strip NODE_TEST_CONTEXT: node --test sets it on children and the
    // recursion guard would make the spawned test-all skip its own test files.
    // Isolate NODE_V8_COVERAGE: node --test inherits it into descendants and
    // aggregates profiles from that dir — without isolation the nested unit
    // run's profiles would merge into this integration run's coverage.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    if (env.NODE_V8_COVERAGE) env.NODE_V8_COVERAGE = join(dir, "nested-v8");
    const res = spawnSync(process.execPath, ["scripts/test-all.mjs", "unit", "--no-build", "--report-dir", dir], {
      cwd: root,
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(res.status, 0, `test-all must exit 0 (unit baseline green)\n${res.stderr}`);
    // regression guard: the reporter wiring must not trip node's
    // MaxListenersExceededWarning (a 3rd reporter added ~4 'end' listeners
    // to the TestsStream per reporter → 11 > 10). The lcov output is now
    // emitted by the json reporter itself, so test-all attaches only two.
    assert.doesNotMatch(res.stderr ?? "", /MaxListenersExceededWarning/, "no event-loop listener warning in test-all output");
    for (const f of ["results.json", "coverage.lcov", "report.json", "report.html"]) {
      assert.ok(existsSync(join(dir, f)), `missing artifact ${f}`);
    }
    const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8"));
    assert.equal(results.schemaVersion, 2);
    assert.ok(results.summary.tests >= 1, "results.json must report at least one test");
    assert.equal(results.summary.fail, 0, "unit suite must be green");
    // results.json count must match the spec reporter's count (both from test:summary)
    assert.equal(results.summary.pass, results.summary.tests);
    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.scope, "unit");
    assert.equal(report.summary.tests, results.summary.tests, "report.json summary must match results.json");
    assert.ok(report.coverage.lines != null && report.coverage.functions != null, "coverage percentages must be present");
    assert.ok(report.coverage.met.lines && report.coverage.met.functions && report.coverage.met.branches, "baseline coverage must be met");
    const html = readFileSync(join(dir, "report.html"), "utf8");
    assert.match(html, /Test Report — unit/);
    assert.match(html, /PASS/);
    // coverage in the report must reflect the real run (no hiding): all files row
    assert.ok(report.files.length >= 1, "coverage by file must be non-empty");
    // LCOV artifact is standard format with full line-level detail
    const lcov = readFileSync(join(dir, "coverage.lcov"), "utf8");
    assert.match(lcov, /^SF:/m);
    assert.match(lcov, /^DA:/m, "LCOV must carry line-level DA records (full detail for external tools)");
    assert.match(lcov, /end_of_record$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
