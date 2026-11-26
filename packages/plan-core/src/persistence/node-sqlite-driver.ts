/**
 * node:sqlite persistence driver (P128(F025)/T502).
 *
 * Selected by benchmark 2026-11-15 (decisions.md): built into Node, no native
 * addon, performance parity with better-sqlite3 on the measured planner flows.
 * On Node 25.4.0 it bundles SQLite 3.51.1 with FTS5 and JSON1; there is no
 * online backup API, so snapshots use `VACUUM INTO` (see snapshot.ts).
 */

import { DatabaseSync } from "node:sqlite";
import { PersistenceError, persistenceErrorFrom, type PersistenceDriver, type PersistenceRunResult, type PersistenceStatement } from "./driver.js";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export interface NodeSqliteDriverOptions {
  path: string;
  busyTimeoutMs?: number | undefined;
  /**
   * Applied at open when absent from the database file. `synchronous=FULL` is
   * the reviewed durability policy (architecture.md §5); WAL is set once by
   * the schema bootstrap because it is persistent for the file.
   */
}

export function openNodeSqliteDriver(options: NodeSqliteDriverOptions): PersistenceDriver {
  const { path } = options;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch (error) {
    throw persistenceErrorFrom(error, path);
  }
  try {
    db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA synchronous = FULL");
  } catch (error) {
    db.close();
    throw persistenceErrorFrom(error, path);
  }

  let inExclusive = false;

  const statement = (sql: string): PersistenceStatement => {
    const prepared = db.prepare(sql);
    return {
      run: (...values) => {
        try {
          const result = prepared.run(...values);
          return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
        } catch (error) {
          throw persistenceErrorFrom(error, path);
        }
      },
      get: (...values) => {
        try {
          return prepared.get(...values) as Record<string, never> | undefined;
        } catch (error) {
          throw persistenceErrorFrom(error, path);
        }
      },
      all: (...values) => {
        try {
          return prepared.all(...values) as Record<string, never>[];
        } catch (error) {
          throw persistenceErrorFrom(error, path);
        }
      },
    };
  };

  const driver: PersistenceDriver = {
    kind: "node:sqlite",
    sqliteVersion: () => {
      const row = statement("SELECT sqlite_version() AS v").get();
      return row ? String(row.v) : "unknown";
    },
    prepare: statement,
    exec: (sql) => {
      try {
        db.exec(sql);
      } catch (error) {
        throw persistenceErrorFrom(error, path);
      }
    },
    close: () => {
      try {
        db.close();
      } catch {
        // Closing twice is a caller bug in message but not in effect; keep close idempotent.
      }
    },
    runExclusive: <T,>(fn: () => T): T => {
      if (inExclusive) {
        throw new PersistenceError(
          { code: "PERSISTENCE_CONSTRAINT", cause: "nested runExclusive on one connection", path },
          "Nested exclusive transactions are not supported; compose the work inside one callback.",
        );
      }
      inExclusive = true;
      try {
        db.exec("BEGIN IMMEDIATE");
      } catch (error) {
        inExclusive = false;
        throw persistenceErrorFrom(error, path);
      }
      try {
        const outcome = fn();
        try {
          db.exec("COMMIT");
        } catch (error) {
          throw persistenceErrorFrom(error, path);
        }
        return outcome;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // A failed rollback leaves the transaction implicitly aborted by
          // SQLite; the original error is the meaningful failure.
        }
        throw error;
      } finally {
        inExclusive = false;
      }
    },
  };
  return driver;
}

export type { PersistenceRunResult };
