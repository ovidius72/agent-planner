import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DetailFilters, type DetailFilterValue } from "../src/components/ui/detail-filters";
import { passesDetailFilters, matchesListQuery } from "../src/lib/list-filtering";

const base: DetailFilterValue = { query: "", status: "", hideDone: false, hidePlanned: false, onlyActive: false };

function renderFilters(props: Partial<Parameters<typeof DetailFilters>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <MemoryRouter>
      <DetailFilters entityKind="task" value={base} onChange={onChange} {...props} />
    </MemoryRouter>,
  );
  return { onChange, ...utils };
}

describe("DetailFilters component", () => {
  it("renders the three WorkTree toggles + search + status, with no Apply button", () => {
    renderFilters();
    expect(screen.getByRole("button", { name: "Hide Done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide Planned" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Only active" })).toBeInTheDocument();
    expect(screen.getByLabelText(/search/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument();
  });

  it("debounces the text input and calls onChange with the query after ~250ms (no per-keystroke submit)", () => {
    vi.useFakeTimers();
    try {
      const { onChange } = renderFilters();
      const input = screen.getByLabelText(/search/i) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "auth" } });
      // Still within the debounce window: nothing committed yet.
      expect(onChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ query: "auth" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("toggling Hide Done calls onChange immediately with hideDone=true", () => {
    const { onChange } = renderFilters();
    fireEvent.click(screen.getByRole("button", { name: "Hide Done" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hideDone: true }));
  });

  it("changing the status select calls onChange immediately", () => {
    const { onChange } = renderFilters({ statusOptions: [{ value: "done", label: "Done" }] });
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: "done" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });

  it("Clear resets the query and every toggle", () => {
    const { onChange } = renderFilters({ value: { ...base, query: "x", hideDone: true } });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith({ query: "", status: "", hideDone: false, hidePlanned: false, onlyActive: false });
  });
});

describe("passesDetailFilters", () => {
  it("hideDone excludes done entities", () => {
    expect(passesDetailFilters({ status: "done" }, { ...base, hideDone: true }, ["in-progress"])).toBe(false);
    expect(passesDetailFilters({ status: "in-progress" }, { ...base, hideDone: true }, ["in-progress"])).toBe(true);
  });

  it("hidePlanned excludes planned entities", () => {
    expect(passesDetailFilters({ status: "planned" }, { ...base, hidePlanned: true }, ["in-progress"])).toBe(false);
    expect(passesDetailFilters({ status: "in-progress" }, { ...base, hidePlanned: true }, ["in-progress"])).toBe(true);
  });

  it("onlyActive keeps in-progress tasks and excludes planned", () => {
    expect(passesDetailFilters({ status: "in-progress" }, { ...base, onlyActive: true }, ["in-progress"])).toBe(true);
    expect(passesDetailFilters({ status: "planned" }, { ...base, onlyActive: true }, ["in-progress"])).toBe(false);
  });

  it("onlyActive for phases counts in-progress AND discovery as active", () => {
    expect(passesDetailFilters({ status: "in-progress" }, { ...base, onlyActive: true }, ["in-progress", "discovery"])).toBe(true);
    expect(passesDetailFilters({ status: "discovery" }, { ...base, onlyActive: true }, ["in-progress", "discovery"])).toBe(true);
    expect(passesDetailFilters({ status: "planned" }, { ...base, onlyActive: true }, ["in-progress", "discovery"])).toBe(false);
  });

  it("exact status filter takes precedence over the active/done/planned toggles", () => {
    expect(passesDetailFilters({ status: "done" }, { ...base, status: "done" }, ["in-progress"])).toBe(true);
    expect(passesDetailFilters({ status: "planned" }, { ...base, status: "done" }, ["in-progress"])).toBe(false);
  });

  it("empty filters pass through", () => {
    expect(passesDetailFilters({ status: "done" }, base, ["in-progress"])).toBe(true);
    expect(passesDetailFilters({ status: "planned" }, base, ["in-progress"])).toBe(true);
  });
});

describe("matchesListQuery — title / number / shortId", () => {
  it("matches against the entity title (case-insensitive)", () => {
    expect(matchesListQuery("auth", ["Auth flow", "12", "A1B2C"])).toBe(true);
    expect(matchesListQuery("billing", ["Auth flow", "12", "A1B2C"])).toBe(false);
  });

  it("matches against the entity number and shortId", () => {
    expect(matchesListQuery("12", ["Some title", "12", "A1B2C"])).toBe(true);
    expect(matchesListQuery("a1b2c", ["Some title", "99", "A1B2C"])).toBe(true);
  });

  it("treats a blank query as a pass-through", () => {
    expect(matchesListQuery("   ", ["Anything"])).toBe(true);
  });
});
