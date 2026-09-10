import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_MS = 20;

interface WriterOwner {
  token: string;
  pid: number;
  hostname: string;
  cwd: string;
  acquiredAt: string;
}

export interface PlanWriterBusyDetails {
  errorCode: "PLAN_WRITER_BUSY";
  planRoot: string;
  lockPath: string;
  waitedMs: number;
  owner?: WriterOwner | undefined;
}

export class PlanWriterBusyError extends Error {
  readonly code = "PLAN_WRITER_BUSY";

  constructor(public readonly details: PlanWriterBusyDetails) {
    const owner = details.owner
      ? ` Active writer: pid ${details.owner.pid} on ${details.owner.hostname}, acquired ${details.owner.acquiredAt}.`
      : "";
    super(`PLAN_WRITER_BUSY: another process is mutating ${details.planRoot}; waited ${details.waitedMs}ms.${owner} Read-only operations remain available; retry the write after the active mutation finishes.`);
    this.name = "PlanWriterBusyError";
  }
}

const heldRoots = new AsyncLocalStorage<ReadonlySet<string>>();

function positiveEnvMs(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

async function readOwner(lockPath: string): Promise<WriterOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as Partial<WriterOwner>;
    if (
      typeof parsed.token !== "string"
      || typeof parsed.pid !== "number"
      || typeof parsed.hostname !== "string"
      || typeof parsed.cwd !== "string"
      || typeof parsed.acquiredAt !== "string"
    ) return undefined;
    return parsed as WriterOwner;
  } catch {
    return undefined;
  }
}

function ownerIsActive(owner: WriterOwner, heartbeatStale: boolean): boolean {
  if (owner.hostname !== hostname()) return !heartbeatStale;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function acquirePlanRootLock(planRoot: string): Promise<() => Promise<void>> {
  const locksRoot = join(planRoot, ".local", "locks");
  const lockPath = join(locksRoot, "writer.lock");
  const recoveryPath = join(locksRoot, "writer-recovery.lock");
  const startedAt = Date.now();
  const timeoutMs = positiveEnvMs("AGENT_PLAN_WRITE_LOCK_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const staleMs = positiveEnvMs("AGENT_PLAN_WRITE_LOCK_STALE_MS", DEFAULT_STALE_MS);
  const retryMs = positiveEnvMs("AGENT_PLAN_WRITE_LOCK_RETRY_MS", DEFAULT_RETRY_MS);
  const owner: WriterOwner = {
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    cwd: process.cwd(),
    acquiredAt: new Date().toISOString(),
  };

  for (;;) {
    try {
      await mkdir(locksRoot, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
      continue;
    }
    if (await pathExists(recoveryPath)) {
      try {
        const recovery = await stat(recoveryPath);
        if (Date.now() - recovery.mtimeMs > staleMs) {
          await rm(recoveryPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      const waitedMs = Date.now() - startedAt;
      if (waitedMs >= timeoutMs) {
        const currentOwner = await readOwner(lockPath);
        throw new PlanWriterBusyError({
          errorCode: "PLAN_WRITER_BUSY",
          planRoot,
          lockPath,
          waitedMs,
          ...(currentOwner ? { owner: currentOwner } : {}),
        });
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
      continue;
    }

    try {
      await mkdir(lockPath);
      try {
        await writeFile(join(lockPath, "owner.json"), JSON.stringify(owner, null, 2), "utf8");
        // A stale-owner recovery may have started after our initial check. Its
        // sentinel wins: withdraw this new lock and retry after recovery ends.
        if (await pathExists(recoveryPath)) {
          const persistedOwner = await readOwner(lockPath);
          if (persistedOwner?.token === owner.token) {
            await rm(lockPath, { recursive: true, force: true });
          }
          await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
          continue;
        }
      } catch (error) {
        const persistedOwner = await readOwner(lockPath);
        if (!persistedOwner || persistedOwner.token === owner.token) {
          await rm(lockPath, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
      }

      const heartbeat = setInterval(() => {
        const now = new Date();
        void utimes(lockPath, now, now).catch(() => {});
      }, Math.max(250, Math.floor(staleMs / 3)));
      heartbeat.unref();

      return async () => {
        clearInterval(heartbeat);
        const persistedOwner = await readOwner(lockPath);
        if (persistedOwner?.token === owner.token) {
          await rm(lockPath, { recursive: true, force: true }).catch(() => {});
        }
      };
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === "ENOENT") {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
        continue;
      }
      if (fsError.code !== "EEXIST") throw error;

      const currentOwner = await readOwner(lockPath);
      let stale = false;
      try {
        const info = await stat(lockPath);
        stale = Date.now() - info.mtimeMs > staleMs;
      } catch {
        continue;
      }

      if (currentOwner ? !ownerIsActive(currentOwner, stale) : stale) {
        try {
          await mkdir(recoveryPath);
          try {
            const confirmedOwner = await readOwner(lockPath);
            let confirmedStale = false;
            try {
              const info = await stat(lockPath);
              confirmedStale = Date.now() - info.mtimeMs > staleMs;
            } catch {
              continue;
            }
            if (confirmedOwner ? !ownerIsActive(confirmedOwner, confirmedStale) : confirmedStale) {
              await rm(lockPath, { recursive: true, force: true }).catch(() => {});
            }
          } finally {
            await rm(recoveryPath, { recursive: true, force: true }).catch(() => {});
          }
        } catch (recoveryError) {
          if ((recoveryError as NodeJS.ErrnoException).code !== "EEXIST") throw recoveryError;
        }
        continue;
      }

      const waitedMs = Date.now() - startedAt;
      if (waitedMs >= timeoutMs) {
        throw new PlanWriterBusyError({
          errorCode: "PLAN_WRITER_BUSY",
          planRoot,
          lockPath,
          waitedMs,
          ...(currentOwner ? { owner: currentOwner } : {}),
        });
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
    }
  }
}

/**
 * Serialize one logical planner mutation across processes for a planner root.
 * Nested writes in the same async transaction are re-entrant. Reads never take
 * this lock, so secondary processes remain available for inspection.
 */
export async function withPlanRootWriteLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const planRoot = resolve(root);
  const active = heldRoots.getStore();
  if (active?.has(planRoot)) return fn();

  const release = await acquirePlanRootLock(planRoot);
  const next = new Set(active ?? []);
  next.add(planRoot);
  try {
    return await heldRoots.run(next, fn);
  } finally {
    await release();
  }
}
