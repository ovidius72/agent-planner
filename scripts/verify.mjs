#!/usr/bin/env node
/**
 * Canonical bounded verification runner.
 *
 * Focused development verification:
 *   pnpm verify:focused -- --package plan-core
 *   pnpm verify:focused -- --test packages/plan-core/test/task-context.test.mjs
 *
 * Final phase/release gate:
 *   pnpm verify:final
 *
 * Full command output is captured to log files. The terminal receives only
 * step summaries and a bounded failure excerpt. Successful final results are
 * reused while the repository content fingerprint is unchanged.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const mode = argv[0] ?? "focused";
const isCi = argv.includes("--ci") || process.env.CI === "true";
const force = argv.includes("--force");
const excerptLines = 60;

const valueAfter = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const logRoot = process.env.VERIFY_LOG_DIR
  ? join(root, process.env.VERIFY_LOG_DIR)
  : join(root, ".planner", ".local", "verification");
const stateFile = join(logRoot, "final-gate.json");

function runGit(args, runner = spawnSync) {
  const result = runner("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

export function repositoryFingerprint({ runner = spawnSync, readFile = readFileSync } = {}) {
  const hash = createHash("sha256");
  hash.update(runGit(["rev-parse", "HEAD"], runner).trim());
  hash.update(runGit(["diff", "--binary", "HEAD", "--", ".", ":(exclude).planner/**", ":(exclude)reports/**"], runner));
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "-z"], runner)
    .split("\0")
    .filter((path) => path && !path.startsWith(".planner/") && !path.startsWith("reports/"))
    .sort();
  for (const path of untracked) {
    hash.update(path);
    hash.update(readFile(join(root, path)));
  }
  return hash.digest("hex");
}

export function finalGateCacheDecision(previous, fingerprint, { ci = false, forceRun = false } = {}) {
  if (ci || forceRun || previous?.fingerprint !== fingerprint) return "run";
  if (previous.status === "passed") return "reuse";
  if (previous.status === "failed") return "block-unchanged-failure";
  return "run";
}

function loadState() {
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function saveState(state) {
  mkdirSync(logRoot, { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function safeStepName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function runStep(name, command, args, fingerprint) {
  mkdirSync(logRoot, { recursive: true });
  const logPath = join(logRoot, `${fingerprint.slice(0, 12)}-${safeStepName(name)}.log`);
  const log = createWriteStream(logPath, { flags: "w" });
  let outputTail = "";
  const capture = (chunk) => {
    log.write(chunk);
    outputTail = `${outputTail}${chunk.toString("utf8")}`.slice(-256 * 1024);
  };
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const started = performance.now();
  const code = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.on("error", (error) => {
      capture(Buffer.from(`${error.stack ?? error.message}\n`));
      finish(1);
    });
    child.on("close", finish);
  });
  await new Promise((resolve, reject) => {
    log.once("error", reject);
    log.end(resolve);
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const shownPath = relative(root, logPath) || logPath;
  if (code === 0) {
    console.log(`[verify] ✓ ${name} (${seconds}s; log: ${shownPath})`);
    return;
  }
  const excerpt = outputTail.trimEnd().split("\n").slice(-excerptLines).join("\n");
  console.error(`[verify] ✗ ${name} (${seconds}s; log: ${shownPath})`);
  if (excerpt) console.error(`--- bounded failure excerpt (last ${excerptLines} lines) ---\n${excerpt}`);
  throw new Error(`${name} failed with exit code ${code ?? 1}`);
}

function focusedSteps() {
  const packageName = valueAfter("--package");
  const testPath = valueAfter("--test");
  if (Boolean(packageName) === Boolean(testPath)) {
    throw new Error("Focused mode requires exactly one of --package <name> or --test <path>.");
  }
  if (packageName) {
    return [{ name: `Focused ${packageName}`, command: process.execPath, args: ["scripts/test-all.mjs", "unit", "--package", packageName] }];
  }
  return [{ name: `Focused ${testPath}`, command: process.execPath, args: ["--test", testPath] }];
}

function finalSteps() {
  return [
    { name: "Build", command: "pnpm", args: ["build"] },
    { name: "Typecheck", command: "pnpm", args: ["check"] },
    { name: "Coverage", command: process.execPath, args: ["scripts/test-all.mjs", "--gate", "--no-build"] },
    { name: "Plugin synchronization", command: "pnpm", args: ["plugins:check"] },
    { name: "Browser end-to-end", command: "pnpm", args: ["exec", "playwright", "test"] },
    { name: "Packed installation smoke", command: process.execPath, args: ["scripts/installed-artifact-smoke.mjs"] },
  ];
}

export async function main() {
  if (!new Set(["focused", "final"]).has(mode)) throw new Error("Mode must be focused or final.");
  const fingerprint = repositoryFingerprint();
  const steps = mode === "focused" ? focusedSteps() : finalSteps();

  if (mode === "final") {
    const cacheDecision = finalGateCacheDecision(loadState(), fingerprint, { ci: isCi, forceRun: force });
    if (cacheDecision === "reuse") {
      console.log(`[verify] ✓ Reusing successful final gate for unchanged fingerprint ${fingerprint.slice(0, 12)}.`);
      return;
    }
    if (cacheDecision === "block-unchanged-failure") {
      throw new Error("The final gate already failed for this unchanged fingerprint. Run focused verification after a fix; use --force only for an explicitly justified infrastructure retry.");
    }
  }

  if (mode === "final" && !isCi) saveState({ fingerprint, status: "running" });
  try {
    for (const step of steps) await runStep(step.name, step.command, step.args, fingerprint);
    if (mode === "final" && !isCi) saveState({ fingerprint, status: "passed" });
    console.log(`[verify] ${mode} verification passed (${fingerprint.slice(0, 12)}).`);
  } catch (error) {
    if (mode === "final" && !isCi) saveState({ fingerprint, status: "failed", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[verify] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
