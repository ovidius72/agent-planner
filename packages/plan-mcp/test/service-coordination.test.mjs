import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rename } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPlannerFixture } from "../../../test/helpers/fixtures.mjs";
import { callTool, cleanupMcpFixtures, startMcpClient } from "../../../test/helpers/mcp-fixture.mjs";
import { readLiveServerRecord, serve, serverRecordPath } from "@agent-plan/server";
import {
  ensurePlannerService,
  plannerApiForSession,
  resetPlannerSessions,
  stopPlannerService,
  stopPlannerSessionHeartbeats,
} from "../dist/service.js";

after(cleanupMcpFixtures);

test("concurrent startup and transport registration reuse the authority without sharing identities", async () => {
  const fixture = await createPlannerFixture({ name: "mcp-service-coordination" });
  const oldHomedir = os.homedir;
  os.homedir = () => fixture.root;
  syncBuiltinESMExports();
  try {
    const root = fixture.planRoot;
    const [first, second] = await Promise.all([ensurePlannerService(root), ensurePlannerService(root)]);
    assert.ok(first.localUrl);
    assert.equal(first.localUrl, second.localUrl);
    assert.equal([first, second].filter((entry) => entry.reused === false).length, 1);

    const [a, aAgain, b] = await Promise.all([
      plannerApiForSession(root, "transport-a", { clientKind: "mcp" }),
      plannerApiForSession(root, "transport-a", { clientKind: "mcp" }),
      plannerApiForSession(root, "transport-b", { clientKind: "mcp" }),
    ]);
    assert.equal(a.sessionId, aAgain.sessionId);
    assert.notEqual(a.sessionId, b.sessionId);
    assert.equal(a.client.sessionId, a.sessionId);
    assert.equal(b.client.sessionId, b.sessionId);
    await Promise.all([
      a.client.request("GET", "/context/guidelines"),
      b.client.request("GET", "/context/guidelines"),
    ]);
    assert.equal((await fixture.store.loadPlannerSessions()).length, 2);

    await stopPlannerService();
    const reconnected = await plannerApiForSession(root, "transport-a", { clientKind: "mcp" });
    assert.equal(reconnected.sessionId, a.sessionId);
    await reconnected.client.request("GET", "/context/guidelines");
  } finally {
    await stopPlannerService();
    resetPlannerSessions();
    os.homedir = oldHomedir;
    syncBuiltinESMExports();
  }
});

test("a registered MCP session renews against the live endpoint until heartbeat shutdown", async (t) => {
  const fixture = await createPlannerFixture({ name: "mcp-heartbeat" });
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds, ...args) =>
    realSetTimeout(callback, milliseconds === 30_000 ? 20 : milliseconds, ...args));
  try {
    const { sessionId } = await plannerApiForSession(fixture.planRoot, "heartbeat", { clientKind: "mcp" });
    const readSession = async () => (await fixture.store.loadPlannerSessions()).find((session) => session.sessionId === sessionId);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const record = await readSession();
      if (record.lastSeenAt > record.registeredAt) break;
      await delay(10);
    }
    const renewed = await readSession();
    assert.ok(renewed.lastSeenAt > renewed.registeredAt);
    stopPlannerSessionHeartbeats();
    await delay(40);
    const stopped = await readSession();
    await delay(50);
    assert.equal((await readSession()).lastSeenAt, stopped.lastSeenAt);
  } finally {
    await stopPlannerService();
    resetPlannerSessions();
  }
});

test("a copied server advertisement is ignored across planner roots", async () => {
  const source = await createPlannerFixture({ name: "service-source" });
  const destination = await createPlannerFixture({ name: "service-destination" });
  const owner = await serve({ planRoot: source.planRoot, port: 0, runtimeHome: source.root, staticDir: "", quiet: true });
  try {
    await writeFile(serverRecordPath(destination.planRoot), await readFile(serverRecordPath(source.planRoot)));
    assert.equal(await readLiveServerRecord(destination.planRoot), null);
    assert.equal((await readLiveServerRecord(source.planRoot)).localUrl, owner.localUrl);
  } finally {
    await owner.close();
  }
});

test("an incompatible but live root endpoint is preserved and refused", async () => {
  const fixture = await createPlannerFixture({ name: "mcp-incompatible-service" });
  const server = await serve({ planRoot: fixture.planRoot, port: 0, runtimeHome: fixture.root, staticDir: "", quiet: true });
  try {
    const path = serverRecordPath(fixture.planRoot);
    const record = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...record, protocolVersion: "incompatible" }));
    const result = await ensurePlannerService(fixture.planRoot);
    assert.match(result.error, /incompatible/);
    assert.equal((await readLiveServerRecord(fixture.planRoot)).localUrl, server.localUrl);
    assert.deepEqual(await stopPlannerService(fixture.planRoot), { stopped: false, foreign: true, url: server.localUrl });
    assert.ok((await fetch(`${server.localUrl}/health`)).ok);
  } finally {
    await server.close();
  }
});

test("two MCP subprocesses that load at once discover the same endpoint", async () => {
  const fixture = await createPlannerFixture({ name: "mcp-cross-process-start" });
  const preload = join(fixture.root, "runtime-home.mjs");
  await writeFile(preload, `import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
os.homedir = () => ${JSON.stringify(fixture.root)};
syncBuiltinESMExports();`);
  const options = { planRoot: fixture.planRoot, env: { NODE_OPTIONS: `--import=${preload}` } };
  const [first, second] = await Promise.all([
    startMcpClient({ ...options, name: "concurrent-first" }),
    startMcpClient({ ...options, name: "concurrent-second" }),
  ]);
  try {
    const runs = await Promise.all([first, second].map((client) => callTool(client, "planner-load", {})));
    const endpoints = runs.map((result) => result.structuredContent.webUi.address);
    assert.match(endpoints[0], /^http:\/\/127\.0\.0\.1:/);
    assert.equal(endpoints[0], endpoints[1]);
    assert.equal((await readLiveServerRecord(fixture.planRoot)).localUrl, endpoints[0]);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("a startup coordination failure leaves the endpoint unpublished", async () => {
  const fixture = await createPlannerFixture({ name: "mcp-start-failure" });
  const localDirectory = join(fixture.planRoot, ".local");
  const locksPath = join(localDirectory, "locks");
  await rename(locksPath, join(localDirectory, "original-locks"));
  await writeFile(locksPath, "occupied");
  const result = await ensurePlannerService(fixture.planRoot);
  assert.equal(result.localUrl, "");
  assert.ok(result.error);
  assert.equal(await readLiveServerRecord(fixture.planRoot), null);
});
