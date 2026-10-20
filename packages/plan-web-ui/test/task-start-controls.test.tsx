import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { TaskRow } from "../src/components/tasks/task-row";
import { CHECKPOINT_STATUS_LOCK_TITLE, canStartTask, isStatusLockedByCheckpoint } from "../src/lib/statuses";
import type { Task } from "../src/lib/types";
import { makeTask } from "./fixtures";

const checkpoint = { id: "p1", reason: "Parked", whatWasBeingDone: "x", resumeLocation: "a:1", howToResume: "go", relatedTaskId: "", pausedAt: "2026-01-01T00:00:00.000Z", pausedBy: "t" };

describe("canStartTask", () => {
  it("matches the server rule: planned and parked work start, decisions and done work do not", () => {
    for (const status of ["planned", "waiting", "blocked", "deferred"] as const) expect(canStartTask(status)).toBe(true);
    for (const status of ["in-progress", "done", "canceled", "rejected"] as const) expect(canStartTask(status)).toBe(false);
  });
});

describe("isStatusLockedByCheckpoint", () => {
  it("locks checkpointed work that Start can resume", () => {
    for (const status of ["planned", "waiting", "blocked", "deferred", "in-progress"] as const) {
      expect(isStatusLockedByCheckpoint({ status, pauseSnapshot: checkpoint })).toBe(true);
    }
  });
  it("never locks canceled or rejected work, which has no Start", () => {
    expect(isStatusLockedByCheckpoint({ status: "canceled", pauseSnapshot: checkpoint })).toBe(false);
    expect(isStatusLockedByCheckpoint({ status: "rejected", pauseSnapshot: checkpoint })).toBe(false);
  });
  it("does not lock work without a checkpoint", () => {
    expect(isStatusLockedByCheckpoint({ status: "waiting", pauseSnapshot: null })).toBe(false);
  });
});

function renderRow(task: Task) {
  const router = createMemoryRouter([{ path: "/", element: <TaskRow featureId="feature-1" phaseId="phase-1" task={task} /> }]);
  render(<RouterProvider router={router} />);
  return screen.getByRole("combobox");
}

describe("TaskRow status control", () => {
  it("is locked for a checkpointed waiting task and says to use Start", () => {
    const select = renderRow(makeTask({ status: "waiting", pauseSnapshot: checkpoint }));
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute("title", CHECKPOINT_STATUS_LOCK_TITLE);
  });
  it("stays editable for a checkpointed canceled task so it can go back to planned", () => {
    const select = renderRow(makeTask({ status: "canceled", pauseSnapshot: checkpoint }));
    expect(select).toBeEnabled();
    expect(select).not.toHaveAttribute("title");
  });
});
