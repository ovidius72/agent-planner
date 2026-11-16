/**
 * Store schema: DDL, versioned bootstrap and migration seam (P128(F025)/T502).
 *
 * The relational mapping follows architecture.md §4. SQLite owns only
 * mechanical invariants (foreign keys, unique constraints, status CHECKs,
 * FTS-maintenance triggers); TypeScript owns permissions, eligibility and
 * semantic lifecycle. `schema_version` gates every open: unknown versions are
 * a typed incompatibility, never a silent migration.
 */

import type { PersistenceDriver } from "./driver.js";
import { PersistenceError } from "./driver.js";

export const STORE_SCHEMA_VERSION = 1;

export const STORE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS store_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  descriptor_project_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  metadata JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  number INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('planned','in-progress','done','blocked','canceled','rejected','deferred','waiting')),
  name TEXT NOT NULL,
  description_updated_at TEXT,
  metadata JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, number)
);
CREATE TABLE IF NOT EXISTS phases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  feature_id TEXT REFERENCES features(id),
  number INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('planned','in-progress','done','blocked','canceled','rejected','deferred','waiting')),
  title TEXT NOT NULL,
  description_updated_at TEXT,
  metadata JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, number)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  phase_id TEXT NOT NULL REFERENCES phases(id),
  number INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('planned','in-progress','done','blocked','canceled','rejected','deferred','waiting')),
  title TEXT NOT NULL,
  active_owner_session TEXT NOT NULL DEFAULT '',
  pause_snapshot JSON,
  metadata JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, number)
);
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on)
);
CREATE TABLE IF NOT EXISTS task_checklists (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  text TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, item_id)
);
CREATE TABLE IF NOT EXISTS entity_requirements (
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('project','feature','phase','task')),
  entity_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  PRIMARY KEY (entity_kind, entity_id, requirement_id)
);
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content JSON NOT NULL DEFAULT '{}',
  UNIQUE (project_id, number)
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  content JSON NOT NULL,
  superseded_by TEXT,
  accepted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  folder TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, folder, name)
);
CREATE TABLE IF NOT EXISTS document_revisions (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (document_id, revision)
);
CREATE TABLE IF NOT EXISTS document_assets (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE (document_id, name)
);
CREATE TABLE IF NOT EXISTS phase_handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  phase_id TEXT NOT NULL REFERENCES phases(id),
  content JSON NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_deviations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_session TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('approved','active','resume-required','resolved','resumed','canceled')),
  temporary_task_id TEXT NOT NULL REFERENCES tasks(id),
  resume_task_id TEXT NOT NULL REFERENCES tasks(id),
  checkpoint JSON NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS command_receipts (
  request_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  payload_hash TEXT NOT NULL,
  operation TEXT NOT NULL,
  outcome JSON NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, project_id)
);
CREATE TABLE IF NOT EXISTS event_outbox (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  payload JSON NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event_cursor (
  project_id TEXT NOT NULL REFERENCES projects(id),
  consumer TEXT NOT NULL,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, consumer)
);
CREATE INDEX IF NOT EXISTS idx_phases_feature ON phases(feature_id);
CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority);
CREATE INDEX IF NOT EXISTS idx_taskdeps_reverse ON task_dependencies(depends_on);
CREATE INDEX IF NOT EXISTS idx_decisions_owner ON decisions(owner_id, revision);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(project_id, folder);
CREATE INDEX IF NOT EXISTS idx_outbox_project ON event_outbox(project_id, event_id);
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  name, content, content='documents', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS documents_fts_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, name, content) VALUES (new.rowid, new.name, new.content);
END;
CREATE TRIGGER IF NOT EXISTS documents_fts_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, name, content) VALUES ('delete', old.rowid, old.name, old.content);
END;
CREATE TRIGGER IF NOT EXISTS documents_fts_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, name, content) VALUES ('delete', old.rowid, old.name, old.content);
  INSERT INTO documents_fts(rowid, name, content) VALUES (new.rowid, new.name, new.content);
END;
`;

export interface OpenedStore {
  schemaVersion: number;
  created: boolean;
}

/**
 * Open the store at the driver's path: create on first use (the caller decided
 * to initialize — the driver never invents a planner), verify the persisted
 * schemaVersion is supported, and apply the durable WAL mode.
 */
export function bootstrapStoreSchema(driver: PersistenceDriver): OpenedStore {
  const tableRow = driver.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='store_meta'").get();
  const created = tableRow === undefined;
  if (created) {
    driver.exec(STORE_SCHEMA_DDL);
    driver
      .prepare("INSERT INTO store_meta (key, value) VALUES ('schema_version', ?)")
      .run(String(STORE_SCHEMA_VERSION));
    driver.exec("PRAGMA journal_mode = WAL");
    return { schemaVersion: STORE_SCHEMA_VERSION, created: true };
  }
  const versionRow = driver.prepare("SELECT value FROM store_meta WHERE key = 'schema_version'").get();
  const persisted = versionRow === undefined ? undefined : Number(versionRow.value);
  if (persisted === undefined || !Number.isInteger(persisted) || persisted > STORE_SCHEMA_VERSION) {
    throw new PersistenceSchemaIncompatible(persisted, STORE_SCHEMA_VERSION);
  }
  if (persisted < STORE_SCHEMA_VERSION) {
    // Forward migration seam for T494/T495: apply pending migrations inside
    // one transaction, then bump the version. Today no migration steps exist.
    driver.runExclusive(() => {
      applyMigrations(driver, persisted, STORE_SCHEMA_VERSION);
      driver.prepare("UPDATE store_meta SET value = ? WHERE key = 'schema_version'").run(String(STORE_SCHEMA_VERSION));
    });
  }
  driver.exec("PRAGMA journal_mode = WAL");
  return { schemaVersion: persisted, created: false };
}

export class PersistenceSchemaIncompatible extends PersistenceError {
  constructor(readonly persistedVersion: number | undefined, readonly supportedVersion: number) {
    super(
      {
        code: "PERSISTENCE_SCHEMA_INCOMPATIBLE",
        cause: persistedVersion === undefined ? "missing schema_version" : `persisted schemaVersion ${persistedVersion}`,
      },
      persistedVersion === undefined
        ? `Store metadata is missing a schema version; expected <= ${supportedVersion}. Explicit recovery is required — no automatic migration.`
        : `Store schemaVersion ${persistedVersion} is not supported by this build (supported: ${supportedVersion}). Migration is explicit, never silent.`,
    );
    this.name = "PersistenceSchemaIncompatible";
  }
}

function applyMigrations(_driver: PersistenceDriver, _from: number, _to: number): void {
  // No migrations exist yet; the seam is reserved for T494/T495.
}

export function readStoreSchemaVersion(driver: PersistenceDriver): number | undefined {
  const row = driver.prepare("SELECT value FROM store_meta WHERE key = 'schema_version'").get();
  return row === undefined ? undefined : Number(row.value);
}
