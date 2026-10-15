/**
 * Per-session focus: the side-task stack and the resume focus belong to the
 * session that made them. A caller with no session id sees the whole project.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import {
  PlanStore,
  FeatureSchema,
  PhaseSchema,
  WorkDeviationSchema,
  RESUME_SESSION_LIMIT,
  createFeatureId,
  createPhaseId,
  createTaskId,
  deviationsForSession,
  pruneResumeSessions,
  recommendNextTask,
} from "../dist/index.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = [];
after(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const now = "2026-10-06T08:00:00.000Z";

async function setup({ tasks = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "session-focus-"));
  dirs.push(root);
  const store = new PlanStore(join(root, ".planner"));
  await store.init("session focus");
  const feature = FeatureSchema.parse({ id: createFeatureId(), number: 1, name: "Feature", createdAt: now, updatedAt: now });
  await store.saveFeature(feature);
  const phaseId = createPhaseId();
  const phase = PhaseSchema.parse({
    id: phaseId, number: 1, featureId: feature.id, slug: "phase", title: "Phase", createdAt: now, updatedAt: now,
    tasks: tasks.map((task, index) => ({
      id: createTaskId(), phaseId, number: index + 1, shortName: `t${index + 1}`, title: `Task ${index + 1}`,
      status: "planned", createdAt: now, updatedAt: now, ...task,
    })),
  });
  await store.savePhase(phase);
  return { store, phase };
}

const deviation = (id, ownerSession) =>
  WorkDeviationSchema.parse({
    id, recommendedTaskId: "r", temporaryTaskId: "t", resumeTaskId: "x", createdAt: now,
    ...(ownerSession === undefined ? {} : { ownerSession }),
  });

describe("atomic ownership and explicit recovery", () => {
  test("independent stores claim one owner, while independent tasks remain available", async () => {
    const { store, phase } = await setup({ tasks: [{}, {}] });
    const other = new PlanStore(store.root);
    const results = await Promise.allSettled([store.claimTask(phase.id, phase.tasks[0].id, "A"), other.claimTask(phase.id, phase.tasks[0].id, "B")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.find((result) => result.status === "rejected").reason.details.errorCode, "TASK_OWNED_BY_ANOTHER_SESSION");
    const task = (await store.loadPhase(phase.id)).tasks[0];
    const winner = task.activeOwnerSession;
    const loser = winner === "A" ? "B" : "A";
    assert.equal((await other.claimTask(phase.id, task.id, winner)).alreadyStarted, true);
    assert.equal((await store.loadPhase(phase.id)).tasks[0].statusLog.length, 1);
    await assert.rejects(store.claimTask(phase.id, phase.tasks[1].id, winner), (error) => error.details.errorCode === "ACTIVE_TASK_CONFLICT");
    await other.claimTask(phase.id, phase.tasks[1].id, loser);
  });

  test("a paused return task cannot be claimed by another session", async () => {
    const { store, phase } = await setup({ tasks: [{}, {}] });
    await store.addWorkDeviation({ ...deviation("held", "A"), resumeTaskId: phase.tasks[0].id, temporaryTaskId: phase.tasks[1].id }, "A");
    await assert.rejects(store.claimTask(phase.id, phase.tasks[0].id, "B"), (error) => error.details.errorCode === "TASK_OWNED_BY_ANOTHER_SESSION");
    assert.equal((await store.loadPhase(phase.id)).tasks[0].status, "planned");
  });

  test("legacy pending returns recover explicitly without changing their checkpoints", async () => {
    const { store, phase } = await setup({ tasks: [{}, {}] });
    const snapshot = { id: "checkpoint", reason: "Detour", whatWasBeingDone: "Source work", resumeLocation: "src/a.ts:1", howToResume: "Continue", relatedTaskId: phase.tasks[1].id, pausedAt: now, pausedBy: "A" };
    await store.updateTask(phase.id, phase.tasks[0].id, (task) => ({ ...task, pauseSnapshot: snapshot, pauseHistory: [snapshot] }));
    await store.addWorkDeviation({ ...deviation("pending", "old"), resumeTaskId: phase.tasks[0].id, temporaryTaskId: phase.tasks[1].id, state: "resume-required", snapshot }, "old");
    await store.refreshResume("Old notes", "Return needed", "old");
    await assert.rejects(store.recoverSessionForTask(phase.id, phase.tasks[0].id, "new", false), (error) => error.details.errorCode === "SESSION_RECOVERY_CONFIRMATION_REQUIRED");
    await store.recoverSessionForTask(phase.id, phase.tasks[0].id, "new", true);
    assert.equal((await store.loadProject("new")).workDeviations[0].state, "resume-required");
    assert.equal((await store.loadProject("old")).workDeviations.length, 0);
    assert.equal((await store.loadResume("new")).notes, "Old notes");
    assert.deepEqual((await store.loadPhase(phase.id)).tasks[0].pauseSnapshot, snapshot);
    await store.claimTask(phase.id, phase.tasks[0].id, "new");
    assert.deepEqual((await store.loadPhase(phase.id)).tasks[0].pauseHistory, [snapshot]);
  });

  test("registered live owners and occupied destination sessions cannot be recovered", async () => {
    const { store, phase } = await setup({ tasks: [{ status: "in-progress", activeOwnerSession: "old" }, { status: "in-progress", activeOwnerSession: "occupied" }] });
    await store.registerSession("old");
    await assert.rejects(store.recoverSessionForTask(phase.id, phase.tasks[0].id, "new", true), (error) => error.details.errorCode === "SESSION_OWNER_ACTIVE");
    await assert.rejects(store.recoverSessionForTask(phase.id, phase.tasks[1].id, "old", true), (error) => error.details.errorCode === "SESSION_RECOVERY_CONFLICT");
    assert.equal((await store.loadPhase(phase.id)).tasks[0].activeOwnerSession, "old");
  });

  test("unreadable process evidence fails closed and recovery rollback preserves canonical data", async () => {
    const { store, phase } = await setup({ tasks: [{ status: "in-progress", activeOwnerSession: "old" }] });
    await store.registerSession("old");
    const path = join(store.root, ".local/sessions", `${Buffer.from("old").toString("base64url")}.json`);
    await writeFile(path, "broken");
    await assert.rejects(store.recoverSessionForTask(phase.id, phase.tasks[0].id, "new", true));
    await rm(path);
    const before = await store.loadPhase(phase.id);
    const original = store.saveWorkDeviations.bind(store);
    let fail = true;
    store.saveWorkDeviations = async (...args) => { if (fail) { fail = false; throw new Error("Injected disk failure"); } return original(...args); };
    await assert.rejects(store.recoverSessionForTask(phase.id, phase.tasks[0].id, "new", true), /Injected disk failure/);
    assert.deepEqual((await store.loadPhase(phase.id)).tasks, before.tasks);
  });
});

describe("deviationsForSession", () => {
  const all = [deviation("mine", "A"), deviation("theirs", "B"), deviation("legacy")];

  test("a session sees its own and unowned deviations, never another session's", () => {
    assert.deepEqual(deviationsForSession(all, "A").map((d) => d.id), ["mine", "legacy"]);
    assert.deepEqual(deviationsForSession(all, "B").map((d) => d.id), ["theirs", "legacy"]);
  });

  test("no session id means the whole project, as before", () => {
    assert.deepEqual(deviationsForSession(all, undefined).map((d) => d.id), ["mine", "theirs", "legacy"]);
    assert.deepEqual(deviationsForSession(all, "").map((d) => d.id), ["mine", "theirs", "legacy"]);
  });

  test("does not change the list it is given", () => {
    const copy = [...all];
    deviationsForSession(all, "A");
    assert.deepEqual(all, copy);
  });

  test("old stored data without ownerSession reads as unowned", () => {
    const legacy = WorkDeviationSchema.parse({ id: "old", recommendedTaskId: "r", temporaryTaskId: "t", resumeTaskId: "x", createdAt: now });
    assert.equal(legacy.ownerSession, "");
  });
});

describe("addWorkDeviation", () => {
  test("stamps the session that made the switch and persists it", async () => {
    const { store } = await setup();
    const project = await store.addWorkDeviation(deviation("d1"), "session-A");
    assert.equal(project.workDeviations[0].ownerSession, "session-A");
    const reloaded = await store.loadProject();
    assert.equal(reloaded.workDeviations[0].ownerSession, "session-A");
  });

  test("keeps an owner that was already set, and leaves sessionless callers unowned", async () => {
    const { store } = await setup();
    await store.addWorkDeviation(deviation("d1", "X"), "session-A");
    await store.addWorkDeviation(deviation("d2"));
    const stored = (await store.loadProject()).workDeviations;
    assert.deepEqual(stored.map((d) => d.ownerSession), ["X", ""]);
  });
});

describe("per-session resume focus", () => {
  test("two sessions keep separate notes and neither touches the project-level focus", async () => {
    const { store } = await setup();
    await store.refreshResume("project notes", "project summary");
    await store.refreshResume("A notes", "A summary", "session-A");
    await store.refreshResume("B notes", undefined, "session-B");

    assert.equal((await store.loadResume("session-A")).notes, "A notes");
    assert.equal((await store.loadResume("session-A")).lastSessionSummary, "A summary");
    assert.equal((await store.loadResume("session-B")).notes, "B notes");
    const projectLevel = await store.loadResume();
    assert.equal(projectLevel.notes, "project notes");
    assert.equal(projectLevel.lastSessionSummary, "project summary");
  });

  test("a session that has no entry yet inherits the project-level focus for reading", async () => {
    const { store } = await setup();
    await store.refreshResume("shared notes");
    assert.equal((await store.loadResume("brand-new-session")).notes, "shared notes");
    assert.equal(await store.loadResume("brand-new-session").then((r) => r.guardBypassUntil), "");
  });

  test("a session's in-progress tasks are the ones it owns", async () => {
    const { store, phase } = await setup({
      tasks: [
        { status: "in-progress", activeOwnerSession: "session-A" },
        { status: "in-progress", activeOwnerSession: "session-B" },
        { status: "planned" },
      ],
    });
    const [a, b] = phase.tasks;
    assert.deepEqual((await store.refreshResume(undefined, undefined, "session-A")).inProgressTaskIds, [a.id]);
    assert.deepEqual((await store.refreshResume(undefined, undefined, "session-B")).inProgressTaskIds, [b.id]);
    assert.deepEqual((await store.refreshResume()).inProgressTaskIds.sort(), [a.id, b.id].sort(), "sessionless sees everyone's");
    assert.equal((await store.loadResume("session-A")).currentPhaseId, phase.id);
  });

  test("a session with no tasks of its own has no current phase", async () => {
    const { store } = await setup({ tasks: [{ status: "in-progress", activeOwnerSession: "session-A" }] });
    const idle = await store.refreshResume(undefined, undefined, "session-idle");
    assert.deepEqual(idle.inProgressTaskIds, []);
    assert.equal(idle.currentPhaseId, "");
  });

  test("session saves never change the guard bypass, which stays project-wide", async () => {
    const { store } = await setup();
    await store.authorizeGuardBypass(30);
    await store.refreshResume("A notes", undefined, "session-A");
    assert.equal(await store.isGuardBypassed(), true, "the bypass survives a session's save");
    assert.equal((await store.loadResume("session-A")).guardBypassUntil, "", "and is not copied into the session entry");
    await store.clearGuardBypass();
    assert.equal(await store.isGuardBypassed(), false);
  });

  test("sessionless refresh and save behave exactly as before", async () => {
    const { store } = await setup();
    const first = await store.refreshResume("n1", "s1");
    const again = await store.refreshResume();
    assert.equal(again.notes, "n1");
    assert.equal(again.lastSessionSummary, "s1");
    assert.equal(first.guardBypassUntil, "");
  });

  test("sessions saving at the same moment do not lose each other's entry", async () => {
    const { store } = await setup();
    await Promise.all(["s1", "s2", "s3", "s4", "s5"].map((id) => store.refreshResume(`${id} notes`, undefined, id)));
    for (const id of ["s1", "s2", "s3", "s4", "s5"]) assert.equal((await store.loadResume(id)).notes, `${id} notes`);
  });
});

describe("pruning old sessions", () => {
  const entry = (updatedAt) => ({
    updatedAt, currentPhaseId: "", inProgressTaskIds: [], nextSteps: [], nextStepsUpdatedAt: "",
    blockers: [], notes: "", lastSessionSummary: "", guardBypassUntil: "",
  });

  test("keeps the most recently updated entries up to the limit", () => {
    const sessions = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`s${i}`, entry(`2026-10-06T08:${String(i).padStart(2, "0")}:00.000Z`)]));
    const kept = pruneResumeSessions(sessions);
    assert.equal(Object.keys(kept).length, RESUME_SESSION_LIMIT);
    assert.ok(kept.s24 && kept.s5, "the newest are kept");
    assert.equal(kept.s4, undefined, "the oldest are dropped");
    assert.equal(Object.keys(sessions).length, 25, "the input is not changed");
  });

  test("the store keeps at most the limit of sessions on disk", async () => {
    const { store } = await setup();
    for (let i = 0; i < RESUME_SESSION_LIMIT + 3; i += 1) await store.refreshResume(`n${i}`, undefined, `session-${i}`);
    const survivors = await Promise.all(Array.from({ length: RESUME_SESSION_LIMIT + 3 }, (_, i) => store.loadResume(`session-${i}`).then((r) => r.notes === `n${i}`)));
    assert.equal(survivors.filter(Boolean).length, RESUME_SESSION_LIMIT, "exactly the limit still have their own entry");
    assert.equal(survivors[RESUME_SESSION_LIMIT + 2], true, "the newest session is kept");
  });
});

describe("selection by session", () => {
  async function twoSessionsFixture() {
    const { store, phase } = await setup({ tasks: [{ status: "planned" }, { status: "planned" }, { status: "planned" }] });
    const [a1, a2, other] = phase.tasks;
    // Session A set a1 aside (checkpointed) for a2 and must return to it.
    const checkpoint = { id: "p1", reason: "r", whatWasBeingDone: "w", resumeLocation: "l", howToResume: "h", pausedAt: now };
    await store.savePhase({ ...phase, tasks: phase.tasks.map((t) => t.id === a1.id ? { ...t, pauseSnapshot: checkpoint } : t) });
    await store.addWorkDeviation(WorkDeviationSchema.parse({
      id: "d1", recommendedTaskId: a1.id, temporaryTaskId: a2.id, resumeTaskId: a1.id, createdAt: now, state: "active", snapshot: checkpoint,
    }), "session-A");
    const features = (await store.loadFeatures()).features;
    const phases = await store.loadAllPhases();
    const deviations = (await store.loadProject()).workDeviations;
    return { features, phases, deviations, a1, a2, other };
  }

  test("the session that made the switch keeps its return target", async () => {
    const { features, phases, deviations, a1, a2 } = await twoSessionsFixture();
    const forA = recommendNextTask(features, phases, deviations, "", "session-A");
    assert.equal(forA.kind, "resume");
    assert.ok([a1.id, a2.id].includes(forA.candidate.task.id));
  });

  test("another session is not sent to the task the first one set aside, nor to its temporary task", async () => {
    const { features, phases, deviations, a1, other } = await twoSessionsFixture();
    const forB = recommendNextTask(features, phases, deviations, "", "session-B");
    assert.notEqual(forB.kind, "resume", "no forced return to someone else's task");
    assert.notEqual(forB.candidate?.task.id, a1.id, "the set-aside task is never offered to B");
    assert.ok(forB.candidate, "B still gets something to do");
    assert.ok(forB.candidate.task.id === other.id || forB.candidate.task.id !== a1.id);
  });

  test("a caller with no session still sees everything, as before", async () => {
    const { features, phases, deviations } = await twoSessionsFixture();
    assert.equal(recommendNextTask(features, phases, deviations, "", "").kind, "resume");
  });
});
