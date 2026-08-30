import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ActiveTasksHeader } from "../src/components/layout/app-shell";
import { ResumeRequiredSection } from "../src/components/dashboard/resume-required";
import { ProjectContext } from "../src/components/dashboard/project-context";
import { TopNav } from "../src/components/layout/top-nav";
import { TaskDetailRoute } from "../src/routes/task-detail/route";
import { LastUpdated } from "../src/components/ui/last-updated";
import { LatestCompletedTasks } from "../src/components/dashboard/latest-completed-tasks";
import { NewAddedTasks } from "../src/components/dashboard/new-added-tasks";
import { FeatureRow } from "../src/components/features/feature-row";
import { PhaseRow } from "../src/components/phases/phase-row";
import { TaskTreeRow } from "../src/components/dashboard/work-tree-rows";
import { createEmptyStatusSummary } from "../src/lib/status-summary";
import { makeFeature, makePhase, makeProject, makeTask, renderRoute } from "./fixtures";

describe("entity references and timestamps", () => {
  it("renders canonical Project Context without exposing agent-only files and flags unmigrated legacy context", () => {
    const project = makeProject({
      scope: ["Planner core"],
      technologies: ["TypeScript"],
      projectGuidelines: { content: "Use English in source code.", updatedAt: "", sessionInfo: [] },
      globalRules: ["Legacy rule"],
      acceptedDecisions: [{ id: "decision-1", title: "Use file storage", decision: "Store plans in .planner/.", rationale: "Portable.", implementationNotes: "Keep the format open.", acceptedAt: "2026-01-01T00:00:00.000Z" }],
    });
    render(<MemoryRouter><ProjectContext project={project} /></MemoryRouter>);

    expect(screen.getByText("Project Context")).toBeInTheDocument();
    expect(screen.queryByText("AI Consolidated Context")).not.toBeInTheDocument();
    expect(screen.getByText("Project Guidelines")).toBeInTheDocument();
    expect(screen.getByText("Use English in source code.")).toBeInTheDocument();
    expect(screen.getByText(/Legacy project context remains/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review the migration preview" })).toHaveAttribute("href", "/project/edit");
    expect(screen.queryByText(/SKILL\.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rules\.json/)).not.toBeInTheDocument();
  });

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

  it("shows planned resume targets without duplicating the section label", () => {
    renderRoute([{ path: "/", element: (
      <ResumeRequiredSection tasks={[{
        id: "task-5", number: 5, shortId: "TSK05", title: "Return target",
        phaseId: "phase-2", phaseNumber: 2, featureId: "feature-1", featureNumber: 1,
        status: "planned", pendingResume: true, deviationId: "deviation-2", pauseSnapshot: null,
      }]} />
    ) }]);

    expect(screen.getByRole("heading", { name: "Resume required (1)" })).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.queryByText("Resume required")).not.toBeInTheDocument();
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

  it("shows compact priority badges on feature, phase, and work-tree task rows", () => {
    const feature = makeFeature({ priority: 3 });
    const task = makeTask({ priority: 5 });
    const phase = makePhase({ priority: 4, tasks: [task], taskIds: [task.id] });

    renderRoute([
      {
        path: "/",
        element: (
          <div>
            <FeatureRow
              feature={feature}
              phases={[phase]}
              phasesCount={1}
              tasksCount={1}
              phaseSummary={createEmptyStatusSummary()}
              taskSummary={createEmptyStatusSummary()}
            />
            <PhaseRow featureId={feature.id} feature={feature} phase={phase} />
            <TaskTreeRow
              feature={feature}
              phase={phase}
              task={task}
              recentlyChanged={false}
              highlighted={false}
            />
          </div>
        ),
      },
    ]);

    expect(screen.getByLabelText("Priority 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority 4")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority 5")).toBeInTheDocument();
  });
});

describe("dashboard cards reuse the segmented ref header", () => {
  it("renders the clickable F/P/T segmented header with copyable short id + name tooltips on Latest completed tasks", () => {
    const feature = makeFeature();
    const task = makeTask({ status: "done", completedAt: "2026-01-02T00:00:00.000Z" });
    const phase = makePhase({ tasks: [task] });
    const { container } = render(
      <MemoryRouter>
        <LatestCompletedTasks features={[feature]} phases={[phase]} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".entity-path-badge")).toBeTruthy();
    expect(container.querySelector(".short-id-badge")).toBeTruthy();
    expect(container.querySelector(".copyable-id")).toBeTruthy();
    expect(container.querySelector(".entity-path-seg--feature")?.getAttribute("title")).toBe("Example feature");
    expect(container.querySelector(".entity-path-seg--phase")?.getAttribute("title")).toBe("Example phase");
    expect(container.querySelector(".entity-path-seg--task")?.getAttribute("title")).toBe("Example task");
    expect(screen.getByLabelText("Priority 1")).toBeInTheDocument();
  });

  it("renders the segmented header with the New pill + name tooltips on New added tasks", () => {
    const feature = makeFeature();
    const task = makeTask({ status: "planned", createdAt: new Date().toISOString(), startedAt: "" });
    const phase = makePhase({ tasks: [task] });
    const { container } = render(
      <MemoryRouter>
        <NewAddedTasks features={[feature]} phases={[phase]} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".entity-path-badge")).toBeTruthy();
    expect(container.querySelector(".short-id-badge")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    expect(container.querySelector(".entity-path-seg--feature")?.getAttribute("title")).toBe("Example feature");
    expect(container.querySelector(".entity-path-seg--phase")?.getAttribute("title")).toBe("Example phase");
    expect(container.querySelector(".entity-path-seg--task")?.getAttribute("title")).toBe("Example task");
    expect(screen.getByLabelText("Priority 1")).toBeInTheDocument();
  });
});
