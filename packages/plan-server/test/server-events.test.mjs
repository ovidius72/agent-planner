/**
 * T235 (P054/F015) — Server live events and static UI serving.
 *
 * Exercises the real Hono server + real WsHub (packages/plan-server) through
 * the T232 harness:
 *  - server startup/shutdown: dynamic port, close resolves, connections
 *    refused after close, WebSocket teardown
 *  - static Web UI serving: exact-file assets with content types, SPA
 *    fallback to index.html on unmatched GET, non-GET rejection, API/static
 *    route separation (known /api/* routes return JSON, never index.html),
 *    API-only mode when staticDir is disabled
 *  - live-sync events over a real WebSocket: connected, ping/pong, and the
 *    full broadcast map for feature/phase/task/requirement/project/handoff
 *    mutations with payload identifiers sufficient for the Web UI to
 *    revalidate (action + id/phaseId/featureId/taskId), plus file-changed
 *    from the real filesystem watcher
 *  - a polling event-await helper (no fixed sleeps → no flaky timing)
 *
 * No mocks: real HTTP, real WebSocket, real PlanStore, real filesystem.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import {
  startServerFixture,
  closeServerFixture,
  cleanupServerFixtures,
  request,
} from "../../../test/helpers/server-fixture.mjs";

after(async () => {
  await cleanupServerFixtures();
});

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const put = (body) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ── Event-await helper ─────────────────────────────────────────────────────
// Connect a real WebSocket to /ws, buffer incoming events, and WAIT (polling,
// no fixed sleeps) for an event matching a predicate. Safe against flaky
// timing: we wait for the event, never assume it already arrived.

async function connectWs(fixture) {
  const url = fixture.handle.url.replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(url);
  const state = { inbox: [], closed: false };
  ws.on("message", (raw) => {
    try {
      state.inbox.push(JSON.parse(raw.toString()));
    } catch {
      // ignore malformed frames
    }
  });
  ws.on("close", () => {
    state.closed = true;
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await waitForWs(state, (m) => m.type === "connected", 2000);
  return {
    ws,
    state,
    close: () =>
      new Promise((resolve) => {
        ws.once("close", resolve);
        ws.close();
      }),
  };
}

function waitForWs(state, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const found = state.inbox.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - started > timeoutMs) {
        const types = state.inbox.map((m) => m.type).join(",");
        return reject(new Error(`WS event timeout (no event matching predicate within ${timeoutMs}ms; saw: ${types || "none"})`));
      }
      setTimeout(check, 10);
    };
    check();
  });
}

// ── Startup / shutdown ─────────────────────────────────────────────────────

test("startup assigns a dynamic port; close resolves and refuses connections", async () => {
  const fx = await startServerFixture({ name: "t235-lifecycle" });
  assert.match(fx.handle.url, /^http:\/\/127\.0\.0\.1:\d+$/, "dynamic OS-assigned port");
  // server is actually serving (probe a real API route)
  const features = await request(fx, "/features");
  assert.ok(Array.isArray(features.body));

  await closeServerFixture(fx);
  // connection refused after close (handle.url is no longer listening)
  await assert.rejects(fetch(fx.handle.url + "/features"));
  // close is idempotent
  await fx.handle.close();
});

// ── Static Web UI serving ──────────────────────────────────────────────────

function writeUiDir(root) {
  const ui = join(root, "ui");
  mkdirSync(join(ui, "assets"), { recursive: true });
  writeFileSync(join(ui, "index.html"), "<!doctype html><html><body>agent-plan ui</body></html>");
  writeFileSync(join(ui, "assets", "app.js"), "console.log('app');");
  writeFileSync(join(ui, "assets", "app.css"), "body { color: red; }");
  return ui;
}

test("static SPA: exact assets, SPA fallback, non-GET rejection, API/static separation", async () => {
  const fx = await startServerFixture({ name: "t235-static" });
  const ui = writeUiDir(fx.root);
  await closeServerFixture(fx);

  // restart with the static UI enabled
  const fx2 = await startServerFixture({ name: "t235-static", serveOptions: { staticDir: ui } });
  const base = fx2.handle.url;

  // exact file assets with content types
  const root = await fetch(base + "/");
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await root.text(), /agent-plan ui/);

  const js = await fetch(base + "/assets/app.js");
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type") ?? "", /^application\/javascript/);
  assert.equal(await js.text(), "console.log('app');");

  const css = await fetch(base + "/assets/app.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /^text\/css/);

  // SPA fallback: unmatched GET → index.html
  const spa = await fetch(base + "/some/deep/spa/route");
  assert.equal(spa.status, 200);
  assert.match(spa.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await spa.text(), /agent-plan ui/, "SPA fallback serves index.html");

  // non-GET on unmatched path → JSON 404 (never SPA fallback)
  const post = await fetch(base + "/some/deep/spa/route", { method: "POST", body: "{}" });
  assert.equal(post.status, 404);
  assert.deepEqual(await post.json(), { error: "not found" });

  // API/static separation: known API routes return JSON under /api, never index.html
  const apiFeatures = await fetch(base + "/api/features");
  assert.equal(apiFeatures.status, 200);
  assert.match(apiFeatures.headers.get("content-type") ?? "", /^application\/json/);
  const body = await apiFeatures.json();
  assert.ok(Array.isArray(body), "GET /api/features → JSON array, not the SPA fallback");
  // project endpoint too
  const apiProject = await fetch(base + "/api/project");
  assert.equal(apiProject.status, 200);
  assert.ok((await apiProject.json()).name, "GET /api/project → JSON object");
});

test("API-only mode (staticDir disabled): root is not served, API still works", async () => {
  const fx = await startServerFixture({ name: "t235-api-only" }); // harness default staticDir ""
  const root = await fetch(fx.handle.url + "/");
  assert.equal(root.status, 404, "no static root in API-only mode");
  const features = await request(fx, "/features");
  assert.ok(Array.isArray(features.body));
});

test("task focus endpoint keeps checkpointed work in pending resume and marks pending resume", async () => {
  const fx = await startServerFixture({ name: "t289-task-focus" });
  const phase = (await fx.store.loadAllPhases())[0];
  const task = phase.tasks[0];
  const now = "2026-08-18T12:34:56.000Z";
  const snapshot = {
    id: "snapshot-1", reason: "Temporary prerequisite", whatWasBeingDone: "Implementing focus endpoint",
    resumeLocation: "src/serve.ts:640", howToResume: "Finish endpoint and rerun server tests",
    relatedTaskId: "temporary-task", pausedAt: now, pausedBy: "server-test",
  };
  await fx.store.updatePhase(phase.id, (stored) => {
    const target = stored.tasks.find((entry) => entry.id === task.id);
    target.status = "planned";
    target.pauseSnapshot = snapshot;
    target.pauseHistory = [snapshot];
    return stored;
  });
  await fx.store.addWorkDeviation({
    id: "deviation-1", recommendedTaskId: task.id, temporaryTaskId: "temporary-task",
    resumeTaskId: task.id, reason: snapshot.reason, snapshot, requestedBy: "agent", approvedBy: "test",
    state: "resume-required", createdAt: now, activatedAt: now, resumeRequiredAt: now, resolvedAt: "", resumedAt: "",
  });

  const focus = (await request(fx, "/tasks/focus")).body;
  assert.deepEqual(focus.active, []);
  assert.equal(focus.paused, undefined);
  assert.equal(focus.pendingResume.length, 1);
  assert.equal(focus.pendingResume[0].id, task.id);
  assert.equal(focus.pendingResume[0].pendingResume, true);
  assert.equal(focus.pendingResume[0].pauseSnapshot.resumeLocation, "src/serve.ts:640");

  const unsafeResume = await request(fx, `/tasks/${task.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...task, phaseId: phase.id, status: "in-progress" }), expectStatus: 400,
  });
  assert.match(unsafeResume.body.error, /Resume checkpoint lifecycle transitions require/);
  const unsafeCreate = await request(fx, `/phases/${phase.id}/tasks`, {
    ...json({ title: "Invalid paused task", status: "paused" }), expectStatus: 400,
  });
  assert.match(unsafeCreate.body.error, /cannot be created paused/);
});

test("task focus endpoint ignores done resume targets and stale deviations", async () => {
  const fx = await startServerFixture({ name: "t289-task-focus-done" });
  const phase = (await fx.store.loadAllPhases())[0];
  const task = phase.tasks[0];
  const now = "2026-08-18T12:34:56.000Z";
  const snapshot = {
    id: "snapshot-2", reason: "Temporary prerequisite", whatWasBeingDone: "Implementing focus endpoint",
    resumeLocation: "src/serve.ts:640", howToResume: "Finish endpoint and rerun server tests",
    relatedTaskId: "temporary-task", pausedAt: now, pausedBy: "server-test",
  };
  await fx.store.updatePhase(phase.id, (stored) => {
    const target = stored.tasks.find((entry) => entry.id === task.id);
    target.status = "planned";
    target.pauseSnapshot = snapshot;
    target.pauseHistory = [snapshot];
    return stored;
  });
  await fx.store.addWorkDeviation({
    id: "deviation-2", recommendedTaskId: task.id, temporaryTaskId: "temporary-task",
    resumeTaskId: task.id, reason: snapshot.reason, snapshot, requestedBy: "agent", approvedBy: "test",
    state: "resume-required", createdAt: now, activatedAt: now, resumeRequiredAt: now, resolvedAt: "", resumedAt: "",
  });
  await fx.store.updatePhase(phase.id, (stored) => {
    const target = stored.tasks.find((entry) => entry.id === task.id);
    target.status = "done";
    target.completedAt = now;
    return stored;
  });

  const focus = (await request(fx, "/tasks/focus")).body;
  assert.deepEqual(focus.active, []);
  assert.equal(focus.paused, undefined);
  assert.deepEqual(focus.pendingResume, []);
  assert.equal((await fx.store.loadProject()).workDeviations.length, 0);
});

// ── Live-sync events (real WebSocket) ──────────────────────────────────────

test("WS events on feature/requirement/phase/task mutations carry revalidation identifiers", async () => {
  const fx = await startServerFixture({ name: "t235-events" });
  const ws = await connectWs(fx);

  // feature create → features-updated {action:created, id, featureId} + plan-rendered
  const feature = (await request(fx, "/features", { ...json({ name: "Events feature", description: "d" }), expectStatus: 201 })).body;
  const featCreated = await waitForWs(ws.state, (m) => m.type === "features-updated" && m.data?.action === "created");
  assert.equal(featCreated.data.id, feature.id);
  assert.equal(featCreated.data.featureId, feature.id);
  await waitForWs(ws.state, (m) => m.type === "plan-rendered");

  // feature update → features-updated {action:updated}
  await request(fx, `/features/${feature.id}`, put({ ...feature, name: "Events feature v2" }));
  const featUpdated = await waitForWs(ws.state, (m) => m.type === "features-updated" && m.data?.action === "updated");
  assert.equal(featUpdated.data.id, feature.id);

  // requirement create → requirements-updated
  const now = "2026-01-01T00:00:00.000Z";
  const phase = (await request(fx, "/phases")).body[0];
  const req2 = (await request(fx, "/requirements", {
    ...json({
      id: crypto.randomUUID(), title: "Req events", description: "", status: "planned",
      macroTasks: [], linkedPhaseIds: ["P001"], createdAt: now, updatedAt: now,
    }),
    expectStatus: 201,
  })).body;
  const reqEvent = await waitForWs(ws.state, (m) => m.type === "requirements-updated");
  assert.ok(Array.isArray(reqEvent.data.requirements), "requirements-updated carries the document");
  assert.ok(reqEvent.data.requirements.some((r) => r.id === req2.id), "requirements-updated includes the created requirement");

  // phase create → phases-updated {action:created, id, phaseId, featureId}
  const phase2 = (await request(fx, "/phases", { ...json({ title: "Events phase", featureId: feature.id }), expectStatus: 201 })).body;
  const phaseCreated = await waitForWs(ws.state, (m) => m.type === "phases-updated" && m.data?.action === "created");
  assert.equal(phaseCreated.data.id, phase2.id);
  assert.equal(phaseCreated.data.phaseId, phase2.id);
  assert.equal(phaseCreated.data.featureId, feature.id);

  // task create → phases-updated {action:task-created, phaseId, taskId}
  const task = (await request(fx, `/phases/${phase2.id}/tasks`, { ...json({ title: "Task events" }), expectStatus: 201 })).body;
  const taskCreated = await waitForWs(ws.state, (m) => m.type === "phases-updated" && m.data?.action === "task-created");
  assert.equal(taskCreated.data.phaseId, phase2.id);
  assert.equal(taskCreated.data.taskId, task.id);

  // task update (rename, no status) → phases-updated {action:task-updated, taskId}
  await request(fx, `/tasks/${task.id}`, put({ phaseId: phase2.id, title: "Task events renamed" }));
  const taskUpdated = await waitForWs(ws.state, (m) => m.type === "phases-updated" && m.data?.action === "task-updated");
  assert.equal(taskUpdated.data.taskId, task.id);
  assert.equal(taskUpdated.data.phaseId, phase2.id);

  // phase update → phases-updated {action:updated, id, phaseId} (fresh body: a
  // stale PUT body would drop the just-created task, so re-fetch first)
  const phase2Fresh = (await request(fx, `/phases/${phase2.id}`)).body;
  await request(fx, `/phases/${phase2.id}`, put({ ...phase2Fresh, title: "Events phase v2" }));
  const phaseUpdated = await waitForWs(ws.state, (m) => m.type === "phases-updated" && m.data?.action === "updated");
  assert.equal(phaseUpdated.data.id, phase2.id);
  assert.equal(phaseUpdated.data.phaseId, phase2.id);

  // task delete → phases-updated {action:task-deleted, taskId}
  await request(fx, `/tasks/${task.id}`, { method: "DELETE" });
  const taskDeleted = await waitForWs(ws.state, (m) => m.type === "phases-updated" && m.data?.action === "task-deleted");
  assert.equal(taskDeleted.data.taskId, task.id);

  // phase delete → phases-updated {action:deleted}
  await request(fx, `/phases/${phase2.id}`, { method: "DELETE" });
  const phaseDeleted = await waitForWs(ws.state, (m) => m.type === "phases-updated" && m.data?.action === "deleted");
  assert.equal(phaseDeleted.data.id, phase2.id);

  // feature delete → features-updated {action:deleted}
  await request(fx, `/features/${feature.id}`, { method: "DELETE" });
  const featDeleted = await waitForWs(ws.state, (m) => m.type === "features-updated" && m.data?.action === "deleted");
  assert.equal(featDeleted.data.id, feature.id);

  ws.close();
});

test("WS events on project update, handoff lifecycle, watcher file-changed, ping/pong", async () => {
  const fx = await startServerFixture({ name: "t235-events2" });
  const ws = await connectWs(fx);
  const phase = (await request(fx, "/phases")).body[0];

  // project update → project-updated
  const project = (await request(fx, "/project")).body;
  await request(fx, "/project", put({ ...project, name: "Events project" }));
  const proj = await waitForWs(ws.state, (m) => m.type === "project-updated");
  assert.equal(proj.data.name, "Events project");

  // handoff write → handoffUpdated {phaseId}
  await request(fx, `/phases/${phase.id}/handoff`, put({ content: "handoff events" }));
  const hUpdated = await waitForWs(ws.state, (m) => m.type === "handoffUpdated");
  assert.equal(hUpdated.data.phaseId, phase.id);

  // handoff clear → handoffCleared {phaseId}
  await request(fx, `/phases/${phase.id}/handoff`, { method: "DELETE" });
  const hCleared = await waitForWs(ws.state, (m) => m.type === "handoffCleared");
  assert.equal(hCleared.data.phaseId, phase.id);

  // watcher: an external file write inside .planner/ → file-changed with the filename
  const probe = join(fx.planRoot, "probe-t235.txt");
  writeFileSync(probe, "external write");
  const fileChanged = await waitForWs(ws.state, (m) => m.type === "file-changed" && /probe-t235/.test(m.data?.filename ?? ""), 5000);
  assert.match(fileChanged.data.filename, /probe-t235/);
  rmSync(probe, { force: true });

  // protocol: client ping → pong
  ws.ws.send(JSON.stringify({ type: "ping" }));
  const pong = await waitForWs(ws.state, (m) => m.type === "pong");
  assert.equal(pong.data, "");

  ws.close();
});

// ── Listener/socket cleanup on close ───────────────────────────────────────

test("closing the server tears down the WebSocket connection", async () => {
  const fx = await startServerFixture({ name: "t235-ws-close" });
  const ws = await connectWs(fx);
  assert.equal(ws.state.closed, false);

  await closeServerFixture(fx);
  // the WS client must observe the server-side close
  await new Promise((resolve, reject) => {
    if (ws.state.closed) return resolve();
    ws.ws.once("close", () => resolve());
    setTimeout(() => reject(new Error("WS not closed by server teardown within 2s")), 2000);
  });
  assert.equal(ws.state.closed, true, "server close tears down the WebSocket");
});
