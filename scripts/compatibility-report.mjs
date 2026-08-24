#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";

import { scenarios, scenariosForHarness } from "../test/scenario-matrix.mjs";
import { surfacesByHarness } from "../test/surfaces.mjs";
import { runScenario, missingExecutors } from "../test/helpers/runner.mjs";
import {
  parityCases,
  registerErrorParityExecutors,
  compareParityResults,
  comparableSnapshot,
  cleanupErrorParityHarnesses,
} from "../test/helpers/error-parity-harnesses.mjs";

const HARNESS_ORDER = ["api", "mcp", "pi", "ui", "e2e"];

function parseArgs(argv) {
  const pos = [];
  for (const arg of argv) pos.push(arg);
  return { outDir: pos[0] ? resolve(pos[0]) : resolve("reports/compatibility") };
}

function firstLine(text) {
  return String(text ?? "").split(/\r?\n/, 1)[0] ?? "";
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function summarizeSnapshot(snapshot) {
  const normalized = comparableSnapshot(snapshot);
  if (!normalized) return null;
  return {
    manifestVersion: normalized.manifestVersion ?? null,
    project: normalized.project ? { workDeviationCount: normalized.project.workDeviationCount ?? 0 } : null,
    features: (normalized.features ?? [])
      .map((feature) => ({
        ref: feature.ref ?? null,
        name: feature.name ?? "",
        status: feature.status ?? null,
        phaseRefs: [...(feature.phaseRefs ?? [])].sort(),
      }))
      .sort((left, right) => String(left.ref).localeCompare(String(right.ref))),
    phases: (normalized.phases ?? [])
      .map((phase) => ({
        ref: phase.ref ?? null,
        featureRef: phase.featureRef ?? null,
        title: phase.title ?? "",
        status: phase.status ?? null,
        handoff: phase.handoff ?? "",
        taskRefs: [...(phase.taskRefs ?? [])].sort(),
        tasks: (phase.tasks ?? [])
          .map((task) => ({
            ref: task.ref ?? null,
            title: task.title ?? "",
            status: task.status ?? null,
            started: Boolean(task.started),
            completed: Boolean(task.completed),
          }))
          .sort((left, right) => String(left.ref).localeCompare(String(right.ref))),
      }))
      .sort((left, right) => String(left.ref).localeCompare(String(right.ref))),
    requirements: (normalized.requirements ?? [])
      .map((requirement) => ({
        title: requirement.title ?? "",
        status: requirement.status ?? null,
        linkedPhaseRefs: [...(requirement.linkedPhaseRefs ?? [])].sort(),
      }))
      .sort((left, right) => left.title.localeCompare(right.title)),
    workDeviations: (normalized.workDeviations ?? [])
      .map((deviation) => ({
        state: deviation.state ?? null,
        temporaryTaskRef: deviation.temporaryTaskRef ?? null,
        resumeTaskRef: deviation.resumeTaskRef ?? null,
        recommendedTaskRef: deviation.recommendedTaskRef ?? null,
        relatedTaskRef: deviation.relatedTaskRef ?? null,
      }))
      .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
    resume: normalized.resume
      ? {
        currentFeatureRef: normalized.resume.currentFeatureRef ?? null,
        currentPhaseRef: normalized.resume.currentPhaseRef ?? null,
        currentTaskRef: normalized.resume.currentTaskRef ?? null,
        inProgressTaskRefs: [...(normalized.resume.inProgressTaskRefs ?? [])].sort(),
        nextSteps: [...(normalized.resume.nextSteps ?? [])],
        notes: normalized.resume.notes ?? "",
      }
      : null,
    handoffArchive: (normalized.handoffArchive ?? [])
      .map((entry) => ({
        reason: entry.reason ?? "",
        phaseRef: entry.phaseRef ?? null,
        featureRef: entry.featureRef ?? null,
        firstLine: entry.firstLine ?? "",
      }))
      .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
    activityCount: normalized.activityCount ?? 0,
  };
}

function summarizeNormalized(result) {
  return {
    ok: result.ok,
    errorCategory: result.errorCategory ?? null,
    status: result.status ?? null,
    reference: result.reference ?? null,
    textPreview: firstLine(result.error ?? result.text ?? "") || null,
    snapshot: summarizeSnapshot(result.snapshot),
  };
}

export function analyzeSurfaceCoverageDrift() {
  const allSurfaces = Object.entries(surfacesByHarness)
    .flatMap(([harness, entries]) => entries.map((entry) => ({ harness, ...entry })));
  const referenced = new Set(scenarios.flatMap((scenario) => scenario.surfaces ?? []));
  const uncoveredSurfaces = [];
  const deferredSurfaces = [];
  for (const entry of allSurfaces) {
    if (referenced.has(entry.id)) continue;
    const payload = {
      id: entry.id,
      harness: entry.harness,
      kind: entry.kind,
      name: entry.name,
      anchor: entry.anchor,
      phase: entry.coverage?.phase ?? null,
      reason: entry.coverage?.reason ?? null,
    };
    if (entry.coverage) deferredSurfaces.push(payload);
    else uncoveredSurfaces.push(payload);
  }
  uncoveredSurfaces.sort((a, b) => a.id.localeCompare(b.id));
  deferredSurfaces.sort((a, b) => a.id.localeCompare(b.id));
  return {
    ok: uncoveredSurfaces.length === 0,
    referencedSurfaceCount: referenced.size,
    deferredSurfaceCount: deferredSurfaces.length,
    uncoveredSurfaces,
    deferredSurfaces,
  };
}

export function buildCompatibilityReport({ parityResults, drift }) {
  const harnesses = HARNESS_ORDER.map((harness) => {
    const declaredScenarios = scenariosForHarness(harness).length;
    const executorGaps = missingExecutors(harness).slice().sort();
    const exercisedParityCases = parityResults.filter((entry) => entry.harnesses.includes(harness));
    const parityPassed = exercisedParityCases.filter((entry) => entry.ok).length;
    const parityFailed = exercisedParityCases.length - parityPassed;
    return {
      harness,
      declaredScenarios,
      executableScenarios: declaredScenarios - executorGaps.length,
      executorGapCount: executorGaps.length,
      executorGaps,
      exercisedParityCases: exercisedParityCases.length,
      parityPassed,
      parityFailed,
      status: parityFailed > 0 ? "fail" : executorGaps.length === 0 ? "ready" : exercisedParityCases.length > 0 ? "partial" : "inventory-only",
    };
  });

  const paritySummary = {
    total: parityResults.length,
    passed: parityResults.filter((entry) => entry.ok).length,
    failed: parityResults.filter((entry) => !entry.ok).length,
  };

  return {
    schemaVersion: 1,
    overallOk: paritySummary.failed === 0 && drift.ok,
    paritySummary,
    harnesses,
    drift,
    parityResults: parityResults.map((entry) => ({
      id: entry.id,
      title: entry.title,
      harnesses: entry.harnesses,
      ok: entry.ok,
      mismatches: entry.mismatches,
      normalized: Object.fromEntries(
        Object.entries(entry.normalized)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([harness, result]) => [harness, summarizeNormalized(result)]),
      ),
    })),
  };
}

