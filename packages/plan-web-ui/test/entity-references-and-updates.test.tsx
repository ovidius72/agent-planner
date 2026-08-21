import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActiveTasksHeader, TaskFocusHeader } from "../src/components/layout/app-shell";
import { LastUpdated } from "../src/components/ui/last-updated";
import { renderRoute } from "./fixtures";

describe("entity references and timestamps", () => {
  it("keeps every active-task header path segment navigable and its identifiers copyable", () => {
    renderRoute([
      {
        path: "/",
        element: (
          <ActiveTasksHeader
            activeTasks={[{
              id: "task-3",
              number: 3,
              shortId: "TSK03",
              title: "Active task",
              phaseId: "phase-2",
              phaseNumber: 2,
              featureId: "feature-1",
              featureNumber: 1,
              status: "in-progress",
            }]}
          />
        ),
      },
    ]);

    expect(screen.getByRole("link", { name: "F001" })).toHaveAttribute("href", "/features/feature-1");
    expect(screen.getByRole("link", { name: "P002" })).toHaveAttribute("href", "/features/feature-1/phases/phase-2");
    expect(screen.getByRole("link", { name: "T003" })).toHaveAttribute("href", "/features/feature-1/phases/phase-2/tasks/task-3");
    expect(screen.getByRole("button", { name: "Copy F001/P002/T003" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy TSK03" })).toBeInTheDocument();
  });

  it("surfaces paused checkpoints and keeps resume-required separate from canonical status", () => {
    renderRoute([{ path: "/", element: (
      <TaskFocusHeader taskFocus={{ active: [], paused: [], pendingResume: [{
        id: "task-4", number: 4, shortId: "TSK04", title: "Paused task",
        phaseId: "phase-2", phaseNumber: 2, featureId: "feature-1", featureNumber: 1,
        status: "paused", pendingResume: true, deviationId: "deviation-1",
        pauseSnapshot: {
          id: "snapshot-1", reason: "Temporary prerequisite", whatWasBeingDone: "Implementing selection",
          resumeLocation: "src/selector.ts:20", howToResume: "Finish branch and rerun tests",
          relatedTaskId: "task-5", pausedAt: "2026-08-18T12:34:56.000Z", pausedBy: "test",
        },
      }] }} />
    ) }]);

    expect(screen.getByRole("heading", { name: "Resume required (1)" })).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Resume checkpoint")).toBeInTheDocument();
    expect(screen.getByText("Temporary prerequisite")).toBeInTheDocument();
    expect(screen.getByText("src/selector.ts:20")).toBeInTheDocument();
    expect(screen.getByText("Finish branch and rerun tests")).toBeInTheDocument();
  });

  it("shows planned resume targets as planned plus a secondary resume-required marker", () => {
    renderRoute([{ path: "/", element: (
      <TaskFocusHeader taskFocus={{ active: [], paused: [], pendingResume: [{
        id: "task-5", number: 5, shortId: "TSK05", title: "Return target",
        phaseId: "phase-2", phaseNumber: 2, featureId: "feature-1", featureNumber: 1,
        status: "planned", pendingResume: true, deviationId: "deviation-2", pauseSnapshot: null,
      }] }} />
    ) }]);

    expect(screen.getByRole("heading", { name: "Resume required (1)" })).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getAllByText("Resume required")).toHaveLength(1);
    expect(screen.getByText("Return to this preserved task before selecting new priority work.")).toBeInTheDocument();
  });

  it("renders the persisted entity last-update timestamp as a semantic time", () => {
    renderRoute([
      {
        path: "/",
        element: <LastUpdated value="2026-08-18T12:34:56.000Z" />,
      },
    ]);

    const timestamp = screen.getByLabelText(/^Last updated /);
    expect(timestamp).toHaveAttribute("dateTime", "2026-08-18T12:34:56.000Z");
  });
});
