import { test } from "node:test";
import assert from "node:assert/strict";
import { taskStartDenied, taskStartSucceeded } from "../dist/index.js";

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
