/**
 * T418 (P104/F005) — The locate link must not keep clearing the filter bar.
 *
 * Reported on 2026-09-15: after using the locate icon in the active-tasks
 * header, the Work Tree search box stops working — typed text will not
 * delete and never filters anything.
 *
 * Cause: clearLocateParam strips `?locate=` with history.replaceState, which
 * the router never observes, so locateNum stays set for the life of the
 * mount. The locate effect lists the filter state in its dependency array
 * (it is a retry loop waiting for the row to reach the DOM) and clears three
 * filters in its body — onlyActiveBranches, hideDone and searchQuery — so
 * every later change re-ran that clear.
 *
 * These tests drive the Hide done and Only active toggles rather than the
 * search box: the search input is a third-party contenteditable editor that
 * jsdom cannot type into, while the toggles are plain buttons. All three
 * filters are cleared by the same three lines under the same dependency
 * loop, so a toggle that survives proves the search query survives too.
 */

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { describe, expect, it, beforeEach } from "vitest";
import { WorkTree } from "../src/components/dashboard/work-tree";
import { makeFeature, makePhase, makeTask, stubLocalStorage } from "./fixtures";

const feature = makeFeature({ id: "feature-1", number: 1, name: "Improvements", phaseIds: ["phase-1"] });
const phase = makePhase({
  id: "phase-1",
  number: 104,
  featureId: "feature-1",
  title: "Stop planner tools eliding state",
  tasks: [
    makeTask({ id: "task-417", number: 417, title: "Bound tool results", phaseId: "phase-1" }),
    makeTask({ id: "task-418", number: 418, title: "Stop the locate effect wiping the box", phaseId: "phase-1" }),
  ],
  taskIds: ["task-417", "task-418"],
});

function renderTree(initialEntry: string) {
  const routes: RouteObject[] = [{
    path: "/",
    element: (
      <WorkTree
        features={[feature]}
        phases={[phase]}
        activeTasks={[]}
        projectStorageScope="t418-locate"
      />
    ),
  }];
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return { router, ...render(<RouterProvider router={router} />) };
}

const toggle = (name: string) => screen.getByRole("button", { name });
const isOn = (name: string) => toggle(name).className.includes("bg-[var(--accent)]");

describe("Work Tree locate", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it("leaves the filter bar alone once a locate has finished", async () => {
    renderTree("/?locate=T418");
    // Let the locate effect complete its clear-expand-scroll pass.
    await act(async () => {});

    fireEvent.click(toggle("Hide done"));
    await waitFor(() => expect(isOn("Hide done")).toBe(true));

    // The reported symptom: a second filter change used to revert the first,
    // because the locate effect re-ran and cleared it again.
    fireEvent.click(toggle("Only active"));
    await waitFor(() => expect(isOn("Only active")).toBe(true));
    expect(isOn("Hide done")).toBe(true);

    // And turning one back off has to stick, which is how the user noticed.
    fireEvent.click(toggle("Hide done"));
    await waitFor(() => expect(isOn("Hide done")).toBe(false));
    expect(isOn("Only active")).toBe(true);
  });

  it("still clears a filter that would hide the row it is jumping to", async () => {
    const { router } = renderTree("/");
    await act(async () => {});
    fireEvent.click(toggle("Only active"));
    await waitFor(() => expect(isOn("Only active")).toBe(true));

    // Arriving at a locate clears the filters once, so the located row cannot
    // be hidden behind them. That part of the behaviour stays.
    await act(async () => {
      await router.navigate("/?locate=T418");
    });
    await waitFor(() => expect(isOn("Only active")).toBe(false));
  });

  it("locates a second task in the same visit", async () => {
    const { router } = renderTree("/?locate=T418");
    await act(async () => {});

    fireEvent.click(toggle("Hide done"));
    await waitFor(() => expect(isOn("Hide done")).toBe(true));

    // A fresh navigation is a new locate: it runs again and clears once more.
    // Without keying the "already handled" record to the navigation, a repeat
    // of the same locateNum would look done and never scroll again.
    await act(async () => {
      await router.navigate("/?locate=T417");
    });
    await waitFor(() => expect(isOn("Hide done")).toBe(false));
  });

  it("does not consume the locate while the task data has not arrived", async () => {
    // phases empty: the effect must keep the request pending and retry, which
    // is why it does not mark the locate handled on that path.
    const routes: RouteObject[] = [{
      path: "/",
      element: <WorkTree features={[]} phases={[]} activeTasks={[]} projectStorageScope="t418-empty" />,
    }];
    const router = createMemoryRouter(routes, { initialEntries: ["/?locate=T418"] });
    render(<RouterProvider router={router} />);
    await act(async () => {});

    expect(router.state.location.search).toBe("?locate=T418");
  });
});
