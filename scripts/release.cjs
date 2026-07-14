#!/usr/bin/env node
// scripts/release.cjs
// Unified release helper: bump ALL packages to a single version, create a
// release branch, verify build, and open a PR to `main` (the release act that
// triggers .github/workflows/publish.yml on merge).
//
// Usage:
//   pnpm release                 # patch bump (default)
//   pnpm release -- patch        # explicit patch
//   pnpm release -- minor        # minor bump
//   pnpm release -- major        # major bump
//   pnpm release -- 1.0.0        # explicit version
//   pnpm release -- --dry-run    # preview only (no branch/commit/PR)
//
// Model (AGENTS.md §12, unified versioning):
//   - ALL 5 packages share ONE version per release.
//   - Must run on a clean `develop`, up to date with origin.
//   - Target version = bump(max(current versions), level). Downgrades rejected.
//   - Creates release/v<target> from develop, commits the bump, pushes, PRs → main.
//   - After the PR merges to main, publish.yml publishes to npm. Then sync
//     develop: `git switch develop && git pull && git merge origin/main`.
//
// Prereqs: git, pnpm, gh (GitHub CLI) installed and authenticated.

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const PACKAGES = [
  { dir: "plan-core", name: "@agent-plan/core" },
  { dir: "plan-mcp", name: "@agent-plan/mcp" },
  { dir: "plan-server", name: "@agent-plan/server" },
  { dir: "agent-plan", name: "agent-plan" },
  { dir: "pi-adapter", name: "@agent-plan/pi-adapter" },
];

// Plugin manifests have their own version track (independent from npm packages).
// The release script bumps them by the same level so /plugin marketplace update
// detects a new version. The marketplace.json lives at the repo root.
const PLUGIN_FILES = {
  manifest: path.join(root, "plugins", "claude-code", ".claude-plugin", "plugin.json"),
  marketplace: path.join(root, ".claude-plugin", "marketplace.json"),
};

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim();
  } catch (e) {
    if (e.stderr) process.stderr.write(e.stderr.toString());
    throw e;
  }
}
function run(cmd) {
  execSync(cmd, { cwd: root, stdio: "inherit" });
}
function pkgPath(dir) { return path.join(root, "packages", dir, "package.json"); }
function readVersion(dir) { return JSON.parse(fs.readFileSync(pkgPath(dir), "utf8")).version; }
function writeVersion(dir, version) {
  const p = pkgPath(dir);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.version = version;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
}
function readPluginVersion() { return JSON.parse(fs.readFileSync(PLUGIN_FILES.manifest, "utf8")).version; }
function writePluginVersion(version) {
  // plugin.json
  const mp = PLUGIN_FILES.manifest;
  const mj = JSON.parse(fs.readFileSync(mp, "utf8"));
  mj.version = version;
  fs.writeFileSync(mp, JSON.stringify(mj, null, 2) + "\n");
  // marketplace.json: plugins[0].version + top-level catalog version
  const mk = PLUGIN_FILES.marketplace;
  const mkj = JSON.parse(fs.readFileSync(mk, "utf8"));
  mkj.version = version;
  if (Array.isArray(mkj.plugins) && mkj.plugins[0]) mkj.plugins[0].version = version;
  fs.writeFileSync(mk, JSON.stringify(mkj, null, 2) + "\n");
}
function parse(v) { return v.split(".").map(Number); }
function cmp(a, b) { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; } return 0; }
function bumpVer(v, level) {
  const [M, m, p] = parse(v);
  if (level === "major") return `${M + 1}.0.0`;
  if (level === "minor") return `${M}.${m + 1}.0`;
  return `${M}.${m}.${p + 1}`;
}

// --- parse args ---
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const levelArg = args.find((a) => ["patch", "minor", "major"].includes(a));
const explicitArg = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const level = levelArg || explicitArg || "patch";

// --- pre-flight ---
console.log("› Pre-flight checks...");
try { sh("gh --version"); } catch { console.error("✗ gh (GitHub CLI) not found. Install: https://cli.github.com"); process.exit(1); }
try { sh("pnpm --version"); } catch { console.error("✗ pnpm not found."); process.exit(1); }

const status = sh("git status --porcelain");
if (status) { console.error("✗ Working tree not clean. Commit or stash changes first:\n" + status); process.exit(1); }

const branch = sh("git rev-parse --abbrev-ref HEAD");
if (branch !== "develop") { console.error(`✗ Must be on 'develop' (currently on '${branch}'). Run: git switch develop`); process.exit(1); }

console.log("› Updating develop from origin...");
run("git fetch origin develop");
const behind = sh("git rev-list --count HEAD..origin/develop");
if (Number(behind) > 0) { console.error(`✗ develop is ${behind} commit(s) behind origin/develop. Run: git pull --ff-only origin develop`); process.exit(1); }

