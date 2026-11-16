/**
 * Snapshot, restore and store-open primitives (P128(F025)/T502).
 *
 * The export-service markdown renderer is not a portable backup; these
 * primitives are. `createSnapshot` produces a consistent full-database copy
 * (`VACUUM INTO` — node:sqlite has no online backup API on the benchmarked
 * Node; the copy is taken transactionally against the WAL, so readers and
 * writers continue during the copy at the cost of a brief write pause).
 * `openStore` verifies the schemaVersion before any domain call and exposes
 * typed busy/corrupt/incompatible outcomes for T496/T490.
 */

import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { PersistenceError, persistenceErrorFrom, type PersistenceDriver } from "./driver.js";
import { openNodeSqliteDriver } from "./node-sqlite-driver.js";
import { PersistenceSchemaIncompatible, bootstrapStoreSchema, type OpenedStore } from "./schema.js";

export async function createSnapshot(driver: PersistenceDriver, destinationPath: string): Promise<{ bytes: number }> {
  await mkdir(dirname(destinationPath), { recursive: true });
  try {
    // VACUUM INTO fails cleanly if the target exists — the caller owns overwrite policy.
    driver.exec(`VACUUM INTO '${destinationPath.replaceAll("'", "''")}'`);
  } catch (error) {
    throw persistenceErrorFrom(error, destinationPath);
  }
  return { bytes: (await stat(destinationPath)).size };
}

export interface OpenStoreOptions {
  path: string;
  busyTimeoutMs?: number | undefined;
}

export interface OpenedStoreHandle {
  driver: PersistenceDriver;
  store: OpenedStore;
  close(): void;
}

/**
 * Open an existing or freshly initialized store. Missing file + `create` =
 * initialization offer accepted by the caller; missing file without `create`
 * is a typed unavailable outcome. Unknown schema versions never migrate
 * silently (architecture.md §5: no automatic empty initialization).
 */
export async function openStore(options: OpenStoreOptions & { create?: boolean }): Promise<OpenedStoreHandle> {
  const driver = openNodeSqliteDriver(options);
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    driver.close();
  };
  try {
    const tableRow = driver.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='store_meta'").get();
    if (tableRow === undefined && options.create !== true) {
      closeOnce();
      throw new PersistenceError(
        { code: "PERSISTENCE_UNAVAILABLE", path: options.path },
        `No Agent Plan store at ${options.path}; pass create=true to initialize explicitly.`,
      );
    }
    let store: OpenedStore;
    try {
      store = bootstrapStoreSchema(driver);
    } catch (error) {
      closeOnce();
      if (error instanceof PersistenceSchemaIncompatible) throw error;
      throw persistenceErrorFrom(error, options.path);
    }
    return { driver, store, close: closeOnce };
  } catch (error) {
    closeOnce();
    if (error instanceof PersistenceError || error instanceof PersistenceSchemaIncompatible) throw error;
    throw persistenceErrorFrom(error, options.path);
  }
}

/** Copy a snapshot over an empty target and verify its schema version (T494/T495 restore primitive). */
export async function restoreFromSnapshot(
  snapshotPath: string,
  destinationPath: string,
): Promise<OpenedStoreHandle> {
  const { copyFile } = await import("node:fs/promises");
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(snapshotPath, destinationPath);
  return openStore({ path: destinationPath });
}
