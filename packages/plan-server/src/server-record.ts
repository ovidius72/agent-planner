/**
 * The record of a running planner server: `<planner folder>/.local/server.json`.
 *
 * Several things start a server (`agent-plan serve`, the MCP `planner-web` and
 * `planner-load`, the Pi adapter) and until now nothing said that one was
 * already running for a folder. serve() writes this record, so every starter
 * gets it, and a program that wants to reuse a server reads it with
 * readLiveServerRecord(). The first live server owns the record.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * How the server was started. `standalone` is `agent-plan serve`: the whole
 * process is the server, so it is safe to stop by signalling its pid.
 * `embedded` is a server inside another program (an agent's MCP server, the Pi
 * adapter): signalling that pid would kill the host, so only its owner stops it.
 */
export type ServerKind = "standalone" | "embedded";

export interface ServerRecord {
  kind: ServerKind;
  pid: number;
  url: string;
  localUrl: string;
  lanUrl: string | null;
  host: string;
  port: number;
  root: string;
  startedAt: string;
  version: string;
  apiVersion: string;
}

/** How long a liveness check waits for /health before calling the record stale. */
const HEALTH_TIMEOUT_MS = 1000;

export function serverRecordPath(planRoot: string): string {
  return join(planRoot, ".local", "server.json");
}

function isServerRecord(value: unknown): value is ServerRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.pid === "number" && typeof record.localUrl === "string" && typeof record.root === "string"
    && (record.kind === "standalone" || record.kind === "embedded");
}

async function readRecordFile(planRoot: string): Promise<ServerRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(serverRecordPath(planRoot), "utf-8"));
    return isServerRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function answersHealth(record: ServerRecord): Promise<boolean> {
  try {
    const response = await fetch(`${record.localUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return false;
    const body = (await response.json()) as { root?: unknown };
    return typeof body.root === "string" && resolve(body.root) === resolve(record.root);
  } catch {
    return false;
  }
}

/** The record of a server that is really running for this folder, or null. A stale record is deleted. */
export async function readLiveServerRecord(planRoot: string): Promise<ServerRecord | null> {
  const record = await readRecordFile(planRoot);
  if (!record) return null;
  if (processExists(record.pid) && (await answersHealth(record))) return record;
  await rm(serverRecordPath(planRoot), { force: true }).catch(() => {});
  return null;
}

/**
 * Write the record unless another live server already owns it. Never throws:
 * a folder that cannot be written must not stop the server from running.
 * Returns true when this server now owns the record.
 */
export async function writeServerRecord(planRoot: string, record: ServerRecord): Promise<boolean> {
  try {
    const existing = await readLiveServerRecord(planRoot);
    // Compare the address, not the pid: one process can run several servers.
    if (existing && existing.localUrl !== record.localUrl) return false;
    const path = serverRecordPath(planRoot);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
    await rename(temporary, path);
    return true;
  } catch {
    return false;
  }
}

/** Remove the record, but only when it describes this very server (pid and address). Never throws. */
export async function removeServerRecord(planRoot: string, owner: { pid: number; localUrl: string }): Promise<void> {
  try {
    const record = await readRecordFile(planRoot);
    if (record?.pid === owner.pid && record.localUrl === owner.localUrl) await rm(serverRecordPath(planRoot), { force: true });
  } catch {
    // Nothing useful to do: the record is advisory.
  }
}
