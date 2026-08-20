import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { vi } from "vitest";
import type { Feature, Phase, Project, Requirement, Task } from "../src/lib/types";

const timestamp = "2026-01-01T00:00:00.000Z";

export function makeFeature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: "feature-1",
    number: 1,
    shortId: "FTR01",
    priority: 1,
    name: "Example feature",
    description: "Feature context",
    status: "planned",
    discussedAt: "",
    contextReady: false,
    contextReadyReason: "",
    startDate: "",
    endDate: "",
    workDone: "",
    workRemaining: "",
    acceptedDecisions: [],
    phaseIds: ["phase-1"],
    dependsOn: [],
    statusLog: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    phaseId: "phase-1",
    number: 1,
    shortId: "TSK01",
    priority: 1,
    shortName: "example-task",
    title: "Example task",
    status: "planned",
    description: "Task context",
    notes: "",
    statusLog: [],
    decisions: [],
    acceptedDecisions: [],
    checklist: [],
    subtasks: [],
    dependsOn: [],
    pauseSnapshot: null,
    pauseHistory: [],
    startedAt: "",
    completedAt: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

export function makePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: "phase-1",
    featureId: "feature-1",
    number: 1,
    shortId: "PHS01",
    priority: 1,
    slug: "example-phase",
    title: "Example phase",
    status: "planned",
    discussedAt: "",
    contextReady: false,
    contextReadyReason: "",
    summary: "Phase summary",
    description: "Phase context",
    notes: "",
    goals: [],
    nonGoals: [],
    dependencies: [],
    dependsOn: [],
    risks: [],
    openQuestions: [],
    decisions: [],
    acceptedDecisions: [],
    completionCriteria: [],
    taskIds: ["task-1"],
    tasks: [makeTask()],
    linkedRequirements: [],
    handoff: "",
    handoffUpdatedAt: "",
    statusLog: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

export function makeRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: "requirement-1",
    title: "Example requirement",
    description: "Requirement context",
    status: "planned",
    macroTasks: [],
    linkedPhaseIds: ["phase-1"],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: "Example project",
    goal: "Test the Web UI",
    description: "Project context",
    webPort: 3030,
    scope: [],
    outOfScope: [],
    decisions: [],
    globalRules: [],
    technologies: [],
    tools: [],
    acceptedDecisions: [],
    workDeviations: [],
    workflowRules: { beforePhaseStart: [], beforeTaskStart: [], afterPhaseComplete: [] },
    planRoot: "/tmp/example/.planner",
    projectRoot: "/tmp/example",
    ...overrides,
  };
}

export type FetchHandler = (path: string, init: RequestInit) => Response | Promise<Response>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

export function installFetchMock(handler: FetchHandler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url.replace(/^https?:\/\/[^/]+/, ""), init);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export async function requestJson(init?: RequestInit): Promise<Record<string, unknown>> {
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) as Record<string, unknown> : {};
}

export function formRequest(entries: Record<string, string | string[]>): Request {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return new Request("http://test.local/form", { method: "POST", body: data });
}

export function renderRoute(routes: RouteObject[], initialEntry = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  return { router, ...render(<RouterProvider router={router} />) };
}
