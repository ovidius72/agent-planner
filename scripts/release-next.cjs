#!/usr/bin/env node
// scripts/release-next.cjs
// Bump the @next prerelease channel on the current branch (typically `next`).
// Increments the prerelease counter: 0.2.19-next.0 -> 0.2.19-next.1, etc.
// If the current version is not a `-next.N` prerelease, starts `-next.0` from the
// current base. Commits + pushes; the push triggers .github/workflows/publish.yml
// which publishes to npm with the `next` dist-tag (install: npm i @agent-plan/core@next).
//
// Usage:
//   pnpm release:next             # bump counter, commit, push
//   pnpm release:next -- --dry-run  # preview only
//
// Model: `next` is the prerelease channel. `main` is stable (latest). `develop`
// is frozen until `next` is proven, then merged. See AGENTS.md.

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = "/Users/antonio/projects/agent-plan";
const PACKAGES = [
  { dir: "plan-core", name: "@agent-plan/core" },
  { dir: "plan-mcp", name: "@agent-plan/mcp" },
  { dir: "plan-server", name: "@agent-plan/server" },
  { dir: "agent-plan", name: "agent-plan" },
  { dir: "pi-adapter", name: "@agent-plan/pi-adapter" },
];

function sh(cmd) { return execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
function run(cmd) { execSync(cmd, { cwd: root, stdio: "inherit" }); }
function pkgPath(dir) { return path.join(root, "packages", dir, "package.json"); }
function readVer(dir) { return JSON.parse(fs.readFileSync(pkgPath(dir), "utf8")).version; }
function writeVer(dir, v) { const p = pkgPath(dir); const j = JSON.parse(fs.readFileSync(p, "utf8")); j.version = v; fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n"); }

// Plugin manifests have their own version track (independent from npm packages).
// Bump them on every `next` push so /plugin marketplace update detects a new
// version and refreshes the plugin files (matching release.cjs's stable behavior).
const PLUGIN_FILES = {
  manifest: path.join(root, "plugins", "claude-code", ".claude-plugin", "plugin.json"),
  marketplace: path.join(root, ".claude-plugin", "marketplace.json"),
};
function readPluginVersion() { return JSON.parse(fs.readFileSync(PLUGIN_FILES.manifest, "utf8")).version; }
function bumpPatch(v) { const [M, m, p] = v.split(".").map(Number); return `${M}.${m}.${p + 1}`; }
function writePluginVersion(version) {
  const mp = PLUGIN_FILES.manifest;
  const mj = JSON.parse(fs.readFileSync(mp, "utf8"));
  mj.version = version;
  fs.writeFileSync(mp, JSON.stringify(mj, null, 2) + "\n");
  const mk = PLUGIN_FILES.marketplace;
  const mkj = JSON.parse(fs.readFileSync(mk, "utf8"));
  mkj.version = version;
  if (Array.isArray(mkj.plugins) && mkj.plugins[0]) mkj.plugins[0].version = version;
  fs.writeFileSync(mk, JSON.stringify(mkj, null, 2) + "\n");
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// Pre-flight: clean tree
const status = sh("git status --porcelain");
if (status) { console.error("✗ Working tree not clean. Commit or stash first:\n" + status); process.exit(1); }
const branch = sh("git rev-parse --abbrev-ref HEAD");
console.log(`› Branch: ${branch}`);

// Compute next prerelease version from the first package (all share one version)
const cur = readVer(PACKAGES[0].dir);
const m = cur.match(/^(\d+\.\d+\.\d+)(?:-next\.(\d+))?$/);
let target;
if (m) {
  const base = m[1];
  const n = m[2] !== undefined ? Number(m[2]) + 1 : 0;
  target = `${base}-next.${n}`;
} else {
  // Non-prerelease version: start a next.0 prerelease from it
  target = `${cur}-next.0`;
}
const pluginCur = readPluginVersion();
const pluginTarget = bumpPatch(pluginCur);
console.log(`\n› Prerelease bump: ${cur} → ${target}  (${dryRun ? "DRY-RUN" : "LIVE"})`);
for (const p of PACKAGES) console.log(`    ${p.name.padEnd(26)} ${readVer(p.dir)} → ${target}`);
console.log(`    ${"plugin (claude-code)".padEnd(26)} ${pluginCur} → ${pluginTarget}`);

if (dryRun) { console.log(`\n[dry-run] Would: bump all to ${target}, plugin to ${pluginTarget}, commit, push (triggers publish.yml → @next).`); process.exit(0); }

// Bump
for (const p of PACKAGES) writeVer(p.dir, target);
writePluginVersion(pluginTarget);
run("pnpm install");
try { run("pnpm -r build"); run("pnpm check"); } catch { console.error("✗ build/check failed. Restoring versions."); for (const p of PACKAGES) writeVer(p.dir, cur); process.exit(1); }

// Commit + push
run('git add -A');
execSync(`git commit -m "chore(release-next): ${target}"`, { cwd: root, stdio: "inherit" });
console.log("› Pushing...");
run(`git push`);
console.log(`\n✓ Done. Pushed ${target}; publish.yml will publish to npm with dist-tag \`next\`.`);
console.log("  Install: npm i @agent-plan/core@next");