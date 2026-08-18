/**
 * T232 (P054/F015) — Server integration harness verification.
 *
 * Proves the harness contract from test/helpers/server-fixture.mjs:
 *  - real Hono server on a dynamic port with static assets disabled
 *  - real PlanStore + real filesystem behind real HTTP (no mocks)
 *  - route errors surface as test failures with request/response diagnostics
 *  - every test starts from isolated filesystem state
 *  - mutations persist to .planner/ and are visible through HTTP
 *  - HTTP/WebSocket resources close reliably; temp roots are removed
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  startServerFixture,
  closeServerFixture,
  cleanupServerFixtures,
  request,
  expectError,
} from "../../../test/helpers/server-fixture.mjs";

after(async () => {
  await cleanupServerFixtures();
});

test("health, project, features and phases serve real fixture data over HTTP", async () => {
  const fx = await startServerFixture({ name: "harness-basic" });

  const health = await request(fx, "/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ok");
  assert.equal(health.body.root, fx.planRoot, "server rooted at the isolated temp planner");

  const project = await request(fx, "/project");
  assert.equal(project.status, 200);
  assert.equal(project.body.planRoot, fx.planRoot);

  const features = await request(fx, "/features");
  assert.equal(features.status, 200);
  assert.equal(features.body.length, 1, "minimal seed has one feature");
  assert.equal(features.body[0].name, "Auth API");

  const phases = await request(fx, "/phases");
  assert.equal(phases.status, 200);
  assert.equal(phases.body.length, 1);
  assert.equal(phases.body[0].tasks.length, 1, "phase task list served from real PlanStore");
  assert.equal(phases.body[0].tasks[0].title, "Implement login");
});

test("mutations persist to .planner/ and are visible through HTTP", async () => {
  const fx = await startServerFixture({ name: "harness-persist" });

  const created = await request(fx, "/features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Persistence check", description: "created over HTTP" }),
    expectStatus: 201,
  });
  assert.ok(created.body.id);
  assert.equal(created.body.name, "Persistence check");

  // visible through a fresh GET
  const features = await request(fx, "/features");
  assert.equal(features.body.length, 2);
  assert.ok(features.body.some((f) => f.id === created.body.id));

  // persisted on the real filesystem of THIS fixture only
  const onDisk = JSON.parse(readFileSync(`${fx.planRoot}/features/${created.body.id}.json`, "utf-8"));
  assert.equal(onDisk.name, "Persistence check");
});

test("route errors surface as failures with request/response diagnostics", async () => {
  const fx = await startServerFixture({ name: "harness-errors" });

  // unknown phase id → 404 from the route handler
  const missing = await request(fx, "/phases/00000000-0000-4000-8000-000000000000", { expectStatus: 404 });
  assert.equal(missing.body.error, "phase not found");

  // a 404 WITHOUT expectStatus throws, carrying method/path/status/body
  const err = await expectError(fx, "/phases/00000000-0000-4000-8000-000000000000", {}, { status: 404 });
  assert.match(err.message, /GET \/phases\/00000000-0000-4000-8000-000000000000/);
  assert.match(err.message, /status: 404/);
  assert.match(err.message, /body:/);

  // validation failure → 400 with the API's error payload
  const bad = await request(fx, "/features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "   " }),
    expectStatus: 400,
  });
  assert.equal(bad.body.error, "name required");

  // unmatched route → Hono default 404 with plain-text body (API-only, no SPA fallback)
  const unknown = await request(fx, "/definitely-not-a-route", { expectStatus: 404 });
  assert.equal(unknown.body, "404 Not Found");
  // static assets disabled: root does NOT serve the web UI
  const root = await request(fx, "/", { expectStatus: 404 });
  assert.equal(root.body, "404 Not Found");
});

test("every fixture starts from isolated filesystem state", async () => {
  const fxA = await startServerFixture({ name: "harness-iso-a" });
  const fxB = await startServerFixture({ name: "harness-iso-b", seed: "empty" });

  assert.notEqual(fxA.planRoot, fxB.planRoot, "distinct temp planners");

  // seed difference is real: A has the minimal feature, B (empty seed) has none
  const a = await request(fxA, "/features");
  const b = await request(fxB, "/features");
  assert.equal(a.body.length, 1);
  assert.equal(b.body.length, 0);

  // mutation on A is invisible on B
  await request(fxA, "/features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Only on A" }),
    expectStatus: 201,
  });
  const bAfter = await request(fxB, "/features");
  assert.equal(bAfter.body.length, 0, "B untouched by A's mutation");
});

test("close() drains HTTP/WebSocket resources and cleanup removes temp roots", async () => {
  const fx = await startServerFixture({ name: "harness-close" });
  const root = fx.root;
  assert.ok(existsSync(root), "temp root exists while server is up");

  await closeServerFixture(fx);

  // after close, fetch fails with a network error surfaced by the harness
  await assert.rejects(
    () => fetch(`${fx.handle.url}/health`),
    /fetch failed|ECONNREFUSED|terminated/i,
  );
  // the harness surfaces the same failure with diagnostics
  await assert.rejects(() => request(fx, "/health"), /network error|fetch failed/i);

  // cleanup removes the temp root and drains remaining handles
  await cleanupServerFixtures();
  assert.equal(existsSync(root), false, "temp root removed");
});
