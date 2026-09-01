import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusHistoryAccordion } from "../src/components/ui/status-history-accordion";

describe("StatusHistoryAccordion", () => {
  it("renders recorded status-log descriptions in the Motivation column", () => {
    render(
      <StatusHistoryAccordion
        statusLog={[{
          id: "status-1",
          date: "2026-08-30T10:00:00.000Z",
          fromStatus: "waiting",
          toStatus: "planned",
          title: "Dependency sequence completed",
          description: "The prerequisite sequence is complete; this task is ready to resume.",
        }]}
        currentStatus="planned"
        backbone={["planned", "in-progress", "done"]}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Motivation" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Waiting Planned/ });
    expect(within(row).getByText("The prerequisite sequence is complete; this task is ready to resume.")).toBeInTheDocument();
  });

  it("shows an em dash when a recorded or inferred transition has no motivation", () => {
    render(
      <StatusHistoryAccordion
        statusLog={[]}
        currentStatus="in-progress"
        backbone={["planned", "in-progress", "done"]}
        startedAt="2026-08-30T10:00:00.000Z"
      />,
    );

    const row = screen.getByRole("row", { name: /Planned In Progress/ });
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
});
