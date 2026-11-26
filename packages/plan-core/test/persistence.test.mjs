/**
 * P128(F025)/T502 — transactional SQLite authority, documents and planner search.
 *
 * Isolated mkdtemp fixtures only; never a real .planner (AGENTS.md rule 17).
 * Covers the task acceptance cases: atomic task/parent/receipt/event commit,
 * retry-safe idempotency with conflicting-payload refusal, typed busy /
 * corrupt / schema-incompatible outcomes, independent task rows, documents
 * and assets surviving snapshot restore, rebuildable FTS, and crash
 * behaviour at the before-commit / after-commit-before-reply boundaries.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeCommand,
  advanceEventCursor,
  publishEvent,
  readOutbox,
  bootstrapStoreSchema,
  createDocument,
  updateDocument,
  getDocument,
  deleteDocument,
  documentHistory,
  listFolder,
  saveDocumentAsset,
  getDocumentAsset,
  searchDocumentsFts,
  searchDocumentsLiteral,
  rebuildFtsIndex,
  createSnapshot,
  restoreFromSnapshot,
  openStore,
  openNodeSqliteDriver,
  PersistenceError,
} from "../dist/persistence/index.js";

const roots = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function tempStore(name) {
  const root = await mkdtemp(join(tmpdir(), `agent-plan-sqlite-${name}-`));
  roots.push(root);
  return join(root, "planner.sqlite");
}

function seedProject(driver, projectId = "proj-1") {
  driver.runExclusive(() => {
    driver.prepare("INSERT INTO projects (id, descriptor_project_id, name, revision, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(projectId, "descriptor-1", "Fixture Project", 1, "{}", new Date().toISOString(), new Date().toISOString());
    driver.prepare("INSERT INTO features (id, project_id, number, priority, status, name, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("f-1", projectId, 1, 1, "in-progress", "Feature", "{}", new Date().toISOString(), new Date().toISOString());
    driver.prepare("INSERT INTO phases (id, project_id, feature_id, number, priority, status, title, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("p-1", projectId, "f-1", 1, 2, "in-progress", "Phase", "{}", new Date().toISOString(), new Date().toISOString());
    driver.prepare("INSERT INTO tasks (id, project_id, phase_id, number, priority, status, title, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("t-1", projectId, "p-1", 1, 1, "planned", "Task one", "{}", new Date().toISOString(), new Date().toISOString());
  });
}

const startTaskApply = (ctx) => {
  const updated = ctx.driver.prepare("UPDATE tasks SET status='in-progress', active_owner_session='session-A', updated_at=? WHERE id='t-1' AND status='planned'")
    .run(new Date().toISOString());
  if (updated.changes === 0) throw new Error("not claimable");
  publishEvent(ctx.driver, ctx.projectId, "task.started", { taskId: "t-1", requestId: ctx.requestId });
  ctx.recordRevision();
  return { taskId: "t-1", status: "in-progress" };
};

test("bootstrap creates schema_version 3 with WAL and verifies on reopen", async () => {
  const path = await tempStore("bootstrap");
  const first = await openStore({ path, create: true });
  assert.equal(first.store.created, true);
  assert.equal(first.store.schemaVersion, 3);
  const mode = first.driver.prepare("PRAGMA journal_mode").get();
  assert.equal(String(mode.journal_mode ?? Object.values(mode)[0]).toLowerCase(), "wal");
  first.close();
  const second = await openStore({ path });
  assert.equal(second.store.created, false);
  assert.equal(second.store.schemaVersion, 3);
  second.close();
});

test("upgrading schema 1 preserves existing data and grants no principal automatically", async () => {
  const path = await tempStore("upgrade-access");
  const opened = await openStore({ path, create: true });
  try {
    seedProject(opened.driver);
    opened.driver.exec("DROP TABLE task_context_reads; DROP TABLE command_audit; DROP TABLE project_context_reads; DROP TABLE project_sessions; DROP TABLE project_workspaces; DROP TABLE project_principals;");
    opened.driver.prepare("UPDATE store_meta SET value='1' WHERE key='schema_version'").run();
  } finally {
    opened.close();
  }
  const upgraded = await openStore({ path });
  try {
    assert.equal(upgraded.store.schemaVersion, 3);
    assert.ok(upgraded.driver.prepare("SELECT id FROM projects WHERE id='proj-1'").get());
    assert.equal(upgraded.driver.prepare("SELECT COUNT(*) AS count FROM project_principals").get().count, 0);
  } finally {
    upgraded.close();
  }
});

test("task/parent/receipt/event commit atomically and bump one revision", async () => {
  const path = await tempStore("atomic");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  const outcome = executeCommand(handle.driver, {
    requestId: "req-1", projectId: "proj-1", operation: "task.start", payload: { taskId: "t-1" }, expectedRevision: 1,
  }, startTaskApply);
  assert.equal(outcome.status, "committed");
  assert.equal(outcome.revision, 2);
  const task = handle.driver.prepare("SELECT status, active_owner_session FROM tasks WHERE id='t-1'").get();
  assert.equal(task.status, "in-progress");
  const receipt = handle.driver.prepare("SELECT COUNT(*) AS c FROM command_receipts WHERE request_id='req-1'").get();
  assert.equal(receipt.c, 1, "receipt committed in the same transaction");
  const events = readOutbox(handle.driver, "proj-1", "consumer-1");
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "task.started");
  handle.close();
});

test("retry of a retained request returns the stored outcome and does not repeat the mutation", async () => {
  const path = await tempStore("idempotent");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  const envelope = { requestId: "req-r", projectId: "proj-1", operation: "task.start", payload: { taskId: "t-1" } };
  const first = executeCommand(handle.driver, envelope, startTaskApply);
  assert.equal(first.status, "committed");
  const revisionAfterFirst = first.revision;
  const retry = executeCommand(handle.driver, envelope, startTaskApply);
  assert.equal(retry.status, "already-applied");
  assert.equal(retry.revision, revisionAfterFirst, "no repeated mutation");
  const events = handle.driver.prepare("SELECT COUNT(*) AS c FROM event_outbox").get();
  assert.equal(events.c, 1, "event not duplicated on retry");
  handle.close();
});

test("same request id with a different payload is a typed conflict", async () => {
  const path = await tempStore("conflict");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  executeCommand(handle.driver, { requestId: "req-c", projectId: "proj-1", operation: "task.start", payload: { taskId: "t-1" } }, startTaskApply);
  const conflict = executeCommand(handle.driver, { requestId: "req-c", projectId: "proj-1", operation: "task.start", payload: { taskId: "t-9" } }, startTaskApply);
  assert.equal(conflict.status, "conflict");
  assert.match(conflict.reason, /different payload/);
  handle.close();
});

test("command receipts retain authenticated requester provenance across retries", async () => {
  const handle = await openStore({ path: await tempStore("audit-requester"), create: true });
  try {
    seedProject(handle.driver);
    const projectId = "proj-1";
    const workspaceId = "workspace-1";
    handle.driver.prepare("UPDATE projects SET descriptor_project_id = ? WHERE id = ?").run(projectId, projectId);
    handle.driver.prepare("INSERT INTO project_principals(project_id, principal_id) VALUES (?, ?)").run(projectId, "agent");
    handle.driver.prepare("INSERT INTO project_workspaces(project_id, id, source_path, clone_key) VALUES (?, ?, ?, ?)")
      .run(projectId, workspaceId, "/fixture", "/fixture");
    const envelope = { projectId, requestId: "req-attributed", operation: "task.start", payload: { taskId: "t-1" } };
    const caller = { projectId, workspaceId, principalId: "agent", requesterId: "orchestrator" };
    assert.equal(executeCommand(handle.driver, envelope, startTaskApply, caller).status, "committed");
    assert.equal(executeCommand(handle.driver, envelope, startTaskApply, caller).status, "already-applied");
    assert.equal(executeCommand(handle.driver, envelope, startTaskApply, { ...caller, requesterId: "different" }).status, "conflict");
    const audit = handle.driver.prepare("SELECT actor_id, requester_id FROM command_audit").get();
    assert.deepEqual({ ...audit }, { actor_id: "agent", requester_id: "orchestrator" });
  } finally {
    handle.driver.close();
  }
});

test("stale expected revision is a typed revision-conflict with no mutation", async () => {
  const path = await tempStore("revision");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  const stale = executeCommand(handle.driver, {
    requestId: "req-s", projectId: "proj-1", operation: "task.start", payload: { taskId: "t-1" }, expectedRevision: 99,
  }, startTaskApply);
  assert.equal(stale.status, "revision-conflict");
  assert.equal(stale.revision, 1);
  const task = handle.driver.prepare("SELECT status FROM tasks WHERE id='t-1'").get();
  assert.equal(task.status, "planned", "no mutation on revision conflict");
  handle.close();
});

test("crash before commit leaves no partial planner mutation", async () => {
  const path = await tempStore("crash");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  const outcome = executeCommand(handle.driver, { requestId: "req-x", projectId: "proj-1", operation: "task.start", payload: {} }, () => {
    handle.driver.prepare("UPDATE tasks SET status='in-progress' WHERE id='t-1'").run();
    publishEvent(handle.driver, "proj-1", "task.started", {});
    throw new Error("simulated crash before commit");
  });
  assert.equal(outcome.status, "error");
  const task = handle.driver.prepare("SELECT status FROM tasks WHERE id='t-1'").get();
  assert.equal(task.status, "planned", "mutation rolled back");
  assert.equal(handle.driver.prepare("SELECT COUNT(*) AS c FROM command_receipts").get().c, 0, "no receipt");
  assert.equal(handle.driver.prepare("SELECT COUNT(*) AS c FROM event_outbox").get().c, 0, "no event");
  assert.equal(handle.driver.prepare("SELECT revision FROM projects WHERE id='proj-1'").get().revision, 1, "revision unchanged");
  handle.close();
});

test("outbox cursor replay is deduplicated after delivery", async () => {
  const path = await tempStore("outbox");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  handle.driver.runExclusive(() => publishEvent(handle.driver, "proj-1", "e1", { n: 1 }));
  handle.driver.runExclusive(() => publishEvent(handle.driver, "proj-1", "e2", { n: 2 }));
  const first = readOutbox(handle.driver, "proj-1", "c");
  assert.equal(first.length, 2);
  advanceEventCursor(handle.driver, "proj-1", "c", first[1].eventId);
  const replay = readOutbox(handle.driver, "proj-1", "c");
  assert.equal(replay.length, 0, "delivered events are not redelivered");
  handle.close();
});

test("second writer gets a bounded busy outcome, never a hang", async () => {
  const path = await tempStore("busy");
  const handle = await openStore({ path, create: true, busyTimeoutMs: 200 });
  seedProject(handle.driver);
  const blocker = openNodeSqliteDriver({ path, busyTimeoutMs: 200 });
  // Both drivers are synchronous on one thread: hold the blocker's write
  // transaction while the second connection attempts a mutation — the second
  // must observe a bounded busy outcome after ~busy_timeout, never a hang.
  blocker.runExclusive(() => {
    blocker.prepare("INSERT INTO event_outbox (project_id, kind, payload, created_at) VALUES ('proj-1','block','{}',?)").run(new Date().toISOString());
    const busy = executeCommand(handle.driver, { requestId: "req-b", projectId: "proj-1", operation: "task.start", payload: {} }, startTaskApply);
    assert.equal(busy.status, "busy");
    assert.match(busy.reason, /busy/i);
  });
  blocker.close();
  // After the blocker commits, the same command succeeds — bounded retry semantics.
  const retry = executeCommand(handle.driver, { requestId: "req-b", projectId: "proj-1", operation: "task.start", payload: {} }, startTaskApply);
  assert.equal(retry.status, "committed");
  handle.close();
});

test("foreign keys are enforced with typed constraint outcomes", async () => {
  const path = await tempStore("fk");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  assert.throws(
    () => handle.driver.prepare("INSERT INTO tasks (id, project_id, phase_id, number, status, title, metadata, created_at, updated_at) VALUES ('t-bad','proj-1','missing-phase',99,'planned','x','{}',?,?)").run(new Date().toISOString(), new Date().toISOString()),
    (error) => error instanceof PersistenceError && error.code === "PERSISTENCE_CONSTRAINT",
  );
  handle.close();
});

test("documents: CRUD, history, folder listing, assets; content survives restore", async () => {
  const path = await tempStore("docs");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  const created = createDocument(handle.driver, { projectId: "proj-1", id: "doc-1", folder: "docs/agent-brain", name: "notes.md", content: "Begin a short BEGIN IMMEDIATE transaction; check expected revisions; store receipt and event." });
  assert.equal(created.revision, 1);
  const updated = updateDocument(handle.driver, "doc-1", { content: "Second revision body with checkpoint words." });
  assert.equal(updated.revision, 2);
  assert.notEqual(updated.contentHash, created.contentHash);
  const history = documentHistory(handle.driver, "doc-1");
  assert.deepEqual(history.map((entry) => entry.revision), [1, 2]);
  assert.equal(listFolder(handle.driver, "proj-1", "docs/agent-brain").length, 1);
  saveDocumentAsset(handle.driver, { id: "asset-1", documentId: "doc-1", name: "diagram.png", content: new Uint8Array([1, 2, 3, 4]) });
  const asset = getDocumentAsset(handle.driver, "asset-1");
  assert.equal(asset.content.length, 4);
  handle.close();

  // snapshot + restore: documents, revisions and assets survive
  const root = roots[roots.length - 1];
  const snapshotPath = join(root, "snapshots", "planner.snapshot.sqlite");
  const source = await openStore({ path });
  const snapshot = await createSnapshot(source.driver, snapshotPath);
  source.close();
  assert.ok(snapshot.bytes > 0);
  const restored = await restoreFromSnapshot(snapshotPath, join(root, "restored", "planner.sqlite"));
  assert.equal(restored.store.schemaVersion, 3);
  const restoredDoc = getDocument(restored.driver, "doc-1");
  assert.equal(restoredDoc.revision, 2, "document revision survives restore");
  assert.equal(restoredDoc.content, "Second revision body with checkpoint words.");
  const restoredAsset = getDocumentAsset(restored.driver, "asset-1");
  assert.ok(restoredAsset !== undefined && restoredAsset.content.length === 4, "required portable assets survive restore");
  restored.close();
});

test("FTS5 search returns snippets and pagination; the index is rebuildable without changing content", async () => {
  const path = await tempStore("fts");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  for (let i = 1; i <= 25; i++) {
    createDocument(handle.driver, {
      projectId: "proj-1", id: `doc-${i}`, folder: i % 2 ? "docs/a" : "docs/b", name: `note-${i}.md`,
      content: `Planner reliability note ${i}. The receipt and outbox pattern commits together with checkpoint evidence.`,
    });
  }
  const firstPage = searchDocumentsFts(handle.driver, "proj-1", "receipt outbox", { limit: 10, offset: 0 });
  assert.ok(firstPage.matches.length > 0);
  assert.ok(firstPage.matches.every((match) => match.snippet.length > 0), "snippets are returned");
  assert.equal(firstPage.matches.length, 10, "pagination honors limit");
  assert.equal(firstPage.truncated, true, "truncation is explicit when more results exist");
  const secondPage = searchDocumentsFts(handle.driver, "proj-1", "receipt outbox", { limit: 10, offset: 10 });
  assert.notEqual(firstPage.matches[0].documentId, secondPage.matches[0].documentId);
  const folderScoped = searchDocumentsFts(handle.driver, "proj-1", "receipt", { folder: "docs/a", limit: 50 });
  assert.ok(folderScoped.matches.every((match) => match.folder === "docs/a"));
  const literal = searchDocumentsLiteral(handle.driver, "proj-1", "receipt and outbox", { limit: 5 });
  assert.ok(literal.matches.length > 0);
  const contentBefore = handle.driver.prepare("SELECT content FROM documents WHERE id='doc-3'").get().content;
  const rebuilt = rebuildFtsIndex(handle.driver);
  assert.equal(rebuilt.documents, 25);
  const afterRebuild = searchDocumentsFts(handle.driver, "proj-1", "receipt outbox", { limit: 10 });
  assert.deepEqual(afterRebuild.matches.map((m) => m.documentId), firstPage.matches.map((m) => m.documentId), "rebuild preserves search results");
  const contentAfter = handle.driver.prepare("SELECT content FROM documents WHERE id='doc-3'").get().content;
  assert.equal(contentAfter, contentBefore, "canonical content unchanged by rebuild");
  assert.equal(deleteDocument(handle.driver, "doc-25"), true);
  assert.equal(getDocument(handle.driver, "doc-25"), undefined);
  handle.close();
});

test("unknown schema versions and corrupt files are typed, never silently migrated", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plan-sqlite-incompat-"));
  roots.push(root);
  const futurePath = join(root, "future.sqlite");
  const driver = openNodeSqliteDriver({ path: futurePath });
  bootstrapStoreSchema(driver);
  driver.prepare("UPDATE store_meta SET value='999' WHERE key='schema_version'").run();
  driver.close();
  await assert.rejects(
    () => openStore({ path: futurePath }),
    (error) => error instanceof PersistenceError && error.code === "PERSISTENCE_SCHEMA_INCOMPATIBLE",
  );

  const corruptPath = join(root, "corrupt.sqlite");
  await writeFile(corruptPath, "this is not a database".repeat(40));
  await assert.rejects(
    () => openStore({ path: corruptPath }),
    (error) => error instanceof PersistenceError,
  );

  const missingPath = join(root, "missing.sqlite");
  await assert.rejects(
    () => openStore({ path: missingPath }),
    (error) => error instanceof PersistenceError && error.code === "PERSISTENCE_UNAVAILABLE",
  );
  await openStore({ path: missingPath, create: true }).then((h) => h.close());
  const size = await stat(missingPath);
  assert.ok(size.size > 0);
});

test("task rows are independent: two tasks in one phase mutate independently", async () => {
  const path = await tempStore("rows");
  const handle = await openStore({ path, create: true });
  seedProject(handle.driver);
  handle.driver.runExclusive(() => {
    handle.driver.prepare("INSERT INTO tasks (id, project_id, phase_id, number, priority, status, title, metadata, created_at, updated_at) VALUES ('t-2','proj-1','p-1',2,1,'planned','Task two','{}',?,?)")
      .run(new Date().toISOString(), new Date().toISOString());
  });
  executeCommand(handle.driver, { requestId: "req-t1", projectId: "proj-1", operation: "task.start", payload: { taskId: "t-1" } }, startTaskApply);
  const t1 = handle.driver.prepare("SELECT status FROM tasks WHERE id='t-1'").get();
  const t2 = handle.driver.prepare("SELECT status FROM tasks WHERE id='t-2'").get();
  assert.equal(t1.status, "in-progress");
  assert.equal(t2.status, "planned", "sibling task untouched");
  handle.close();
});

test("restoring a snapshot preserves an occupied database and refuses an invalid source", async () => {
  const sourcePath = await tempStore("restore-source");
  const source = await openStore({ path: sourcePath, create: true });
  seedProject(source.driver);
  source.close();

  const targetPath = await tempStore("restore-occupied");
  const target = await openStore({ path: targetPath, create: true });
  seedProject(target.driver, "existing-project");
  target.close();
  await assert.rejects(() => restoreFromSnapshot(sourcePath, targetPath), { code: "EEXIST" });
  const kept = await openStore({ path: targetPath });
  try {
    assert.equal(kept.driver.prepare("SELECT id FROM projects").get().id, "existing-project");
  } finally {
    kept.close();
  }

  const invalidPath = await tempStore("restore-invalid");
  await writeFile(invalidPath, "This is not a SQLite snapshot");
  const missingPath = await tempStore("restore-missing");
  await assert.rejects(() => restoreFromSnapshot(invalidPath, missingPath), { code: "PERSISTENCE_CORRUPT" });
  await assert.rejects(() => openStore({ path: missingPath }), { code: "PERSISTENCE_UNAVAILABLE" });
  await assert.rejects(() => stat(missingPath), { code: "ENOENT" });
});

test("concurrent snapshot restores publish exactly one database", async () => {
  const sourcePath = await tempStore("restore-race-source");
  const source = await openStore({ path: sourcePath, create: true });
  source.close();

  const targetPath = await tempStore("restore-race-target");
  const attempts = await Promise.allSettled([
    restoreFromSnapshot(sourcePath, targetPath),
    restoreFromSnapshot(sourcePath, targetPath),
  ]);
  for (const attempt of attempts) {
    if (attempt.status === "fulfilled") attempt.value.close();
  }
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.find((attempt) => attempt.status === "rejected").reason.code, "EEXIST");
});
