/**
 * Transactional command authority (P128(F025)/T502).
 *
 * One exclusive BEGIN IMMEDIATE transaction per mutation (architecture.md §5):
 * receipt lookup, expected-revision check, domain mutation, revision bump,
 * receipt and outbox event all commit together — or nothing does. Retries of
 * a retained request return the stored outcome; payload reuse with a
 * different hash is refused. No Git/network/model calls ever run inside the
 * callback: the caller composes them after the commit, driven by the outbox.
 */

import { createHash } from "node:crypto";
import type { PersistenceDriver } from "./driver.js";
import { persistenceErrorFrom } from "./driver.js";
import { recordProjectAudit, resolveProjectCaller, type ProjectCaller } from "./project-access.js";

export const IDEMPOTENCY_RETENTION_COMMANDS = 100_000;
/** Receipts older than this horizon are explicitly non-replayable (documented, not silent). */
export const IDEMPOTENCY_RETENTION_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

export type CommandOutcomeStatus = "committed" | "already-applied" | "conflict" | "revision-conflict" | "forbidden" | "refused" | "busy" | "error";

export interface CommandEnvelope {
  /** Client-generated idempotency key, unique per logical request. */
  requestId: string;
  projectId: string;
  operation: string;
  /** JSON-serializable arguments; the hash feeds idempotency validation. */
  payload: unknown;
  /** Expected current project revision; omit to skip the optimistic check. */
  expectedRevision?: number | undefined;
}

export interface CommandOutcome<T> {
  status: CommandOutcomeStatus;
  /** The project revision after the mutation (undefined for refused outcomes). */
  revision?: number | undefined;
  result?: T | undefined;
  reason?: string | undefined;
  code?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

/** A domain refusal rolls back the command before a success receipt is recorded. */
export class CommandRefusal extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

export interface AppliedCommandContext {
  driver: PersistenceDriver;
  projectId: string;
  requestId: string;
  operation: string;
  payload: unknown;
  /** Bump the project revision and record the provenance row; call once per mutation. */
  recordRevision: (details?: { previousRevision: number }) => void;
}

export interface CommandReceiptRow {
  requestId: string;
  payloadHash: string;
  operation: string;
  outcome: string;
  createdAt: string;
}

function payloadHash(envelope: CommandEnvelope): string {
  return createHash("sha256")
    .update(JSON.stringify([envelope.operation, envelope.payload ?? null]))
    .digest("hex");
}

function readProjectRevision(driver: PersistenceDriver, projectId: string): number {
  const row = driver.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId);
  if (row === undefined) throw new Error(`Unknown project ${projectId}`);
  return Number(row.revision);
}

function readReceipt(driver: PersistenceDriver, projectId: string, requestId: string): CommandReceiptRow | undefined {
  const row = driver
    .prepare("SELECT request_id, payload_hash, operation, outcome, created_at FROM command_receipts WHERE request_id = ? AND project_id = ?")
    .get(requestId, projectId);
  return row === undefined
    ? undefined
    : {
        requestId: String(row.request_id),
        payloadHash: String(row.payload_hash),
        operation: String(row.operation),
        outcome: String(row.outcome),
        createdAt: String(row.created_at),
      };
}

/**
 * Execute one command envelope through the authority. `apply` runs strictly
 * inside the exclusive transaction; it must not open sockets, spawn Git or
 * call models — those run after commit, replayed from the outbox.
 *
 * Idempotency: a retained receipt with the same payload hash returns the
 * stored outcome (`already-applied`); a different hash on the same key is a
 * typed `conflict`. A stale `expectedRevision` is a typed
 * `revision-conflict`; no mutation is attempted.
 */
