import { test } from "node:test";
import assert from "node:assert/strict";
import { taskStartDenied, taskStartSucceeded, taskStartGateState, taskStartGateStateLine } from "../dist/index.js";

test("taskStartDenied exposes a stable non-success contract", () => {
  assert.deepEqual(
    taskStartDenied(
      "REQUIREMENTS_READ_REQUIRED",
      "Read linked requirements.",
      ["requirement_list", "Retry task_start P001(F001)/T001"],
      { taskId: "task-1", requirementIds: ["req-1"] },
    ),
    {
      started: false,
      errorCode: "REQUIREMENTS_READ_REQUIRED",
      message: "Read linked requirements.",
      nextActions: ["requirement_list", "Retry task_start P001(F001)/T001"],
      taskId: "task-1",
      requirementIds: ["req-1"],
    },
  );
});

test("taskStartSucceeded proves persisted in-progress state", () => {
  assert.deepEqual(taskStartSucceeded("task-1"), {
    started: true,
    taskId: "task-1",
    status: "in-progress",
    alreadyStarted: false,
  });
});

// P104(F005)/T420 — taskStartGateState mirrors the same three checks
// task_start runs, so a task-show reply can report readiness before a
// caller ever calls task_start.
test("taskStartGateState is ready only when every task_start check passes", () => {
  const eligible = { eligible: true, reason: "" };
  assert.equal(taskStartGateState(eligible, eligible, "not-required").ready, true);
  assert.equal(taskStartGateState(eligible, eligible, "valid").ready, true);
  assert.equal(taskStartGateState(eligible, eligible, "missing").ready, false);
  assert.equal(taskStartGateState(eligible, eligible, "stale").ready, false);
});

test("taskStartGateState reports exactly what task_start would still deny on", () => {
  const contextEligibility = {
    eligible: false,
    reason: "Read this task's parent phase with full=true.",
    requiredReads: [{ kind: "phase", id: "phase-1", state: "missing" }],
  };
  const requirementEligibility = {
    eligible: false,
    reason: "Read linked requirements.",
    requiredReads: [{ kind: "requirement", id: "req-1", state: "missing" }],
  };
  const gate = taskStartGateState(contextEligibility, requirementEligibility, "missing");
  assert.deepEqual(gate, {
    ready: false,
    projectGuidelinesReadState: "missing",
    missingReads: [{ kind: "phase", id: "phase-1", state: "missing" }],
    missingRequirementIds: ["req-1"],
  });
});

test("taskStartGateStateLine names what task_start still needs, or says it is ready", () => {
  const ready = taskStartGateState({ eligible: true, reason: "" }, { eligible: true, reason: "" }, "valid");
  assert.equal(taskStartGateStateLine(ready), "task_start readiness: ready.");

  const notReady = taskStartGateState(
    { eligible: false, reason: "", requiredReads: [{ kind: "phase", id: "phase-1", state: "missing" }] },
    { eligible: false, reason: "", requiredReads: [{ kind: "requirement", id: "req-1", state: "missing" }] },
    "missing",
  );
  const line = taskStartGateStateLine(notReady);
  assert.match(line, /not ready/);
  assert.match(line, /Project Guidelines \(missing\)/);
  assert.match(line, /phase phase-1 \(missing\)/);
  assert.match(line, /1 linked requirement\(s\)/);
});
