/**
 * P128(F025)/T496 — bounded semantic reconciliation over the SQLite authority.
 *
 * Isolated mkdtemp fixtures only. Covers: affected-context from reverse
 * indexes without full-plan rereads, mechanical consequences committed with
 * the leaf mutation, durable reconciliation_required obligations surviving
 * crashes, explicit factual updates and reviewed-unchanged evidence (never
 * blind upward copying), stale/cyclic/foreign rejection, high-fan-out
 * pagination, and no-op updates producing no obligations.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeCommand,
  publishEvent,
  openStore,
  reconcileLeafMutation,
  listReconciliationObligations,
  resolveReconciliationObligation,
  hasOpenObligations,
  addTaskDependencyValidated,
  ReconciliationError,
  contentHashOf,
  IMPACT_RECEIPT_ENTITY_LIMIT,
} from "../dist/persistence/index.js";

const roots = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function seededStore(name) {
  const root = await mkdtemp(join(tmpdir(), `agent-plan-recon-${name}-`));
  roots.push(root);
  const handle = await openStore({ path: join(root, "planner.sqlite"), create: true });
  const driver = handle.driver;
  const at = new Date().toISOString();
  driver.runExclusive(() => {
    driver.prepare("INSERT INTO projects (id, descriptor_project_id, name, revision, metadata, created_at, updated_at) VALUES ('proj-1','d-1','Fixture',1,'{}',?,?)").run(at, at);
    driver.prepare("INSERT INTO features (id, project_id, number, priority, status, name, description_updated_at, metadata, created_at, updated_at) VALUES ('f-1','proj-1',1,1,'in-progress','Feature','2026-11-16T00:00:00.000Z','{}',?,?)").run(at, at);
    for (let p = 1; p <= 2; p++) {
      driver.prepare("INSERT INTO phases (id, project_id, feature_id, number, priority, status, title, description_updated_at, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(`p-${p}`, "proj-1", "f-1", p, 1, "in-progress", `Phase ${p}`, "2026-11-16T00:00:00.000Z", "{}", at, at);
    }
    for (let t = 1; t <= 3; t++) {
      driver.prepare("INSERT INTO tasks (id, project_id, phase_id, number, priority, status, title, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(`t-${t}`, "proj-1", "p-1", t, 1, t === 3 ? "done" : "planned", `Task ${t}`, "{}", at, at);
    }
  });
  return handle;
}

test("a status mutation receipts derived parent status from reverse indexes, no reread", async () => {
  const handle = await seededStore("status");
  const outcome = executeCommand(handle.driver, { requestId: "r1", projectId: "proj-1", operation: "task.status", payload: { taskId: "t-1" } }, (ctx) => {
    ctx.driver.prepare("UPDATE tasks SET status='in-progress' WHERE id='t-1'").run();
    publishEvent(ctx.driver, "proj-1", "task.status", { taskId: "t-1" });
    const receipt = reconcileLeafMutation(ctx.driver, { projectId: "proj-1", kind: "task.status", taskId: "t-1" });
    ctx.recordRevision();
    return receipt;
  });
  assert.equal(outcome.status, "committed");
  const receipt = outcome.result;
  assert.equal(receipt.affectedParents.length, 1);
  assert.equal(receipt.affectedParents[0].phaseId, "p-1");
  assert.equal(receipt.affectedParents[0].derivedPhaseStatus, "in-progress", "phase derives from row statuses through the index");
  assert.equal(receipt.affectedParents[0].derivedFeatureStatus, "in-progress");
  assert.deepEqual(receipt.obligations, [], "mechanical change creates no semantic obligation");
  assert.equal(receipt.truncated, false);
  handle.close();
});

test("a description change creates durable phase+feature obligations; completion is refused while they remain", async () => {
  const handle = await seededStore("obligations");
  const newBody = "Completely reworded task description with new facts.";
  const outcome = executeCommand(handle.driver, { requestId: "r2", projectId: "proj-1", operation: "task.description", payload: { taskId: "t-1" } }, (ctx) => {
    ctx.driver.prepare("UPDATE tasks SET metadata = JSON_SET(metadata, '$.descriptionHash', ?) WHERE id='t-1'").run(contentHashOf(newBody));
    const receipt = reconcileLeafMutation(ctx.driver, { projectId: "proj-1", kind: "task.description", taskId: "t-1", descriptionChanged: true });
    ctx.recordRevision();
    return receipt;
  });
  assert.equal(outcome.status, "committed");
  const receipt = outcome.result;
  assert.equal(receipt.obligations.length, 2, "phase and feature obligations");
  assert.ok(receipt.obligations.every((obligation) => obligation.kind === "semantic-review"));
  assert.equal(hasOpenObligations(handle.driver, "proj-1", ["p-1", "f-1"]), true, "open obligations are visible before any complete claim");

  // obligations survive close/reopen (committed with the mutation, durable)
  const path = join(roots[roots.length - 1], "planner.sqlite");
  handle.close();
  const reopened = await openStore({ path });
  const listed = listReconciliationObligations(reopened.driver, "proj-1", { status: "open" });
  assert.equal(listed.obligations.length, 2, "obligations survive a crash/close cycle");
  reopened.close();
});

test("resolution requires evidence; stale resolution is refused until re-review is acknowledged", async () => {
  const handle = await seededStore("resolve");
  const receipt = executeCommand(handle.driver, { requestId: "r3", projectId: "proj-1", operation: "task.description", payload: {} }, (ctx) => {
    const r = reconcileLeafMutation(ctx.driver, { projectId: "proj-1", kind: "task.description", taskId: "t-1", descriptionChanged: true });
    ctx.recordRevision();
    return r;
  }).result;
  const obligationId = receipt.obligations[0].id;

  const noEvidence = resolveReconciliationObligation(handle.driver, { projectId: "proj-1", obligationId, resolution: "reviewed-unchanged", evidence: "" });
  assert.equal(noEvidence.resolved, false, "bare done is refused");
  assert.match(noEvidence.reason, /evidence/);

  // advance the project revision (unrelated work) then try resolving without acknowledgement
  handle.driver.runExclusive(() => {
    handle.driver.prepare("UPDATE projects SET revision = revision + 1 WHERE id='proj-1'").run();
  });
  const stale = resolveReconciliationObligation(handle.driver, { projectId: "proj-1", obligationId, resolution: "reviewed-unchanged", evidence: "checked: wording still accurate" });
  assert.equal(stale.resolved, false, "stale resolution refused");
  assert.match(stale.reason, /Stale reconciliation/);

  const acknowledged = resolveReconciliationObligation(handle.driver, {
    projectId: "proj-1", obligationId, resolution: "reviewed-unchanged",
    evidence: "re-reviewed after revision change: wording still accurate", acknowledgeRevisionChange: true,
  });
  assert.equal(acknowledged.resolved, true);
  const listed = listReconciliationObligations(handle.driver, "proj-1", { status: "resolved-reviewed" });
  assert.equal(listed.obligations.length, 1);
  assert.equal(listed.obligations[0].resolutionEvidence, "re-reviewed after revision change: wording still accurate");
  handle.close();
});

test("explicit factual update edits the parent prose itself; blind copying never happens", async () => {
  const handle = await seededStore("factual");
  // The caller performs the parent edit itself inside the same transaction —
  // description_updated_at bumps ONLY on a deliberate parent edit.
  const outcome = executeCommand(handle.driver, { requestId: "r4", projectId: "proj-1", operation: "phase.description", payload: { phaseId: "p-1" } }, (ctx) => {
    ctx.driver.prepare("UPDATE phases SET title = 'Phase 1 — now includes reliability work', description_updated_at = ? WHERE id='p-1'").run(new Date().toISOString());
    const receipt = reconcileLeafMutation(ctx.driver, { projectId: "proj-1", kind: "task.description", taskId: "t-1" });
    ctx.recordRevision();
    return receipt;
  });
  assert.equal(outcome.status, "committed");
  assert.equal(outcome.result.obligations.length, 0, "the deliberate parent edit is the factual update; no obligation");
  const row = handle.driver.prepare("SELECT description_updated_at FROM phases WHERE id='p-1'").get();
  assert.notEqual(row.description_updated_at, "2026-11-16T00:00:00.000Z", "contract revision bumped by the explicit edit only");
  handle.close();
});

test("no-op repeated updates create no obligations and no unconditional context growth", async () => {
  const handle = await seededStore("noop");
  const sameBody = "Unchanged body text.";
  const hash = contentHashOf(sameBody);
  const runOnce = (requestId) => executeCommand(handle.driver, { requestId, projectId: "proj-1", operation: "task.description", payload: { hash } }, (ctx) => {
    ctx.driver.prepare("UPDATE tasks SET metadata = JSON_SET(metadata, '$.descriptionHash', ?) WHERE id='t-1' AND (metadata->>'$.descriptionHash' IS NULL OR metadata->>'$.descriptionHash' <> ?)").run(hash, hash);
    const changed = ctx.driver.prepare("SELECT changes() AS c").get().c > 0;
    const receipt = reconcileLeafMutation(ctx.driver, { projectId: "proj-1", kind: "task.description", taskId: "t-1", descriptionChanged: changed });
    ctx.recordRevision();
    return receipt;
  });
  const first = runOnce("n1");
  assert.equal(first.result.obligations.length, 2, "first real write obligates parents");
  const second = runOnce("n2");
  assert.equal(second.result.obligations.length, 0, "repeated no-op creates nothing");
  assert.equal(second.status, "committed");
  assert.equal(hasOpenObligations(handle.driver, "proj-1", ["p-1", "f-1"]), true, "the first write's obligations still stand");
  handle.close();
});

test("cyclic and foreign dependencies are rejected with typed outcomes; consumers surface via reverse index", async () => {
  const handle = await seededStore("deps");
  handle.driver.runExclusive(() => {
    addTaskDependencyValidated(handle.driver, { projectId: "proj-1", taskId: "t-2", dependsOn: "t-1" });
  });
  assert.throws(
    () => handle.driver.runExclusive(() => addTaskDependencyValidated(handle.driver, { projectId: "proj-1", taskId: "t-1", dependsOn: "t-2" })),
    (error) => error instanceof ReconciliationError && error.subcode === "cyclic-dependency",
  );
  assert.throws(
    () => handle.driver.runExclusive(() => addTaskDependencyValidated(handle.driver, { projectId: "proj-1", taskId: "t-1", dependsOn: "ghost-task" })),
    (error) => error instanceof ReconciliationError && error.subcode === "foreign-reference",
  );
  // t-3 depends on t-1: a mutation on t-1 lists the real consumer
  handle.driver.runExclusive(() => {
    addTaskDependencyValidated(handle.driver, { projectId: "proj-1", taskId: "t-3", dependsOn: "t-1" });
  });
  const receipt = handle.driver.runExclusive(() => reconcileLeafMutation(handle.driver, { projectId: "proj-1", kind: "task.status", taskId: "t-1" }));
  assert.deepEqual(receipt.dependencyConsumers.sort(), ["t-2", "t-3"], "reverse index answers the consumer question");
  handle.close();
});

test("moving a task across phases affects both old and new parents", async () => {
  const handle = await seededStore("move");
  const outcome = executeCommand(handle.driver, { requestId: "m1", projectId: "proj-1", operation: "task.move", payload: { taskId: "t-1" } }, (ctx) => {
    ctx.driver.prepare("UPDATE tasks SET phase_id='p-2' WHERE id='t-1'").run();
    const receipt = reconcileLeafMutation(ctx.driver, { projectId: "proj-1", kind: "task.moved", taskId: "t-1", previousPhaseId: "p-1", newPhaseId: "p-2" });
    ctx.recordRevision();
    return receipt;
  });
  assert.equal(outcome.status, "committed");
  const receipt = outcome.result;
  const byPhase = new Map(receipt.affectedParents.map((entry) => [entry.phaseId, entry.derivedPhaseStatus]));
  assert.equal(byPhase.get("p-1"), "in-progress", "old parent p-1 derived from remaining rows (planned + done)");
  assert.equal(byPhase.get("p-2"), "planned", "new parent p-2 derived after membership change");
  assert.equal(receipt.affectedParents[0].derivedFeatureStatus, "in-progress");
  handle.close();
});

test("high fan-out is enumerated up to the cap with a durable continuation obligation", async () => {
  const handle = await seededStore("fanout");
  const at = new Date().toISOString();
  handle.driver.runExclusive(() => {
    for (let i = 10; i < IMPACT_RECEIPT_ENTITY_LIMIT + 12; i++) {
      handle.driver.prepare("INSERT INTO tasks (id, project_id, phase_id, number, priority, status, title, metadata, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(`f-${i}`, "proj-1", "p-1", i, 1, "planned", `Fan task ${i}`, "{}", at, at);
      handle.driver.prepare("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?,?)").run(`f-${i}`, "t-1");
    }
  });
  const receipt = handle.driver.runExclusive(() => reconcileLeafMutation(handle.driver, { projectId: "proj-1", kind: "task.status", taskId: "t-1" }));
  assert.equal(receipt.dependencyConsumers.length, IMPACT_RECEIPT_ENTITY_LIMIT, "receipt capped at the budget");
  assert.equal(receipt.truncated, true, "truncation is explicit");
  const continuation = receipt.obligations.find((obligation) => obligation.kind === "fan-out-continuation");
  assert.ok(continuation, "durable continuation obligation recorded");
  assert.equal(listReconciliationObligations(handle.driver, "proj-1", { status: "open" }).obligations.length, 1);
  const listed = listReconciliationObligations(handle.driver, "proj-1", { status: "open", limit: 5 });
  assert.equal(listed.obligations.length, 1, "one open continuation obligation exists");
  assert.equal(listed.truncated, false);
  handle.close();
});

test("crash before commit leaves no obligation and no mutation (atomic with the leaf)", async () => {
  const handle = await seededStore("crash");
  const outcome = executeCommand(handle.driver, { requestId: "c1", projectId: "proj-1", operation: "task.description", payload: {} }, (ctx) => {
    ctx.driver.prepare("UPDATE tasks SET title='Half-written' WHERE id='t-1'").run();
    reconcileLeafMutation(ctx.driver, { projectId: "proj-1", kind: "task.description", taskId: "t-1", descriptionChanged: true });
    ctx.recordRevision();
    throw new Error("simulated crash before commit");
  });
  assert.equal(outcome.status, "error");
  assert.equal(listReconciliationObligations(handle.driver, "proj-1", { status: "open" }).obligations.length, 0, "no obligation survived the rollback");
  assert.equal(handle.driver.prepare("SELECT title FROM tasks WHERE id='t-1'").get().title, "Task 1", "leaf mutation rolled back too");
  assert.equal(handle.driver.prepare("SELECT revision FROM projects WHERE id='proj-1'").get().revision, 1, "revision untouched");
  handle.close();
});
