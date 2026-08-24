#!/usr/bin/env node
/**
 * Unified test runner + coverage gate (F015/T227, extended by P060/T257).
 *
 * Usage:
 *   node scripts/test-all.mjs [unit|integration|all] [--gate] [--no-build]
 *   node scripts/test-all.mjs unit --package <plan-core|plan-server|plan-mcp|pi-adapter|agent-plan|plan-web-ui>
 *
 *   unit        — package-local tests only (packages test dirs)
 *   integration — root integration suite only (test/)
 *   all         — both (default)
 *   --gate      — enforce the FINAL coverage thresholds (CI); without it the
 *                 BASELINE thresholds are reported but not enforced
 *   --no-build  — skip the tsc build step (use when dist is already fresh)
 *   --package   — limit UNIT scope to one package's tests + coverage surface
 *   --report-dir <dir> — write CI reports (results.json, coverage.lcov,
 *                 report.json, report.html) into <dir>
 *                 (default reports/<scope>[/<package>])
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
const packageArg = args.indexOf("--package");
const packageName = packageArg !== -1 ? args[packageArg + 1] : "";

const PACKAGE_ORDER = ["plan-core", "plan-server", "plan-mcp", "pi-adapter", "agent-plan"];
const ALL_PACKAGES = [...PACKAGE_ORDER, "plan-web-ui"];
const PKG_FILTER = {
  "plan-core": "@agent-plan/core",
  "plan-server": "@agent-plan/server",
  "plan-mcp": "@agent-plan/mcp",
  "pi-adapter": "@agent-plan/pi-adapter",
  "agent-plan": "agent-plan",
  "plan-web-ui": "@agent-plan/web-ui",
};
const PACKAGE_DIR = {
  "plan-core": "plan-core",
  "plan-server": "plan-server",
  "plan-mcp": "plan-mcp",
  "pi-adapter": "pi-adapter",
  "agent-plan": "agent-plan",
  "plan-web-ui": "plan-web-ui",
};
const BUILD_REQUIREMENTS = {
  "plan-core": ["plan-core"],
  "plan-server": ["plan-core", "plan-server"],
  "plan-mcp": ["plan-core", "plan-server", "plan-mcp"],
  "pi-adapter": ["plan-core", "plan-server", "pi-adapter"],
  "agent-plan": ["plan-core", "plan-server", "plan-mcp", "agent-plan"],
  "plan-web-ui": [],
};

if (packageName && !ALL_PACKAGES.includes(packageName)) {
  console.error(`[test-all] unknown package '${packageName}'. Expected one of: ${ALL_PACKAGES.join(", ")}`);
  process.exit(2);
}
if (packageName && scope !== "unit") {
  console.error("[test-all] --package is supported only for unit scope.");
  process.exit(2);
}
if (packageName === "plan-web-ui" && gate) {
  console.error("[test-all] package-scoped coverage gating for plan-web-ui is not supported by the Node/V8 runner; use the workspace coverage gate instead.");
  process.exit(2);
}

const reportDir = resolve(
  root,
  reportArg !== -1 ? args[reportArg + 1] : `reports/${scope}${packageName ? `/${packageName}` : ""}`,
);

function selectedNodePackages() {
  if (packageName === "plan-web-ui") return [];
  return packageName ? [packageName] : PACKAGE_ORDER;
}

function buildTargets() {
  if (!packageName) return PACKAGE_ORDER;
  return BUILD_REQUIREMENTS[packageName] ?? [];
}

function collectTests() {
  const files = [];
  if (scope !== "integration") {
    for (const pkg of selectedNodePackages()) {
      const dir = join(root, "packages", PACKAGE_DIR[pkg], "test");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".test.mjs")) files.push(join(dir, f));
      }
    }
    if (!packageName || packageName === "plan-web-ui") {
      const uiDir = join(root, "packages", "plan-web-ui", "test");
      if (existsSync(uiDir)) {
        for (const f of readdirSync(uiDir)) {
          if (f.endsWith(".test.mjs")) files.push(join(uiDir, f));
        }
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
  const targets = buildTargets();
  if (targets.length === 0) {
    console.log("[test-all] no build targets for this run");
    return;
  }
  console.log(`[test-all] building ${targets.join(", ")} …`);
  for (const pkg of targets) {
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

async function runWebUiComponentTests() {
  if (scope === "integration") return 0;
  if (packageName && packageName !== "plan-web-ui") return 0;
  console.log("[test-all] running Web UI component tests …");
  const child = spawn("pnpm", ["--filter", "@agent-plan/web-ui", "exec", "vitest", "run"], {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
    shell: false,
  });
  return await new Promise((resolve) => child.on("close", resolve));
}

async function main() {
  if (!noBuild) await build();

  const files = collectTests();
  if (files.length === 0 && !(scope === "unit" && packageName === "plan-web-ui")) {
    console.error("[test-all] no test files found for scope", scope, packageName ? `(package ${packageName})` : "");
    process.exit(1);
  }

  const flags = coverageFlags({ gate, scope, packages: packageName ? [packageName] : undefined });
  const label = gate ? "FINAL gate" : "baseline (no gate)";
  const t = gate ? COVERAGE.gate : COVERAGE.baseline[scope] ?? COVERAGE.baseline.all;
  console.log(`[test-all] scope=${scope} files=${files.length} coverage=${label}${packageName ? ` package=${packageName}` : ""}`);
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

  const env = { ...process.env, REPORT_LCOV_PATH: lcovFile };

  let code = 0;
  if (files.length > 0) {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--test", ...flags, ...reporterFlags, ...files],
      { cwd: root, stdio: ["ignore", "inherit", "inherit"], env },
    );
    code = await new Promise((resolve) => child.on("close", resolve));
  }
  const webUiCode = await runWebUiComponentTests();

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

  if (code !== 0 || webUiCode !== 0) {
    const exitCode = code !== 0 ? code : webUiCode;
    console.error(`[test-all] FAILED (exit ${exitCode})${gate ? "" : " — run with --gate in CI to enforce final thresholds"}`);
    process.exit(exitCode ?? 1);
  }
  console.log("[test-all] OK");
}

main().catch((err) => {
  console.error("[test-all] fatal:", err);
  process.exit(1);
});
