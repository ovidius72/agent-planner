import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanStore, PhaseSchema, createPhaseId, createTaskId } from "../dist/index.js";

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "task-reopen-"));
  roots.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("Task reopen test");
  const now = "2026-01-01T00:00:00.000Z";
  const phase = PhaseSchema.parse({ id: createPhaseId(), number: 1, slug: "phase", title: "Phase", status: "planned", createdAt: now, updatedAt: now });
  await store.savePhase(phase);
  const done = {
    id: createTaskId(), number: 1, phaseId: phase.id, title: "Completed", shortName: "completed", status: "done",
    description: "Completion summary: retained.", createdAt: now, updatedAt: now, completedAt: now,
    statusLog: [{ id: "completion", date: now, fromStatus: "in-progress", toStatus: "done", title: "→ done", description: "Completion summary retained." }],
  };
  const other = { id: createTaskId(), number: 2, phaseId: phase.id, title: "Other session", shortName: "other", status: "in-progress", createdAt: now, updatedAt: now, activeOwnerSession: "session-other" };
  await store.updatePhase(phase.id, (current) => ({ ...current, tasks: [done, other] }));
  return { store, phase, done, other };
}

test("reopenTask is confirmation-gated, preserves completion evidence, and never pauses another owner", async () => {
  const { store, phase, done, other } = await fixture();
  await assert.rejects(
    () => store.reopenTask(phase.id, done.id, { confirmed: false, ownerSessionId: "session-current" }),
    (error) => error?.details?.errorCode === "TASK_REOPEN_CONFIRMATION_REQUIRED",
  );
  const before = await store.loadPhase(phase.id);
  assert.equal(before.tasks.find((task) => task.id === done.id)?.status, "done");

  const reopened = await store.reopenTask(phase.id, done.id, { confirmed: true, ownerSessionId: "session-current", timestamp: "2026-01-02T00:00:00.000Z" });
  assert.equal(reopened.status, "in-progress");
  assert.equal(reopened.completedAt, "");
  assert.equal(reopened.activeOwnerSession, "session-current");
  assert.match(reopened.description, /Completion summary: retained/);
  assert.equal(reopened.statusLog.at(-2)?.toStatus, "done");
  assert.equal(reopened.statusLog.at(-1)?.title, "done → in-progress (reopened)");

  const persisted = await store.loadPhase(phase.id);
  assert.equal(persisted.tasks.find((task) => task.id === done.id)?.status, "in-progress");
  assert.deepEqual(persisted.tasks.find((task) => task.id === other.id)?.activeOwnerSession, "session-other");
  await assert.rejects(
    () => store.reopenTask(phase.id, other.id, { confirmed: true }),
    (error) => error?.details?.errorCode === "TASK_REOPEN_NOT_DONE",
  );
});
