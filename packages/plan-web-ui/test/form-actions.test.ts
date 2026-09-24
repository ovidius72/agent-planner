import { describe, expect, it } from "vitest";
import { action as createFeature } from "../src/routes/feature-create.action";
import { action as editFeature } from "../src/routes/feature-edit.action";
import { action as createPhase } from "../src/routes/phase-create.action";
import { action as editPhase } from "../src/routes/phase-edit.action";
import { action as createTask } from "../src/routes/task-create.action";
import { action as editTask } from "../src/routes/task-edit.action";
import { action as startTask } from "../src/routes/task-start.action";
import { action as createRequirement } from "../src/routes/requirement-create.action";
import { action as editRequirement } from "../src/routes/requirement-edit.action";
import { action as mutateAcceptedDecision } from "../src/routes/accepted-decision.action";
import { formRequest, installFetchMock, jsonResponse, makeFeature, makePhase, makeRequirement, makeTask, requestJson, textResponse } from "./fixtures";

const params = { featureId: "feature-1", phaseId: "phase-1", taskId: "task-1", requirementId: "requirement-1" };

async function expectResponseError(run: () => Promise<unknown>, status: number, message: string) {
  try {
    await run();
    expect.unreachable("Expected action to reject with a Response");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect(error).toMatchObject({ status });
    expect(await (error as Response).text()).toBe(message);
  }
}

