/**
 * One-command dev harness for the planner Web UI with HMR.
 *
 * Starts, in order:
 *   1. plan-server (agent-plan's own .planner) on a dedicated port
 *   2. Vite dev server (port 5175) with HMR, proxying /api and /ws to (1)
 *
 * Vite is only started AFTER the plan-server answers /api/health, so the
 * first WebSocket connection no longer hits a not-yet-listening backend
 * (which produced a noisy ECONNRESET during startup).
 *
 * Both children are spawned detached (their own process group) and Vite is
 * launched directly (not via `pnpm --filter ... dev`). This keeps a Ctrl-C
 * clean: the terminal SIGINT reaches only this script, which then terminates
 * the children. Without this, the `pnpm` wrapper around Vite would report
 * ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL on SIGINT.
 *
 * Because Vite serves the SOURCE with hot-reload, you see in-progress
 * developments instantly — no rebuild, no copy, no relaunch, no cache purge.
 *
 * Env overrides:
 *   DEV_PLAN_PORT      port for the plan-server backend (default 3090)
 *   PLAN_ROOT          planner root served by the backend (default <repo>/.planner)
 *   VITE_PROXY_TARGET  backend base URL Vite proxies to (default http://127.0.0.1:<DEV_PLAN_PORT>)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const PORT = process.env.DEV_PLAN_PORT ?? "3090";
const PLAN_ROOT = process.env.PLAN_ROOT ?? resolve(root, ".planner");
const PROXY_TARGET = process.env.VITE_PROXY_TARGET ?? `http://127.0.0.1:${PORT}`;

const server = spawn("node", [resolve(root, "packages/plan-server/dist/cli.js")], {
  env: { ...process.env, PLAN_PORT: PORT, PLAN_ROOT, PLAN_HOST: "127.0.0.1" },
  stdio: "inherit",
  detached: true,
});

let web;
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  killTree(server);
  if (web) killTree(web);
  process.exit(typeof code === "number" ? code : 0);
}

function killTree(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
server.on("exit", (c) => shutdown(c ?? 0));

async function waitForServer(timeoutMs = 20000) {
  const url = `http://127.0.0.1:${PORT}/api/health`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

console.log(`[dev-web] waiting for plan-server on ${PORT} ...`);
const ready = await waitForServer();
if (!ready) {
  console.error(`[dev-web] plan-server did not become ready within timeout (port ${PORT})`);
  shutdown(1);
}

const viteBin =
  process.platform === "win32"
    ? resolve(root, "packages/plan-web-ui/node_modules/.bin/vite.cmd")
    : resolve(root, "packages/plan-web-ui/node_modules/.bin/vite");

web = spawn(viteBin, [], {
  cwd: resolve(root, "packages/plan-web-ui"),
  env: { ...process.env, VITE_PROXY_TARGET: PROXY_TARGET },
  stdio: "inherit",
  detached: true,
});
web.on("exit", (c) => shutdown(c ?? 0));

console.log(`[dev-web] plan-server -> ${PROXY_TARGET} (PLAN_ROOT=${PLAN_ROOT})`);
console.log(`[dev-web] vite dev    -> http://localhost:5175  (proxy -> ${PROXY_TARGET})`);
