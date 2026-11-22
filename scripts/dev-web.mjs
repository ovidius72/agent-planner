/**
 * One-command dev harness for the planner Web UI with HMR.
 *
 * Starts, in order:
 *   1. plan-server (agent-plan's own .planner) on a dedicated port
 *   2. Vite dev server with HMR, proxying /api and /ws to (1)
 *
 * Port policy: the preferred ports (3090 backend, 5175 UI) are used when
 * free; when one is occupied the harness falls back to a random free port
 * instead of failing with EADDRINUSE, so several checkouts/instances can run
 * side by side. The actually used ports are printed at startup.
 *
 * Vite is only started AFTER the plan-server answers /api/health, so the
 * first WebSocket connection no longer hits a not-yet-listening backend
 * (which produced a noisy ECONNRESET during startup).
 *
 * Vite is launched directly (not via `pnpm --filter ... dev`), and children
 * are NOT detached: they stay in this script's process group so that signals
 * sent to the terminal's foreground group — SIGINT from Ctrl-C, but also
 * SIGHUP when the terminal window closes — reach the whole chain
 * (pnpm -> this script -> plan-server -> vite). Previously the detached
 * groups escaped those signals, leaving orphaned dev stacks listening on
 * ports after the terminal was gone. As a further safety net this script
 * watches for its own parent dying (orphan check) and shuts down if that
 * happens.
 *
 * Because Vite serves the SOURCE with hot-reload, you see in-progress
 * developments instantly — no rebuild, no copy, no relaunch, no cache purge.
 *
 * Env overrides:
 *   DEV_PLAN_PORT      preferred port for the plan-server backend (default 3090; random when busy)
 *   DEV_WEB_PORT       preferred port for the Vite dev server (default 5175; random when busy)
 *   PLAN_ROOT          planner root served by the backend (default <repo>/.planner)
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const PLAN_PORT = Number(process.env.DEV_PLAN_PORT ?? 3090);
const WEB_PORT = Number(process.env.DEV_WEB_PORT ?? 5175);
const PLAN_ROOT = process.env.PLAN_ROOT ?? resolve(root, ".planner");

/** Whether `port` can be bound on 127.0.0.1 right now. */
async function isPortFree(port) {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once("error", () => resolveFree(false));
    probe.once("listening", () => probe.close(() => resolveFree(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/** A random free port assigned by the OS (listen on port 0). */
async function randomFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.once("listening", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
    probe.listen(0, "127.0.0.1");
  });
}

/** The preferred port when free, otherwise a random free port. */
async function pickPort(preferred) {
  if (preferred === 0) return randomFreePort();
  if (await isPortFree(preferred)) return preferred;
  const fallback = await randomFreePort();
  console.log(`[dev-web] port ${preferred} is busy — falling back to random port ${fallback}`);
  return fallback;
}

const PORT = await pickPort(PLAN_PORT);
const WEB = await pickPort(WEB_PORT);
const webUiOrigins = [`http://localhost:${WEB}`, `http://127.0.0.1:${WEB}`];
const PROXY_TARGET = `http://127.0.0.1:${PORT}`;

const server = spawn("node", [resolve(root, "packages/plan-server/dist/cli.js")], {
  env: {
    ...process.env,
    PLAN_PORT: String(PORT),
    PLAN_ROOT,
    PLAN_HOST: "127.0.0.1",
    PLAN_WEB_UI_ORIGINS: webUiOrigins.join(","),
  },
  stdio: "inherit",
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
    child.kill("SIGTERM");
  } catch {}
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));
server.on("exit", (c) => shutdown(c ?? 0));

// Orphan guard: if the parent (e.g. the `pnpm run dev` wrapper) is gone and
// this script was reparented to launchd, no terminal is attached anymore —
// shut the whole stack down instead of lingering as an invisible instance.
const orphanCheck = setInterval(() => {
  if (process.ppid === 1) shutdown(0);
}, 2000);
orphanCheck.unref();

async function waitForServer(timeoutMs = 20000) {
  const url = `${PROXY_TARGET}/api/health`;
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

web = spawn(viteBin, ["--port", String(WEB), "--strictPort"], {
  cwd: resolve(root, "packages/plan-web-ui"),
  env: { ...process.env, VITE_PROXY_TARGET: PROXY_TARGET },
  stdio: "inherit",
});
web.on("exit", (c) => shutdown(c ?? 0));

console.log(`[dev-web] plan-server -> ${PROXY_TARGET} (PLAN_ROOT=${PLAN_ROOT})`);
console.log(`[dev-web] vite dev    -> http://localhost:${WEB}  (proxy -> ${PROXY_TARGET})`);
