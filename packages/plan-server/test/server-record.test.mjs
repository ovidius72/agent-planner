/**
 * server.json: the record of a running planner server, written by serve() so
 * every starter (CLI, MCP, Pi) gets it, and read by programs that want to reuse
 * a server instead of starting a second one.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { startServerFixture, cleanupServerFixtures, closeServerFixture } from "../../../test/helpers/server-fixture.mjs";
import { serve, readLiveServerRecord, serverRecordPath } from "../dist/index.js";

after(async () => {
  await cleanupServerFixtures();
});

const exists = (path) => access(path).then(() => true, () => false);

test("a started server writes server.json and close removes it", async () => {
  const fixture = await startServerFixture({ name: "sr-basic" });
  const path = serverRecordPath(fixture.planRoot);
  const record = JSON.parse(await readFile(path, "utf-8"));
  assert.equal(record.kind, "embedded", "a server started from code is embedded unless it says otherwise");
  assert.equal(record.pid, process.pid);
  assert.equal(record.localUrl, fixture.handle.localUrl);
  assert.equal(record.root, fixture.store.root);
  assert.equal(record.apiVersion, "1");
  assert.equal(typeof record.version, "string");
  assert.equal(typeof record.port, "number");
  assert.equal(typeof record.startedAt, "string");
  assert.equal((await readLiveServerRecord(fixture.planRoot)).localUrl, fixture.handle.localUrl);
  await closeServerFixture(fixture);
  assert.equal(await exists(path), false, "close removes its own record");
  assert.equal(await readLiveServerRecord(fixture.planRoot), null);
});

test("/health tells a client which server it is talking to", async () => {
  const fixture = await startServerFixture({ name: "sr-health" });
  const body = await (await fetch(`${fixture.handle.url}/health`)).json();
  assert.equal(body.status, "ok");
  assert.equal(body.pid, process.pid);
  assert.equal(body.apiVersion, "1");
  assert.equal(typeof body.version, "string");
  assert.equal(body.root, fixture.store.root);
});

test("a record whose process is gone is ignored, deleted and replaced", async () => {
  const fixture = await startServerFixture({ name: "sr-stale", serveOptions: { recordServer: false } });
  const path = serverRecordPath(fixture.planRoot);
  await mkdir(join(fixture.planRoot, ".local"), { recursive: true });
  await writeFile(path, JSON.stringify({ kind: "embedded", pid: 2 ** 22 + 12345, url: "http://127.0.0.1:1", localUrl: "http://127.0.0.1:1", lanUrl: null, host: "127.0.0.1", port: 1, root: fixture.store.root, startedAt: "x", version: "0", apiVersion: "1" }));
  assert.equal(await readLiveServerRecord(fixture.planRoot), null);
  assert.equal(await exists(path), false, "the stale record is deleted");

  await writeFile(path, JSON.stringify({ kind: "embedded", pid: 2 ** 22 + 12345, localUrl: "http://127.0.0.1:1", root: fixture.store.root }));
  const replacement = await serve({ planRoot: fixture.planRoot, port: 0, staticDir: "", quiet: true });
  try {
    assert.equal(JSON.parse(await readFile(path, "utf-8")).localUrl, replacement.localUrl, "a new server replaces a stale record");
  } finally {
    await replacement.close();
  }
});

test("a record whose process is alive but whose address does not answer is stale", async () => {
  const fixture = await startServerFixture({ name: "sr-dead-port", serveOptions: { recordServer: false } });
  await mkdir(join(fixture.planRoot, ".local"), { recursive: true });
  await writeFile(serverRecordPath(fixture.planRoot), JSON.stringify({ kind: "embedded", pid: process.pid, localUrl: "http://127.0.0.1:1", root: fixture.store.root }));
  assert.equal(await readLiveServerRecord(fixture.planRoot), null);
});

test("the first live server keeps the record; a second one neither overwrites nor removes it", async () => {
  const first = await startServerFixture({ name: "sr-two" });
  const second = await serve({ planRoot: first.planRoot, port: 0, staticDir: "", quiet: true });
  const path = serverRecordPath(first.planRoot);
  assert.notEqual(second.localUrl, first.handle.localUrl);
  assert.equal(JSON.parse(await readFile(path, "utf-8")).localUrl, first.handle.localUrl, "the first server still owns the record");
  await second.close();
  assert.equal(JSON.parse(await readFile(path, "utf-8")).localUrl, first.handle.localUrl, "closing the second leaves the record alone");
  assert.equal((await readLiveServerRecord(first.planRoot)).localUrl, first.handle.localUrl);
});

test("a corrupt record is ignored and does not stop a server from starting", async () => {
  const fixture = await startServerFixture({ name: "sr-corrupt", serveOptions: { recordServer: false } });
  await mkdir(join(fixture.planRoot, ".local"), { recursive: true });
  await writeFile(serverRecordPath(fixture.planRoot), "{ not json");
  assert.equal(await readLiveServerRecord(fixture.planRoot), null);
  const handle = await serve({ planRoot: fixture.planRoot, port: 0, staticDir: "", quiet: true });
  try {
    assert.equal(JSON.parse(await readFile(serverRecordPath(fixture.planRoot), "utf-8")).localUrl, handle.localUrl);
  } finally {
    await handle.close();
  }
});

test("recordServer: false writes no record", async () => {
  const fixture = await startServerFixture({ name: "sr-off", serveOptions: { recordServer: false } });
  assert.equal(await exists(serverRecordPath(fixture.planRoot)), false);
});

test("a folder that cannot hold the record does not stop the server", async () => {
  const fixture = await startServerFixture({ name: "sr-blocked", serveOptions: { recordServer: false } });
  // A file where the .local directory should be makes every write fail.
  await writeFile(join(fixture.planRoot, ".local-blocker"), "x");
  const { rm } = await import("node:fs/promises");
  await rm(join(fixture.planRoot, ".local"), { recursive: true, force: true });
  await writeFile(join(fixture.planRoot, ".local"), "i am a file");
  const handle = await serve({ planRoot: fixture.planRoot, port: 0, staticDir: "", quiet: true });
  try {
    assert.equal((await fetch(`${handle.url}/health`)).status, 200);
  } finally {
    await handle.close();
    await rm(join(fixture.planRoot, ".local"), { force: true });
  }
});
