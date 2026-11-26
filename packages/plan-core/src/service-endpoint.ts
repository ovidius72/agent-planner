/**
 * User-scoped service endpoint record (P128(F025)/T490).
 *
 * One application service serves every client of one OS user
 * (architecture.md §2). Its connection information is advertised in
 * `~/.agent-plan/runtime/server.json` as a `ServiceEndpointRecord`
 * (project-descriptor.ts — the T489 port implemented here): protocol
 * version, boot identity, loopback host and port. A second launcher
 * verifies the advertised identity, protocol and boot epoch before
 * reusing a service — a PID or an open port alone is insufficient proof
 * of compatibility.
 *
 * The record only advertises connection information. It is never an
 * operational store: project registrations live in the project database.
 * A structurally invalid record is removed and reported as absent, so a
 * corrupted advertisement can never block a fresh boot.
 */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceEndpointRecord } from "./project-descriptor.js";
import { withPlanServiceLock } from "./write-coordination.js";

export type { ServiceEndpointRecord } from "./project-descriptor.js";

/**
 * Protocol version this service build speaks. The service accepts the
 * current and the previous protocol generation; bump only through the
 * contract's explicit version-transition rule (domain-contract.md §0).
 */
export const SERVICE_PROTOCOL_VERSION = "1";

export function compatibleServiceProtocols(version = SERVICE_PROTOCOL_VERSION): readonly string[] {
  const current = Number(version);
  return Number.isSafeInteger(current) && current > 1 ? [version, String(current - 1)] : [version];
}

/** Directory holding the user-scoped runtime records. */
export const SERVICE_RUNTIME_DIR_NAME = ".agent-plan";
export const SERVICE_RUNTIME_SUBDIR = "runtime";
/** Name of the advertised endpoint record inside the runtime directory. */
export const SERVICE_ENDPOINT_RECORD_NAME = "server.json";

/** How long a liveness verification waits for /health before giving up. */
const ENDPOINT_HEALTH_TIMEOUT_MS = 1000;

/** The user-scoped runtime directory for the given HOME (default: real home). */
export function serviceRuntimeDir(home: string = homedir()): string {
  return join(home, SERVICE_RUNTIME_DIR_NAME, SERVICE_RUNTIME_SUBDIR);
}

/** Path of the advertised endpoint record for the given HOME. */
export function serviceEndpointRecordPath(home: string = homedir()): string {
  return join(serviceRuntimeDir(home), SERVICE_ENDPOINT_RECORD_NAME);
}

function isServiceEndpointRecord(value: unknown): value is ServiceEndpointRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.protocolVersion === "string" && typeof record.bootId === "string"
    && (record.runtimeVersion === undefined || typeof record.runtimeVersion === "string")
    && (record.authority === undefined || record.authority === "registered-projects")
    && record.host === "127.0.0.1" && typeof record.port === "number"
    && Number.isInteger(record.port) && record.port > 0 && record.port <= 65_535;
}

async function inspectServiceEndpointRecord(path: string): Promise<ServiceEndpointRecord | "invalid" | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isServiceEndpointRecord(parsed)) return parsed;
  } catch {
    // A malformed record follows the same cleanup path as an invalid shape.
  }
  return "invalid";
}

/** Read the advertised boot, removing a corrupt record under the publication lock. */
export async function readServiceEndpointRecord(home: string = homedir()): Promise<ServiceEndpointRecord | null> {
  const path = serviceEndpointRecordPath(home);
  const recorded = await inspectServiceEndpointRecord(path);
  if (recorded !== "invalid") return recorded;
  return withPlanServiceLock(serviceRuntimeDir(home), "record", async () => {
    const current = await inspectServiceEndpointRecord(path);
    if (current !== "invalid") return current;
    await rm(path, { force: true });
    return null;
  }).catch(() => null);
}

/**
 * Publish the endpoint record atomically (temp file + rename), so a crash
 * never leaves a half-written advertisement. Returns the record written.
 */
export async function writeServiceEndpointRecord(
  record: ServiceEndpointRecord,
  home: string = homedir(),
): Promise<ServiceEndpointRecord> {
  const path = serviceEndpointRecordPath(home);
  const runtimeDir = serviceRuntimeDir(home);
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  return withPlanServiceLock(runtimeDir, "record", async () => {
    const temporary = `${path}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
      await rename(temporary, path);
      return record;
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  });
}

/**
 * Remove the record, but only when it describes exactly this boot (bootId
 * and address): a running service must never have its advertisement stolen
 * by another process shutting down. Never throws.
 */
export async function removeServiceEndpointRecord(
  owner: { bootId: string; host: string; port: number },
  home: string = homedir(),
): Promise<void> {
  try {
    const path = serviceEndpointRecordPath(home);
    if (!await inspectServiceEndpointRecord(path)) return;
    await withPlanServiceLock(serviceRuntimeDir(home), "record", async () => {
      const record = await inspectServiceEndpointRecord(path);
      if (record === "invalid" || (record && record.bootId === owner.bootId && record.host === owner.host && record.port === owner.port)) {
        await rm(path, { force: true });
      }
    });
  } catch {
    // The record is an advertisement; failing to clean it must not throw.
  }
}

export interface ServiceEndpointVerification {
  /** The record answers /health with the same boot identity and an accepted protocol. */
  verified: true;
}

export type ServiceEndpointVerificationResult =
  | ServiceEndpointVerification
  | { verified: false; reason: "unreachable" | "protocol-incompatible" | "boot-mismatch" };

/**
 * Verify that the advertised endpoint is really this service: /health must
 * answer on the loopback address with the advertised bootId and a protocol
 * version the caller accepts (architecture.md §2 — verify identity and
 * protocol, not just an open port).
 */
export async function verifyLiveServiceEndpoint(
  record: ServiceEndpointRecord,
  options: { acceptedProtocolVersions: readonly string[] },
): Promise<ServiceEndpointVerificationResult> {
  let body: { protocolVersion?: unknown; bootId?: unknown; authority?: unknown; runtimeVersion?: unknown; acceptedProtocolVersions?: unknown };
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(ENDPOINT_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return { verified: false, reason: "unreachable" };
    body = (await response.json()) as typeof body;
  } catch {
    return { verified: false, reason: "unreachable" };
  }
  if (typeof body.protocolVersion !== "string") return { verified: false, reason: "protocol-incompatible" };
  const advertised: unknown[] = Array.isArray(body.acceptedProtocolVersions) ? body.acceptedProtocolVersions : [];
  const serverProtocols = compatibleServiceProtocols(body.protocolVersion);
  if (!options.acceptedProtocolVersions.includes(body.protocolVersion)
    && !options.acceptedProtocolVersions.some((version) => advertised.includes(version) && serverProtocols.includes(version))) {
    return { verified: false, reason: "protocol-incompatible" };
  }
  if (body.bootId !== record.bootId || body.protocolVersion !== record.protocolVersion
    || (record.authority && body.authority !== record.authority)
    || (record.runtimeVersion && body.runtimeVersion !== record.runtimeVersion)) {
    return { verified: false, reason: "boot-mismatch" };
  }
  return { verified: true };
}
