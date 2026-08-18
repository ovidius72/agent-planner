import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loader as phaseDetailLoader } from "../src/routes/phase-detail/loader";
import { HandoffArchiveRoute } from "../src/routes/handoff-archive.route";
import { HandoffRoute } from "../src/routes/handoff.route";
import { RequirementsRoute } from "../src/routes/requirements/route";
import { PhaseRequirementLink } from "../src/components/requirements/phase-requirement-link";
import { installFetchMock, jsonResponse, makeFeature, makePhase, makeRequirement, renderRoute, textResponse } from "./fixtures";

const pending = {
  phaseId: "phase-1",
  featureId: "feature-1",
  compositeRef: "F001/P001",
  updatedAt: "2026-01-01T12:00:00.000Z",
  firstLine: "Resume route tests",
  content: "# Resume route tests\n\nUse the shared fixtures.",
};

describe("handoff and requirement routes", () => {
  it("clears a pending handoff, removes it locally, and keeps archives separate", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const fetchMock = installFetchMock((path, init) => {
      if (path === "/api/phases/phase-1/handoff" && init.method === "DELETE") return jsonResponse({ cleared: true });
      if (path === "/api/handoffs") return jsonResponse({ handoffs: [] });
      throw new Error(`Unexpected request ${path}`);
    });
    renderRoute([{ path: "/", loader: () => ({ handoffs: [pending] }), element: <HandoffRoute /> }]);

    expect(await screen.findAllByText("Resume route tests")).not.toHaveLength(0);
    expect(screen.queryByText("Archived handoffs")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(screen.getByText("No pending phase handoffs.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/phases/phase-1/handoff", expect.objectContaining({ method: "DELETE" }));
  });

  it("surfaces a clear failure without discarding the pending handoff", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    installFetchMock(() => textResponse("The handoff was updated elsewhere", 409));
    renderRoute([{ path: "/", loader: () => ({ handoffs: [pending] }), element: <HandoffRoute /> }]);

    await screen.findAllByText("Resume route tests");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText("The handoff was updated elsewhere")).toBeInTheDocument();
    expect(screen.getAllByText("Resume route tests")).not.toHaveLength(0);
  });

  it("refreshes the pending list when live-sync emits a handoff event", async () => {
    const updated = { ...pending, firstLine: "Updated over WebSocket" };
    installFetchMock((path) => {
      expect(path).toBe("/api/handoffs");
      return jsonResponse({ handoffs: [updated] });
    });
    renderRoute([{ path: "/", loader: () => ({ handoffs: [pending] }), element: <HandoffRoute /> }]);

    await screen.findAllByText("Resume route tests");
    window.dispatchEvent(new CustomEvent("agent-plan:ws-event", { detail: { type: "handoffUpdated" } }));
    expect(await screen.findByText("Updated over WebSocket")).toBeInTheDocument();
  });

  it("renders archive metadata and does not mix archived entries into pending UI", async () => {
    const archived = {
      ...pending,
      file: "handoff-archive/phase-1.md",
      archivedAt: "2026-01-02T12:00:00.000Z",
      reason: "phase completed",
      firstLine: "Archived route test",
    };
    renderRoute([{ path: "/", loader: () => ({ archived: [archived] }), element: <HandoffArchiveRoute /> }]);

    expect(await screen.findByText("Archived route test")).toBeInTheDocument();
    expect(screen.getByText("Reason: phase completed")).toBeInTheDocument();
    expect(screen.getByText("File: handoff-archive/phase-1.md")).toBeInTheDocument();
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("renders empty archive and pending states without stale entries", async () => {
    const { router } = renderRoute([{ path: "/", loader: () => ({ archived: [] }), element: <HandoffArchiveRoute /> }]);
    expect(await screen.findByText("No archived handoffs.")).toBeInTheDocument();
    await router.dispose();
    renderRoute([{ path: "/", loader: () => ({ handoffs: [] }), element: <HandoffRoute /> }]);
    expect(await screen.findByText("No pending phase handoffs.")).toBeInTheDocument();
  });

  it("groups requirements under canonical linked phases and exposes detail navigation", async () => {
    const phase = makePhase({ title: "Delivery phase", number: 3, featureId: "feature-1" });
    const linked = makeRequirement({ title: "Linked outcome", linkedPhaseIds: [phase.id] });
    const stale = makeRequirement({ title: "Stale outcome", linkedPhaseIds: ["gone"] });
    renderRoute([{ path: "/requirements", loader: () => ({ requirements: [linked, stale], phases: [phase] }), element: <RequirementsRoute /> }], "/requirements");

    expect(await screen.findByRole("link", { name: "P003 — Delivery phase" })).toHaveAttribute("href", "/features/feature-1/phases/phase-1");
    expect(screen.getByText("Linked outcome")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requirements without a valid phase" })).toBeInTheDocument();
    expect(screen.getByText("Stale outcome")).toBeInTheDocument();
  });

  it("links phase detail loader data and compact phase links to the requirements anchor", async () => {
    const feature = makeFeature();
    const phase = makePhase();
    const requirement = makeRequirement({ linkedPhaseIds: [phase.id] });
    installFetchMock((path) => {
      if (path === "/api/features/feature-1") return jsonResponse(feature);
      if (path === "/api/phases/phase-1") return jsonResponse(phase);
      if (path === "/api/requirements") return jsonResponse({ requirements: [requirement] });
      throw new Error(`Unexpected request ${path}`);
    });

    await expect(phaseDetailLoader({ params: { featureId: feature.id, phaseId: phase.id } })).resolves.toMatchObject({
      phase: { id: phase.id, linkedRequirements: [requirement] },
    });
    const { container } = renderRoute([{ path: "/", element: <PhaseRequirementLink phaseId={phase.id} phaseTitle={phase.title} count={1} /> }]);
    expect(container.querySelector("a")).toHaveAttribute("href", `/requirements#phase-${phase.id}`);
  });
});
