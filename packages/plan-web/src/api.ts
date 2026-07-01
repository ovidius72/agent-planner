import type { Phase, Project, RequirementsDocument, Task } from "@agent-plan/core/schema";

const BASE = import.meta.env.DEV ? "/api" : "http://127.0.0.1:3030";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Project ─────────────────────────────────────────────────────────

export function getProject(): Promise<Project> {
  return request("/project");
}

export function updateProject(project: Project): Promise<Project> {
  return request("/project", { method: "PUT", body: JSON.stringify(project) });
}

// ── Requirements ───────────────────────────────────────────────────

export function getRequirements(): Promise<RequirementsDocument> {
  return request("/requirements");
}

export function createRequirement(req: unknown): Promise<unknown> {
  return request("/requirements", { method: "POST", body: JSON.stringify(req) });
}

// ── Phases ─────────────────────────────────────────────────────────

export function getPhases(): Promise<Phase[]> {
  return request("/phases");
}

export function getPhase(id: string): Promise<Phase> {
  return request(`/phases/${id}`);
}

export interface CreatePhaseInput {
  title: string;
  summary?: string;
  description?: string;
}

export function createPhase(input: CreatePhaseInput): Promise<Phase> {
  return request("/phases", { method: "POST", body: JSON.stringify(input) });
}

export function updatePhase(phase: Phase): Promise<Phase> {
  return request(`/phases/${phase.id}`, { method: "PUT", body: JSON.stringify(phase) });
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: Task["status"];
}

export function createTask(phaseId: string, input: CreateTaskInput): Promise<Task> {
  return request(`/phases/${phaseId}/tasks`, { method: "POST", body: JSON.stringify(input) });
}

export function getTask(id: string): Promise<Task> {
  return request(`/tasks/${id}`);
}

export function updateTask(task: Task): Promise<Task> {
  return request(`/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(task) });
}

export function deletePhase(id: string): Promise<unknown> {
  return request(`/phases/${id}`, { method: "DELETE" });
}

// ── Render ────────────────────────────────────────────────────────

export function triggerRender(): Promise<{ files: string[] }> {
  return request("/render", { method: "POST" });
}