// --- compute unified target version ---
const current = PACKAGES.map((p) => parse(readVersion(p.dir))).reduce((mx, v) => (cmp(v, mx) > 0 ? v : mx));
const currentStr = current.join(".");
let target;
if (/^\d+\.\d+\.\d+$/.test(level)) {
  target = level;
} else {
  target = bumpVer(currentStr, level);
}
if (cmp(parse(target), current) <= 0) {
  console.error(`✗ Target ${target} is not greater than current max ${currentStr}. Aborting (downgrade guard).`);
  process.exit(1);
}

console.log(`\n› Release: ${currentStr} → ${target}  (${dryRun ? "DRY-RUN" : "LIVE"})`);
console.log("  Packages:");
for (const p of PACKAGES) console.log(`    ${p.name.padEnd(26)} ${readVersion(p.dir)} → ${target}`);

// --- plugin version (independent track, same bump level) ---
const pluginCurrent = readPluginVersion();
let pluginTarget;
if (/^\d+\.\d+\.\d+$/.test(level)) {
  // explicit version applies to packages only; bump plugin by same level from its current
  pluginTarget = bumpVer(pluginCurrent, levelArg ? level : "patch");
} else {
  pluginTarget = bumpVer(pluginCurrent, level);
}
if (cmp(parse(pluginTarget), parse(pluginCurrent)) <= 0) {
  console.error(`✗ Plugin target ${pluginTarget} is not greater than current ${pluginCurrent}. Aborting (downgrade guard).`);
  process.exit(1);
}
console.log(`    ${"plugin (claude-code)".padEnd(26)} ${pluginCurrent} → ${pluginTarget}`);

if (dryRun) {
  console.log("\n[dry-run] Would: create release/v" + target + ", bump all packages to " + target + ", bump plugin to " + pluginTarget + ", install, build, check, commit, push, open PR → main.");
  process.exit(0);
}

// --- create release branch ---
const branchName = `release/v${target}`;
try { sh(`git rev-parse --verify refs/heads/${branchName}`); console.error(`✗ Branch ${branchName} already exists.`); process.exit(1); } catch {}
try { sh(`git rev-parse --verify refs/remotes/origin/${branchName}`); console.error(`✗ Remote branch ${branchName} already exists.`); process.exit(1); } catch {}
console.log(`\n› Creating branch ${branchName}...`);
sh(`git switch -c ${branchName}`);

// --- bump all ---
for (const p of PACKAGES) writeVersion(p.dir, target);
writePluginVersion(pluginTarget);

// --- install + build + check (rollback on failure) ---
function rollback() {
  try { sh("git switch develop"); } catch {}
  try { sh(`git branch -D ${branchName}`); } catch {}
}
console.log("› pnpm install (relink workspace)...");
try { run("pnpm install"); } catch { rollback(); console.error("✗ pnpm install failed. Rolled back."); process.exit(1); }
console.log("› pnpm -r build...");
try { run("pnpm -r build"); } catch { rollback(); console.error("✗ build failed. Rolled back."); process.exit(1); }
console.log("› pnpm check...");
try { run("pnpm check"); } catch { rollback(); console.error("✗ type-check failed. Rolled back."); process.exit(1); }

// --- commit ---
console.log("› Committing bump...");
sh('git add -A');
execSync(`git commit -m "chore(release): v${target}

Unified version bump for all packages (core, mcp, server, agent-plan, pi-adapter).
Also bumps the Claude Code plugin manifest + marketplace version to ${pluginTarget}.
Merge this PR into main to publish via .github/workflows/publish.yml."`, { cwd: root, stdio: "inherit" });

// --- push ---
console.log("› Pushing branch...");
run(`git push -u origin ${branchName}`);

// --- changelog (commits since origin/main) ---
let changelog = "";
try { changelog = sh("git log --oneline origin/main..HEAD"); } catch {}

// --- open PR to main ---
const versionTable = PACKAGES.map((p) => `| ${p.name} | ${""} | ${target} |`).join("\n");
const body = `## Release v${target}

Unified version bump for all packages + Claude Code plugin manifest. Merge into \`main\` to publish via \`.github/workflows/publish.yml\`.

### Versions
| Package | Before | After |
|---|---|---|
${versionTable}
| plugin (claude-code) | ${pluginCurrent} | ${pluginTarget} |

### Changelog (commits since origin/main)
\`\`\`
${changelog || "(none — already on main)"}
\`\`\`

### After merge
1. publish.yml publishes all 5 packages to npm.
2. Sync develop: \`git switch develop && git pull && git merge origin/main && git push\`
`;

const bodyFile = path.join(os.tmpdir(), `release-pr-${target}.md`);
fs.writeFileSync(bodyFile, body);
console.log("› Opening PR → main...");
execSync(`gh pr create --base main --head ${branchName} --title "chore(release): v${target}" --body-file ${bodyFile}`, { cwd: root, stdio: "inherit" });
fs.unlinkSync(bodyFile);

console.log(`\n✓ Done. Release branch ${branchName} pushed; PR opened → main.`);
console.log("  After the PR merges to main, publish.yml runs. Then sync develop:");
console.log("    git switch develop && git pull && git merge origin/main && git push");