#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

// Package groups. pi-adapter has an independent release cadence (Pi-only,
// frequent fixes) so it is NOT bumped together with the core packages —
// bumping it from plan-core's version would silently downgrade it.
// See AGENTS.md §3: the core stays harness-agnostic, Pi is an adapter.
const corePkgs = [
  "packages/plan-core",
  "packages/plan-mcp",
  "packages/plan-server",
  "packages/agent-plan",
];
const adapterPkgs = ["packages/pi-adapter"];

const argv = process.argv.slice(2);
const adapterMode = argv.includes("--adapter");
const dryRun = argv.includes("--dry-run");
const arg = argv.find((a) => !a.startsWith("--"));

if (!arg) {
  console.error("Usage:");
  console.error("  pnpm run release:bump -- [major|minor|patch|X.Y.Z]         # core packages (plan-core, plan-mcp, plan-server, agent-plan)");
  console.error("  pnpm run release:bump:adapter -- [major|minor|patch|X.Y.Z]  # pi-adapter only (independent cadence)");
  console.error("");
  console.error("Add --dry-run to preview without writing.");
  process.exit(1);
}

const targetPkgs = adapterMode ? adapterPkgs : corePkgs;

// Base version is read from the FIRST package of the target group, so each
// group bumps from its own current version (never from the other group's).
const cur = JSON.parse(
  fs.readFileSync(path.join(targetPkgs[0], "package.json"), "utf-8")
).version;

let v;
if (/^\d/.test(arg)) {
  v = arg;
} else {
  const parts = cur.split(".").map(Number);
  switch (arg) {
    case "major":
      v = `${parts[0] + 1}.0.0`;
      break;
    case "minor":
      v = `${parts[0]}.${parts[1] + 1}.0`;
      break;
    case "patch":
      v = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
      break;
    default:
      console.error(`Unknown bump type: ${arg}. Use major|minor|patch|X.Y.Z`);
      process.exit(1);
  }
}

// Compare simple semver strings (X.Y.Z). Returns -1, 0, or 1.
function cmpVer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

const label = adapterMode ? "adapter" : "core";
console.log(`Bump mode: ${label} | base ${cur} → target ${v}${dryRun ? " (dry-run)" : ""}`);

let changed = 0;
targetPkgs.forEach((p) => {
  const fp = path.join(p, "package.json");
  const j = JSON.parse(fs.readFileSync(fp, "utf-8"));
  const old = j.version;
  // Guard: never downgrade or re-stamp the same version.
  if (cmpVer(v, old) <= 0) {
    console.log(`  ${p.split("/")[1]}: skip (current ${old} >= target ${v})`);
    return;
  }
  if (dryRun) {
    console.log(`  ${p.split("/")[1]}: ${old} → ${v}  [not written]`);
  } else {
    j.version = v;
    fs.writeFileSync(fp, JSON.stringify(j, null, 2) + "\n");
    console.log(`  ${p.split("/")[1]}: ${old} → ${v}`);
  }
  changed++;
});

if (changed === 0) {
  console.log("Nothing to bump (all targets already at or above the computed version).");
} else if (!dryRun) {
  console.log("Bump done. Run pnpm install to relink.");
}
