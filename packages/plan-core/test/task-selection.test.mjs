import assert from "node:assert/strict";
import test from "node:test";
import { checkExplicitTaskStart, recommendNextTask } from "../dist/index.js";

const NOW = "2026-08-10T00:00:00.000Z";
const feature = (number, priority = 10, status = "planned") => ({ id: `feature-${number}`, number, priority, status });
const task = (id, number, priority = 10, status = "planned", dependsOn = [], pauseSnapshot = null) => ({ id, number, priority, status, dependsOn, pauseSnapshot });
const phase = (id, featureId, number, priority, tasks, status = "planned") => ({ id, featureId, number, priority, tasks, status });
const snapshot = (pausedAt, relatedTaskId = "") => ({
  id: `snapshot-${pausedAt}`, reason: "Temporary switch", whatWasBeingDone: "Core work",
  resumeLocation: "src/core.ts:10", howToResume: "Continue the core change", relatedTaskId,
  pausedAt, pausedBy: "test",
});
const deviation = (temporaryTaskId, resumeTaskId, state = "approved") => ({
  id: `deviation-${temporaryTaskId}`, recommendedTaskId: resumeTaskId, temporaryTaskId, resumeTaskId,
  reason: "Urgent approved work", requestedBy: "user", approvedBy: "user", state,
  createdAt: NOW, activatedAt: "", resolvedAt: "",
});

const recommendation = (features, phases, deviations = []) => recommendNextTask(features, phases, deviations);

test("selects the lowest feature → phase → task priority with number tie-breakers", () => {
  const features = [feature(1, 20), feature(2, 10)];
  const phases = [
    phase("p1", "feature-1", 1, 1, [task("slow", 1, 1)]),
    phase("p2", "feature-2", 2, 20, [task("later", 1, 1)]),
    phase("p3", "feature-2", 1, 10, [task("winner", 2, 10), task("tie-break", 1, 10)]),
  ];
  const result = recommendation(features, phases);
  assert.equal(result.kind, "priority");
  assert.equal(result.candidate.task.id, "tie-break");
});

test("continues ready work in the current phase before global priority", () => {
  const features = [feature(1, 1), feature(2, 20)];
  const phases = [
    phase("global-priority", "feature-1", 1, 1, [task("t374", 374, 1)]),
    phase("current", "feature-2", 2, 20, [task("t438", 438, 1, "done"), task("t439", 439, 2)]),
  ];

  const result = recommendNextTask(features, phases, [], "current");
  assert.equal(result.kind, "priority");
  assert.equal(result.candidate.task.id, "t439");
  assert.match(result.reason, /current phase/i);
});

test("falls back to global priority when the current phase has no ready task", () => {
  const features = [feature(1, 1), feature(2, 20)];
  const phases = [
    phase("global-priority", "feature-1", 1, 1, [task("global", 1, 1)]),
    phase("current", "feature-2", 2, 20, [task("blocked", 2, 1, "blocked")]),
  ];

  const result = recommendNextTask(features, phases, [], "current");
  assert.equal(result.candidate.task.id, "global");
  assert.match(result.reason, /feature, phase, then task/i);
});

test("active and resume work still override current-phase continuity", () => {
  const features = [feature(1)];
  const phases = [
    phase("current", "feature-1", 1, 1, [task("current-ready", 1)]),
    phase("other", "feature-1", 2, 2, [task("active", 2, 2, "in-progress")]),
  ];
  assert.equal(recommendNextTask(features, phases, [], "current").candidate.task.id, "active");

  phases[1].tasks[0].status = "done";
  phases[1].tasks.push(task("resume", 3, 3));
  const pending = deviation("temporary", "resume", "resume-required");
  assert.equal(recommendNextTask(features, phases, [pending], "current").candidate.task.id, "resume");
});

test("returns one active task, but reports an unsafe multiple-active conflict", () => {
  const features = [feature(1)];
  const phases = [phase("p", "feature-1", 1, 1, [task("active", 1, 1, "in-progress"), task("planned", 2, 1)])];
  assert.equal(recommendation(features, phases).candidate.task.id, "active");
  phases[0].tasks.push(task("other-active", 3, 1, "in-progress"));
  const conflict = recommendation(features, phases);
  assert.equal(conflict.kind, "conflict");
  assert.equal(conflict.activeCandidates.length, 2);
});

