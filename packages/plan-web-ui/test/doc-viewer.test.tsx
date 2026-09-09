import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormattedText, docViewerHref } from "../src/components/ui/formatted-text";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual };
});

describe("planner document references", () => {
  it("links valid .planner/docs references to the new-tab viewer", () => {
    render(<FormattedText text="Read .planner/docs/cold-resume.md before resuming." />);
    const link = screen.getByRole("link", { name: /Open planner document .planner\/docs\/cold-resume.md in a new tab/ });
    expect(link).toHaveAttribute("href", "/docs/view?path=.planner%2Fdocs%2Fcold-resume.md");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("builds viewer hrefs with encoded paths", () => {
    expect(docViewerHref(".planner/docs/handoff-p001-note.md")).toBe("/docs/view?path=.planner%2Fdocs%2Fhandoff-p001-note.md");
  });

  it("leaves non-planner text without document links", () => {
    render(<FormattedText text="No document reference here." />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
