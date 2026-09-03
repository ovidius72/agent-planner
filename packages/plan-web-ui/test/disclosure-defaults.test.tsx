import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Accordion } from "../src/components/ui/accordion";
import { StatusHistoryAccordion } from "../src/components/ui/status-history-accordion";
import { FeatureDetailRoute } from "../src/routes/feature-detail/route";
import { HandoffArchiveRoute } from "../src/routes/handoff-archive.route";
import { HandoffRoute } from "../src/routes/handoff.route";
import { IdeasRoute } from "../src/routes/ideas/route";
import { PhaseDetailRoute } from "../src/routes/phase-detail/route";
import { RequirementsRoute } from "../src/routes/requirements/route";
import { TaskDetailRoute } from "../src/routes/task-detail/route";
import { makeFeature, makePhase, makeRequirement, makeTask, renderRoute } from "./fixtures";

function detailsElements(container: HTMLElement): HTMLDetailsElement[] {
  return Array.from(container.querySelectorAll("details"));
}

function detailsWithSummary(container: HTMLElement, text: string): HTMLDetailsElement {
  const detail = detailsElements(container).find((entry) => entry.querySelector("summary")?.textContent?.includes(text));
  expect(detail, `Expected a details element with summary containing "${text}"`).toBeTruthy();
  return detail!;
}

function expectAllDetailsClosed(container: HTMLElement): void {
  const details = detailsElements(container);
  expect(details.length).toBeGreaterThan(0);
  for (const detail of details) expect(detail.open).toBe(false);
}

describe("closed-by-default disclosures", () => {
  it("keeps the shared Accordion closed unless a caller explicitly opens it", () => {
    const { container, rerender } = render(<Accordion title="Shared disclosure">Hidden content</Accordion>);
    expect(detailsWithSummary(container, "Shared disclosure").open).toBe(false);

    rerender(<Accordion title="Shared disclosure" defaultOpen>Hidden content</Accordion>);
    expect(detailsWithSummary(container, "Shared disclosure").open).toBe(true);
  });

  it("keeps status history closed even when transitions are available", () => {
    const { container } = render(
      <StatusHistoryAccordion
        statusLog={[{
          id: "status-1",
          date: "2026-08-30T10:00:00.000Z",
          fromStatus: "planned",
          toStatus: "in-progress",
          title: "Started",
          description: "Work began.",
        }]}
        currentStatus="in-progress"
        backbone={["planned", "in-progress", "done"]}
      />,
    );

    expect(detailsWithSummary(container, "Status history").open).toBe(false);
    expect(screen.getByRole("columnheader", { name: "Motivation" })).toBeInTheDocument();
  });

  it("starts feature, phase, and task detail accordions closed", async () => {
    const feature = makeFeature({ description: "Feature description", descriptionUpdatedAt: "2026-01-01T12:00:00.000Z", workDone: "Done", workRemaining: "Remaining" });
    const task = makeTask({ status: "in-progress", description: "Task description", descriptionUpdatedAt: "2026-01-01T12:00:00.000Z", startedAt: "2026-01-01T12:00:00.000Z", statusLog: [{ id: "status-1", date: "2026-01-01T12:00:00.000Z", fromStatus: "planned", toStatus: "in-progress", title: "Started", description: "Started work." }] });
    const phase = makePhase({ description: "Phase description", descriptionUpdatedAt: "2026-01-01T12:00:00.000Z", handoff: "# Handoff\n\nResume from tests.", linkedRequirements: [makeRequirement()], tasks: [task] });

    const featureRender = renderRoute([{ path: "/features/:featureId", loader: () => ({ feature, phases: [phase] }), element: <FeatureDetailRoute /> }], "/features/feature-1");
    await screen.findByRole("heading", { name: "Example feature" });
    expect(detailsWithSummary(featureRender.container, "Description").open).toBe(false);
    expect(detailsWithSummary(featureRender.container, "Planning notes").open).toBe(false);
    expect(detailsWithSummary(featureRender.container, "Status history").open).toBe(false);
    featureRender.unmount();

    const phaseRender = renderRoute([{ path: "/features/:featureId/phases/:phaseId", loader: () => ({ feature, phase }), element: <PhaseDetailRoute /> }], "/features/feature-1/phases/phase-1");
    await screen.findByRole("heading", { name: "Example phase" });
    expect(detailsWithSummary(phaseRender.container, "Linked requirements").open).toBe(false);
    expect(detailsWithSummary(phaseRender.container, "Description").open).toBe(false);
    expect(detailsWithSummary(phaseRender.container, "Handoff").open).toBe(false);
    expect(detailsWithSummary(phaseRender.container, "Status history").open).toBe(false);
    phaseRender.unmount();

    const taskRender = renderRoute([{ path: "/features/:featureId/phases/:phaseId/tasks/:taskId", loader: () => ({ feature, phase, task, pendingResume: false }), element: <TaskDetailRoute /> }], "/features/feature-1/phases/phase-1/tasks/task-1");
    await screen.findByRole("heading", { name: "Example task" });
    expect(detailsWithSummary(taskRender.container, "Description").open).toBe(false);
    expect(detailsWithSummary(taskRender.container, "Status history").open).toBe(false);
  });

  it("starts requirement and handoff list disclosures closed", async () => {
    const phase = makePhase({ title: "Delivery phase", number: 3, featureId: "feature-1" });
    const requirement = makeRequirement({ title: "Linked outcome", linkedPhaseIds: [phase.id] });
    const pendingHandoff = {
      phaseId: phase.id,
      featureId: phase.featureId,
      compositeRef: "F001/P003",
      updatedAt: "2026-01-01T12:00:00.000Z",
      firstLine: "Resume route tests",
      content: "# Resume route tests\n\nUse the shared fixtures.",
    };
    const archivedHandoff = { ...pendingHandoff, file: "handoff-archive/phase-1.md", archivedAt: "2026-01-02T12:00:00.000Z", reason: "phase completed" };

    const requirementsRender = renderRoute([{ path: "/requirements", loader: () => ({ requirements: [requirement], phases: [phase] }), element: <RequirementsRoute /> }], "/requirements");
    await screen.findByText("Linked outcome");
    expectAllDetailsClosed(requirementsRender.container);
    requirementsRender.unmount();

    const handoffRender = renderRoute([{ path: "/handoff", loader: () => ({ handoffs: [pendingHandoff] }), element: <HandoffRoute /> }], "/handoff");
    await screen.findAllByText("Resume route tests");
    expectAllDetailsClosed(handoffRender.container);
    handoffRender.unmount();

    const archiveRender = renderRoute([{ path: "/handoff/archive", loader: () => ({ archived: [archivedHandoff] }), element: <HandoffArchiveRoute /> }], "/handoff/archive");
    await screen.findByText("File: handoff-archive/phase-1.md");
    expectAllDetailsClosed(archiveRender.container);
  });

  it("keeps the current Ideas surface free of initially open disclosures", async () => {
    const idea = {
      id: "idea-1",
      number: 1,
      shortId: "IDEA1",
      title: "Native notifications",
      description: "Evaluate platform notification delivery.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { container } = renderRoute([{ path: "/ideas", loader: () => ({ ideas: [idea] }), element: <IdeasRoute /> }], "/ideas");

    await screen.findByRole("heading", { name: "Ideas Inbox" });
    for (const detail of detailsElements(container)) expect(detail.open).toBe(false);
  });
});
