import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActiveTasksHeader } from "../src/components/layout/app-shell";
import { ResumeRequiredSection } from "../src/components/dashboard/resume-required";
import { TopNav } from "../src/components/layout/top-nav";
import { TaskDetailRoute } from "../src/routes/task-detail/route";
import { LastUpdated } from "../src/components/ui/last-updated";
import { makeFeature, makePhase, makeTask, renderRoute } from "./fixtures";

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

  it("keeps the resume section compact while preserving canonical status and resume markers", () => {
    renderRoute([{ path: "/", element: (
      <ResumeRequiredSection tasks={[{
        id: "task-4", number: 4, shortId: "TSK04", title: "Paused task",
        phaseId: "phase-2", phaseNumber: 2, featureId: "feature-1", featureNumber: 1,
        status: "paused", pendingResume: true, deviationId: "deviation-1",
        pauseSnapshot: {
          id: "snapshot-1", reason: "Temporary prerequisite", whatWasBeingDone: "Implementing selection",
          resumeLocation: "src/selector.ts:20", howToResume: "Finish branch and rerun tests",
          relatedTaskId: "task-5", pausedAt: "2026-08-18T12:34:56.000Z", pausedBy: "test",
        },
      }]} />
    ) }]);

    expect(screen.getByRole("heading", { name: "Resume required (1)" })).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.queryByText("Checkpoint saved: Temporary prerequisite")).not.toBeInTheDocument();
    expect(screen.queryByText("Open the task detail view for the full checkpoint and resume steps.")).not.toBeInTheDocument();
    expect(screen.queryByText("Resume checkpoint")).not.toBeInTheDocument();
    expect(screen.queryByText("src/selector.ts:20")).not.toBeInTheDocument();
    expect(screen.queryByText("Finish branch and rerun tests")).not.toBeInTheDocument();
  });

  it("shows planned resume targets as planned plus a secondary resume-required marker", () => {
    renderRoute([{ path: "/", element: (
      <ResumeRequiredSection tasks={[{
        id: "task-5", number: 5, shortId: "TSK05", title: "Return target",
        phaseId: "phase-2", phaseNumber: 2, featureId: "feature-1", featureNumber: 1,
        status: "planned", pendingResume: true, deviationId: "deviation-2", pauseSnapshot: null,
      }]} />
    ) }]);

    expect(screen.getByRole("heading", { name: "Resume required (1)" })).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getAllByText("Resume required")).toHaveLength(1);
    expect(screen.queryByText("Return to this preserved task before selecting new priority work.")).not.toBeInTheDocument();
  });

  it("keeps the full checkpoint details in the task detail view", async () => {
    const feature = makeFeature();
    const task = makeTask({
      status: "paused",
      pauseSnapshot: {
        id: "snapshot-1",
        reason: "Temporary prerequisite",
        whatWasBeingDone: "Implementing selection",
        resumeLocation: "src/selector.ts:20",
        howToResume: "Finish branch and rerun tests",
        relatedTaskId: "task-5",
        pausedAt: "2026-08-18T12:34:56.000Z",
        pausedBy: "test",
      },
    });
    const phase = makePhase({ tasks: [task], taskIds: [task.id] });

    renderRoute([
      {
        path: "/",
        element: <TaskDetailRoute />,
        loader: () => ({ feature, phase, task, pendingResume: true }),
      },
    ]);

    expect(await screen.findByText("Resume checkpoint")).toBeInTheDocument();
    expect(screen.getByText("Temporary prerequisite")).toBeInTheDocument();
    expect(screen.getByText("Implementing selection")).toBeInTheDocument();
    expect(screen.getByText("src/selector.ts:20")).toBeInTheDocument();
    expect(screen.getByText("Finish branch and rerun tests")).toBeInTheDocument();
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

  it("keeps the top navigation usable with mobile-first controls and full labels", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {},
        clear: () => {},
      },
    });
    window.matchMedia = window.matchMedia ?? (() => ({ matches: true, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;

    renderRoute([
      {
        path: "/",
        element: <TopNav projectName="Agent Plan" projectRoot="/tmp/example" planRoot="/tmp/example/.planner" liveStatus="live" />,
      },
    ]);

    expect(screen.getByRole("link", { name: "Features" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Requirements" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Handoff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByLabelText("Switch to light theme")).toBeInTheDocument();
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
  });
});
