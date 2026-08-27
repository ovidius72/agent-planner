import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Outlet } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { FlowBacklogAnalytics } from "../src/components/dashboard/flow-backlog-analytics";
import { DashboardRoute } from "../src/routes/dashboard/route";
import { makeFeature, makePhase, makeProject, makeTask, renderRoute } from "./fixtures";

function taskOnDay(day: number) {
  const date = `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  return makeTask({ id: `task-${day}`, number: day, createdAt: date, updatedAt: date });
}

function renderAnalytics(tasks = [taskOnDay(1)], asOf = "2026-01-31") {
  return render(<FlowBacklogAnalytics phases={[makePhase({ tasks, taskIds: tasks.map((task) => task.id) })]} asOf={asOf} />);
}

describe("FlowBacklogAnalytics", () => {
  it("defaults to 21 active days and updates the exact window without navigation", () => {
    const tasks = Array.from({ length: 25 }, (_, index) => taskOnDay(index + 1));
    renderAnalytics(tasks);

    expect(screen.getByRole("button", { name: "21 active days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("21", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("UTC range 2026-01-05 – 2026-01-25") === true)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "7 active days" }));

    expect(screen.getByRole("button", { name: "7 active days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "21 active days" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("7", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("UTC range 2026-01-19 – 2026-01-25") === true)).toBeInTheDocument();
  });

  it("describes positive, zero, and negative net backlog without relying on color", () => {
    const { rerender } = render(<FlowBacklogAnalytics phases={[makePhase({ tasks: [taskOnDay(1)] })]} asOf="2026-01-31" />);
    expect(screen.getByText("Backlog grew by 1 task across the selected active days.")).toBeInTheDocument();
    expect(screen.getByText("+1", { selector: "dd" })).toBeInTheDocument();

    const done = makeTask({
      id: "done",
      status: "done",
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    rerender(<FlowBacklogAnalytics phases={[makePhase({ tasks: [done] })]} asOf="2026-01-31" />);
    expect(screen.getByText("Backlog stayed level across the selected active days.")).toBeInTheDocument();

    const closedTasks = Array.from({ length: 7 }, (_, index) => makeTask({
      id: `closed-${index}`,
      status: "done",
      createdAt: "2025-12-01T00:00:00.000Z",
      completedAt: `2026-01-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`,
      updatedAt: `2026-01-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`,
    }));
    rerender(<FlowBacklogAnalytics phases={[makePhase({ tasks: closedTasks })]} asOf="2026-01-31" />);
    fireEvent.click(screen.getByRole("button", { name: "7 active days" }));
    expect(screen.getByText("Backlog shrank by 7 tasks across the selected active days.")).toBeInTheDocument();
    expect(screen.getByText("-7", { selector: "dd" })).toBeInTheDocument();
  });

  it("shows reopened work only when nonzero and exposes exact rates and limitations", () => {
    const reopened = makeTask({
      id: "reopened",
      status: "planned",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      statusLog: [
        { id: "close", date: "2026-01-02T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "Close", description: "" },
        { id: "reopen", date: "2026-01-03T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "Reopen", description: "" },
      ],
    });
    renderAnalytics([reopened]);

    expect(screen.getByText("Reopened", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText("100%", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText(/Current planner files exclude deleted tasks/)).toHaveAttribute("title", expect.stringContaining("Deleted tasks"));
  });

  it("renders an accessible empty state and keyboard-reachable period controls", () => {
    renderAnalytics([]);

    expect(screen.getByRole("heading", { name: "Flow & Backlog" })).toBeInTheDocument();
    expect(screen.getByText("No task-flow activity is recorded for this period.")).toBeInTheDocument();
    expect(screen.getByText("No UTC activity range is available.")).toBeInTheDocument();
    expect(screen.queryByText("Reopened", { selector: "dt" })).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Active-day period" });
    expect(group).toContainElement(screen.getByRole("button", { name: "60 active days" }));
  });

  it("renders all three accessible charts with non-color series semantics", () => {
    const reopened = makeTask({
      id: "reopened",
      status: "planned",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      statusLog: [
        { id: "close", date: "2026-01-02T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "Close", description: "" },
        { id: "reopen", date: "2026-01-03T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "Reopen", description: "" },
      ],
    });
    renderAnalytics([reopened]);

    expect(screen.getByRole("heading", { name: "Added vs Closed" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scope vs Completion" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Open-task aging" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Added versus closed tasks by active UTC day/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Cumulative scope versus completion/ })).toBeInTheDocument();
    expect(screen.getByText(/Solid bars are additions; striped bars are closures/)).toBeInTheDocument();
    expect(screen.getByText(/solid scope line and dashed completion line/, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Exact added, closed, reopened, and net backlog values by active UTC day")).toBeInTheDocument();
    expect(screen.getByText("Exact cumulative scope, completion, and open backlog values by active UTC day")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Open-task aging buckets" })).toBeInTheDocument();
  });

  it("keeps empty chart states stable and fully labeled", () => {
    renderAnalytics([]);

    expect(screen.getByText("No active-day flow data.")).toBeInTheDocument();
    expect(screen.getByText("No cumulative flow data.")).toBeInTheDocument();
    expect(screen.getByText("No open tasks have an aging anchor at this cutoff.")).toBeInTheDocument();
    for (const label of ["0-7d", "8-14d", "15-30d", "31-60d", "61+d"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("renders a horizontally contained 21-point chart without collapsing labels", () => {
    const tasks = Array.from({ length: 25 }, (_, index) => taskOnDay(index + 1));
    const { container } = renderAnalytics(tasks);

    expect(container.querySelectorAll('[data-responsive-chart="horizontal-scroll"]')).toHaveLength(2);
    const flowSvg = screen.getByRole("img", { name: /^Added versus closed tasks by active UTC day/ });
    expect(flowSvg).toHaveAttribute("width", "100%");
    expect(flowSvg).toHaveAttribute("data-coordinate-width", "420");
    expect(screen.getByText("Exact added, closed, reopened, and net backlog values by active UTC day").closest("table")?.querySelectorAll("tbody tr")).toHaveLength(21);
  });

  it("applies and clears a stable-ID Work Tree drill-down without changing the URL or stored filters", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
    });
    const openTask = makeTask({ id: "open-task", title: "Open analytics task", status: "planned", createdAt: "2026-01-01T00:00:00.000Z" });
    const doneTask = makeTask({ id: "done-task", title: "Done analytics task", status: "done", createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" });
    const phase = makePhase({ tasks: [openTask, doneTask], taskIds: [openTask.id, doneTask.id] });
    const { router } = renderRoute([{
      id: "root",
      loader: () => ({ project: makeProject(), taskFocus: { active: [], pendingResume: [] } }),
      element: <Outlet />,
      children: [{
        index: true,
        loader: () => ({ features: [makeFeature()], phases: [phase], activeTasks: [] }),
        element: <DashboardRoute />,
      }],
    }]);

    await screen.findByRole("heading", { name: "Work Tree" });
    const workTree = screen.getByRole("heading", { name: "Work Tree" }).closest(".surface-card");
    expect(workTree).not.toBeNull();
    expect(within(workTree!).getByRole("link", { name: "Open analytics task" })).toBeVisible();
    expect(within(workTree!).getByRole("link", { name: "Done analytics task" })).toBeVisible();
    const initialSearch = router.state.location.search;

    fireEvent.click(screen.getByRole("button", { name: "Filter Work Tree by Open now" }));

    await waitFor(() => expect(workTree!.querySelector("[data-analytics-work-tree-filter]")).toHaveTextContent("currently open task"));
    expect(within(workTree!).getByRole("link", { name: "Open analytics task" })).toBeVisible();
    expect(within(workTree!).queryByRole("link", { name: "Done analytics task" })).not.toBeInTheDocument();
    expect(router.state.location.search).toBe(initialSearch);

    fireEvent.click(screen.getAllByRole("button", { name: "Clear analytics filter" })[0]);
    await waitFor(() => expect(within(workTree!).getByRole("link", { name: "Done analytics task" })).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: /^Filter Work Tree to 2 tasks added on 2026-01-01/ }));
    await waitFor(() => expect(workTree!.querySelector("[data-analytics-work-tree-filter]")).toHaveTextContent("added on 2026-01-01"));
    expect(router.state.location.search).toBe(initialSearch);
  });

  it("keeps the analytics section between aggregate stats and the Work Tree", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
    });
    const task = taskOnDay(1);
    const phase = makePhase({ tasks: [task], taskIds: [task.id] });
    renderRoute([{
      id: "root",
      loader: () => ({ project: makeProject(), taskFocus: { active: [], pendingResume: [] } }),
      element: <Outlet />,
      children: [{
        index: true,
        loader: () => ({ features: [makeFeature()], phases: [phase], activeTasks: [] }),
        element: <DashboardRoute />,
      }],
    }]);

    const taskStat = await screen.findByText("Tasks", { selector: "p" });
    const analyticsHeading = screen.getByRole("heading", { name: "Flow & Backlog" });
    const workTreeHeading = screen.getByRole("heading", { name: "Work Tree" });
    expect(taskStat.compareDocumentPosition(analyticsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(analyticsHeading.compareDocumentPosition(workTreeHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