describe("entity form actions", () => {
  it("blocks missing feature names before calling the API", async () => {
    const fetchMock = installFetchMock(() => jsonResponse({}));
    await expectResponseError(() => createFeature({ request: formRequest({ description: "context" }) }), 400, "Missing field: name");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a feature with trimmed optional context and redirects", async () => {
    const created = makeFeature({ name: "Long feature" });
    const fetchMock = installFetchMock(async (path, init) => {
      expect(path).toBe("/api/features");
      expect(init.method).toBe("POST");
      expect(await requestJson(init)).toEqual({ name: "Long feature", description: "Useful context" });
      return jsonResponse(created);
    });

    const result = await createFeature({ request: formRequest({ name: "  Long feature  ", description: " Useful context " }) });
    expect(result).toMatchObject({ status: 302, headers: expect.any(Headers) });
    expect((result as Response).headers.get("Location")).toBe("/features");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("validates phase route parameters and writes a valid phase payload", async () => {
    await expectResponseError(() => createPhase({ request: formRequest({ title: "Phase" }), params: {} }), 400, "Missing route param: featureId");

    const fetchMock = installFetchMock(async (path, init) => {
      expect(path).toBe("/api/phases");
      expect(await requestJson(init)).toEqual({ featureId: "feature-1", title: "Phase", summary: "", description: "Long context" });
      return jsonResponse(makePhase());
    });
    const result = await createPhase({ request: formRequest({ title: " Phase ", summary: " ", description: " Long context " }), params });
    expect((result as Response).headers.get("Location")).toBe("/features/feature-1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("creates a task with a normalized checklist and planned default", async () => {
    const fetchMock = installFetchMock(async (path, init) => {
      expect(path).toBe("/api/phases/phase-1/tasks");
      expect(await requestJson(init)).toEqual({
        title: "Task",
        description: "",
        status: "planned",
        checklist: ["First", "Second"],
      });
      return jsonResponse(makeTask());
    });
    const result = await createTask({ request: formRequest({ title: " Task ", checklist: " First\n\n Second " }), params });
    expect((result as Response).headers.get("Location")).toBe("/features/feature-1/phases/phase-1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requires task titles and preserves server validation errors", async () => {
    const fetchMock = installFetchMock(() => textResponse("Title already exists", 422));
    await expectResponseError(() => createTask({ request: formRequest({ title: " " }), params }), 400, "Missing field: title");
    expect(fetchMock).not.toHaveBeenCalled();

    await expectResponseError(() => createTask({ request: formRequest({ title: "Duplicate" }), params }), 422, "Title already exists");
  });

  it("creates statusless requirements with linked phases", async () => {
    await expectResponseError(() => createRequirement({ request: formRequest({ title: " " }) }), 400, "Missing field: title");

    const fetchMock = installFetchMock(async (path, init) => {
      expect(path).toBe("/api/requirements");
      const body = await requestJson(init);
      expect(body).toMatchObject({
        title: "Outcome",
        description: "",
        linkedPhaseIds: ["phase-1", "phase-2"],
        macroTasks: [],
      });
      expect(body).not.toHaveProperty("id");
      expect(body).not.toHaveProperty("createdAt");
      expect(body).not.toHaveProperty("updatedAt");
      return jsonResponse(makeRequirement());
    });
    const result = await createRequirement({ request: formRequest({ title: " Outcome ", linkedPhaseIds: [" phase-1 ", "", "phase-2"] }) });
    expect((result as Response).headers.get("Location")).toBe("/requirements");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("creates, updates, and deletes accepted decisions through semantic confirmed routes", async () => {
    const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
    installFetchMock(async (path, init) => {
      requests.push({ path, method: init.method ?? "GET", body: await requestJson(init) });
      if (init.method === "DELETE") return jsonResponse({ deleted: true, decisionId: "decision-1" });
      return jsonResponse({ acceptedDecision: { id: "decision-1", title: "Explicit lifecycle", decision: "Use semantic operations.", rationale: "Preserve metadata.", implementationNotes: "Keep the owner array canonical.", acceptedAt: "2026-09-03T00:00:00.000Z" } });
    });

    const common = { targetType: "feature", targetRef: "feature-1", returnTo: "/features/feature-1" };
    const created = await mutateAcceptedDecision({ request: formRequest({ ...common, intent: "create", title: " Explicit lifecycle ", decision: " Use semantic operations. ", rationale: " Preserve metadata. ", implementationNotes: " Keep the owner array canonical. " }) });
    const updated = await mutateAcceptedDecision({ request: formRequest({ ...common, intent: "update", decisionId: "decision-1", title: " Explicit lifecycle ", decision: " Use semantic operations. ", rationale: " Updated rationale. ", implementationNotes: " Keep the owner array canonical. " }) });
    const deleted = await mutateAcceptedDecision({ request: formRequest({ ...common, intent: "delete", decisionId: "decision-1" }) });

    expect([created, updated, deleted].map((response) => (response as Response).headers.get("Location"))).toEqual(["/features/feature-1", "/features/feature-1", "/features/feature-1"]);
    expect(requests).toEqual([
      { path: "/api/accepted-decisions", method: "POST", body: { targetType: "feature", targetRef: "feature-1", title: "Explicit lifecycle", decision: "Use semantic operations.", rationale: "Preserve metadata.", implementationNotes: "Keep the owner array canonical." } },
      { path: "/api/accepted-decisions/decision-1", method: "PUT", body: { targetType: "feature", targetRef: "feature-1", title: "Explicit lifecycle", decision: "Use semantic operations.", rationale: "Updated rationale.", implementationNotes: "Keep the owner array canonical." } },
      { path: "/api/accepted-decisions/decision-1", method: "DELETE", body: { targetType: "feature", targetRef: "feature-1", confirmed: true } },
    ]);
  });

  it("edits feature and phase records while normalizing malformed numeric input", async () => {
    const feature = makeFeature({ priority: 3 });
    const phase = makePhase({ priority: 4 });
    const payloads: Record<string, unknown>[] = [];
    installFetchMock(async (path, init) => {
      if (path === "/api/features/feature-1" && !init.method) return jsonResponse(feature);
      if (path === "/api/phases/phase-1" && !init.method) return jsonResponse(phase);
      if (init.method === "PUT") {
        payloads.push(await requestJson(init));
        return jsonResponse(path.includes("features") ? feature : phase);
      }
      throw new Error(`Unexpected request ${path}`);
    });

    await editFeature({ request: formRequest({ name: "Updated", status: "done", priority: "not-a-number", descriptionRef: " .planner/docs/p094-pane-hosts-any-app.md " }), params });
    await editPhase({ request: formRequest({ title: "Updated phase", status: "discovery", priority: "Infinity", featureId: "feature-2", descriptionRef: " .planner/docs/phases/phase.md ", goals: "One\n Two ", nonGoals: "", dependencies: "", risks: "", openQuestions: "Question", decisions: "Decision", completionCriteria: "Done" }), params });

    expect(payloads[0]).toMatchObject({ id: "feature-1", name: "Updated", priority: 0, descriptionRef: ".planner/docs/p094-pane-hosts-any-app.md", expectedUpdatedAt: feature.updatedAt });
    expect(payloads[0]).not.toHaveProperty("status");
    expect(payloads[0]).not.toHaveProperty("phaseIds");
    expect(payloads[0]).not.toHaveProperty("acceptedDecisions");
    expect(payloads[1]).toMatchObject({
      id: "phase-1",
      title: "Updated phase",
      priority: 0,
      featureId: "feature-2",
      descriptionRef: ".planner/docs/phases/phase.md",
      goals: ["One", "Two"],
      openQuestions: ["Question"],
      decisions: ["Decision"],
      completionCriteria: ["Done"],
      expectedUpdatedAt: phase.updatedAt,
    });
    expect(payloads[1]).not.toHaveProperty("status");
    expect(payloads[1]).not.toHaveProperty("tasks");
    expect(payloads[1]).not.toHaveProperty("handoff");
  });

  it("starts a task through the lifecycle endpoint", async () => {
    const fetchMock = installFetchMock(async (path, init) => {
      expect(path).toBe("/api/tasks/task-1/start");
      expect(init.method).toBe("POST");
      return jsonResponse(makeTask({ status: "in-progress" }));
    });

    const result = await startTask({ params });
    expect((result as Response).headers.get("Location")).toBe("/features/feature-1/phases/phase-1/tasks/task-1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("edits a task without losing checklist completion state", async () => {
    const task = makeTask({ checklist: [{ id: "keep", number: 1, title: "Keep", checked: true }] });
    let updatePayload: Record<string, unknown> | undefined;
    installFetchMock(async (path, init) => {
      if (path === "/api/tasks/task-1" && !init.method) return jsonResponse(task);
      if (path === "/api/tasks/task-1" && init.method === "PUT") {
        updatePayload = await requestJson(init);
        return jsonResponse(task);
      }
      throw new Error(`Unexpected request ${path}`);
    });

    const result = await editTask({ request: formRequest({
      title: "Retitled",
      status: "planned",
      priority: "2",
      descriptionRef: " .planner/docs/tasks/task.md ",
      notes: " Implementation context ",
      decisions: "First decision\nSecond decision",
      motivation: " Return to planned ",
      checklist: "Keep\nNew item",
    }), params });
    expect((result as Response).headers.get("Location")).toBe("/features/feature-1/phases/phase-1/tasks/task-1");
    expect(updatePayload).toMatchObject({
      id: "task-1",
      phaseId: "phase-1",
      expectedUpdatedAt: task.updatedAt,
      title: "Retitled",
      status: "planned",
      priority: 2,
      descriptionRef: ".planner/docs/tasks/task.md",
      notes: "Implementation context",
      decisions: ["First decision", "Second decision"],
      motivation: "Return to planned",
      checklist: [
        { id: "keep", number: 1, title: "Keep", checked: true },
        { id: "check-2-new-item", number: 2, title: "New item", checked: false },
      ],
    });
    expect(updatePayload).not.toHaveProperty("acceptedDecisions");
    expect(updatePayload).not.toHaveProperty("statusLog");
  });

  it("edits requirements or reports a missing requirement without a partial write", async () => {
    const requirement = makeRequirement({ macroTasks: [{ id: "macro-1", title: "Keep", description: "", status: "planned", createdAt: "", updatedAt: "" }] });
    let updatePayload: Record<string, unknown> | undefined;
    installFetchMock(async (path, init) => {
      if (path === "/api/requirements" && !init.method) return jsonResponse({ requirements: [requirement] });
      if (path === "/api/requirements/requirement-1" && init.method === "PUT") {
        updatePayload = await requestJson(init);
        return jsonResponse(requirement);
      }
      throw new Error(`Unexpected request ${path}`);
    });

    await editRequirement({ request: formRequest({ title: "Changed", description: "", linkedPhaseIds: ["phase-2"] }), params });
    expect(updatePayload).toMatchObject({
      id: "requirement-1",
      expectedUpdatedAt: requirement.updatedAt,
      title: "Changed",
      linkedPhaseIds: ["phase-2"],
      macroTasks: requirement.macroTasks,
    });
    expect(updatePayload).not.toHaveProperty("status");
    expect(updatePayload).not.toHaveProperty("sessionInfo");
    expect(updatePayload).not.toHaveProperty("createdAt");

    installFetchMock((path) => {
      expect(path).toBe("/api/requirements");
      return jsonResponse({ requirements: [] });
    });
    await expectResponseError(() => editRequirement({ request: formRequest({ title: "Missing" }), params }), 404, "Requirement not found: requirement-1");
  });
});
