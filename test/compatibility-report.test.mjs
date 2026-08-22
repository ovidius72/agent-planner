import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  analyzeSurfaceCoverageDrift,
  buildCompatibilityReport,
  renderCompatibilityMarkdown,
} from "../scripts/compatibility-report.mjs";

const root = join(import.meta.dirname, "..");

const FIXTURE_REPORT = buildCompatibilityReport({
  drift: {
    ok: true,
    referencedSurfaceCount: 123,
    deferredSurfaceCount: 2,
    uncoveredSurfaces: [],
    deferredSurfaces: [
      { id: "ui.loader", harness: "ui", kind: "loader", name: "loader", anchor: "x:1", phase: "P059", reason: "Deferred to browser runner" },
      { id: "pi.hostOnly", harness: "pi", kind: "hook", name: "hostOnly", anchor: "y:2", phase: "P059", reason: "Host-only exception" },
    ],
  },
  parityResults: [
    {
      id: "create.feature.missingName",
      title: "create feature with missing name is rejected",
      harnesses: ["api", "mcp", "pi"],
      ok: true,
      mismatches: [],
      normalized: {
        api: { ok: false, errorCategory: "validation", status: null, reference: null, error: "name required", text: "name required", snapshot: null },
        mcp: { ok: false, errorCategory: "validation", status: null, reference: null, error: "name required", text: "name required", snapshot: null },
        pi: { ok: false, errorCategory: "validation", status: null, reference: null, error: "name required", text: "name required", snapshot: null },
      },
    },
  ],
});

test("buildCompatibilityReport summarizes parity, drift, and harness coverage deterministically", () => {
  assert.equal(FIXTURE_REPORT.schemaVersion, 1);
  assert.equal(FIXTURE_REPORT.overallOk, true);
  assert.deepEqual(FIXTURE_REPORT.paritySummary, { total: 1, passed: 1, failed: 0 });
  assert.equal(FIXTURE_REPORT.harnesses.find((entry) => entry.harness === "api").parityPassed, 1);
  assert.equal(FIXTURE_REPORT.harnesses.find((entry) => entry.harness === "ui").status, "inventory-only");
  assert.equal(FIXTURE_REPORT.drift.deferredSurfaceCount, 2);
  assert.equal(JSON.stringify(FIXTURE_REPORT), JSON.stringify(buildCompatibilityReport({
    drift: FIXTURE_REPORT.drift,
    parityResults: [
      {
        id: "create.feature.missingName",
        title: "create feature with missing name is rejected",
        harnesses: ["api", "mcp", "pi"],
        ok: true,
        mismatches: [],
        normalized: {
          api: { ok: false, errorCategory: "validation", status: null, reference: null, error: "name required", text: "name required", snapshot: null },
          mcp: { ok: false, errorCategory: "validation", status: null, reference: null, error: "name required", text: "name required", snapshot: null },
          pi: { ok: false, errorCategory: "validation", status: null, reference: null, error: "name required", text: "name required", snapshot: null },
        },
      },
    ],
  })));
});

test("renderCompatibilityMarkdown includes harness summary, drift section, and parity details", () => {
  const markdown = renderCompatibilityMarkdown(FIXTURE_REPORT);
  assert.match(markdown, /# Cross-harness compatibility report/);
  assert.match(markdown, /Overall: \*\*PASS\*\*/);
  assert.match(markdown, /\| api \|/);
  assert.match(markdown, /No uncovered public surfaces/);
  assert.match(markdown, /create\.feature\.missingName — PASS/);
  assert.match(markdown, /Differences: none after normalization/);
});

test("analyzeSurfaceCoverageDrift returns only explicitly deferred gaps for the current matrix", () => {
  const drift = analyzeSurfaceCoverageDrift();
  assert.equal(drift.ok, true);
  assert.equal(drift.uncoveredSurfaces.length, 0);
  assert.ok(drift.deferredSurfaces.length >= 1);
});

test("CLI: compatibility-report.mjs writes deterministic JSON + Markdown artifacts", { timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ap-compat-report-"));
  try {
    const run = () => spawnSync(process.execPath, ["scripts/compatibility-report.mjs", dir], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    for (const file of ["compatibility-report.json", "compatibility-report.md"]) {
      assert.ok(existsSync(join(dir, file)), `missing artifact ${file}`);
    }
    const report = JSON.parse(readFileSync(join(dir, "compatibility-report.json"), "utf8"));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.overallOk, true);
    assert.equal(report.paritySummary.total >= 10, true);
    assert.equal(report.paritySummary.failed, 0);
    assert.equal(report.drift.ok, true);
    assert.ok(report.harnesses.some((entry) => entry.harness === "ui"), "ui/browser layer summary must be present");
    assert.ok(report.harnesses.some((entry) => entry.harness === "e2e"), "e2e/browser layer summary must be present");
    const markdown = readFileSync(join(dir, "compatibility-report.md"), "utf8");
    assert.match(markdown, /## Harness summary/);
    assert.match(markdown, /## Drift check/);
    assert.match(markdown, /## Parity cases/);

    const beforeJson = readFileSync(join(dir, "compatibility-report.json"), "utf8");
    const beforeMd = readFileSync(join(dir, "compatibility-report.md"), "utf8");
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(join(dir, "compatibility-report.json"), "utf8"), beforeJson);
    assert.equal(readFileSync(join(dir, "compatibility-report.md"), "utf8"), beforeMd);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
