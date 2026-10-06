/**
 * Change detector for the `entity-changed` live event (docs/api-v1.md).
 *
 * Agents write to `.planner/` from other processes (the MCP server), so route
 * handlers in this process never see those writes. Only the folder watcher and
 * `/internal/notify` do, and they only say "something changed". This detector
 * turns that signal into exact answers: it keeps a fingerprint of every API v1
 * view, reloads the plan on each signal, and reports which entities were
 * created, updated or deleted.
 */

import { createHash } from "node:crypto";
import {
  API_V1_VERSION,
  buildApiV1Model,
  listApiV1Entities,
  type ApiV1EntityEntry,
  type ApiV1EntityKind,
  type PlanStore,
} from "@agent-plan/core";

export type EntityChangeOp = "created" | "updated" | "deleted";

export interface EntityChangedData {
  apiVersion: typeof API_V1_VERSION;
  kind: ApiV1EntityKind;
  ref: string;
  id: string;
  op: EntityChangeOp;
  parents: { featureRef?: string; phaseRef?: string };
}

interface Fingerprint {
  kind: ApiV1EntityKind;
  id: string;
  ref: string;
  parents: ApiV1EntityEntry["parents"];
  hash: string;
}

export type EntitySnapshot = ReadonlyMap<string, Fingerprint>;

export function snapshotOf(entries: readonly ApiV1EntityEntry[]): EntitySnapshot {
  const snapshot = new Map<string, Fingerprint>();
  for (const entry of entries) {
    snapshot.set(`${entry.kind}:${entry.key}`, {
      kind: entry.kind,
      id: entry.id,
      ref: entry.ref,
      parents: entry.parents,
      hash: createHash("sha1").update(JSON.stringify(entry.view)).digest("hex"),
    });
  }
  return snapshot;
}

function changeOf(fingerprint: Fingerprint, op: EntityChangeOp): EntityChangedData {
  return { apiVersion: API_V1_VERSION, kind: fingerprint.kind, ref: fingerprint.ref, id: fingerprint.id, op, parents: fingerprint.parents };
}

/** Exactly what differs between two snapshots, one change per entity. */
export function diffSnapshots(previous: EntitySnapshot, next: EntitySnapshot): EntityChangedData[] {
  const changes: EntityChangedData[] = [];
  for (const [key, fingerprint] of next) {
    const before = previous.get(key);
    if (!before) changes.push(changeOf(fingerprint, "created"));
    else if (before.hash !== fingerprint.hash) changes.push(changeOf(fingerprint, "updated"));
  }
  for (const [key, fingerprint] of previous) {
    if (!next.has(key)) changes.push(changeOf(fingerprint, "deleted"));
  }
  return changes;
}

export interface EntityEventDetectorOptions {
  /** Wait this long after the last signal before reloading, so one burst of writes is one pass. */
  debounceMs?: number;
  /** Wait before retrying when the plan could not be loaded (for example mid-write). */
  retryMs?: number;
  maxRetries?: number;
}

export class EntityEventDetector {
  private snapshot: EntitySnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private dirty = false;
  private retries = 0;
  private closed = false;
  private readonly debounceMs: number;
  private readonly retryMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly store: PlanStore,
    private readonly emit: (change: EntityChangedData) => void,
    options: EntityEventDetectorOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 100;
    this.retryMs = options.retryMs ?? 300;
    this.maxRetries = options.maxRetries ?? 10;
  }

  private async currentSnapshot(): Promise<EntitySnapshot> {
    const [project, features, phases, ideas] = await Promise.all([
      this.store.loadProject(),
      this.store.loadFeatures(),
      this.store.loadAllPhases(),
      this.store.loadIdeas(),
    ]);
    return snapshotOf(listApiV1Entities(buildApiV1Model({ project, features: features.features, phases, ideas: ideas.ideas })));
  }

  /** Record the starting state. If it cannot be read yet, the first successful pass only records and never reports. */
  async prime(): Promise<void> {
    try {
      this.snapshot = await this.currentSnapshot();
    } catch {
      this.snapshot = null;
    }
  }

  /** Something in `.planner/` may have changed. */
  signal(): void {
    if (this.closed) return;
    this.retries = 0;
    this.schedule(this.debounceMs);
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delayMs);
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    try {
      const next = await this.currentSnapshot();
      const previous = this.snapshot;
      this.snapshot = next;
      if (previous) for (const change of diffSnapshots(previous, next)) this.emit(change);
      this.retries = 0;
    } catch {
      // A writer is mid-update. Try again shortly instead of waiting for another signal.
      if (!this.closed && this.retries < this.maxRetries) {
        this.retries += 1;
        this.schedule(this.retryMs);
      }
    } finally {
      this.running = false;
      if (this.dirty && !this.closed) {
        this.dirty = false;
        this.schedule(this.debounceMs);
      }
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