export function renderCompatibilityMarkdown(report) {
  const lines = [
    "# Cross-harness compatibility report",
    "",
    `- Overall: **${report.overallOk ? "PASS" : "FAIL"}**`,
    `- Parity cases: **${report.paritySummary.passed}/${report.paritySummary.total}** passing`,
    `- Drift check: **${report.drift.ok ? "PASS" : "FAIL"}**`,
    `- Referenced surfaces: **${report.drift.referencedSurfaceCount}**`,
    `- Deferred surfaces: **${report.drift.deferredSurfaceCount}**`,
    "",
    "## Harness summary",
    "",
    "| Harness | Status | Declared scenarios | Executable scenarios | Executor gaps | Parity pass/fail |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...report.harnesses.map((entry) => `| ${entry.harness} | ${entry.status} | ${entry.declaredScenarios} | ${entry.executableScenarios} | ${entry.executorGapCount} | ${entry.parityPassed}/${entry.parityFailed} |`),
    "",
    "## Drift check",
    "",
  ];

  if (report.drift.uncoveredSurfaces.length === 0) {
    lines.push("- No uncovered public surfaces without a scenario or explicit deferred coverage rationale.");
  } else {
    lines.push("### Uncovered public surfaces");
    lines.push("");
    for (const entry of report.drift.uncoveredSurfaces) {
      lines.push(`- ${entry.id} (${entry.harness} · ${entry.kind}) — ${entry.name} [${entry.anchor}]`);
    }
  }

  lines.push("");
  lines.push("### Explicitly deferred surfaces");
  lines.push("");
  for (const entry of report.drift.deferredSurfaces) {
    lines.push(`- ${entry.id} → ${entry.phase}: ${entry.reason}`);
  }

  lines.push("");
  lines.push("## Parity cases");
  lines.push("");
  for (const entry of report.parityResults) {
    lines.push(`### ${entry.id} — ${entry.ok ? "PASS" : "FAIL"}`);
    lines.push("");
    lines.push(`- Harnesses: ${entry.harnesses.join(", ")}`);
    if (entry.mismatches.length === 0) lines.push("- Differences: none after normalization");
    else lines.push(`- Differences: ${entry.mismatches.join("; ")}`);
    for (const harness of entry.harnesses) {
      const result = entry.normalized[harness];
      lines.push(`- ${harness}: ok=${result.ok} errorCategory=${result.errorCategory ?? "-"} status=${result.status ?? "-"} reference=${result.reference ?? "-"} text=${result.textPreview ?? "-"}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function executeParitySuite() {
  registerErrorParityExecutors();
  const parityResults = [];
  for (const entry of parityCases) {
    const { results } = await runScenario(entry.id, entry.harnesses);
    const mismatches = compareParityResults(results, entry.harnesses, entry);
    parityResults.push({
      id: entry.id,
      title: scenarios.find((scenario) => scenario.id === entry.id)?.title ?? entry.id,
      harnesses: entry.harnesses,
      ok: mismatches.length === 0,
      mismatches,
      normalized: results,
    });
  }
  return parityResults.sort((a, b) => a.id.localeCompare(b.id));
}

async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });

  let parityResults = [];
  try {
    parityResults = await executeParitySuite();
    const report = buildCompatibilityReport({
      parityResults,
      drift: analyzeSurfaceCoverageDrift(),
    });
    const jsonPath = join(outDir, "compatibility-report.json");
    const markdownPath = join(outDir, "compatibility-report.md");
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(markdownPath, renderCompatibilityMarkdown(report));
    console.log(`[compat] wrote ${jsonPath} (${report.paritySummary.passed}/${report.paritySummary.total} parity cases, drift ${report.drift.ok ? "ok" : "fail"})`);
    console.log(`[compat] wrote ${markdownPath}`);
    if (!report.overallOk) process.exitCode = 1;
  } finally {
    await cleanupErrorParityHarnesses();
  }
}

if (process.argv[1] && basename(process.argv[1]) === "compatibility-report.mjs") {
  main().catch((err) => {
    console.error(`[compat] fatal: ${err.message}`);
    process.exit(1);
  });
}
