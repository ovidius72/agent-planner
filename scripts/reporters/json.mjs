/**
 * Custom node:test reporter (F015/T227) — normalized JSON test results.
 * Consumed by --test-reporter=./scripts/reporters/json.mjs with
 * --test-reporter-destination=<file>. Deterministic: no timestamps/randomness.
 *
 * Uses node's test:summary events (one per test file + one root aggregate),
 * which carry the SAME canonical counts the spec reporter shows (tests /
 * passed / failed / skipped / todo), plus real per-file durations. Failure
 * details come from test:fail events (name + file + error message/stack).
 *
 * Also emits a full LCOV tracefile (same format as node's built-in lcov
 * reporter: TN/SF/FN/FNDA/FNF/FNH/BRDA/BRF/BRH/DA/LH/LF/end_of_record) from
 * test:coverage events. The destination path is taken from REPORT_LCOV_PATH
 * (set by scripts/test-all.mjs). Emitting LCOV from this single reporter lets
 * test-all attach only two reporters (spec + this one); a third reporter was
 * the cause of node's MaxListenersExceededWarning on the TestsStream
 * (compose+pipe plumbing adds ~4 'end' listeners per reporter).
 */
import { writeFileSync } from "node:fs";

function lcovForFiles(summary) {
  // Mirrors node's internal lcov reporter output byte-for-byte
  // (internal/test_runner/reporter/lcov.js), so the file stays consumable by
  // external tools (codecov, lcov.info parsers).
  const { workingDirectory } = summary;
  let lcov = "TN:\n";
  for (const file of summary.files) {
    lcov += `SF:${relative(workingDirectory, file.path)}\n`;
    let fnda = "";
    for (let j = 0; j < file.functions.length; j++) {
      const fn = file.functions[j];
      const name = fn.name || `anonymous_${j}`;
      lcov += `FN:${fn.line},${name}\n`;
      fnda += `FNDA:${fn.count},${name}\n`;
    }
    lcov += fnda;
    lcov += `FNF:${file.totalFunctionCount}\n`;
    lcov += `FNH:${file.coveredFunctionCount}\n`;
    for (let j = 0; j < file.branches.length; j++) {
      lcov += `BRDA:${file.branches[j].line},${j},0,${file.branches[j].count}\n`;
    }
    lcov += `BRF:${file.totalBranchCount}\n`;
    lcov += `BRH:${file.coveredBranchCount}\n`;
    const sortedLines = file.lines.toSorted((a, b) => a.line - b.line);
    for (const ln of sortedLines) {
      lcov += `DA:${ln.line},${ln.count}\n`;
    }
    lcov += `LH:${file.coveredLineCount}\n`;
    lcov += `LF:${file.totalLineCount}\n`;
    lcov += "end_of_record\n";
  }
  return lcov;
}

function relative(from, to) {
  // Cheap relative path (no node:path dep needed in a reporter context):
  // make absolute, strip common prefix, drop leading slashes.
  const f = from.split("/");
  const t = to.split("/");
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  return [...f.slice(i).map(() => ".."), ...t.slice(i)].join("/");
}

export default async function* (source) {
  const files = [];
  const failures = [];
  let root = null;
  let lcov = "";
  for await (const event of source) {
    const d = event.data ?? {};
    if (event.type === "test:summary") {
      const entry = { file: d.file ?? "", duration_ms: Math.round(d.duration_ms ?? 0), ...(d.counts ?? {}) };
      if (entry.file) files.push(entry);
      else root = entry;
    } else if (event.type === "test:fail") {
      failures.push({
        name: d.name ?? "",
        file: d.file ?? "",
        error: d.error ? { message: String(d.error.message ?? d.error), stack: String(d.error.stack ?? "") } : undefined,
      });
    } else if (event.type === "test:coverage") {
      lcov = lcovForFiles(d.summary);
    }
  }
  if (lcov) {
    const dest = process.env.REPORT_LCOV_PATH;
    if (dest) writeFileSync(dest, lcov);
  }
  const sum = (a, f, k) => a + (f[k] ?? 0);
  const summary = root
    ? { tests: root.tests ?? 0, pass: root.passed ?? 0, fail: root.failed ?? 0, skip: root.skipped ?? 0, duration_ms: root.duration_ms ?? 0 }
    : files.reduce(
        (a, f) => ({
          tests: sum(a, f, "tests"),
          pass: sum(a, f, "passed"),
          fail: sum(a, f, "failed"),
          skip: sum(a, f, "skipped"),
          duration_ms: a.duration_ms + (f.duration_ms ?? 0),
        }),
        { tests: 0, pass: 0, fail: 0, skip: 0, duration_ms: 0 },
      );
  yield JSON.stringify({ schemaVersion: 2, summary, files, failures });
}
