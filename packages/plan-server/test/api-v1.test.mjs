/**
 * /api/v1 — the read-only outside API. Real server, real PlanStore, real HTTP.
 * The web UI's own routes are covered elsewhere; here only the v1 contract:
 * envelope, refs, filters, compact lists, errors and read-only enforcement.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServerFixture, cleanupServerFixtures } from "../../../test/helpers/server-fixture.mjs";

after(async () => {
  await cleanupServerFixtures();
});

async function get(fixture, path) {
  const response = await fetch(`${fixture.handle.url}${path}`);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test("index and /health report the api version", async () => {
  const fixture = await startServerFixture({ name: "v1-index", seed: "full" });
  const index = await get(fixture, "/api/v1");
  assert.equal(index.status, 200);
  assert.equal(index.body.apiVersion, "1");
  assert.equal(index.body.data.links.tasks, "/api/v1/tasks");
  const health = await get(fixture, "/health");
  assert.equal(health.body.apiVersion, "1");
});

test("every collection replies with the envelope and human refs", async () => {
  const fixture = await startServerFixture({ name: "v1-collections", seed: "full" });
  for (const name of ["features", "phases", "tasks", "decisions", "handoffs", "ideas"]) {
    const { status, body } = await get(fixture, `/api/v1/${name}`);
    assert.equal(status, 200, name);
    assert.equal(body.apiVersion, "1", name);
    assert.ok(Array.isArray(body.data), name);
  }
  const project = await get(fixture, "/api/v1/project");
  assert.equal(project.status, 200);
  assert.equal(typeof project.body.data.name, "string");

  const features = (await get(fixture, "/api/v1/features")).body.data;
  assert.ok(features.length > 0);
  assert.match(features[0].ref, /^F\d{3}$/);
  const tasks = (await get(fixture, "/api/v1/tasks")).body.data;
  assert.match(tasks[0].ref, /^P\d{3}(\(F\d{3}\))?\/T\d{3}$/);
});

test("a single entity resolves by composite ref, short form, id and short id; nothing fuzzy", async () => {
  const fixture = await startServerFixture({ name: "v1-refs", seed: "full" });
  const [task] = (await get(fixture, "/api/v1/tasks")).body.data;
  const byRef = await get(fixture, `/api/v1/tasks/${encodeURIComponent(task.ref)}`);
  assert.equal(byRef.status, 200);
  assert.equal(byRef.body.data.id, task.id);
  const rawSlash = await get(fixture, `/api/v1/tasks/${task.ref}`);
  assert.equal(rawSlash.body.data.id, task.id, "an unencoded slash in a composite ref works too");
  assert.equal((await get(fixture, `/api/v1/tasks/T${String(task.number).padStart(3, "0")}`)).body.data.id, task.id);
  assert.equal((await get(fixture, `/api/v1/tasks/${task.id}`)).body.data.id, task.id);
  if (task.shortId) assert.equal((await get(fixture, `/api/v1/tasks/${task.shortId}`)).body.data.id, task.id);
  const fuzzy = await get(fixture, `/api/v1/tasks/${encodeURIComponent(task.title.slice(0, 4))}`);
  assert.equal(fuzzy.status, 404, "titles are never matched");

  const [phase] = (await get(fixture, "/api/v1/phases")).body.data;
  assert.equal((await get(fixture, `/api/v1/phases/${encodeURIComponent(phase.ref)}`)).body.data.id, phase.id);
  assert.equal((await get(fixture, `/api/v1/phases/${phase.ref.replace(/\(F\d+\)/, "")}`)).body.data.id, phase.id);
  const [feature] = (await get(fixture, "/api/v1/features")).body.data;
  assert.equal((await get(fixture, `/api/v1/features/${feature.ref}`)).body.data.id, feature.id);
});

test("filters: phases by feature, tasks by phase and status, decisions by owner", async () => {
  const fixture = await startServerFixture({ name: "v1-filters", seed: "full" });
  const features = (await get(fixture, "/api/v1/features")).body.data;
  const phases = (await get(fixture, `/api/v1/phases?feature=${features[0].ref}`)).body.data;
  assert.ok(phases.length > 0);
  assert.ok(phases.every((phase) => phase.featureRef === features[0].ref));
  const phase = phases[0];
  const tasks = (await get(fixture, `/api/v1/tasks?phase=${encodeURIComponent(phase.ref)}`)).body.data;
  assert.ok(tasks.every((task) => task.phaseRef === phase.ref));
  const planned = (await get(fixture, "/api/v1/tasks?status=planned")).body.data;
  assert.ok(planned.every((task) => task.status === "planned"));
  const missingFeature = await get(fixture, "/api/v1/phases?feature=F999");
  assert.equal(missingFeature.status, 404);
  assert.equal(missingFeature.body.error.code, "NOT_FOUND");
  const projectDecisions = (await get(fixture, "/api/v1/decisions?owner=project")).body.data;
  assert.ok(projectDecisions.every((decision) => decision.owner.kind === "project"));
});

test("compact=true leaves out long text but keeps identity and status", async () => {
  const fixture = await startServerFixture({ name: "v1-compact", seed: "full" });
  const full = (await get(fixture, "/api/v1/tasks")).body.data;
  const compact = (await get(fixture, "/api/v1/tasks?compact=true")).body.data;
  assert.equal(compact.length, full.length);
  assert.equal("description" in compact[0], false);
  assert.equal(compact[0].ref, full[0].ref);
  assert.equal(compact[0].status, full[0].status);
  assert.equal("description" in full[0], true);
});

test("unknown refs and routes return the error envelope with 404", async () => {
  const fixture = await startServerFixture({ name: "v1-404", seed: "minimal" });
  for (const path of ["/api/v1/tasks/T9999", "/api/v1/phases/P999", "/api/v1/features/F999", "/api/v1/handoffs/P999", "/api/v1/ideas/I999", "/api/v1/nothing"]) {
    const { status, body } = await get(fixture, path);
    assert.equal(status, 404, path);
    assert.equal(body.apiVersion, "1", path);
    assert.equal(body.error.code, "NOT_FOUND", path);
    assert.equal(typeof body.error.message, "string", path);
  }
});

test("every method except GET is refused with 405 and changes nothing", async () => {
  const fixture = await startServerFixture({ name: "v1-405", seed: "minimal" });
  const before = await get(fixture, "/api/v1/tasks");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await fetch(`${fixture.handle.url}/api/v1/tasks`, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : "{}" });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "GET");
    assert.equal((await response.json()).error.code, "METHOD_NOT_ALLOWED");
  }
  assert.deepEqual((await get(fixture, "/api/v1/tasks")).body, before.body);
});

test("a handoff is listed and fetched by its phase ref", async () => {
  const fixture = await startServerFixture({ name: "v1-handoff", seed: "full" });
  const handoffs = (await get(fixture, "/api/v1/handoffs")).body.data;
  if (handoffs.length === 0) return; // seed without an active handoff
  const one = await get(fixture, `/api/v1/handoffs/${encodeURIComponent(handoffs[0].phaseRef)}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.data.phaseRef, handoffs[0].phaseRef);
  assert.equal(typeof one.body.data.resumeReady, "boolean");
});

test("the web UI routes keep answering without the envelope", async () => {
  const fixture = await startServerFixture({ name: "v1-ui-untouched", seed: "minimal", serveOptions: { staticDir: "" } });
  const features = await fetch(`${fixture.handle.url}/features`);
  assert.equal(features.status, 200);
  assert.ok(Array.isArray(await features.json()), "the UI route still returns a bare array");
});

test("the API is also served when the web UI bundle is mounted under /api", async () => {
  const fixture = await startServerFixture({ name: "v1-static", seed: "minimal", serveOptions: { staticDir: undefined } });
  const { status, body } = await get(fixture, "/api/v1/project");
  assert.equal(status, 200);
  assert.equal(body.apiVersion, "1");
});
