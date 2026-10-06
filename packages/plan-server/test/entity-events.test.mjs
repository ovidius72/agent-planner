/**
 * entity-changed: exact change events, including writes made by another
 * process. A second PlanStore on the same folder plays the MCP server; the real
 * folder watcher and a real WebSocket deliver the events.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { PlanStore, TaskSchema, createTaskId } from "../../plan-core/dist/index.js";
import { diffSnapshots, snapshotOf } from "../dist/entity-events.js";
import { startServerFixture, cleanupServerFixtures } from "../../../test/helpers/server-fixture.mjs";

after(async () => {
  await cleanupServerFixtures();
});

async function connect(fixture) {
  const ws = new WebSocket(fixture.handle.url.replace(/^http/, "ws") + "/ws");
  const inbox = [];
  lastInbox = inbox;
  ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  await waitFor(() => inbox.some((m) => m.type === "connected"));
  await warmUpWatcher(fixture, inbox);
  return { ws, inbox, changes: () => inbox.filter((m) => m.type === "entity-changed").map((m) => m.data) };
}

let lastInbox = [];
/**
 * The operating system starts a folder watcher a moment after it is created, and
 * writes made in that gap are never reported (most often when the machine is busy).
 * Touch a scratch file until the server reports one, so a test only writes once the
 * watcher is known to be live. The scratch file is not a plan entity.
 */
