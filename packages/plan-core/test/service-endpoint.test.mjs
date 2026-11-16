/**
 * User-scoped service endpoint record (P128(F025)/T490).
 *
 * The runtime record at <home>/.agent-plan/runtime/server.json advertises the
 * one application service: protocol version, boot identity, loopback host and
 * port. A launcher verifies identity, protocol and boot epoch before reuse;
 * a structurally invalid record is removed, never served. Isolated mkdtemp
 * fixtures only; never a real HOME (AGENTS.md rule 17).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SERVICE_PROTOCOL_VERSION,
  readServiceEndpointRecord,
  removeServiceEndpointRecord,
  serviceEndpointRecordPath,
  serviceRuntimeDir,
  verifyLiveServiceEndpoint,
  writeServiceEndpointRecord,
} from "../dist/index.js";

const roots = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const tempHome = (name) => mkdtemp(join(tmpdir(), `agent-plan-endpoint-${name}-`));

const RECORD = { protocolVersion: "1", bootId: "boot-1", host: "127.0.0.1", port: 41000 };

test("the endpoint record round-trips atomically in the user runtime directory", async () => {
  const home = await tempHome("roundtrip");
  roots.push(home);
  assert.equal(await readServiceEndpointRecord(home), null, "no record before the first boot");
  await writeServiceEndpointRecord(RECORD, home);
  const record = await readServiceEndpointRecord(home);
  assert.deepEqual(record, RECORD);
  assert.equal(serviceRuntimeDir(home).endsWith(".agent-plan/runtime"), true, "the record lives in the user runtime directory");
  const raw = JSON.parse(await readFile(serviceEndpointRecordPath(home), "utf-8"));
  assert.equal(raw.protocolVersion, SERVICE_PROTOCOL_VERSION);
});

test("a structurally invalid record is removed and reported as absent, never served", async () => {
  const home = await tempHome("invalid");
  roots.push(home);
  await writeServiceEndpointRecord(RECORD, home);
  const path = serviceEndpointRecordPath(home);
  await writeFile(path, "not-json-at-all");
  assert.equal(await readServiceEndpointRecord(home), null, "a corrupt advertisement is not a service");
  await assert.rejects(() => readFile(path, "utf-8"), "the corrupt record file is removed");
});

test("a record whose host is not the loopback interface is invalid", async () => {
  const home = await tempHome("foreign-host");
  roots.push(home);
  await writeServiceEndpointRecord({ ...RECORD, host: "0.0.0.0" }, home);
  assert.equal(await readServiceEndpointRecord(home), null, "the service type constrains the host to 127.0.0.1");
});

test("a shutdown removes only its own boot record", async () => {
  const home = await tempHome("boot-ownership");
  roots.push(home);
  await writeServiceEndpointRecord(RECORD, home);
  await removeServiceEndpointRecord({ bootId: "other-boot", host: "127.0.0.1", port: 41000 }, home);
  assert.notEqual(await readServiceEndpointRecord(home), null, "another boot's shutdown never steals the advertisement");
  await removeServiceEndpointRecord({ bootId: "boot-1", host: "127.0.0.1", port: 41000 }, home);
  assert.equal(await readServiceEndpointRecord(home), null, "the owning boot removes its record");
});

test("verification refuses an endpoint that does not answer", async () => {
  const home = await tempHome("unreachable");
  roots.push(home);
  const result = await verifyLiveServiceEndpoint({ ...RECORD, port: 1 }, { acceptedProtocolVersions: [SERVICE_PROTOCOL_VERSION] });
  assert.deepEqual(result, { verified: false, reason: "unreachable" });
});
