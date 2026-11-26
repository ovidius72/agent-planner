import assert from "node:assert/strict";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { createPiHost, closePiHost } from "../../pi-adapter/test/helpers/pi-host-fixture.mjs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { cloneKeyFor, handoffContentHash, writeProjectDescriptor } from "@agent-plan/core";
import { join } from "node:path";
import { after, test } from "node:test";
import { once } from "node:events";
import WebSocket from "ws";
import { bootstrapStoreSchema, createDocument, documentHistory, openNodeSqliteDriver, readOutbox } from "@agent-plan/core/persistence";
import { cleanupFixtures, createPlannerFixture } from "../../../test/helpers/fixtures.mjs";
import { callTool, closeMcpFixture, startMcpClient } from "../../../test/helpers/mcp-fixture.mjs";
import { request } from "../../../test/helpers/server-fixture.mjs";
import { runCliAsync } from "../../agent-plan/test/helpers/cli-process.mjs";
import { connectRegisteredPlannerService, ensureRegisteredPlannerRuntime, stopRegisteredPlannerRuntime } from "../dist/index.js";

after(cleanupFixtures);

async function nextEvent(socket) {
  const [message] = await once(socket, "message", { signal: AbortSignal.timeout(3000) });
  return JSON.parse(String(message));
}

