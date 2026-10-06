/** Shared helpers for tests that run the built agent-plan CLI as a real process. */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const cliPath = join(packageRoot, "dist", "index.js");

const roots = [];
const children = new Set();

/** Remove every temp folder and stop every process this file started. Call from `after()`. */
export async function cleanupCliProcesses() {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
}

export async function tempDir(prefix = "agent-plan-cli-") {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

export function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf-8", ...options });
}

/**
 * Like runCli, but does not block this process. Use it whenever the command talks
 * to a server that lives in THIS process, or stops a child of this process: a
 * blocked event loop cannot answer requests or collect a finished child.
 */
export function runCliAsync(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/** A folder with an initialized planner. */
export async function plannerFixture(prefix = "agent-plan-cli-planner-") {
  const cwd = await tempDir(prefix);
  const init = runCli(["init", "CLI Fixture", "--yes"], { cwd });
  if (init.status !== 0) throw new Error(`init failed: ${init.stderr}`);
  return cwd;
}

/** Start `agent-plan serve ...` and resolve with its first stdout line. */
export function startServe(cwd, args) {
  const child = spawn(process.execPath, [cliPath, "serve", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  const firstLine = new Promise((resolve, reject) => {
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end !== -1) resolve(buffer.slice(0, end));
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`serve exited early with ${code}`)));
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return { child, firstLine, exited };
}
