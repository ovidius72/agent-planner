import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActiveTasksHeader } from "../src/components/layout/app-shell";
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