test("registered projects use SQLite with principal and workspace scope, receipts, audit and outbox", async (t) => {
  const fixture = await createPlannerFixture({ name: "registered-project-app" });
  const git = (...args) => execFileSync("git", ["-C", fixture.root, ...args], { stdio: "pipe" });
  git("init", "-q");
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const workspaceId = randomUUID();
  const requestId = randomUUID();
  const documentId = randomUUID();
  const foreignDocumentId = randomUUID();
  async function openFixtureProject(id) {
    const directory = join(fixture.root, ".agent-plan", "projects", id);
    await mkdir(directory, { recursive: true });
    const driver = openNodeSqliteDriver({ path: join(directory, "planner.sqlite") });
    bootstrapStoreSchema(driver);
    const now = new Date().toISOString();
    driver.prepare("INSERT INTO projects(id, descriptor_project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, id, "SQLite planner", now, now);
    driver.prepare("INSERT INTO project_principals(project_id, principal_id) VALUES (?, ?)").run(id, "loopback:agent");
    const sourcePath = await realpath(fixture.root);
    driver.prepare("INSERT INTO project_workspaces(project_id, id, source_path, clone_key) VALUES (?, ?, ?, ?)")
      .run(id, workspaceId, sourcePath, await cloneKeyFor(sourcePath));
    return driver;
  }
  const driver = await openFixtureProject(projectId);
  const otherDriver = await openFixtureProject(otherProjectId);
  let handle;
  let stream;
  let replayStream;
  try {
    createDocument(driver, { projectId, id: documentId, folder: "specs", name: "Document", content: "baseline" });
    createDocument(otherDriver, { projectId: otherProjectId, id: foreignDocumentId, folder: "specs", name: "Other", content: "baseline foreign" });

    const connections = await Promise.all([1, 2].map(() => connectRegisteredPlannerService({ home: fixture.root })));
    assert.deepEqual(connections.map(({ url }) => url), [connections[0].url, connections[0].url]);
    assert.equal(connections.filter(({ reused }) => !reused).length, 1);
    handle = connections.find(({ reused }) => !reused);
    const runtime = { handle };
    await writeProjectDescriptor(fixture.root, { schemaVersion: 1, projectId });
    git("add", ".agent-plan.json");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Descriptor");
    const linked = join(fixture.root, "linked");
    git("worktree", "add", "--detach", "--quiet", linked);
    const resolveCheckout = (cwd) => request(runtime, "/api/v2/projects/resolve", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd }),
    });
    const [bound, repeated] = await Promise.all([resolveCheckout(linked), resolveCheckout(linked)]);
    assert.equal(bound.body.data.projectId, projectId);
    assert.notEqual(bound.body.data.workspaceId, workspaceId);
    assert.deepEqual(repeated.body.data, bound.body.data);
    assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM command_audit WHERE operation='workspace.register'").get().count, 1);
    const linkedScope = `/api/v2/projects/${projectId}/workspaces/${bound.body.data.workspaceId}`;
    assert.equal((await request(runtime, `${linkedScope}/snapshot`)).body.data.sourceRoot, await realpath(linked));
    const nested = join(fixture.root, "src");
    await mkdir(nested);
    const resolved = await request(runtime, "/api/v2/projects/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: nested }),
    });
    assert.deepEqual(resolved.body.data, { projectId, workspaceId });
    const cli = await runCliAsync(["serve", "--json"], {
      cwd: nested,
      env: { ...process.env, HOME: fixture.root, NODE_OPTIONS: "", AGENT_PLAN_ROOT: "" },
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout), {
      url: handle.url, ...handle.record, reused: true, projectId, workspaceId,
      boardUrl: `${handle.url}/board/${projectId}/${workspaceId}`,
    });
    const expectedBoard = `${handle.url}/board/${projectId}/${workspaceId}`;
    const featureId = randomUUID();
    const phaseId = randomUUID();
    const taskId = randomUUID();
    const now = new Date().toISOString();
    driver.prepare("INSERT INTO features(id, project_id, number, status, name, created_at, updated_at) VALUES (?, ?, 1, 'planned', 'Feature', ?, ?)")
      .run(featureId, projectId, now, now);
    driver.prepare("INSERT INTO phases(id, project_id, feature_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 2, 'planned', 'Phase', ?, ?)")
      .run(phaseId, projectId, featureId, now, now);
    driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 3, 'in-progress', 'Task', ?, ?)")
      .run(taskId, projectId, phaseId, now, now);

    const requirementId = randomUUID();
    driver.prepare("INSERT INTO requirements(id, project_id, number, title, content) VALUES (?, ?, 1, ?, ?)")
      .run(requirementId, projectId, "Verify registered context", JSON.stringify({ createdAt: now, updatedAt: now }));
    driver.prepare("INSERT INTO entity_requirements(entity_kind, entity_id, requirement_id) VALUES ('phase', ?, ?)")
      .run(phaseId, requirementId);
    const mcp = await startMcpClient({
      cwd: nested, env: { HOME: fixture.root, NODE_OPTIONS: "" },
    });
    try {
      const [features, phases, tasks, overview] = await Promise.all([
        callTool(mcp, "planner-feature-list", { featureRef: "F001" }),
        callTool(mcp, "planner-phase-list", { featureRef: "F001", status: "in-progress" }),
        callTool(mcp, "planner-task-list", { phaseRef: "P002(F001)", status: "in-progress" }),
        callTool(mcp, "planner-show", {}),
      ]);
      assert.equal(features.structuredContent.features[0].taskCount, 1);
      assert.equal(phases.structuredContent.phases[0].status, "in-progress");
      assert.equal(tasks.structuredContent.tasks[0].ref, "P002(F001)/T003");
      assert.equal(tasks.structuredContent.tasks[0].id, taskId);
      assert.ok(overview.structuredContent, JSON.stringify(overview.content));
      assert.equal(overview.structuredContent.overview.activeTaskState, "single");
      assert.equal(overview.structuredContent.overview.activeTasks[0].id, taskId);
      const incomplete = await callTool(mcp, "planner-load", { maxChars: 20 });
      assert.ok(incomplete.structuredContent, JSON.stringify(incomplete.content));
      assert.equal(incomplete.structuredContent.projectContext.contextComplete, false);
      assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM project_context_reads").get().count, 0);
      const loaded = await callTool(mcp, "planner-load", {});
      assert.ok(loaded.structuredContent, JSON.stringify(loaded.content));
      const delivered = loaded.structuredContent;
      assert.equal(delivered.sessionId, incomplete.structuredContent.sessionId);
      assert.equal(delivered.projectContext.contextComplete, true);
      assert.match(delivered.text, /Verify registered context/);
      assert.equal(driver.prepare("SELECT fingerprint FROM project_context_reads WHERE session_id = ?").get(delivered.sessionId).fingerprint,
        delivered.projectContext.fingerprint);
    } finally {
      await closeMcpFixture(mcp);
    }
    const copied = join(fixture.root, "unregistered-copy");
    await writeProjectDescriptor(copied, { schemaVersion: 1, projectId });
    await request(runtime, "/api/v2/projects/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: copied }),
      expectStatus: 403,
    });
    const scope = `/api/v2/projects/${projectId}/workspaces/${workspaceId}`;
    const view = (await request(runtime, scope)).body;
    assert.deepEqual(view.data, { projectId, workspaceId, name: "SQLite planner", revision: 1, contentLanguage: "", chatLanguage: "" });
    const found = (await request(runtime, `${scope}/search?q=baseline`)).body.data;
    assert.deepEqual(found.matches.map((match) => match.documentId), [documentId]);
    const otherScope = `/api/v2/projects/${otherProjectId}/workspaces/${workspaceId}`;
    const otherFound = (await request(runtime, `${otherScope}/search?q=baseline`)).body.data;
    assert.deepEqual(otherFound.matches.map((match) => match.documentId), [foreignDocumentId]);
    const streamUrl = `${handle.url.replace("http:", "ws:")}${scope}/events/stream`;
    stream = new WebSocket(streamUrl);
    const wsSnapshot = await nextEvent(stream);
    assert.equal(wsSnapshot.type, "snapshot");
    assert.equal(wsSnapshot.bootId, handle.record.bootId);
    const staleSocket = new WebSocket(`${streamUrl}?after=0&bootId=${randomUUID()}`);
    assert.deepEqual(await nextEvent(staleSocket), { type: "snapshot-required", bootId: handle.record.bootId });
    staleSocket.terminate();
    const snapshot = (await request(runtime, `${scope}/snapshot`)).body.data;
    assert.equal(snapshot.cursor, 0);
    assert.deepEqual(snapshot.documents.map(({ id }) => id), [documentId]);
    assert.deepEqual(snapshot.features.map(({ id }) => id), [featureId]);
    assert.deepEqual(snapshot.phases.map(({ id }) => id), [phaseId]);
    assert.deepEqual(snapshot.tasks.map(({ id, status }) => ({ id, status })), [{ id: taskId, status: "in-progress" }]);
    const session = (await request(runtime, `${scope}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKind: "mcp", sessionId: "self-assigned" }),
    })).body.data;
    assert.notEqual(session.sessionId, "self-assigned");
    assert.equal(Date.parse(session.expiresAt) - Date.parse(session.lastSeenAt), 120_000);
    const heartbeat = `${scope}/sessions/${session.sessionId}/heartbeat`;
    await request(runtime, heartbeat, { method: "POST" });
    await request(runtime, `${otherScope}/sessions/${session.sessionId}/heartbeat`, { method: "POST", expectStatus: 404 });
    driver.prepare("UPDATE project_sessions SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", session.sessionId);
    assert.equal((await request(runtime, heartbeat, { method: "POST", expectStatus: 409 })).body.error.code, "SESSION_EXPIRED");
    const denied = await request(runtime, scope, { headers: { Origin: handle.url, "X-Planner-Source": "agent" }, expectStatus: 403 });
    assert.equal(denied.body.error.code, "PROJECT_ACCESS_DENIED");
    await request(runtime, `/api/v2/projects/${projectId}/workspaces/${randomUUID()}`, { expectStatus: 403 });
    await request(runtime, `${scope}/documents/${foreignDocumentId}`, { expectStatus: 404 });
    const missing = randomUUID();
    await request(runtime, `/api/v2/projects/${missing}/workspaces/${workspaceId}`, { expectStatus: 404 });

    const edit = (content, expectedRevision, key = requestId) => ({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: key, expectedRevision, content, actorId: "forged", requesterId: "forged" }),
    });
    const path = `${scope}/documents/${documentId}`;
    const broadcast = nextEvent(stream);
    const applied = await request(runtime, path, edit("committed", 1));
    const live = await broadcast;
    assert.equal(live.type, "events");
    assert.deepEqual(live.data.events.map((event) => event.kind), ["document.updated"]);
    const replayed = await request(runtime, path, edit("committed", 1));
    assert.equal(applied.body.data.status, "committed");
    assert.equal(replayed.body.data.status, "already-applied");
    assert.equal(replayed.body.data.revision, 2);
    assert.equal((await request(runtime, path, { ...edit("different", 1), expectStatus: 409 })).body.error.code, "REQUEST_ID_CONFLICT");
    assert.equal((await request(runtime, path, { ...edit("stale", 1, randomUUID()), expectStatus: 409 })).body.error.code, "PROJECT_REVISION_CONFLICT");
    assert.equal((await request(runtime, path)).body.data.content, "committed");
    assert.equal(documentHistory(driver, documentId).length, 2);
    assert.deepEqual(driver.prepare("SELECT actor_id, requester_id, request_id FROM command_audit WHERE operation='document.update'").all().map((row) => ({ ...row })), [
      { actor_id: "loopback:agent", requester_id: "loopback:agent", request_id: requestId },
    ]);
    assert.deepEqual(readOutbox(driver, projectId, "test").map((event) => event.kind), ["document.updated"]);
    assert.deepEqual((await request(runtime, `${otherScope}/events`)).body.data.events, []);
    replayStream = new WebSocket(`${streamUrl}?after=0&bootId=${handle.record.bootId}`);
    const recovered = await nextEvent(replayStream);
    assert.deepEqual(recovered.data.events, live.data.events);
    const replay = (await request(runtime, `${scope}/events?after=${snapshot.cursor}`)).body.data;
    assert.deepEqual(replay.events.map((event) => event.kind), ["document.updated"]);
    assert.equal((await request(runtime, `${scope}/events?after=${replay.cursor}`)).body.data.events.length, 0);
    await request(runtime, `${scope}/events?after=${replay.cursor + 1}`, { expectStatus: 409 });
    const taskToStart = randomUUID();
    driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 4, 'planned', 'Claim test', ?, ?)")
      .run(taskToStart, projectId, phaseId, now, now);
    const register = async () => (await request(runtime, `${scope}/sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientKind: "mcp" }),
    })).body.data.sessionId;
    const [firstOwner, secondOwner] = await Promise.all([register(), register()]);
    const taskRef = "P002(F001)/T004";
    const taskRequest = (sessionId, fields, expectStatus) => ({
      method: "POST", headers: { "Content-Type": "application/json", "X-Planner-Session": sessionId },
      body: JSON.stringify({ ref: taskRef, ...fields }), ...(expectStatus ? { expectStatus } : {}),
    });
    const startPath = `${scope}/tasks/start`;
    const contextPath = `${scope}/tasks/context`;
    const firstKey = randomUUID();
    const noRead = await request(runtime, startPath, taskRequest(firstOwner, { requestId: firstKey }, 409));
    assert.equal(noRead.body.error.code, "CONTEXT_READ_REQUIRED");
    const partial = await request(runtime, contextPath, taskRequest(firstOwner, { maxChars: 16 }));
    assert.equal(partial.body.data.kind, "incomplete");
    assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM task_context_reads").get().count, 0);
    await request(runtime, contextPath, taskRequest(firstOwner, {}));
    driver.prepare("UPDATE tasks SET title = ? WHERE id = ?").run("Changed since read", taskToStart);
    const stale = await request(runtime, startPath, taskRequest(firstOwner, { requestId: firstKey }, 409));
    assert.equal(stale.body.error.code, "CONTEXT_READ_REQUIRED");
    assert.equal(driver.prepare("SELECT status FROM tasks WHERE id = ?").get(taskToStart).status, "planned");

    await Promise.all([firstOwner, secondOwner].map((owner) => request(runtime, contextPath, taskRequest(owner, {}))));
    const contenders = [{ owner: firstOwner, key: firstKey }, { owner: secondOwner, key: randomUUID() }];
    const raced = await Promise.all(contenders.map(async ({ owner, key }) => {
      const response = await fetch(handle.url + startPath, taskRequest(owner, { requestId: key }));
      return { owner, key, status: response.status, body: await response.json() };
    }));
    assert.deepEqual(raced.map(({ status }) => status).sort(), [200, 409]);
    const winner = raced.find(({ status }) => status === 200);
    const loser = raced.find(({ status }) => status === 409);
    assert.equal(loser.body.error.code, "TASK_OWNED_BY_ANOTHER_SESSION");
    const same = await request(runtime, startPath, taskRequest(winner.owner, { requestId: winner.key }));
    assert.deepEqual(same.body, winner.body);
    assert.equal(driver.prepare("SELECT active_owner_session FROM tasks WHERE id = ?").get(taskToStart).active_owner_session, winner.owner);

    driver.prepare("UPDATE project_sessions SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", winner.owner);
    const successor = await startMcpClient({ cwd: nested, env: { HOME: fixture.root, NODE_OPTIONS: "" } });
    try {
      const deniedStart = await callTool(successor, "planner-task-start", { task: taskRef }, { expectError: true });
      assert.equal(deniedStart.structuredContent.errorCode, "CONTEXT_READ_REQUIRED");
      const full = await callTool(successor, "planner-task-show", { task: taskRef, full: true });
      assert.equal(full.structuredContent.contextComplete, true);
      assert.doesNotMatch(full.structuredContent.text, new RegExp(winner.owner));
      const reclaimed = await callTool(successor, "planner-task-start", { task: taskRef });
      assert.equal(reclaimed.structuredContent.started, true);
      assert.equal(reclaimed.structuredContent.reclaimed, true);
      const beforePause = JSON.parse(driver.prepare("SELECT metadata FROM tasks WHERE id = ?").get(taskToStart).metadata);
      const paused = await callTool(successor, "planner-task-pause", {
        task: taskRef, reason: "Test parking the execution", what_was_being_done: "Registered lifecycle verification",
        resume_location: "registered lifecycle fixture", how_to_resume: "Reload the scoped task context.",
      });
      assert.equal(paused.structuredContent.paused, true);
      assert.equal(driver.prepare("SELECT active_owner_session FROM tasks WHERE id = ?").get(taskToStart).active_owner_session, "");
      await callTool(successor, "planner-task-show", { task: taskRef, full: true });
      const resumed = await callTool(successor, "planner-task-start", { task: taskRef });
      assert.equal(resumed.structuredContent.started, true);
      assert.equal(resumed.structuredContent.checkpoint.resumeLocation, "registered lifecycle fixture");
      const afterResume = driver.prepare("SELECT metadata, pause_snapshot FROM tasks WHERE id = ?").get(taskToStart);
      assert.equal(afterResume.pause_snapshot, null);
      assert.equal(JSON.parse(afterResume.metadata).startedAt, beforePause.startedAt);
      assert.equal(JSON.parse(afterResume.metadata).pauseHistory.length, 1);
      driver.prepare("INSERT INTO task_checklists(task_id, item_id, text, checked) VALUES (?, ?, ?, 0)")
        .run(taskToStart, "check-1", "Preserve this unticked item");
      const complete = { task: taskRef, description_update: "Verified completion under the registered authority." };
      const incompleteChecklist = await callTool(successor, "planner-task-complete", complete);
      assert.equal(incompleteChecklist.structuredContent.errorCode, "CHECKLIST_INCOMPLETE");
      const missingMotivation = await callTool(successor, "planner-task-complete", { ...complete, force: true });
      assert.equal(missingMotivation.structuredContent.errorCode, "FORCE_MOTIVATION_REQUIRED");
      const checked = await callTool(successor, "planner-task-checklist-toggle", { task: taskRef, item: "C1", checked: true });
      assert.equal(checked.structuredContent.item.checked, true);
      const unchecked = await callTool(successor, "planner-task-checklist-toggle", { task: taskRef, item: "C1", checked: false });
      assert.equal(unchecked.structuredContent.item.checked, false);
      const finished = await callTool(successor, "planner-task-complete", {
        ...complete, force: true, motivation: "The retained item is intentionally outside this test.",
      });
      assert.equal(finished.structuredContent.completed, true);
      assert.equal(driver.prepare("SELECT checked FROM task_checklists WHERE task_id = ?").get(taskToStart).checked, 0);
      const persisted = driver.prepare("SELECT status, active_owner_session, metadata FROM tasks WHERE id = ?").get(taskToStart);
      assert.equal(persisted.status, "done");
      assert.equal(persisted.active_owner_session, "");
      assert.match(JSON.parse(persisted.metadata).description, /intentionally outside this test/);
      const reopenDenied = await callTool(successor, "planner-task-reopen", { task: taskRef }, { expectError: true });
      assert.equal(reopenDenied.structuredContent.errorCode, "TASK_REOPEN_CONFIRMATION_REQUIRED");
      const reopened = await callTool(successor, "planner-task-reopen", { task: taskRef, confirmed: true });
      assert.equal(reopened.structuredContent.reopened, true);
      const afterReopen = driver.prepare("SELECT status, metadata FROM tasks WHERE id = ?").get(taskToStart);
      assert.equal(afterReopen.status, "in-progress");
      assert.equal(JSON.parse(afterReopen.metadata).completedAt, "");
      assert.match(JSON.parse(afterReopen.metadata).description, /Verified completion/);
      const temporaryTask = randomUUID();
      driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 5, 'planned', 'Temporary work', ?, ?)")
        .run(temporaryTask, projectId, phaseId, now, now);
      const change = {
        from_task: taskRef, to_task: "T005", reason: "Switch to prerequisite",
        what_was_being_done: "Testing the first task", resume_location: "Fixture checkpoint",
        how_to_resume: "Verify the resumed owner.",
      };
      const revisionBeforeSwitch = driver.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId).revision;
      const blockedSwitch = await callTool(successor, "planner-task-switch", change, { expectError: true });
      assert.equal(blockedSwitch.structuredContent.errorCode, "CONTEXT_READ_REQUIRED");
      assert.equal(driver.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId).revision, revisionBeforeSwitch);
      assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM work_deviations").get().count, 0);
      assert.equal(driver.prepare("SELECT status FROM tasks WHERE id = ?").get(taskToStart).status, "in-progress");

      await callTool(successor, "planner-task-show", { task: "T005", full: true });
      const switched = await callTool(successor, "planner-task-switch", change);
      assert.equal(switched.structuredContent.switched, true);
      assert.equal(driver.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId).revision, revisionBeforeSwitch + 1);
      assert.equal(driver.prepare("SELECT status FROM tasks WHERE id = ?").get(taskToStart).status, "planned");
      const temporaryCompleted = await callTool(successor, "planner-task-complete", {
        task: "T005", description_update: "Verified completion of the temporary task.",
      });
      assert.equal(temporaryCompleted.structuredContent.resumeRequired.taskId, taskToStart);
      const resumeRecommendation = await callTool(successor, "planner-task-recommend");
      assert.equal(resumeRecommendation.structuredContent.kind, "resume");
      assert.equal(resumeRecommendation.structuredContent.taskId, taskToStart);
      await callTool(successor, "planner-task-show", { task: taskRef, full: true });
      const returned = await callTool(successor, "planner-task-start", { task: taskRef });
      assert.equal(returned.structuredContent.checkpoint.resumeLocation, "Fixture checkpoint");
      assert.equal(driver.prepare("SELECT state FROM work_deviations WHERE id = ?").get(switched.structuredContent.deviationId).state, "resumed");
      const secondTemporary = randomUUID();
      driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 6, 'planned', 'Recovery target', ?, ?)")
        .run(secondTemporary, projectId, phaseId, now, now);
      await callTool(successor, "planner-task-show", { task: "T006", full: true });
      const waitingReturn = await callTool(successor, "planner-task-switch", { ...change, to_task: "T006" });
      assert.equal(waitingReturn.structuredContent.switched, true);

      const recovery = await startMcpClient({ cwd: nested, env: { HOME: fixture.root, NODE_OPTIONS: "" } });
      try {
        const active = await callTool(recovery, "planner-session-recover", { task: taskRef, confirmed: true }, { expectError: true });
        assert.equal(active.structuredContent.errorCode, "SESSION_OWNER_ACTIVE");
        const oldOwner = driver.prepare("SELECT active_owner_session FROM tasks WHERE id = ?").get(secondTemporary).active_owner_session;
        driver.prepare("UPDATE project_sessions SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", oldOwner);
        const recoveredSession = await callTool(recovery, "planner-session-recover", { task: taskRef, confirmed: true });
        assert.deepEqual(recoveredSession.structuredContent.taskIds, [secondTemporary]);
        assert.deepEqual(recoveredSession.structuredContent.deviationIds, [waitingReturn.structuredContent.deviationId]);
        const noRecoveryRead = await callTool(recovery, "planner-task-start", { task: "T006" }, { expectError: true });
        assert.equal(noRecoveryRead.structuredContent.errorCode, "CONTEXT_READ_REQUIRED");
      } finally {
        await closeMcpFixture(recovery);
      }
    } finally {
      await closeMcpFixture(successor);
    }
    assert.deepEqual(readOutbox(driver, projectId, "test").map((event) => event.kind), ["document.updated", "task.started", "task.reclaimed", "task.paused", "task.resumed", "task.checklist.changed", "task.checklist.changed", "task.completed", "task.reopened", "task.paused", "task.started", "task.switched", "task.completed", "task.resumed", "task.paused", "task.started", "task.switched", "task.session.recovered"]);
    assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM command_audit WHERE operation='task.start'").get().count, 4);
    const piTask = randomUUID();
    driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 7, 'planned', 'Pi execution', ?, ?)")
      .run(piTask, projectId, phaseId, now, now);
    const mockHome = t.mock.method(os, "homedir", () => fixture.root);
    syncBuiltinESMExports();
    const pi = await createPiHost({ root: nested, keepRootOnClose: true });
    try {
      const load = await pi.runTool("planner-load");
      assert.equal(load.details.projectContext.contextComplete, true);
      const sameTask = await pi.runTool("task_deviation", {
        temporary_task: "T007", resume_task: "T007", reason: "Check the registered refusal.",
      }, { expectError: true });
      assert.equal(sameTask.details.errorCode, "DEVIATION_SAME_TASK");
      const approved = await pi.runTool("task_deviation", {
        temporary_task: "T007", resume_task: taskRef, reason: "Verify registered deviation approval.",
      });
      const deviation = approved.details.deviation;
      assert.equal(deviation.state, "approved");
      assert.equal(deviation.temporaryTaskId, piTask);
      assert.equal(deviation.resumeTaskId, taskToStart);
      assert.equal(driver.prepare("SELECT status FROM tasks WHERE id = ?").get(piTask).status, "planned");
      assert.equal(driver.prepare("SELECT owner_session FROM work_deviations WHERE id = ?").get(deviation.id).owner_session, deviation.ownerSession);
      assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM command_audit WHERE operation='task.deviation'").get().count, 1);
      const refusedStart = await pi.runTool("task_start", { taskId: "T007" }, { expectError: true });
      assert.equal(refusedStart.details.errorCode, "CONTEXT_READ_REQUIRED");
      await pi.runTool("task_get", { taskId: "T007", full: true });
      const startedPi = await pi.runTool("task_start", { taskId: "T007" });
      assert.equal(startedPi.details.started, true);
      const activeRecommendation = await pi.runTool("task_recommend");
      assert.equal(activeRecommendation.details.kind, "active");
      assert.equal(activeRecommendation.details.taskId, piTask);
      const wholePlan = await pi.runTool("plan_get");
      assert.ok(wholePlan.details.activeTasks.some(({ id }) => id === piTask));
      assert.equal(wholePlan.details.manifest.projectId, projectId);
      const exported = await runCliAsync(["export", "--full"], {
        cwd: nested, env: { ...process.env, HOME: fixture.root, NODE_OPTIONS: "", AGENT_PLAN_ROOT: "" },
      });
      assert.equal(exported.status, 0, exported.stderr);
      assert.match(exported.stdout, /Pi execution/);
      const owner = driver.prepare("SELECT active_owner_session FROM tasks WHERE id = ?").get(piTask).active_owner_session;
      assert.equal(driver.prepare("SELECT client_kind FROM project_sessions WHERE id = ?").get(owner).client_kind, "pi");
      await pi.runCommand("task checklist-add T007 Verify native checklist routing");
      await pi.runCommand("task checklist-toggle T007 C1 on");
      assert.equal(driver.prepare("SELECT checked FROM task_checklists WHERE task_id = ?").get(piTask).checked, 1);
      await pi.runCommand("task checklist-remove T007 C1");
      assert.equal(driver.prepare("SELECT item_id FROM task_checklists WHERE task_id = ?").get(piTask), undefined);
      const completedPi = await pi.runTool("task_complete", {
        taskId: "T007", description_update: "Verified execution through the registered Pi adapter.",
      });
      assert.equal(completedPi.details.completed, true);
      assert.equal(driver.prepare("SELECT status FROM tasks WHERE id = ?").get(piTask).status, "done");
      const slashTask = randomUUID();
      driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 97, 'planned', 'Pi slash execution', ?, ?)")
        .run(slashTask, projectId, phaseId, now, now);
      await pi.runCommand("task start T097");
      assert.equal(driver.prepare("SELECT status FROM tasks WHERE id = ?").get(slashTask).status, "planned");
      await pi.runCommand("task show T097");
      await pi.runCommand("task start T097");
      assert.equal(driver.prepare("SELECT status FROM tasks WHERE id = ?").get(slashTask).status, "in-progress");
      pi.ui.inputAnswers.push("Verified start and completion using the registered native Pi command.");
      await pi.runCommand("task complete T097");
      assert.equal(driver.prepare("SELECT status FROM tasks WHERE id = ?").get(slashTask).status, "done");
      pi.ui.inputAnswers.push("Pi slash edit", "");
      pi.ui.editorAnswers.push("Updated through the native scoped task command.");
      await pi.runCommand("task update T097");
      assert.equal(driver.prepare("SELECT title FROM tasks WHERE id = ?").get(slashTask).title, "Pi slash edit");
      pi.ui.editorAnswers.push("Discussed through the native scoped task command.");
      pi.ui.inputAnswers.push("Review the discussion");
      await pi.runCommand("task discuss T097");
      assert.equal(driver.prepare("SELECT text FROM task_checklists WHERE task_id = ?").get(slashTask).text, "Review the discussion");
      const description = "Verify registered planner create commands and atomic scoped entity identity allocation.";
      const mcpWriter = await startMcpClient({ cwd: nested, env: { HOME: fixture.root, NODE_OPTIONS: "" } });
      try {
        const disposable = randomUUID();
        driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 8, 'planned', 'Delete via Pi', ?, ?)")
          .run(disposable, projectId, phaseId, now, now);
        pi.ui.inputAnswers.push("no");
        await pi.runCommand("task delete T008");
        assert.equal(driver.prepare("SELECT id FROM tasks WHERE id = ?").get(disposable).id, disposable);
        pi.ui.inputAnswers.push("yes");
        await pi.runCommand("task delete T008");
        assert.equal(driver.prepare("SELECT id FROM tasks WHERE id = ?").get(disposable), undefined);
        const disposableMcp = randomUUID();
        driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, 8, 'planned', 'Delete via MCP', ?, ?)")
          .run(disposableMcp, projectId, phaseId, now, now);
        const mcpDeleted = await callTool(mcpWriter, "planner-task-delete", { task: disposableMcp });
        assert.equal(mcpDeleted.structuredContent.deleted, disposableMcp);
        const mcpExport = await callTool(mcpWriter, "planner-export", { full: true });
        assert.match(mcpExport.structuredContent.markdown, /Pi execution/);
        pi.ui.editorAnswers.push("Verify native feature creation against the scoped SQLite service and preserve its implementation context.");
        await pi.runCommand("feature add Native Pi feature");
        const nativeFeature = driver.prepare("SELECT id FROM features WHERE project_id = ? AND name = ?").get(projectId, "Native Pi feature");
        pi.ui.inputAnswers.push("Native Pi feature updated", "", "");
        pi.ui.editorAnswers.push("Verify native feature creation against the scoped SQLite service and preserve its implementation context.", "", "");
        await pi.runCommand(`feature update ${nativeFeature.id}`);
        assert.equal(driver.prepare("SELECT name FROM features WHERE id = ?").get(nativeFeature.id).name, "Native Pi feature updated");
        const mcpBoard = await callTool(mcpWriter, "planner-web", { action: "start" });
        assert.equal(mcpBoard.structuredContent.localUrl, expectedBoard);
        const piBoard = await pi.runTool("planner-web", { action: "status" });
        assert.equal(piBoard.details.localUrl, expectedBoard);
        const stopWeb = await callTool(mcpWriter, "planner-web", { action: "stop" });
        assert.equal(stopWeb.structuredContent.running, true);
        assert.equal((await (await fetch(`${handle.url}/health`)).json()).bootId, handle.record.bootId);
        const feature = await callTool(mcpWriter, "planner-feature-add", { name: "Created in MCP", description });
        assert.equal(feature.structuredContent.created, true);
        const createdPhase = await pi.runTool("phase_create", {
          featureId: feature.structuredContent.feature.id, title: "Created in Pi", description,
        });
        assert.equal(createdPhase.details.created, true);
        pi.ui.inputAnswers.push("Native Pi phase summary", "", "", "", "", "", "");
        pi.ui.editorAnswers.push("Record scoped phase discussion through the native client with context provenance.");
        await pi.runCommand(`phase discuss ${createdPhase.details.ref}`);
        const nativePhaseMetadata = JSON.parse(driver.prepare("SELECT metadata FROM phases WHERE id = ?").get(createdPhase.details.phase.id).metadata);
        assert.equal(nativePhaseMetadata.contextReady, true);
        assert.equal(nativePhaseMetadata.summary, "Native Pi phase summary");
        const task = await callTool(mcpWriter, "planner-task-add", {
          feature: feature.structuredContent.ref, phase: createdPhase.details.ref, title: "Cross-harness task", description, checklist: ["Verify its scope"],
        });
        assert.equal(task.structuredContent.created, true);
        assert.equal(task.structuredContent.task.phaseId, createdPhase.details.phase.id);
        const mcpDeviation = await callTool(mcpWriter, "planner-task-deviation", {
          temporary_task: task.structuredContent.ref, resume_task: taskRef, reason: "Verify MCP uses the registered deviation command.",
        });
        assert.equal(mcpDeviation.structuredContent.deviation.state, "approved");
        assert.equal(mcpDeviation.structuredContent.deviation.resumeTaskId, taskToStart);
        assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM task_checklists WHERE task_id = ?").get(task.structuredContent.task.id).count, 1);
        const addedChecklist = await callTool(mcpWriter, "planner-task-checklist-add", { task: task.structuredContent.ref, title: "Verify its scope" });
        const keptItem = addedChecklist.structuredContent.item.id;
        await pi.runTool("task_checklist_remove", { taskId: task.structuredContent.ref, item: "C1" });
        const readded = await pi.runTool("task_checklist_add", { taskId: task.structuredContent.ref, title: "Verify its scope" });
        assert.notEqual(readded.details.item.id, keptItem);
        assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM task_checklists WHERE task_id = ? AND item_id = ?").get(task.structuredContent.task.id, keptItem).count, 1);
        const changed = await callTool(mcpWriter, "planner-task-update", { task: task.structuredContent.ref, notes: "Cross-harness update" });
        assert.equal(changed.structuredContent.updated, true);
        const mcpFreshness = await callTool(mcpWriter, "planner-description-freshness", {});
        const piFreshness = await pi.runTool("description_freshness");
        const { text: freshnessText, ...freshnessDetails } = mcpFreshness.structuredContent;
        assert.equal(piFreshness.content[0].text, freshnessText);
        assert.deepEqual(piFreshness.details, freshnessDetails);
        assert.ok(mcpFreshness.structuredContent.diagnostics.some(({ ownerId }) => ownerId === createdPhase.details.phase.id));
        const updatedFeature = await pi.runTool("feature_update", { featureId: feature.structuredContent.ref, workDone: "Verified via Pi" });
        assert.equal(updatedFeature.details.feature.workDone, "Verified via Pi");
        const updatedPhase = await pi.runTool("phase_update", { phaseId: createdPhase.details.ref, summary: "Updated phase summary" });
        assert.equal(updatedPhase.details.phase.summary, "Updated phase summary");
        const invalidStatus = await callTool(mcpWriter, "planner-task-update", { task: task.structuredContent.ref, status: "done" });
        assert.equal(invalidStatus.structuredContent.errorCode, "TASK_LIFECYCLE_TRANSITION_REQUIRED");
        const discussFeature = await callTool(mcpWriter, "planner-feature-discuss", { feature: feature.structuredContent.ref, dependencies: [" shared authority "] });
        assert.equal(discussFeature.structuredContent.feature.contextReady, true);
        assert.deepEqual(discussFeature.structuredContent.feature.dependsOn, ["shared authority"]);
        const discussPhase = await pi.runTool("phase_discuss", { phaseId: createdPhase.details.ref, goal: "Shared planner" });
        assert.equal(discussPhase.details.phase.contextReadyReason, "Updated through phase_discuss tool.");
        assert.deepEqual(discussPhase.details.phase.goals, ["Shared planner"]);
        const requirementReply = await callTool(mcpWriter, "planner-requirement-create", {
          title: "Requirement shared across clients", linkedPhaseIds: [createdPhase.details.ref],
          macroTasks: [{ title: "Verify persisted linkage" }],
        });
        const requirement = requirementReply.structuredContent.requirement;
        assert.deepEqual(requirement.linkedPhaseIds, [createdPhase.details.phase.id]);
        assert.equal(requirement.status, undefined);
        const update = await pi.runTool("requirement_update", {
          requirementId: requirement.id, title: "Verified in Pi",
          macroTasks: [{ id: requirement.macroTasks[0].id, title: "Verify persisted linkage", status: "done" }],
        });
        assert.equal(update.details.updated, true);
        const refreshed = await callTool(mcpWriter, "planner-requirement-list");
        const saved = refreshed.structuredContent.requirements.requirements.find(({ id }) => id === requirement.id);
        assert.equal(saved.title, "Verified in Pi");
        assert.equal(saved.macroTasks[0].createdAt, requirement.macroTasks[0].createdAt);
        assert.equal(saved.macroTasks[0].status, "done");
        const scopedRequirements = await callTool(mcpWriter, "planner-requirement-list", { phaseRef: createdPhase.details.ref });
        assert.equal(scopedRequirements.structuredContent.requirements.requirements[0].id, requirement.id);
        const scopedPi = await pi.runTool("requirement_list", { phaseRef: createdPhase.details.ref });
        assert.equal(scopedPi.details.requirements[0].id, requirement.id);
        const featureRead = await callTool(mcpWriter, "planner-feature-show", { feature: feature.structuredContent.ref, full: true });
        assert.equal(featureRead.structuredContent.feature.description, description);
        const phaseRead = await pi.runTool("phase_get", { phaseId: createdPhase.details.ref, full: true });
        assert.equal(phaseRead.details.linkedRequirements[0].id, requirement.id);
        const compactTask = await pi.runTool("task_get", { taskId: task.structuredContent.ref });
        assert.match(compactTask.content[0].text, /Cross-harness task/);
        const dependency = await callTool(mcpWriter, "planner-task-dependency-add", { task: task.structuredContent.ref, dependsOn: "T007" });
        assert.equal(dependency.structuredContent.updated, true);
        const reverse = await pi.runTool("task_dependency_add", { taskId: "T007", dependsOn: task.structuredContent.ref }, { expectError: true });
        assert.equal(reverse.details.errorCode, "DEPENDENCY_CYCLE");
        const removedDependency = await pi.runTool("task_dependency_delete", { taskId: task.structuredContent.ref, dependsOn: "T007", confirmed: true });
        assert.equal(removedDependency.details.updated, true);
        assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM task_dependencies WHERE task_id = ?").get(task.structuredContent.task.id).count, 0);
        const decisionTarget = { targetType: "task", targetRef: task.structuredContent.ref };
        const creation = await callTool(mcpWriter, "planner-accepted-decision-create", {
          ...decisionTarget, title: "Retain the existing authority", rationale: "Verify scope across clients.",
        });
        const decision = creation.structuredContent.acceptedDecision;
        const revisedDecision = await pi.runTool("accepted_decision_update", {
          ...decisionTarget, decisionId: decision.id, rationale: "Verified SQLite decision update.",
        });
        assert.equal(revisedDecision.details.acceptedDecision.acceptedAt, decision.acceptedAt);
        assert.equal(revisedDecision.details.acceptedDecision.rationale, "Verified SQLite decision update.");
        const wrongOwner = await callTool(mcpWriter, "planner-accepted-decision-update", {
          targetType: "feature", targetRef: feature.structuredContent.ref, decisionId: decision.id, title: "Wrong owner",
        }, { expectError: true });
        assert.equal(wrongOwner.structuredContent.errorCode, "ACCEPTED_DECISION_NOT_FOUND");
        const notConfirmed = await callTool(mcpWriter, "planner-accepted-decision-delete", { ...decisionTarget, decisionId: decision.id, confirmed: false });
        assert.equal(notConfirmed.structuredContent.confirmRequired, true);
        const taskRead = await callTool(mcpWriter, "planner-task-show", { task: task.structuredContent.ref, full: true });
        assert.match(JSON.stringify(taskRead), /Verified in Pi/);
        assert.match(JSON.stringify(taskRead), /Verified SQLite decision update/);
        const deletedDecision = await callTool(mcpWriter, "planner-accepted-decision-delete", { ...decisionTarget, decisionId: decision.id, confirmed: true });
        assert.equal(deletedDecision.structuredContent.deleted, true);
        assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM decisions WHERE id = ?").get(decision.id).count, 0);
        const guidelines = await callTool(mcpWriter, "planner-project-guidelines-update", { content: "Run scoped regression checks." });
        assert.equal(guidelines.structuredContent.updated, true);
        const guidelinesRead = await pi.runTool("project_guidelines_show");
        assert.equal(guidelinesRead.details.projectGuidelines.content, "Run scoped regression checks.");
        const mcpLanguage = await callTool(mcpWriter, "planner-project-language", { contentLanguage: "English" });
        assert.match(mcpLanguage.content[0].text, /content=English/);
        const piLanguage = await pi.runTool("project_set_language_preferences", { chatLanguage: "French" });
        assert.equal(piLanguage.details.contentLanguage, "English");
        assert.equal(piLanguage.details.chatLanguage, "French");
        pi.ui.inputAnswers.push("English", "German");
        await pi.runCommand("project language");
        const savedLanguages = (await request(runtime, scope)).body.data;
        assert.equal(savedLanguages.contentLanguage, "English");
        assert.equal(savedLanguages.chatLanguage, "German");
        const readWithGuidelines = await callTool(mcpWriter, "planner-task-show", { task: task.structuredContent.ref, full: true });
        assert.match(JSON.stringify(readWithGuidelines), /Run scoped regression checks/);
        const handoffId = randomUUID();
        const handoffBody = "# Continue the registered task\n\nRun the scoped acceptance check.";
        const handoffAudit = { version: 1, entries: [], contentHash: handoffContentHash(handoffBody), contentLength: handoffBody.length, verifiedAt: now };
        driver.prepare("INSERT INTO phase_handoffs (id, project_id, phase_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(handoffId, projectId, createdPhase.details.phase.id, JSON.stringify({ content: handoffBody, audit: handoffAudit }), now, now);
        const listedHandoffs = await callTool(mcpWriter, "planner-handoff-list");
        assert.equal(listedHandoffs.structuredContent.handoffs[0].firstLine, "Continue the registered task");
        assert.equal(listedHandoffs.structuredContent.handoffs[0].content, undefined);
        const shownHandoff = await pi.runTool("handoff_show", { phaseRef: createdPhase.details.ref });
        assert.equal(shownHandoff.details.content, handoffBody);
        assert.equal(shownHandoff.details.resumeReady, false);
        const prepared = await callTool(mcpWriter, "planner-handoff-prepare", { phaseRef: createdPhase.details.ref });
        assert.equal(prepared.structuredContent.handoffUpdatedAt, now);
        assert.ok(prepared.structuredContent.draftTemplate);
        const staleHandoff = await callTool(mcpWriter, "planner-handoff-verify", {
          phaseRef: createdPhase.details.ref, expectedContentHash: "0".repeat(64),
        }, { expectError: true });
        assert.equal(staleHandoff.structuredContent.errorCode, "HANDOFF_READBACK_VERIFICATION_REQUIRED");
        const verifiedHandoff = await pi.runTool("handoff_verify", { phaseRef: createdPhase.details.ref, expectedContentHash: shownHandoff.details.contentHash });
        assert.equal(verifiedHandoff.details.resumeReady, true);
        const readyHandoffs = await callTool(mcpWriter, "planner-handoff-list");
        assert.equal(readyHandoffs.structuredContent.handoffs[0].resumeReady, true);
        const deleted = await callTool(mcpWriter, "planner-requirement-delete", { requirementId: requirement.id });
        assert.equal(deleted.structuredContent.deleted, true);
        assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM entity_requirements WHERE requirement_id = ?").get(requirement.id).count, 0);
        assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM command_audit WHERE operation LIKE 'requirement.%'").get().count, 3);
        const moved = await callTool(mcpWriter, "planner-task-move", { tasks: [task.structuredContent.ref], targetPhase: phaseId });
        assert.equal(moved.structuredContent.moved, true);
        assert.equal(moved.structuredContent.moves[0].id, task.structuredContent.task.id);
        assert.deepEqual(moved.structuredContent.sourcePhaseRefsWithHandoff, [createdPhase.details.ref]);
        assert.equal(driver.prepare("SELECT phase_id FROM tasks WHERE id = ?").get(task.structuredContent.task.id).phase_id, phaseId);
        assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM task_checklists WHERE task_id = ? AND item_id = ?").get(task.structuredContent.task.id, keptItem).count, 1);
        const returnedMove = await pi.runTool("task_move", { taskIds: [moved.structuredContent.moves[0].newRef], targetPhase: createdPhase.details.ref });
        assert.equal(returnedMove.details.moved, true);
        assert.equal(returnedMove.details.moves[0].newRef, task.structuredContent.ref);
        const captured = await callTool(mcpWriter, "planner-idea-create", { title: "Use the coordinated service", description: "A fixture inbox entry." });
        const idea = captured.structuredContent.idea;
        const discussion = await pi.runTool("idea_promotion_begin", { idea: idea.id, targetType: "task" });
        assert.equal(discussion.details.persisted, false);
        assert.ok(discussion.details.grillMeSkill);
        const promotedIdea = await callTool(mcpWriter, "planner-idea-promotion-finalize", {
          idea: idea.id, targetType: "task", targetRef: task.structuredContent.ref, discussionCompleted: true, confirmed: true,
        });
        assert.equal(promotedIdea.structuredContent.idea.promotion.targetId, task.structuredContent.task.id);
        await pi.runCommand(`idea show ${idea.id}`);
        assert.match(pi.ui.notifyCalls.at(-1).message, /Promoted to:/);
        const shownIdea = await pi.runTool("idea_show", { idea: idea.id });
        assert.equal(shownIdea.details.idea.promotion.targetRef, task.structuredContent.ref);
        const retainedIdea = await callTool(mcpWriter, "planner-idea-delete", { idea: idea.id, confirmed: false });
        assert.equal(retainedIdea.structuredContent.deleted, false);
        const forgottenIdea = await callTool(mcpWriter, "planner-idea-delete", { idea: idea.id, confirmed: true });
        assert.equal(forgottenIdea.structuredContent.deleted, true);
        assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = ?").get(task.structuredContent.task.id).count, 1);
        await pi.runCommand("handoff list");
        assert.match(pi.ui.notifyCalls.at(-1).message, /Continue the registered task/);
        await pi.runCommand(`handoff show ${createdPhase.details.ref}`);
        assert.match(pi.ui.notifyCalls.at(-1).message, /Run the scoped acceptance check/);
        pi.ui.confirmAnswer = false;
        await pi.runCommand(`handoff clear ${createdPhase.details.ref}`);
        assert.equal(driver.prepare("SELECT archived FROM phase_handoffs WHERE id = ?").get(handoffId).archived, 0);
        pi.ui.confirmAnswer = true;
        await pi.runCommand(`handoff clear ${createdPhase.details.ref}`);
        assert.match(pi.ui.notifyCalls.at(-1).message, /Archived handoff/);
        const archivedRow = driver.prepare("SELECT archived, content FROM phase_handoffs WHERE id = ?").get(handoffId);
        assert.equal(archivedRow.archived, 1);
        assert.equal(JSON.parse(archivedRow.content).content, handoffBody);
        assert.equal(JSON.parse(archivedRow.content).handoffUpdatedAt, now);
        const rewriteTarget = await callTool(mcpWriter, "planner-handoff-prepare", { phaseRef: createdPhase.details.ref });
        const writeFields = {
          phaseRef: createdPhase.details.ref, title: "Continue the SQLite acceptance checks",
          reason: "A handoff is needed for the next verification session.", confirmed: true,
          expectedHandoffUpdatedAt: rewriteTarget.structuredContent.handoffUpdatedAt,
          phaseNoUpdateReason: "The registered phase already records the complete current implementation state.",
          featureNoUpdateReason: "The feature progress remains correctly recorded and requires no changes here.",
        };
        const blockedWrite = await callTool(mcpWriter, "planner-handoff-write", {
          ...writeFields, content: "# Continue SQLite verification\n\nResume by reviewing active tasks and verifying the registered authority.",
          supportingDocuments: [{ path: ".planner/docs/missing.md", description: "Additional details from the prior acceptance check." }],
        }, { expectError: true });
        assert.equal(blockedWrite.structuredContent.errorCode, "HANDOFF_SUPPORTING_DOCUMENT_INVALID");
        assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM phase_handoffs WHERE phase_id = ? AND archived = 0").get(createdPhase.details.phase.id).count, 0);
        const persistedHandoff = await callTool(mcpWriter, "planner-handoff-write", writeFields);
        assert.equal(persistedHandoff.structuredContent.persisted, true);
        assert.equal(persistedHandoff.structuredContent.resumeReady, false);
        const fromDatabase = await pi.runTool("handoff_show", { phaseRef: createdPhase.details.ref });
        assert.match(fromDatabase.details.content, /Resume by reviewing active tasks/);
        assert.equal(fromDatabase.details.contentHash, persistedHandoff.structuredContent.handoffAudit.contentHash);
      } finally {
        await closeMcpFixture(mcpWriter);
      }
    } finally {
      await closePiHost(pi);
      mockHome.mock.restore();
      syncBuiltinESMExports();
    }
    const lockTask = randomUUID();
    const oldActivity = "2000-01-01T00:00:00.000Z";
    const idleOwner = await register();
    const contender = await register();
    driver.prepare(`
      INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at, active_owner_session)
      VALUES (?, ?, ?, 99, 'in-progress', 'Idle claim', ?, ?, ?)
    `).run(lockTask, projectId, phaseId, now, oldActivity, idleOwner);
    const claim = (fields, status) => taskRequest(contender, { ref: lockTask, requestId: randomUUID(), ...fields }, status);
    await request(runtime, contextPath, claim({}));
    const unconfirmed = await request(runtime, startPath, claim({}, 409));
    assert.equal(unconfirmed.body.error.code, "TASK_TAKEOVER_CONFIRMATION_REQUIRED");
    assert.equal(driver.prepare("SELECT active_owner_session FROM tasks WHERE id = ?").get(lockTask).active_owner_session, idleOwner);
    const taken = await request(runtime, startPath, claim({ confirmedTakeover: true }));
    assert.equal(taken.body.data.tookOver, true);
    assert.equal(driver.prepare("SELECT active_owner_session FROM tasks WHERE id = ?").get(lockTask).active_owner_session, contender);
    assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM event_outbox WHERE kind = 'task.taken-over'").get().count, 1);
    const release = await request(runtime, `${scope}/tasks/release`, claim({ confirmed: true }, 403));
    assert.equal(release.body.error.code, "TASK_RELEASE_FORBIDDEN");
    const parkedTask = randomUUID();
    const parkedCheckpoint = JSON.stringify({
      id: randomUUID(), reason: "Prerequisite", whatWasBeingDone: "Fixture", resumeLocation: "Fixture",
      howToResume: "Read the checkpoint", pausedAt: now, pausedBy: "loopback:agent",
    });
    driver.prepare(`
      INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at, pause_snapshot)
      VALUES (?, ?, ?, 100, 'planned', 'Parked claim', ?, ?, ?)
    `).run(parkedTask, projectId, phaseId, now, now, parkedCheckpoint);
    const parkedDeviation = randomUUID();
    driver.prepare(`
      INSERT INTO work_deviations(id, project_id, owner_session, state, temporary_task_id, resume_task_id, checkpoint, created_at, updated_at)
      VALUES (?, ?, ?, 'resume-required', ?, ?, ?, ?, ?)
    `).run(parkedDeviation, projectId, idleOwner, lockTask, parkedTask, parkedCheckpoint, now, now);
    const newOwner = await register();
    await request(runtime, contextPath, taskRequest(newOwner, { ref: parkedTask }));
    const parkedTaken = await request(runtime, startPath, taskRequest(newOwner, { ref: parkedTask, requestId: randomUUID() }));
    assert.equal(parkedTaken.body.data.parkedTakeover, true);
    const returning = await request(runtime, contextPath, taskRequest(idleOwner, { ref: parkedTask }));
    assert.ok(returning.body.data.parkedTakeoverAt);
    assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM event_outbox WHERE kind = 'task.parked-taken-over'").get().count, 1);
    const beforePage = (await request(runtime, `${scope}/snapshot`)).body.data.cursor;
    driver.prepare(`
      WITH RECURSIVE count(n) AS (VALUES (1) UNION ALL SELECT n + 1 FROM count WHERE n < 101)
      INSERT INTO event_outbox(project_id, kind, payload, created_at) SELECT ?, 'test.page', '{}', ? FROM count
    `).run(projectId, now);
    const firstPage = (await request(runtime, `${scope}/events?after=${beforePage}`)).body.data;
    assert.equal(firstPage.events.length, 100);
    assert.equal(firstPage.more, true);
    const finalPage = (await request(runtime, `${scope}/events?after=${firstPage.nextCursor}`)).body.data;
    assert.equal(finalPage.events.length, 1);
    assert.equal(finalPage.more, false);
    const beforeOverflow = finalPage.nextCursor;
    driver.prepare("INSERT INTO event_outbox(project_id, kind, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(projectId, "test.large", JSON.stringify({ data: "x".repeat(1024 * 1024) }), now);
    const overflowing = new WebSocket(`${streamUrl}?after=${beforeOverflow}&bootId=${handle.record.bootId}`);
    const [closeCode] = await once(overflowing, "close", { signal: AbortSignal.timeout(3000) });
    assert.equal(closeCode, 1013);
    assert.deepEqual((await request(runtime, `${otherScope}/events`)).body.data.events, []);
    const deletePath = `${scope}/entities/delete`;
    const disposableFeature = randomUUID();
    const disposablePhase = randomUUID();
    const disposableTask = randomUUID();
    const externalTask = randomUUID();
    driver.prepare("INSERT INTO features(id, project_id, number, status, name, created_at, updated_at) VALUES (?, ?, 801, 'planned', 'Disposable', ?, ?)")
      .run(disposableFeature, projectId, now, now);
    driver.prepare("INSERT INTO phases(id, project_id, feature_id, number, status, title, metadata, created_at, updated_at) VALUES (?, ?, ?, 801, 'planned', 'Disposable phase', ?, ?, ?)")
      .run(disposablePhase, projectId, disposableFeature, JSON.stringify({ featureId: disposableFeature }), now, now);
    const insertDisposableTask = driver.prepare("INSERT INTO tasks(id, project_id, phase_id, number, status, title, created_at, updated_at) VALUES (?, ?, ?, ?, 'planned', ?, ?, ?)");
    insertDisposableTask.run(disposableTask, projectId, disposablePhase, 801, "Disposable task", now, now);
    insertDisposableTask.run(externalTask, projectId, phaseId, 802, "External dependent", now, now);
    driver.prepare("INSERT INTO task_dependencies(task_id, depends_on) VALUES (?, ?)").run(externalTask, disposableTask);

    const reorderPath = `${scope}/entities/reorder`;
    const order = (fields, status) => taskRequest(newOwner, {
      kind: "task", movedId: externalTask, beforeId: null, afterId: taskToStart, requestId: randomUUID(), ...fields,
    }, status);
    const beforeReorder = driver.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId).revision;
    const invalidOrder = await request(runtime, reorderPath, order({ afterId: disposableTask }, 409));
    assert.equal(invalidOrder.body.error.code, "REORDER_NEIGHBORS_CHANGED");
    assert.equal(driver.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId).revision, beforeReorder);
    const reorderFirst = order({});
    const reordered = await request(runtime, reorderPath, reorderFirst);
    assert.equal(reordered.body.data.movedId, externalTask);
    assert.equal((await request(runtime, reorderPath, reorderFirst)).body.data.movedId, externalTask);
    assert.equal(driver.prepare("SELECT id FROM tasks WHERE phase_id = ? ORDER BY priority, number LIMIT 1").get(phaseId).id, externalTask);
    assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM command_audit WHERE operation = 'entity.reorder'").get().count, 1);

    const remove = (kind, ref, fields = {}, status) => request(runtime, deletePath,
      taskRequest(newOwner, { kind, ref, requestId: randomUUID(), ...fields }, status));
    assert.equal((await remove("task", disposableTask, {}, 409)).body.error.code, "TASK_DELETE_CONFIRMATION_REQUIRED");
    const beforeFailedDelete = driver.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId).revision;
    assert.equal((await remove("feature", disposableFeature, { cascade: true }, 409)).body.error.code, "TASK_DELETE_DEPENDENCY_EXISTS");
    assert.equal(driver.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId).revision, beforeFailedDelete);
    assert.equal(driver.prepare("SELECT depends_on FROM task_dependencies WHERE task_id = ?").get(externalTask).depends_on, disposableTask);
    assert.equal((await remove("task", parkedTask, { confirmed: true }, 409)).body.error.code, "TASK_DELETE_EXECUTION_PENDING");
    driver.prepare("INSERT INTO work_deviations(id, project_id, owner_session, state, temporary_task_id, resume_task_id, checkpoint, created_at, updated_at) VALUES (?, ?, ?, 'resume-required', ?, ?, '{}', ?, ?)")
      .run(randomUUID(), projectId, newOwner, lockTask, externalTask, now, now);
    assert.equal((await remove("task", externalTask, { confirmed: true }, 409)).body.error.code, "TASK_DELETE_DEVIATION_EXISTS");

    const unlinked = await remove("feature", disposableFeature);
    assert.equal(unlinked.body.data.id, disposableFeature);
    assert.deepEqual(unlinked.body.data.phases, [{ id: disposablePhase, action: "unlinked" }]);
    const detached = await request(runtime, `${scope}/phases/${disposablePhase}?full=true`);
    assert.equal(detached.body.data.phase.featureId, undefined);
    assert.equal((await remove("phase", disposablePhase, {}, 409)).body.error.code, "TASK_DELETE_DEPENDENCY_EXISTS");
    driver.prepare("DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?").run(externalTask, disposableTask);
    const deleteTaskBody = { kind: "task", ref: disposableTask, confirmed: true, requestId: randomUUID() };
    const deleted = await request(runtime, deletePath, taskRequest(newOwner, deleteTaskBody));
    assert.equal(deleted.body.data.taskId, disposableTask);
    const replayedDelete = await request(runtime, deletePath, taskRequest(newOwner, deleteTaskBody));
    assert.deepEqual(replayedDelete.body.data, deleted.body.data);
    assert.equal(driver.prepare("SELECT COUNT(*) AS count FROM command_audit WHERE operation='task.delete' AND request_id = ?").get(deleteTaskBody.requestId).count, 1);
    assert.equal((await remove("phase", disposablePhase)).body.data.phaseId, disposablePhase);
    assert.equal(driver.prepare("SELECT id FROM phases WHERE id = ?").get(disposablePhase), undefined);
    driver.prepare("DELETE FROM project_principals WHERE project_id = ?").run(projectId);
    await request(runtime, path, { ...edit("committed", 1), expectStatus: 403 });
  } finally {
    stream?.terminate();
    replayStream?.terminate();
    await handle?.close();
    driver.close();
    otherDriver.close();
  }
});

test("concurrent detached launchers share a dedicated runtime and stop its verified boot", async () => {
  const fixture = await createPlannerFixture({ name: "registered-detached-runtime" });
  try {
    const [first, second] = await Promise.all([
      ensureRegisteredPlannerRuntime(fixture.root), ensureRegisteredPlannerRuntime(fixture.root),
    ]);
    assert.deepEqual(first, second);
    const endpoint = `http://${first.host}:${first.port}/health`;
    const health = await (await fetch(endpoint)).json();
    assert.equal(health.bootId, first.bootId);
    assert.ok(Number.isInteger(health.runtimePid));
    assert.notEqual(health.runtimePid, process.pid);
    assert.equal(await stopRegisteredPlannerRuntime(fixture.root), true);
    assert.equal(await stopRegisteredPlannerRuntime(fixture.root), false);
  } finally {
    await stopRegisteredPlannerRuntime(fixture.root).catch(() => {});
  }
});
