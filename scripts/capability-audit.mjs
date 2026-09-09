#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { fieldCapabilityManifest } from "../test/field-capabilities.mjs";

export function buildCapabilityAudit(manifest = fieldCapabilityManifest) {
  const entries = manifest.map((entry) => {
    const status = entry.exception
      ? (entry.exception.includes("Removed") ? "deprecated" : entry.exception.includes("Derived") || entry.exception.includes("Planner-owned") ? "exempt" : "harness-specific")
      : entry.operations.includes("read") && entry.operations.some((operation) => ["create", "update", "delete"].includes(operation))
        ? "complete"
        : "partial";
    return {
      key: `${entry.entity}.${entry.name}`,
      entity: entry.entity,
      field: entry.name,
      status,
      operations: [...entry.operations],
      surfaces: { ...entry.surfaces },
      exception: entry.exception ?? "",
    };
  });
  return {
    version: 1,
    methodology: "Field-level declarations plus executable semantic matrix assertions; handler registration alone never establishes completeness.",
    counts: Object.fromEntries([...new Set(entries.map((entry) => entry.status))].sort().map((status) => [status, entries.filter((entry) => entry.status === status).length])),
    entries,
  };
}

export function renderCapabilityAuditMarkdown(audit) {
  const lines = ["# Product Capability Audit", "", `Manifest version: ${audit.version}`, "", audit.methodology, "", "## Summary", "", "| Status | Count |", "| --- | ---: |"];
  for (const [status, count] of Object.entries(audit.counts)) lines.push(`| ${status} | ${count} |`);
  lines.push("", "## Field capabilities", "", "| Capability | Status | Operations | Exception |", "| --- | --- | --- | --- |");
  for (const entry of audit.entries) lines.push(`| \`${entry.key}\` | ${entry.status} | ${entry.operations.join(", ") || "—"} | ${entry.exception || "—"} |`);
  lines.push("", "## Maintenance contract", "", "Update `test/field-capabilities.mjs` when a canonical field or semantic operation changes, add a behavioral regression, and run `node scripts/capability-audit.mjs --check` plus the canonical verification gate. Do not classify a handler-only registration as complete.", "");
  return lines.join("\n");
}

const audit = buildCapabilityAudit();
if (process.argv.includes("--check")) {
  if (audit.entries.some((entry) => entry.status === "partial")) {
    console.error("Capability audit failed: partial field capabilities remain.");
    process.exitCode = 1;
  } else {
    console.log(`Capability audit passed: ${audit.entries.length} fields classified.`);
  }
} else if (process.argv.includes("--write")) {
  await mkdir("reports", { recursive: true });
  await writeFile("reports/capability-audit.json", `${JSON.stringify(audit, null, 2)}\n`);
  await writeFile("reports/capability-audit.md", `${renderCapabilityAuditMarkdown(audit)}\n`);
  console.log("Capability audit written to reports/capability-audit.{json,md}");
} else {
  console.log(JSON.stringify(audit, null, 2));
}
