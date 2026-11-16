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

import { homedir } from "node:os";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServiceEndpointRecord } from "./project-descriptor.js";

export type { ServiceEndpointRecord } from "./project-descriptor.js";

/**
 * Protocol version this service build speaks. The service accepts the
 * current and the previous protocol generation; bump only through the
 * contract's explicit version-transition rule (domain-contract.md §0).
 */
export const SERVICE_PROTOCOL_VERSION = "1";

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
    && record.host === "127.0.0.1" && typeof record.port === "number";
}

/**
 * The advertised record for this user, or null when none exists or the
 * file is stale/structurally invalid (a corrupt record is removed, never
 * served — an unreadable advertisement is not a service).
 */
export async function readServiceEndpointRecord(home: string = homedir()): Promise<ServiceEndpointRecord | null> {
  const path = serviceEndpointRecordPath(home);
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
    // fall through to removal
  }
  await rm(path, { force: true }).catch(() => {});
  return null;
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
  await mkdir(serviceRuntimeDir(home), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
  return record;
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
    const record = await readServiceEndpointRecord(home);
    if (record && record.bootId === owner.bootId && record.host === owner.host && record.port === owner.port) {
      await rm(serviceEndpointRecordPath(home), { force: true });
    }
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
  let body: { protocolVersion?: unknown; bootId?: unknown };
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/health`, {
      signal: AbortSignal.timeout(ENDPOINT_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return { verified: false, reason: "unreachable" };
    body = (await response.json()) as { protocolVersion?: unknown; bootId?: unknown };
  } catch {
    return { verified: false, reason: "unreachable" };
  }
  if (typeof body.protocolVersion !== "string" || !options.acceptedProtocolVersions.includes(body.protocolVersion)) {
    return { verified: false, reason: "protocol-incompatible" };
  }
  if (body.bootId !== record.bootId) return { verified: false, reason: "boot-mismatch" };
  return { verified: true };
}
