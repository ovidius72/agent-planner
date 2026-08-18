import { describe, expect, it } from "vitest";
import { action as createFeature } from "../src/routes/feature-create.action";
import { action as editFeature } from "../src/routes/feature-edit.action";
import { action as createPhase } from "../src/routes/phase-create.action";
import { action as editPhase } from "../src/routes/phase-edit.action";
import { action as createTask } from "../src/routes/task-create.action";
import { action as editTask } from "../src/routes/task-edit.action";
import { action as createRequirement } from "../src/routes/requirement-create.action";
import { action as editRequirement } from "../src/routes/requirement-edit.action";
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

  it("creates requirements with linked phases and rejects missing status", async () => {
    await expectResponseError(() => createRequirement({ request: formRequest({ title: "Outcome" }) }), 400, "Missing field: status");

    const fetchMock = installFetchMock(async (path, init) => {
      expect(path).toBe("/api/requirements");
      const body = await requestJson(init);
      expect(body).toMatchObject({
        title: "Outcome",
        description: "",
        status: "in-progress",
        linkedPhaseIds: ["phase-1", "phase-2"],
        macroTasks: [],
      });
      expect(body.id).toEqual(expect.any(String));
      return jsonResponse(makeRequirement());
    });
    const result = await createRequirement({ request: formRequest({ title: " Outcome ", status: "in-progress", linkedPhaseIds: [" phase-1 ", "", "phase-2"] }) });
    expect((result as Response).headers.get("Location")).toBe("/requirements");
    expect(fetchMock).toHaveBeenCalledOnce();
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

    await editFeature({ request: formRequest({ name: "Updated", status: "done", priority: "not-a-number" }), params });
    await editPhase({ request: formRequest({ title: "Updated phase", status: "discovery", priority: "Infinity", goals: "One\n Two ", nonGoals: "", dependencies: "", risks: "", openQuestions: "", completionCriteria: "" }), params });

    expect(payloads[0]).toMatchObject({ id: "feature-1", name: "Updated", status: "done", priority: 0 });
    expect(payloads[1]).toMatchObject({ id: "phase-1", title: "Updated phase", status: "discovery", priority: 0, goals: ["One", "Two"] });
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

    const result = await editTask({ request: formRequest({ title: "Retitled", status: "in-progress", priority: "2", checklist: "Keep\nNew item" }), params });
    expect((result as Response).headers.get("Location")).toBe("/features/feature-1/phases/phase-1/tasks/task-1");
    expect(updatePayload).toMatchObject({
      title: "Retitled",
      status: "in-progress",
      priority: 2,
      checklist: [
        { id: "keep", number: 1, title: "Keep", checked: true },
        { id: "check-2-new-item", number: 2, title: "New item", checked: false },
      ],
    });
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

    await editRequirement({ request: formRequest({ title: "Changed", description: "", status: "done", linkedPhaseIds: ["phase-2"] }), params });
    expect(updatePayload).toMatchObject({ title: "Changed", status: "done", linkedPhaseIds: ["phase-2"], macroTasks: requirement.macroTasks });

    installFetchMock((path) => {
      expect(path).toBe("/api/requirements");
      return jsonResponse({ requirements: [] });
    });
    await expectResponseError(() => editRequirement({ request: formRequest({ title: "Missing", status: "planned" }), params }), 404, "Requirement not found: requirement-1");
  });
});
