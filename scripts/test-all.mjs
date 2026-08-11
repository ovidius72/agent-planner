#!/usr/bin/env node
/**
 * Unified test runner + coverage gate (F015/T227).
 *
 * Usage:
 *   node scripts/test-all.cjs [unit|integration|all] [--gate] [--no-build]
 *
 *   unit        — package-local tests only (packages test dirs)
 *   integration — root integration suite only (test/)
 *   all         — both (default)
 *   --gate      — enforce the FINAL coverage thresholds (CI); without it the
 *                 BASELINE thresholds are reported but not enforced
 *   --no-build  — skip the tsc build step (use when dist is already fresh)
 *   --report-dir <dir> — write CI reports (results.json, coverage.lcov,
 *                 report.json, report.html) into <dir> (default reports/<scope>)
 *
 * Reports: the run always emits a normalized JSON results file (custom
 * reporter) + LCOV coverage (node lcov reporter); scripts/report.mjs then
 * renders deterministic report.json + report.html from those. Generated even
 * on failure so CI can inspect what broke.
 *
 * Coverage policy lives in test/coverage.config.mjs (include/exclude/thresholds).
 */

import { spawn, spawnSync } from "node:child_process";
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COVERAGE, coverageFlags } from "../test/coverage.config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const args = process.argv.slice(2);
const scope = args.includes("unit") ? "unit" : args.includes("integration") ? "integration" : "all";
const gate = args.includes("--gate");
const noBuild = args.includes("--no-build");
const reportArg = args.indexOf("--report-dir");
const reportDir = resolve(root, reportArg !== -1 ? args[reportArg + 1] : `reports/${scope}`);

const PACKAGES = ["plan-core", "plan-server", "plan-mcp", "pi-adapter", "agent-plan"];
const PKG_FILTER = {
  "plan-core": "@agent-plan/core",
  "plan-server": "@agent-plan/server",
  "plan-mcp": "@agent-plan/mcp",
  "pi-adapter": "@agent-plan/pi-adapter",
  "agent-plan": "agent-plan",
};

function collectTests() {
  const files = [];
  if (scope !== "integration") {
    for (const pkg of PACKAGES) {
      const dir = join(root, "packages", pkg, "test");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".test.mjs")) files.push(join(dir, f));
      }
    }
    // web-ui unit tests (strip-types)
    const uiDir = join(root, "packages", "plan-web-ui", "test");
    if (existsSync(uiDir)) {
      for (const f of readdirSync(uiDir)) {
        if (f.endsWith(".test.mjs")) files.push(join(uiDir, f));
      }
    }
  }
  if (scope !== "unit") {
    const dir = join(root, "test");
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".test.mjs")) files.push(join(dir, f));
    }
  }
  return files;
}

async function build() {
  console.log(`[test-all] building ${PACKAGES.join(", ")} …`);
  for (const pkg of PACKAGES) {
    const child = spawn("pnpm", ["--filter", PKG_FILTER[pkg], "build"], {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
    });
    const code = await new Promise((resolve) => child.on("close", resolve));
    if (code !== 0) {
      console.error(`[test-all] build failed for ${pkg}`);
      process.exit(code ?? 1);
    }
  }
  console.log("[test-all] build OK");
}

async function main() {
  if (!noBuild) await build();

  const files = collectTests();
  if (files.length === 0) {
    console.error("[test-all] no test files found for scope", scope);
    process.exit(1);
  }

  const flags = coverageFlags({ gate, scope });
  const label = gate ? "FINAL gate" : "baseline (no gate)";
  const t = gate ? COVERAGE.gate : COVERAGE.baseline[scope] ?? COVERAGE.baseline.all;
  console.log(`[test-all] scope=${scope} files=${files.length} coverage=${label}`);
  console.log(`[test-all] thresholds lines=${t.lines} functions=${t.functions} branches=${t.branches}`);
  console.log(`[test-all] reports → ${reportDir}/report.{json,html}`);

  mkdirSync(reportDir, { recursive: true });
  const resultsFile = join(reportDir, "results.json");
  const lcovFile = join(reportDir, "coverage.lcov");
  const reporterFlags = [
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=./scripts/reporters/json.mjs",
    `--test-reporter-destination=${resultsFile}`,
  ];

  // The json reporter writes coverage.lcov itself (REPORT_LCOV_PATH) from the
  // test:coverage event. Keeping LCOV inside one reporter avoids a THIRD
  // --test-reporter: node's compose+pipe wiring adds ~4 'end' listeners to the
  // TestsStream per reporter, and 3 reporters trip MaxListenersExceededWarning
  // (11 > 10) — a noisy warning we do not want in CI output.
  const env = { ...process.env, REPORT_LCOV_PATH: lcovFile };

  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--test", ...flags, ...reporterFlags, ...files],
    { cwd: root, stdio: ["ignore", "inherit", "inherit"], env },
  );
  const code = await new Promise((resolve) => child.on("close", resolve));

  // Reports are generated even on failure (CI inspects what broke); the
  // original exit code is preserved.
  try {
    const gen = spawnSync(process.execPath, ["scripts/report.mjs", resultsFile, lcovFile, reportDir, "--scope", scope, ...(gate ? ["--gate"] : [])], {
      cwd: root,
      encoding: "utf8",
    });
    if (gen.status === 0) process.stdout.write(gen.stdout);
    else console.error(`[test-all] report generation failed (exit ${gen.status ?? gen.error?.message}): ${gen.stderr}`);
  } catch (err) {
    console.error(`[test-all] report generation failed: ${err.message}`);
  }

  if (code !== 0) {
    console.error(`[test-all] FAILED (exit ${code})${gate ? "" : " — run with --gate in CI to enforce final thresholds"}`);
    process.exit(code ?? 1);
  }
  console.log("[test-all] OK");
}

main().catch((err) => {
  console.error("[test-all] fatal:", err);
  process.exit(1);
});