test("explicit starts preserve readiness gates but do not enforce priority or single-active selection", () => {
  const features = [feature(1)];
  const phases = [phase("p", "feature-1", 1, 1, [
    task("priority", 1, 1), task("explicit", 2, 2), task("blocked", 3, 3, "blocked"), task("dependent", 4, 4, "planned", ["priority"]),
    task("checkpointed", 5, 5, "planned", [], snapshot(NOW)),
  ])];

  assert.equal(checkExplicitTaskStart(features, phases, "explicit").eligible, true, "a lower-priority explicit task is valid");
  assert.equal(checkExplicitTaskStart(features, phases, "checkpointed").eligible, true, "a planned task with a checkpoint is resumable");
  phases[0].tasks.find((item) => item.id === "priority").status = "in-progress";
  assert.equal(checkExplicitTaskStart(features, phases, "explicit").eligible, true, "an explicit task remains valid with another active task");
  assert.equal(checkExplicitTaskStart(features, phases, "blocked").eligible, false, "blocked work stays unavailable");
  assert.equal(checkExplicitTaskStart(features, phases, "dependent").eligible, false, "unfinished dependencies still block an explicit start");
});

test("approved deviations preserve their waiting-task exception", () => {
  const features = [feature(1, 10, "waiting")];
  const phases = [phase("p", "feature-1", 1, 1, [task("resume", 1), task("temporary", 2, 2, "waiting", ["unfinished"])], "waiting")];
  assert.equal(checkExplicitTaskStart(features, phases, "temporary", [deviation("temporary", "resume")]).eligible, true);
});

test("excludes unavailable work and waits for completed dependencies", () => {
  const features = [feature(1)];
  const phases = [phase("p", "feature-1", 1, 1, [
    task("blocked", 1, 1, "blocked"), task("waiting", 2, 1, "waiting"),
    task("dependent", 3, 1, "planned", ["prerequisite"]), task("prerequisite", 4, 1),
  ])];
  assert.equal(recommendation(features, phases).candidate.task.id, "prerequisite");
  phases[0].tasks.find((item) => item.id === "prerequisite").status = "done";
  assert.equal(recommendation(features, phases).candidate.task.id, "dependent");
});

test("resumes an approved pre-start deviation after its temporary task ends", () => {
  const features = [feature(1)];
  const phases = [phase("p", "feature-1", 1, 1, [task("resume", 1), task("temporary", 2, 2, "done")])];
  const result = recommendation(features, phases, [deviation("temporary", "resume")]);
  assert.equal(result.kind, "resume");
  assert.equal(result.candidate.task.id, "resume");
});

test("nested deviations follow the latest open override and resume its preserved target", () => {
  const features = [feature(1)];
  const phases = [phase("p", "feature-1", 1, 1, [
    task("original", 1, 1, "waiting"), task("first", 2, 2, "waiting"), task("second", 3, 3, "done"),
  ])];
  const first = { ...deviation("first", "original"), createdAt: "2026-08-10T00:00:00.000Z" };
  const nested = { ...deviation("second", "first"), createdAt: "2026-08-10T01:00:00.000Z" };
  const result = recommendation(features, phases, [first, nested]);
  assert.equal(result.kind, "resume");
  assert.equal(result.candidate.task.id, "first");
});

test("orphan checkpoints are resumed LIFO before new priority work", () => {
  const features = [feature(1)];
  const phases = [phase("p", "feature-1", 1, 1, [
    task("priority", 1, 1),
    task("older", 2, 2, "planned", [], snapshot("2026-08-10T00:00:00.000Z")),
    task("newer", 3, 3, "planned", [], snapshot("2026-08-10T01:00:00.000Z")),
  ])];
  const result = recommendation(features, phases);
  assert.equal(result.kind, "resume");
  assert.equal(result.candidate.task.id, "newer");
});

test("resume-required deviations return to a checkpointed snapshot", () => {
  const features = [feature(1)];
  const phases = [phase("p", "feature-1", 1, 1, [
    task("resume", 1, 1, "planned", [], snapshot(NOW, "temporary")),
    task("temporary", 2, 2, "done"),
  ])];
  const pending = { ...deviation("temporary", "resume", "resume-required"), resumeRequiredAt: NOW };
  const result = recommendation(features, phases, [pending]);
  assert.equal(result.kind, "resume");
  assert.equal(result.candidate.task.id, "resume");
  assert.match(result.reason, /Resume required/);
});

test("resolved deviations retain their explicit resume target; canceled records do not override priority", () => {
  const features = [feature(1)];
  const phases = [phase("p", "feature-1", 1, 1, [task("resume", 1), task("temporary", 2, 2, "done")])];
  const resolved = { ...deviation("temporary", "resume", "resolved"), resolvedAt: NOW };
  assert.equal(recommendation(features, phases, [resolved]).candidate.task.id, "resume");
  const canceled = { ...resolved, state: "canceled" };
  assert.equal(recommendation(features, phases, [canceled]).kind, "priority");
});
