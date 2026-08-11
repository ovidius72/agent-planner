#!/usr/bin/env node
/**
 * Deterministic test-report generator (F015/T227).
 *
 * Reads node:test JSON results (scripts/reporters/json.mjs, schemaVersion 2)
 * + LCOV coverage and writes:
 *   <out-dir>/report.json   — machine-readable, stable schema
 *   <out-dir>/report.html   — self-contained page (no external assets, no JS)
 *
 * Purity contract: same inputs → byte-identical outputs. No timestamps, no
 * randomness, no environment-dependent formatting. Determinism is verified by
 * test/report.test.mjs (two runs on identical inputs must produce identical
 * bytes).
 *
 * Usage:
 *   node scripts/report.mjs <results.json> <coverage.lcov> <out-dir> --scope <unit|integration|all>
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { COVERAGE } from "../test/coverage.config.mjs";

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scope") flags.scope = argv[++i];
    else if (a === "--gate") flags.gate = true;
    else pos.push(a);
  }
  const [resultsJson, coverageLcov, outDir] = pos;
  return { resultsJson, coverageLcov, outDir, scope: flags.scope ?? "all", gate: flags.gate ?? false };
}

/** ── LCOV (node --test-reporter=lcov) parsing ───────────────────────── */
export function parseLcov(text) {
  const files = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      cur = { path: line.slice(3), lines: { found: 0, hit: 0 }, functions: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 } };
      files.push(cur);
    } else if (!cur) continue;
    else if (line === "end_of_record") cur = null;
    else if (line.startsWith("LF:")) cur.lines.found = Number(line.slice(3));
    else if (line.startsWith("LH:")) cur.lines.hit = Number(line.slice(3));
    else if (line.startsWith("FNF:")) cur.functions.found = Number(line.slice(4));
    else if (line.startsWith("FNH:")) cur.functions.hit = Number(line.slice(4));
    else if (line.startsWith("BRF:")) cur.branches.found = Number(line.slice(4));
    else if (line.startsWith("BRH:")) cur.branches.hit = Number(line.slice(4));
  }
  return files;
}

const pct = (hit, found) => (found > 0 ? Number(((hit / found) * 100).toFixed(2)) : null);

/** Build the report document from inputs (pure). `gate` selects the FINAL
 *  thresholds (COVERAGE.gate) and labels the report accordingly; without it
 *  the BASELINE thresholds for the scope are used. Deterministic in both
 *  modes: same inputs + same gate flag → identical bytes. */
