/**
 * Documents: logical folders, revisions, assets and search (P128(F025)/T502).
 *
 * Document bodies are first-class content with stable IDs; folders are a
 * logical path, not a filesystem location. The FTS index is maintained by
 * mechanical triggers (architecture.md §4 allows exactly that) and is
 * rebuildable without touching canonical content — clients receive content
 * through these domain operations, never raw SQL or DB paths.
 */

import { createHash } from "node:crypto";
import type { PersistenceDriver } from "./driver.js";

export interface DocumentRecord {
  id: string;
  folder: string;
  name: string;
  revision: number;
  content: string;
  contentHash: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentHistoryEntry {
  revision: number;
  contentHash: string;
  savedAt: string;
}

export function contentHashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function rowToDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    folder: String(row.folder),
    name: String(row.name),
    revision: Number(row.revision),
    content: String(row.content),
    contentHash: String(row.content_hash),
    metadata: JSON.parse(String(row.metadata)) as unknown,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createDocument(
  driver: PersistenceDriver,
  input: { projectId: string; id: string; folder: string; name: string; content: string; metadata?: unknown },
): DocumentRecord {
  return driver.runExclusive(() => createDocumentInTransaction(driver, input));
}

export function createDocumentInTransaction(
  driver: PersistenceDriver,
  input: { projectId: string; id: string; folder: string; name: string; content: string; metadata?: unknown },
): DocumentRecord {
  const at = new Date().toISOString();
  const hash = contentHashOf(input.content);
  driver.prepare("INSERT INTO documents (id, project_id, folder, name, revision, content, content_hash, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(input.id, input.projectId, input.folder, input.name, 1, input.content, hash, JSON.stringify(input.metadata ?? {}), at, at);
  driver.prepare("INSERT INTO document_revisions (document_id, revision, content, content_hash, saved_at) VALUES (?,?,?,?,?)")
    .run(input.id, 1, input.content, hash, at);
  return getDocument(driver, input.id)!;
}

export function updateDocument(
  driver: PersistenceDriver,
  documentId: string,
  input: { content: string; metadata?: unknown },
): DocumentRecord {
  return driver.runExclusive(() => updateDocumentInTransaction(driver, documentId, { ...input, metadata: input.metadata ?? {} }));
}

/** Write a revision as part of a caller-owned command transaction. */
export function updateDocumentInTransaction(
  driver: PersistenceDriver,
  documentId: string,
  input: { content: string; metadata?: unknown },
): DocumentRecord {
  const current = getDocument(driver, documentId);
  if (!current) throw new Error(`Unknown document ${documentId}`);
  const at = new Date().toISOString();
  const hash = contentHashOf(input.content);
  const nextRevision = current.revision + 1;
  driver
    .prepare("UPDATE documents SET revision = ?, content = ?, content_hash = ?, metadata = ?, updated_at = ? WHERE id = ?")
    .run(nextRevision, input.content, hash, JSON.stringify(input.metadata ?? current.metadata), at, documentId);
  driver
    .prepare("INSERT INTO document_revisions (document_id, revision, content, content_hash, saved_at) VALUES (?,?,?,?,?)")
    .run(documentId, nextRevision, input.content, hash, at);
  return getDocument(driver, documentId)!;
}

export function getDocument(driver: PersistenceDriver, documentId: string): DocumentRecord | undefined {
  const row = driver.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
  return row === undefined ? undefined : rowToDocument(row);
}

export function getDocumentByPath(driver: PersistenceDriver, projectId: string, folder: string, name: string): DocumentRecord | undefined {
  const row = driver.prepare("SELECT * FROM documents WHERE project_id = ? AND folder = ? AND name = ?").get(projectId, folder, name);
  return row === undefined ? undefined : rowToDocument(row);
}

export function registeredPlannerDocumentPath(path: string): { folder: string; name: string } | undefined {
  if (path.length > 2048) return undefined;
  const relative = /^\.planner\/docs\/(.+\.md)$/i.exec(path)?.[1];
  if (!relative) return undefined;
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) return undefined;
  const name = parts.pop();
  return name ? { folder: parts.join("/"), name } : undefined;
}

export function listFolder(driver: PersistenceDriver, projectId: string, folder: string): DocumentRecord[] {
  return driver
    .prepare("SELECT * FROM documents WHERE project_id = ? AND folder = ? ORDER BY name")
    .all(projectId, folder)
    .map((row) => rowToDocument(row));
}

export function deleteDocument(driver: PersistenceDriver, documentId: string): boolean {
  return driver.runExclusive(() => {
    const result = driver.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
    return result.changes > 0;
  });
}

export function documentHistory(driver: PersistenceDriver, documentId: string): DocumentHistoryEntry[] {
  return driver
    .prepare("SELECT revision, content_hash, saved_at FROM document_revisions WHERE document_id = ? ORDER BY revision")
    .all(documentId)
    .map((row) => ({ revision: Number(row.revision), contentHash: String(row.content_hash), savedAt: String(row.saved_at) }));
}

export function saveDocumentAsset(
  driver: PersistenceDriver,
  input: { id: string; documentId: string; name: string; content: Uint8Array },
): void {
  driver
    .prepare("INSERT INTO document_assets (id, document_id, name, content, content_hash) VALUES (?,?,?,?,?)")
    .run(input.id, input.documentId, input.name, input.content, contentHashOf(Buffer.from(input.content).toString("base64")));
}

export function getDocumentAsset(driver: PersistenceDriver, assetId: string): { id: string; name: string; content: Uint8Array } | undefined {
  const row = driver.prepare("SELECT id, name, content FROM document_assets WHERE id = ?").get(assetId);
  if (row === undefined) return undefined;
  return { id: String(row.id), name: String(row.name), content: new Uint8Array(row.content as Uint8Array) };
}

// ---------------------------------------------------------------------------
// Search: literal and FTS5 with snippets and pagination.
// ---------------------------------------------------------------------------

export interface SearchMatch {
  documentId: string;
  folder: string;
  name: string;
  revision: number;
  snippet: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  total: number;
  truncated: boolean;
}

export interface SearchOptions {
  limit?: number | undefined;
  offset?: number | undefined;
}

/** Exact-ID and literal (case-insensitive substring) search over document names and content. */
export function searchDocumentsLiteral(driver: PersistenceDriver, projectId: string, query: string, options: SearchOptions = {}): SearchResult {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const pattern = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const rows = driver
    .prepare(
      "SELECT id, folder, name, revision FROM documents "
      + "WHERE project_id = ? AND (name LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') "
      + "ORDER BY folder, name LIMIT ? OFFSET ?",
    )
    .all(projectId, pattern, pattern, limit + 1, offset);
  const truncated = rows.length > limit;
  return {
    matches: rows.slice(0, limit).map((row) => ({
      documentId: String(row.id),
      folder: String(row.folder),
      name: String(row.name),
      revision: Number(row.revision),
      snippet: literalSnippet(driver, String(row.id), query),
    })),
    total: rows.slice(0, limit).length,
    truncated,
  };
}

function literalSnippet(driver: PersistenceDriver, documentId: string, query: string): string {
  const row = driver.prepare("SELECT content FROM documents WHERE id = ?").get(documentId);
  const content = row === undefined ? "" : String(row.content);
  const index = content.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return content.slice(0, 120);
  const start = Math.max(0, index - 40);
  return `${start > 0 ? "…" : ""}${content.slice(start, index + query.length + 80)}…`;
}

export interface FtsSearchOptions extends SearchOptions {
  /** Filter to one logical folder. */
  folder?: string | undefined;
}

/**
 * FTS5 word/phrase search with snippets, ordering by relevance and optional
 * folder filter. The FTS index is a derived, transactionally maintained
 * projection; when it is missing or corrupt, `rebuildFtsIndex` restores it
 * from canonical documents without changing them.
 */
export function searchDocumentsFts(driver: PersistenceDriver, projectId: string, query: string, options: FtsSearchOptions = {}): SearchResult {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const folderClause = options.folder === undefined ? "" : "AND d.folder = ?";
  const args: Array<string | number> = options.folder === undefined
    ? [query, projectId, limit + 1, offset]
    : [query, projectId, options.folder, limit + 1, offset];
  const rows = driver
    .prepare(
      `SELECT d.id, d.folder, d.name, d.revision, snippet(documents_fts, 1, '<b>', '</b>', '…', 12) AS snippet
       FROM documents_fts f JOIN documents d ON d.rowid = f.rowid
       WHERE documents_fts MATCH ? AND d.project_id = ? ${folderClause}
       ORDER BY rank LIMIT ? OFFSET ?`,
    )
    .all(...args);
  const truncated = rows.length > limit;
  return {
    matches: rows.slice(0, limit).map((row) => ({
      documentId: String(row.id),
      folder: String(row.folder),
      name: String(row.name),
      revision: Number(row.revision),
      snippet: String(row.snippet),
    })),
    total: rows.slice(0, limit).length,
    truncated,
  };
}

/**
 * Rebuild the FTS index from canonical content. Transactional and
 * content-preserving: document rows never change; only the derived index does.
 */
export function rebuildFtsIndex(driver: PersistenceDriver): { documents: number } {
  return driver.runExclusive(() => {
    driver.exec("INSERT INTO documents_fts(documents_fts) VALUES ('delete-all')");
    driver.exec("INSERT INTO documents_fts(rowid, name, content) SELECT rowid, name, content FROM documents");
    const row = driver.prepare("SELECT COUNT(*) AS c FROM documents").get();
    return { documents: Number(row?.c ?? 0) };
  });
}