export function executeCommand<T>(
  driver: PersistenceDriver,
  envelope: CommandEnvelope,
  apply: (context: AppliedCommandContext) => T,
  caller?: ProjectCaller,
): CommandOutcome<T> {
  const receiptKey = caller
    ? createHash("sha256").update(JSON.stringify([caller.principalId, envelope.requestId])).digest("hex")
    : envelope.requestId;
  const requester = caller?.requesterId && caller.requesterId !== caller.principalId ? [caller.requesterId] : [];
  const payload = caller ? [caller.workspaceId, envelope.payload, ...requester] : envelope.payload;
  const hash = payloadHash({ ...envelope, payload });
  try {
    return driver.runExclusive(() => {
      if (caller && (caller.projectId !== envelope.projectId || !resolveProjectCaller(driver, caller))) {
        return { status: "forbidden", reason: "The principal has no access to the project and workspace." };
      }
      const receipt = readReceipt(driver, envelope.projectId, receiptKey);
      if (receipt !== undefined) {
        if (receipt.payloadHash !== hash) {
          return {
            status: "conflict",
            reason: `Request ${envelope.requestId} was retained with a different payload; conflicting reuse is refused.`,
          };
        }
        const stored = JSON.parse(receipt.outcome) as CommandOutcome<T>;
        return { ...stored, status: "already-applied" };
      }
      const currentRevision = readProjectRevision(driver, envelope.projectId);
      if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== currentRevision) {
        return {
          status: "revision-conflict",
          revision: currentRevision,
          reason: `Expected revision ${envelope.expectedRevision} does not match current revision ${currentRevision}.`,
        };
      }
      let bumped = false;
      const context: AppliedCommandContext = {
        driver,
        projectId: envelope.projectId,
        requestId: envelope.requestId,
        operation: envelope.operation,
        payload: envelope.payload,
        recordRevision: () => {
          if (bumped) throw new Error("recordRevision called twice for one command");
          bumped = true;
          const at = new Date().toISOString();
          driver
            .prepare("UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?")
            .run(at, envelope.projectId);
        },
      };
      const result = apply(context);
      const nextRevision = readProjectRevision(driver, envelope.projectId);
      const outcome: CommandOutcome<T> = { status: "committed", revision: nextRevision, result };
      const at = new Date().toISOString();
      driver
        .prepare("INSERT INTO command_receipts (request_id, project_id, payload_hash, operation, outcome, created_at) VALUES (?,?,?,?,?,?)")
        .run(receiptKey, envelope.projectId, hash, envelope.operation, JSON.stringify({ status: outcome.status, revision: outcome.revision, result: outcome.result ?? null }), at);
      if (caller) {
        recordProjectAudit(driver, caller, envelope.operation, nextRevision, envelope.requestId, at);
      }
      return outcome;
    });
  } catch (error) {
    if (error instanceof CommandRefusal) {
      return { status: "refused", code: error.code, reason: error.message, ...(error.details ? { details: error.details } : {}) };
    }
    const mapped = persistenceErrorFrom(error, undefined);
    if (mapped.code === "PERSISTENCE_BUSY") {
      return { status: "busy", reason: `Database busy; retry the command with the same requestId. ${mapped.message}` };
    }
    return { status: "error", reason: mapped.message };
  }
}

/** Record one domain event inside the open transaction (outbox pattern). */
export function publishEvent(
  driver: PersistenceDriver,
  projectId: string,
  kind: string,
  payload: unknown,
): void {
  driver
    .prepare("INSERT INTO event_outbox (project_id, kind, payload, created_at) VALUES (?,?,?,?)")
    .run(projectId, kind, JSON.stringify(payload ?? null), new Date().toISOString());
}

export interface OutboxEvent {
  eventId: number;
  kind: string;
  payload: unknown;
  createdAt: string;
}

/** Drain undelivered events past a consumer cursor; the caller advances it after durable delivery. */
export function readOutbox(driver: PersistenceDriver, projectId: string, consumer: string, limit = 100): OutboxEvent[] {
  const cursorRow = driver
    .prepare("SELECT last_event_id FROM event_cursor WHERE project_id = ? AND consumer = ?")
    .get(projectId, consumer);
  const lastEventId = cursorRow === undefined ? 0 : Number(cursorRow.last_event_id);
  return readProjectEvents(driver, projectId, lastEventId, limit);
}

/** Replay one project's durable events after a cursor acknowledged by the caller. */
export function readProjectEvents(driver: PersistenceDriver, projectId: string, lastEventId: number, limit: number): OutboxEvent[] {
  return driver
    .prepare("SELECT event_id, kind, payload, created_at FROM event_outbox WHERE project_id = ? AND event_id > ? ORDER BY event_id LIMIT ?")
    .all(projectId, lastEventId, limit)
    .map((row) => ({
      eventId: Number(row.event_id),
      kind: String(row.kind),
      payload: JSON.parse(String(row.payload)) as unknown,
      createdAt: String(row.created_at),
    }));
}

export function advanceEventCursor(driver: PersistenceDriver, projectId: string, consumer: string, lastEventId: number): void {
  driver
    .prepare(
      "INSERT INTO event_cursor (project_id, consumer, last_event_id) VALUES (?,?,?) "
      + "ON CONFLICT (project_id, consumer) DO UPDATE SET last_event_id = MAX(event_cursor.last_event_id, excluded.last_event_id)",
    )
    .run(projectId, consumer, lastEventId);
}

export function readCommandReceipt(driver: PersistenceDriver, projectId: string, requestId: string): CommandReceiptRow | undefined {
  return readReceipt(driver, projectId, requestId);
}
