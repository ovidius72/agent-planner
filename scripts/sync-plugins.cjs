#!/usr/bin/env node
// scripts/sync-plugins.js
// Regenerate each plugin's derived files from the single-source-of-truth
// templates in plugins/_shared/. Substitutes {{HARNESS}} and {{LOAD_COMMAND}}
// placeholders per harness. Edits go to _shared/, then run this script.
//
// Usage: node scripts/sync-plugins.js [--check]
//   --check  fail (exit 1) if any derived file is out of sync (CI guard)

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sharedDir = path.join(root, "plugins", "_shared");
const pluginsDir = path.join(root, "plugins");

// Per-harness substitution values. Add a new harness here when scaffolding it.
const HARNESSES = [
  {
    name: "claude-code",
    dir: path.join(pluginsDir, "claude-code"),
    HARNESS: "Claude Code",
    LOAD_COMMAND: "/planner load",
    // derived targets: source template -> destination
    targets: [
      { from: "planner-skill.md.in", to: "skills/planner/SKILL.md", mode: 0o644 },
      { from: "notify-session-start.sh.in", to: "scripts/notify-session-start.sh", mode: 0o755 },
    ],
  },
];

function substitute(text, vars) {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function ensureDirOf(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

let changed = 0;
const check = process.argv.includes("--check");
const drift = [];

for (const h of HARNESSES) {
  for (const t of h.targets) {
    const fromPath = path.join(sharedDir, t.from);
    const toPath = path.join(h.dir, t.to);
    if (!fs.existsSync(fromPath)) {
      console.error(`✗ template missing: ${path.relative(root, fromPath)}`);
      process.exitCode = 1;
      continue;
    }
    const rendered = substitute(read(fromPath), { HARNESS: h.HARNESS, LOAD_COMMAND: h.LOAD_COMMAND });
    const relTo = path.relative(root, toPath);
    if (fs.existsSync(toPath)) {
      const current = read(toPath);
      if (current === rendered) {
        console.log(`✓ ${relTo} (in sync)`);
        continue;
      }
      if (check) {
        console.log(`✗ ${relTo} (out of sync — run: node scripts/sync-plugins.js)`);
        drift.push(relTo);
        continue;
      }
    }
    if (check) continue;
    ensureDirOf(toPath);
    fs.writeFileSync(toPath, rendered, { mode: t.mode });
    // ensure exec bit for shell scripts
    if (t.mode & 0o111) fs.chmodSync(toPath, t.mode);
    console.log(`↻ ${relTo} (regenerated)`);
    changed++;
  }
}

if (check) {
  if (drift.length > 0) {
    console.error(`\n${drift.length} derived file(s) out of sync with plugins/_shared/.`);
    process.exit(1);
  }
  console.log("\nAll derived files in sync with plugins/_shared/.");
} else {
  console.log(`\nDone. ${changed} file(s) regenerated.`);
}