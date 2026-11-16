/**
 * Thin persistence-driver interface (P128(F025)/T502).
 *
 * The benchmark decision (decisions.md, 2026-11-15) selected the built-in
 * `node:sqlite` driver at performance parity with better-sqlite3; this
 * interface keeps the choice swappable. It covers only connection lifecycle,
 * prepared statements and exclusive transactions — domain semantics live in
 * the sibling modules, never here. Synchronous by design: both candidate
 * drivers are synchronous and blocking DB work belongs in the service's
 * bounded worker (T490), not in this API's shape.
 */

export type PersistenceBindValue = string | number | bigint | Uint8Array | null;
export type PersistenceColumnValue = string | number | bigint | Uint8Array | null;

export interface PersistenceRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface PersistenceStatement {
  run(...values: PersistenceBindValue[]): PersistenceRunResult;
  get(...values: PersistenceBindValue[]): Record<string, PersistenceColumnValue> | undefined;
  all(...values: PersistenceBindValue[]): Record<string, PersistenceColumnValue>[];
}

export type PersistenceErrorCode =
  /** Another writer holds the database past the busy timeout — bounded typed retry outcome. */
  | "PERSISTENCE_BUSY"
  /** The database file is corrupt or unreadable — explicit recovery, never automatic re-initialization. */
  | "PERSISTENCE_CORRUPT"
  /** The persisted schemaVersion is unknown to this build — migration required, never silent. */
  | "PERSISTENCE_SCHEMA_INCOMPATIBLE"
  /** A constraint or uniqueness violation refused the mutation. */
  | "PERSISTENCE_CONSTRAINT"
  /** The driver could not be opened at all. */
  | "PERSISTENCE_UNAVAILABLE";

export interface PersistenceErrorDetails {
  code: PersistenceErrorCode;
  /** Underlying driver message, for honest diagnostics. */
  cause?: string | undefined;
  path?: string | undefined;
}

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly path: string | undefined;

  constructor(details: PersistenceErrorDetails, message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = details.code;
    this.path = details.path;
  }
}

export interface PersistenceDriver {
  /** Stable driver identity for diagnostics ("node:sqlite", "better-sqlite3"). */
  readonly kind: string;
  /** Bundled SQLite engine version, for schema/driver compatibility records. */
  sqliteVersion(): string;
  prepare(sql: string): PersistenceStatement;
  exec(sql: string): void;
  close(): void;
  /**
   * Run `fn` inside one exclusive BEGIN IMMEDIATE transaction: commit on
   * success, rollback and rethrow on failure. Re-entrant nesting is NOT
   * supported — callers compose inside one fn, mirroring the old root-lock
   * re-entrancy rule but per-connection instead of per-process.
   */
  runExclusive<T>(fn: () => T): T;
}

/** Map a driver-specific thrown error onto the typed outcomes. */
export function persistenceErrorFrom(error: unknown, path: string | undefined): PersistenceError {
  const raw = error instanceof Error ? error : new Error(String(error));
  const code = (raw as NodeJS.ErrnoException).code ?? "";
  const message = raw.message;
  if (/\bdatabase is locked\b|\bSQLITE_BUSY\b/i.test(`${code} ${message}`)) {
    return new PersistenceError({ code: "PERSISTENCE_BUSY", cause: message, path }, `Database busy: ${message}`);
  }
  if (/\bdatabase disk image is malformed\b|\bfile is not a database\b|\bSQLITE_CORRUPT\b|\bSQLITE_NOTADB\b/i.test(`${code} ${message}`)) {
    return new PersistenceError({ code: "PERSISTENCE_CORRUPT", cause: message, path }, `Database corrupt: ${message}`);
  }
  if (code === "ERR_INVALID_ARG_VALUE" || /unsupported/i.test(message)) {
    return new PersistenceError({ code: "PERSISTENCE_UNAVAILABLE", cause: message, path }, `Driver unavailable: ${message}`);
  }
  return new PersistenceError({ code: "PERSISTENCE_CONSTRAINT", cause: message, path }, message);
}
