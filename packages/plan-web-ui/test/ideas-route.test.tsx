import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { TopNav } from "../src/components/layout/top-nav";
import { IdeasRoute } from "../src/routes/ideas/route";
import type { Idea } from "../src/lib/types";
import { renderRoute } from "./fixtures";

const idea: Idea = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 1,
  shortId: "ABCDE",
  title: "Native notifications",
  description: "Evaluate the platform notification path.",
  targetHref: "/features/feature-1",
  promotion: { targetType: "feature", targetId: "feature-1", targetRef: "F012", promotedAt: "2026-01-01T00:00:00.000Z" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("Ideas Inbox UI", () => {
  it("renders the desktop and mobile navigation entry", () => {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<MemoryRouter><TopNav projectName="Agent Plan" projectRoot="/project" planRoot="/project/.planner" liveStatus="live" /></MemoryRouter>);
    expect(screen.getAllByRole("link", { name: "Ideas" }).length).toBeGreaterThan(0);
  });

  it("renders stable refs, promotion history, and accessible management actions", async () => {
    renderRoute([{ path: "/ideas", loader: () => ({ ideas: [idea] }), element: <IdeasRoute /> }], "/ideas");
    expect(await screen.findByRole("heading", { name: "Ideas Inbox" })).toBeInTheDocument();
    expect(screen.getByText("I001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Promoted to F012" })).toHaveAttribute("href", "/features/feature-1");
    expect(screen.getByRole("button", { name: "Edit Native notifications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Native notifications" })).toBeInTheDocument();
  });
});
