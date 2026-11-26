/**
 * Service hardening and endpoint advertisement (P128(F025)/T490).
 *
 * The service binds 127.0.0.1 only, rejects foreign Host headers (DNS
 * rebinding), accepts writes and WebSocket upgrades only from the Agent
 * Plan UI and configured extra origins, resolves a principal for every
 * request, and advertises its boot identity in the user-scoped runtime
 * record. Isolated mkdtemp fixtures only; never a real .planner or HOME
 * (AGENTS.md rule 17).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import WebSocket from "ws";
import { cleanupServerFixtures, closeServerFixture, startServerFixture } from "../../../test/helpers/server-fixture.mjs";
import { connectRegisteredPlannerService, serve } from "../dist/index.js";
import { SERVICE_PROTOCOL_VERSION, readServiceEndpointRecord, serviceEndpointRecordPath, verifyLiveServiceEndpoint } from "../../../packages/plan-core/dist/index.js";

after(async () => {
  await cleanupServerFixtures();
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
});

const tempHome = (name) => mkdtemp(join(tmpdir(), `agent-plan-service-${name}-`));
const homes = [];
const withHome = (serveOptions = {}, name) => tempHome(name).then((home) => {
  homes.push(home);
  return { ...serveOptions, runtimeHome: home };
});

test("the service advertises its boot identity in the user-scoped runtime record", async () => {
  const home = await tempHome("advertise");
  homes.push(home);
  const handle = await connectRegisteredPlannerService({ home });
  try {
    const record = await readServiceEndpointRecord(homes.at(-1));
    assert.ok(record, "the runtime record exists after startup");
    assert.equal(record.host, "127.0.0.1");
    assert.equal(record.protocolVersion, SERVICE_PROTOCOL_VERSION);
    assert.equal(record.port, Number(new URL(handle.url).port));
    assert.equal(typeof record.bootId, "string");

    const health = await (await fetch(`${handle.url}/health`)).json();
    assert.equal(health.protocolVersion, SERVICE_PROTOCOL_VERSION);
    assert.equal(health.bootId, record.bootId, "the /health boot identity matches the advertisement");
    const verification = await verifyLiveServiceEndpoint(record, { acceptedProtocolVersions: [SERVICE_PROTOCOL_VERSION] });
    assert.deepEqual(verification, { verified: true });
  } finally {
    await handle.close();
    assert.equal(await readServiceEndpointRecord(homes.at(-1)), null, "close removes its own boot record");
  }
});

test("a structurally corrupt runtime record is removed, not served", async () => {
  const home = await tempHome("corrupt-record");
  homes.push(home);
  const handle = await connectRegisteredPlannerService({ home });
  try {
    await writeFile(serviceEndpointRecordPath(home), "{corrupt");
    assert.equal(await readServiceEndpointRecord(home), null, "a corrupt advertisement is not a service");
    await assert.rejects(() => readFile(serviceEndpointRecordPath(home), "utf-8"), "the corrupt record file is removed");
  } finally {
    await handle.close();
    assert.equal(await readServiceEndpointRecord(home), null, "close removes its own boot record");
  }
});

test("negotiation accepts an advertised adjacent protocol and checks the boot identity", async () => {
  const authority = "registered-projects";
  let health = { authority, protocolVersion: "2", acceptedProtocolVersions: ["2", "1"], bootId: "boot-fixture" };
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(health));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const record = { authority, bootId: health.bootId, protocolVersion: "2", host: "127.0.0.1", port: server.address().port };
    const options = { acceptedProtocolVersions: ["1"] };
    assert.deepEqual(await verifyLiveServiceEndpoint(record, options), { verified: true });
    health = { ...health, bootId: "different-fixture" };
    assert.deepEqual(await verifyLiveServiceEndpoint(record, options), { verified: false, reason: "boot-mismatch" });
    health = { ...health, bootId: record.bootId, acceptedProtocolVersions: ["2"] };
    assert.deepEqual(await verifyLiveServiceEndpoint(record, options), { verified: false, reason: "protocol-incompatible" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the service refuses to bind anything but the loopback interface", async () => {
  await assert.rejects(
    () => serve({ planRoot: undefined, host: "0.0.0.0", quiet: true }),
    /127\.0\.0\.1/,
  );
});

test("a foreign Host header is refused (DNS rebinding defense)", async () => {
  const fixture = await startServerFixture({ name: "svc-host-guard", serveOptions: await withHome({}, "host-guard") });
  try {
    const foreign = await rawRequest(fixture.handle.url, "/health", { Host: "evil.example" });
    assert.equal(foreign.status, 403);
    assert.equal((JSON.parse(foreign.body)).error, "UNTRUSTED_HOST");
    const loopback = await rawRequest(fixture.handle.url, "/health", { Host: "127.0.0.1" });
    assert.equal(loopback.status, 200, "the loopback name is accepted");
  } finally {
    await closeServerFixture(fixture);
  }
});

test("writes are accepted from the UI origin and header-less agents, refused from foreign origins", async () => {
  const fixture = await startServerFixture({ name: "svc-origin-guard", serveOptions: await withHome({}, "origin-guard") });
  try {
    const path = `${fixture.handle.url}/features`;
    const foreign = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" }, body: JSON.stringify({ name: "Foreign" }) });
    assert.equal(foreign.status, 403);
    assert.equal((await foreign.json()).error, "UNTRUSTED_ORIGIN");

    const own = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: fixture.handle.url }, body: JSON.stringify({ name: "Supervisor feature" }) });
    assert.notEqual(own.status, 403, "the service's own origin passes the write guard");

    const agent = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Agent feature" }) });
    assert.notEqual(agent.status, 403, "a header-less client is an agent, allowed by the loopback binding");
  } finally {
    await closeServerFixture(fixture);
  }
});

test("a WebSocket upgrade from a foreign origin is refused; the UI origin connects", async () => {
  const fixture = await startServerFixture({ name: "svc-ws-origin", serveOptions: await withHome({}, "ws-origin") });
  try {
    const wsUrl = fixture.handle.url.replace(/^http/, "ws");
    const refused = await wsOutcome(`${wsUrl}/ws`, { origin: "http://evil.example" });
    assert.equal(refused, "rejected", "a foreign browser origin never reaches the hub");
    const accepted = await wsOutcome(`${wsUrl}/ws`, { origin: fixture.handle.url });
    assert.equal(accepted, "connected", "the Agent Plan UI origin connects");
    const agent = await wsOutcome(`${wsUrl}/ws`, {});
    assert.equal(agent, "connected", "a header-less client is not a browser, allowed");
  } finally {
    await closeServerFixture(fixture);
  }
});

function rawRequest(baseUrl, path, headers) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path, method: "GET", headers }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

function wsOutcome(url, { origin }) {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, origin ? { headers: { origin } } : {});
    const settle = (outcome) => {
      try { socket.close(); } catch { /* already closed */ }
      resolve(outcome);
    };
    socket.on("open", () => {
      socket.once("message", () => settle("connected"));
    });
    socket.on("error", () => settle("rejected"));
    socket.on("unexpected-response", () => settle("rejected"));
  });
}

test("the explicitly configured local development UI can write and receive live updates", async () => {
  const preferred = "http://localhost:5175";
  const fallback = "http://localhost:62814";
  for (const origin of [preferred, fallback]) {
    const other = origin === preferred ? fallback : preferred;
    const fx = await startServerFixture({
      name: "svc-dev-origin",
      serveOptions: await withHome({ webUiOrigins: [origin] }, "dev-origin"),
    });
    try {
      const write = (origin) => fetch(`${fx.handle.url}/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ name: "Development feature", description: "Created using the dev proxy origin." }),
      });
      assert.equal((await write(origin)).ok, true);
      assert.equal((await write(other)).status, 403);
      const wsUrl = fx.handle.url.replace(/^http/, "ws");
      assert.equal(await wsOutcome(`${wsUrl}/ws`, { origin }), "connected");
      assert.equal(await wsOutcome(`${wsUrl}/ws`, { origin: other }), "rejected");
    } finally {
      await closeServerFixture(fx);
    }
  }
});