async function warmUpWatcher(fixture, inbox) {
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const started = Date.now();
  for (let attempt = 0; !inbox.some((m) => m.type === "file-changed"); attempt += 1) {
    if (Date.now() - started > 15000) throw new Error("the folder watcher never reported a change");
    writeFileSync(join(fixture.planRoot, `.watcher-warmup-${attempt}`), "x");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  // Let the detector finish reacting to the warm-up before the test starts.
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function waitFor(predicate, timeoutMs = 12000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for condition; saw: ${lastInbox.map((m) => m.type).join(",")}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/** Let a quiet period pass so "nothing else arrived" is a fact, not a race. */
const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

function secondWriter(fixture) {
  return new PlanStore(fixture.planRoot);
}

async function firstTask(store) {
  const phases = await store.loadAllPhases();
  const phase = phases.find((p) => p.tasks.length > 0);
  return { phase, task: phase.tasks[0] };
}

test("a checklist change by another process reports the task, and only what actually changed", async () => {
  const fixture = await startServerFixture({ name: "ee-task", seed: "minimal" });
  const client = await connect(fixture);
  const writer = secondWriter(fixture);
  const { phase, task } = await firstTask(writer);

  await writer.updatePhase(phase.id, (current) => ({
    ...current,
    tasks: current.tasks.map((t) => t.id === task.id ? { ...t, notes: "changed", title: `${t.title} (edited)` } : t),
  }));
  await waitFor(() => client.changes().some((c) => c.kind === "task"));
  await settle();

  const taskChanges = client.changes().filter((c) => c.kind === "task");
  assert.equal(taskChanges.length, 1, "one event for the task");
  assert.equal(taskChanges[0].op, "updated");
  assert.equal(taskChanges[0].id, task.id);
  assert.match(taskChanges[0].ref, /^P\d{3}\(F\d{3}\)\/T\d{3}$/);
  assert.match(taskChanges[0].parents.phaseRef, /^P\d{3}\(F\d{3}\)$/);
  assert.equal(taskChanges[0].apiVersion, "1");
  assert.equal(client.changes().some((c) => c.kind === "feature"), false, "the feature did not change");
  client.ws.close();
});

test("creating and deleting a task are reported as created and deleted", async () => {
  const fixture = await startServerFixture({ name: "ee-create-delete", seed: "minimal" });
  const client = await connect(fixture);
  const writer = secondWriter(fixture);
  const { phase } = await firstTask(writer);
  const now = new Date().toISOString();
  const added = TaskSchema.parse({ id: createTaskId(), phaseId: phase.id, number: 900, shortName: "extra", title: "Extra", status: "planned", createdAt: now, updatedAt: now });

  await writer.updatePhase(phase.id, (current) => ({ ...current, tasks: [...current.tasks, added] }));
  await waitFor(() => client.changes().some((c) => c.kind === "task" && c.op === "created"));
  const created = client.changes().find((c) => c.kind === "task" && c.op === "created");
  assert.equal(created.id, added.id);
  assert.match(created.ref, /\/T900$/);

  await writer.updatePhase(phase.id, (current) => ({ ...current, tasks: current.tasks.filter((t) => t.id !== added.id) }));
  await waitFor(() => client.changes().some((c) => c.kind === "task" && c.op === "deleted"));
  const deleted = client.changes().find((c) => c.kind === "task" && c.op === "deleted");
  assert.equal(deleted.id, added.id);
  assert.equal(deleted.ref, created.ref, "a deleted entity keeps the ref it had");
  client.ws.close();
});

test("a project description change is reported as the project", async () => {
  const fixture = await startServerFixture({ name: "ee-project", seed: "minimal" });
  const client = await connect(fixture);
  await secondWriter(fixture).updateProject((project) => ({ ...project, description: "New description" }));
  await waitFor(() => client.changes().some((c) => c.kind === "project"));
  assert.deepEqual(client.changes().filter((c) => c.kind === "project").map((c) => c.op), ["updated"]);
  client.ws.close();
});

test("files that are not plan entities produce no entity event", async () => {
  const fixture = await startServerFixture({ name: "ee-noise", seed: "minimal" });
  const client = await connect(fixture);
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const seen = client.inbox.filter((m) => m.type === "file-changed").length;
  writeFileSync(join(fixture.planRoot, "scratch.txt"), "not a plan entity");
  await waitFor(() => client.inbox.filter((m) => m.type === "file-changed").length > seen);
  await settle();
  assert.equal(client.changes().length, 0);
  client.ws.close();
});

test("a burst of writes reports each changed entity once", async () => {
  const fixture = await startServerFixture({ name: "ee-burst", seed: "full" });
  const client = await connect(fixture);
  const writer = secondWriter(fixture);
  const phases = (await writer.loadAllPhases()).filter((p) => p.tasks.length > 0).slice(0, 2);
  const targets = phases.map((p) => ({ phase: p, task: p.tasks[0] }));

  for (let round = 0; round < 3; round += 1) {
    for (const { phase, task } of targets) {
      await writer.updatePhase(phase.id, (current) => ({
        ...current,
        tasks: current.tasks.map((t) => t.id === task.id ? { ...t, title: `${task.title} round ${round}` } : t),
      }));
    }
  }
  await waitFor(() => targets.every(({ task }) => client.changes().some((c) => c.kind === "task" && c.id === task.id)));
  await settle(700);

  for (const { task } of targets) {
    const forTask = client.changes().filter((c) => c.kind === "task" && c.id === task.id);
    assert.equal(forTask.length, 1, `task ${task.id} is reported once for the burst`);
  }
  client.ws.close();
});

test("the old events the web UI uses are still sent", async () => {
  const fixture = await startServerFixture({ name: "ee-legacy", seed: "minimal" });
  const client = await connect(fixture);
  const writer = secondWriter(fixture);
  const { phase } = await firstTask(writer);
  // The folder watcher can be slow when the whole suite runs in parallel, so keep
  // making distinct writes until the event shows up instead of trusting one.
  const started = Date.now();
  const seen = client.inbox.filter((m) => m.type === "file-changed").length;
  for (let attempt = 0; client.inbox.filter((m) => m.type === "file-changed").length <= seen; attempt += 1) {
    if (Date.now() - started > 20000) throw new Error("no file-changed event within 20s");
    await writer.updatePhase(phase.id, (current) => ({ ...current, summary: `touched ${attempt}` }));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  client.ws.close();
});

test("diffSnapshots names created, updated and deleted entities exactly", () => {
  const entry = (kind, key, view, ref = key) => ({ kind, key, id: key, ref, parents: {}, view });
  const before = snapshotOf([entry("task", "a", { v: 1 }), entry("task", "b", { v: 1 }), entry("feature", "f", { v: 1 })]);
  const after = snapshotOf([entry("task", "a", { v: 2 }), entry("task", "c", { v: 1 }), entry("feature", "f", { v: 1 })]);
  const changes = diffSnapshots(before, after).map((c) => `${c.kind}:${c.id}:${c.op}`).sort();
  assert.deepEqual(changes, ["task:a:updated", "task:b:deleted", "task:c:created"]);
  assert.deepEqual(diffSnapshots(after, after), []);
});
