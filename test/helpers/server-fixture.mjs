/**
 * T232 (P054/F015) — Real HTTP server integration harness.
 *
 * Reusable fixture that:
 *  - creates an isolated temporary PlanStore/project (real filesystem)
 *  - starts the REAL Hono server (packages/plan-server) on a dynamic port
 *    (port 0 → OS-assigned) with static assets disabled (API-only)
 *  - exposes `request()`/`expectError()` fetch helpers that surface route
 *    failures as test failures with full request/response diagnostics
 *  - reliably closes HTTP + WebSocket resources on teardown
 *
 * Every `startServerFixture()` call creates a fresh temp root, so each test
 * starts from isolated filesystem state. Tracked handles are drained by
 * `cleanupServerFixtures()` even when a test throws.
 *
 * Mock policy: no mocks — real PlanStore, real filesystem, real HTTP.
 */

import { serve } from "../../packages/plan-server/dist/index.js";
import { createPlannerFixture, cleanupFixtures } from "./fixtures.mjs";

/** Every live server handle created in this process (drained on cleanup). */
const handles = new Set();

/** Close every open server handle and remove all fixture temp roots. */
export async function cleanupServerFixtures() {
  const open = [...handles];
  handles.clear();
  await Promise.all(open.map((h) => h.close().catch(() => {})));
  await cleanupFixtures();
}

/**
 * Create an isolated server fixture: fresh temp root + real server on a
 * dynamic port. Returns { root, planRoot, store, handle }.
 *
 * serveOptions may override host/quiet/etc., but staticDir defaults to ""
 * (API-only) and port to 0 (OS-assigned) so tests never collide.
 */
export async function startServerFixture({ name = "server", seed = "minimal", opts = {}, serveOptions = {} } = {}) {
  const fixture = await createPlannerFixture({ name, seed, opts });
  const handle = await serve({
    planRoot: fixture.planRoot,
    port: 0,
    staticDir: "",
    quiet: true,
    ...serveOptions,
  });
  handles.add(handle);
  return { ...fixture, handle };
}

/** Close one fixture's server (its temp root is still removed by cleanupFixtures). */
export async function closeServerFixture(fixture) {
  handles.delete(fixture.handle);
  await fixture.handle.close();
}

/** Human-readable request/response diagnostic payload. */
export function diagnostic({ method, path, status, body, cause }) {
  const lines = [
    `[server-fixture] ${method} ${path}`,
    `  status: ${status}`,
    `  body: ${typeof body === "string" ? body : JSON.stringify(body ?? null)}`,
  ];
  if (cause) lines.push(`  cause: ${cause.message}`);
  return lines.join("\n");
}

/**
 * Fetch helper with diagnostics. Default contract:
 *  - network errors → throw with method/path context (connection refused
 *    after close, DNS, etc.)
 *  - non-2xx/3xx responses → throw with full request/response diagnostics
 *  - pass `expectStatus` to assert an exact status (200, 201, 404, …)
 * Returns { response, status, body } on success.
 */
export async function request(fixture, path, { expectStatus, ...init } = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const url = `${fixture.handle.url}${path}`;
  let response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    throw new Error(diagnostic({ method, path, status: "network-error", cause }), { cause });
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (expectStatus !== undefined) {
    if (response.status !== expectStatus) {
      throw new Error(diagnostic({ method, path, status: response.status, body }), {
        cause: new Error(`expected status ${expectStatus}, got ${response.status}`),
      });
    }
  } else if (response.status >= 400) {
    throw new Error(diagnostic({ method, path, status: response.status, body }));
  }
  return { response, status: response.status, body };
}

/**
 * Assert that a route FAILS with the expected status and returns the thrown
 * Error so tests can assert on the diagnostics text. This is how "route errors
 * are surfaced as test failures" is verified: an unexpected status or a silent
 * network failure is a failing assertion with full request/response context.
 */
export async function expectError(fixture, path, init, { status }) {
  const method = (init.method ?? "GET").toUpperCase();
  let err;
  try {
    await request(fixture, path, init); // no expectStatus → non-2xx/3xx throws
  } catch (e) {
    err = e;
  }
  if (!err) {
    throw new Error(`[server-fixture] expected ${method} ${path} to fail with status ${status}, but it succeeded`);
  }
  if (!new RegExp(`status: ${status}`).test(err.message)) {
    throw new Error(`[server-fixture] expected ${method} ${path} to fail with status ${status}, got:\n${err.message}`);
  }
  return err;
}