export function buildReport({ results, lcovText, scope, gate = false }) {
  const thresholdMode = gate ? "gate" : "baseline";
  const thresholds = gate ? COVERAGE.gate : COVERAGE.baseline[scope] ?? COVERAGE.baseline.all;
  const files = parseLcov(lcovText ?? "")
    .map((f) => ({
      path: f.path,
      lines: { found: f.lines.found, hit: f.lines.hit, pct: pct(f.lines.hit, f.lines.found) },
      functions: { found: f.functions.found, hit: f.functions.hit, pct: pct(f.functions.hit, f.functions.found) },
      branches: { found: f.branches.found, hit: f.branches.hit, pct: pct(f.branches.hit, f.branches.found) },
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const cov = files.reduce(
    (acc, f) => {
      for (const k of ["lines", "functions", "branches"]) {
        acc[k].found += f[k].found;
        acc[k].hit += f[k].hit;
      }
      return acc;
    },
    { lines: { found: 0, hit: 0 }, functions: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 } },
  );
  const coverage = {
    lines: pct(cov.lines.hit, cov.lines.found),
    functions: pct(cov.functions.hit, cov.functions.found),
    branches: pct(cov.branches.hit, cov.branches.found),
    thresholds,
    met: {
      lines: pct(cov.lines.hit, cov.lines.found) != null && pct(cov.lines.hit, cov.lines.found) >= thresholds.lines,
      functions: pct(cov.functions.hit, cov.functions.found) != null && pct(cov.functions.hit, cov.functions.found) >= thresholds.functions,
      branches: pct(cov.branches.hit, cov.branches.found) != null && pct(cov.branches.hit, cov.branches.found) >= thresholds.branches,
    },
  };

  const summary = {
    tests: results.summary?.tests ?? 0,
    pass: results.summary?.pass ?? 0,
    fail: results.summary?.fail ?? 0,
    skip: results.summary?.skip ?? 0,
    duration_ms: results.summary?.duration_ms ?? 0,
  };
  const failures = (results.failures ?? []).map((t) => ({ name: t.name, file: t.file ?? "", message: t.error?.message ?? "" }));
  const testFiles = (results.files ?? []).map((f) => ({
    file: f.file ?? "",
    tests: f.tests ?? 0,
    passed: f.passed ?? 0,
    failed: f.failed ?? 0,
    skipped: f.skipped ?? 0,
    duration_ms: f.duration_ms ?? 0,
  }));

  return { schemaVersion: 2, scope, thresholdMode, thresholds, coverage, summary, failures, files, testFiles };
}

/** ── HTML rendering (self-contained, deterministic) ─────────────────── */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function bar(p, ok) {
  const w = p == null ? 0 : Math.round(Math.max(0, Math.min(100, p)));
  return `<span class="bar"><span class="fill ${ok ? "ok" : "bad"}" style="width:${w}%"></span></span>`;
}

export function renderHtml(report) {
  const { coverage, summary, failures, files, testFiles, scope } = report;
  const t = (v, threshold) => {
    const ok = v != null && v >= threshold;
    return `<td class="${ok ? "ok" : "bad"}">${v == null ? "N/A" : `${v.toFixed(2)}%`}</td>`;
  };
  const rows = files
    .map(
      (f) => `<tr>
        <td class="file">${esc(f.path)}</td>
        ${t(f.lines.pct, coverage.thresholds.lines)}
        ${t(f.branches.pct, coverage.thresholds.branches)}
        ${t(f.functions.pct, coverage.thresholds.functions)}
        <td>${bar(f.lines.pct, f.lines.pct != null && f.lines.pct >= coverage.thresholds.lines)}</td>
      </tr>`,
    )
    .join("\n");

  const failRows = failures
    .map((f) => `<li class="fail"><code>${esc(f.name)}</code>${f.file ? ` <span class="muted">(${esc(f.file)})</span>` : ""}<div class="msg">${esc(f.message)}</div></li>`)
    .join("\n");

  const fileRows = testFiles
    .map((f) => `<tr><td class="file">${esc(f.file)}</td><td class="num">${f.tests}</td><td class="num ok">${f.passed}</td><td class="num ${f.failed > 0 ? "bad" : "ok"}">${f.failed}</td><td class="num">${f.skipped}</td><td class="num">${f.duration_ms}ms</td></tr>`)
    .join("\n");

  const status = summary.fail === 0 ? "PASS" : "FAIL";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Test Report — ${esc(scope)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem auto; max-width: 960px; padding: 0 1rem; }
  h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; margin-top: 2rem; border-bottom: 1px solid #8884; padding-bottom: .3rem; }
  .status { font-weight: 700; padding: .25rem .6rem; border-radius: 4px; }
  .status.PASS { background: #1a7f3733; color: #2ea043; } .status.FAIL { background: #d1242f33; color: #f85149; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #8884; padding: .3rem .5rem; text-align: left; }
  th.num, td.num { text-align: right; } td.ok { color: #2ea043; } td.bad { color: #f85149; }
  .bar { display: inline-block; width: 120px; height: 10px; background: #8884; border-radius: 5px; overflow: hidden; vertical-align: middle; }
  .fill { display: block; height: 100%; } .fill.ok { background: #2ea043; } .fill.bad { background: #f85149; }
  .cards { display: flex; gap: 1rem; flex-wrap: wrap; } .card { border: 1px solid #8884; border-radius: 8px; padding: .6rem 1rem; }
  .card b { font-size: 1.6rem; display: block; } .muted { color: #888; } .msg { margin: .3rem 0 .6rem; color: #f85149; white-space: pre-wrap; }
  ul.failures { padding-left: 1.2rem; } footer { margin-top: 3rem; color: #888; font-size: .8rem; }
</style></head><body>
<h1>Test Report — <span class="status ${status}">${status}</span> <span class="muted">scope: ${esc(scope)}</span></h1>
<div class="cards">
  <div class="card"><b>${summary.tests}</b>tests</div>
  <div class="card"><b>${summary.pass}</b>passed</div>
  <div class="card"><b>${summary.fail}</b>failed</div>
  <div class="card"><b>${summary.skip}</b>skipped</div>
  <div class="card"><b>${summary.duration_ms}ms</b>duration</div>
</div>
<h2>Coverage (${report.thresholdMode === "gate" ? "FINAL gate" : "baseline"} thresholds)</h2>
<table>
  <tr><th>Metric</th><th class="num">Measured</th><th class="num">Threshold</th><th>Status</th></tr>
  <tr><td>Lines</td><td class="num ${coverage.met.lines ? "ok" : "bad"}">${coverage.lines == null ? "N/A" : `${coverage.lines.toFixed(2)}%`}</td><td class="num">≥ ${coverage.thresholds.lines}%</td><td>${coverage.met.lines ? "✓" : "✗"}</td></tr>
  <tr><td>Branches</td><td class="num ${coverage.met.branches ? "ok" : "bad"}">${coverage.branches == null ? "N/A" : `${coverage.branches.toFixed(2)}%`}</td><td class="num">≥ ${coverage.thresholds.branches}%</td><td>${coverage.met.branches ? "✓" : "✗"}</td></tr>
  <tr><td>Functions</td><td class="num ${coverage.met.functions ? "ok" : "bad"}">${coverage.functions == null ? "N/A" : `${coverage.functions.toFixed(2)}%`}</td><td class="num">≥ ${coverage.thresholds.functions}%</td><td>${coverage.met.functions ? "✓" : "✗"}</td></tr>
</table>
<h2>Test files (${testFiles.length})</h2>
<table>
  <tr><th>File</th><th class="num">Tests</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Skipped</th><th class="num">Duration</th></tr>
  ${fileRows}
</table>
<h2>Failures</h2>
${failRows ? `<ul class="failures">${failRows}</ul>` : `<p class="muted">none</p>`}
<h2>Coverage by file (${files.length})</h2>
<table>
  <tr><th>File</th><th class="num">Lines</th><th class="num">Branches</th><th class="num">Functions</th><th>Bar</th></tr>
  ${rows}
</table>
<footer>generated by scripts/report.mjs · schemaVersion ${report.schemaVersion} · deterministic (no timestamps)</footer>
</body></html>`;
}

function main() {
  const { resultsJson, coverageLcov, outDir, scope, gate } = parseArgs(process.argv.slice(2));
  if (!resultsJson || !coverageLcov || !outDir) {
    console.error("usage: node scripts/report.mjs <results.json> <coverage.lcov> <out-dir> --scope <unit|integration|all>");
    process.exit(2);
  }
  let results = { summary: {}, failures: [], files: [] };
  try {
    results = JSON.parse(readFileSync(resultsJson, "utf8"));
  } catch (err) {
    console.error(`[report] warning: cannot read ${resultsJson}: ${err.message}`);
  }
  let lcovText = "";
  try {
    lcovText = readFileSync(coverageLcov, "utf8");
  } catch (err) {
    console.error(`[report] warning: cannot read ${coverageLcov}: ${err.message}`);
  }
  const report = buildReport({ results, lcovText, scope, gate });
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, "report.json");
  const htmlPath = join(outDir, "report.html");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(htmlPath, renderHtml(report));
  console.log(`[report] wrote ${jsonPath} (${report.files.length} coverage files, ${summaryOf(report)})`);
  console.log(`[report] wrote ${htmlPath}`);
}

function summaryOf(report) {
  const c = report.coverage;
  const mode = report.thresholdMode === "gate" ? "FINAL gate" : "baseline";
  return `tests ${report.summary.pass}/${report.summary.tests} · coverage line ${c.lines ?? "N/A"}% branch ${c.branches ?? "N/A"}% func ${c.functions ?? "N/A"}% (${mode})`;
}

if (process.argv[1] && basename(process.argv[1]) === "report.mjs") main();
