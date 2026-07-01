import type { Feature, Phase, Project, Task } from "./types";

const BASE = import.meta.env.DEV ? "/api" : "http://127.0.0.1:3030";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/* ── Project ────────────────────────────────────────────────────────── */
export function getProject(): Promise<Project> {
  return request("/project");
}

/* ── Features ───────────────────────────────────────────────────────── */
export function getFeatures(): Promise<Feature[]> {
  return request("/features");
}

export function getFeature(id: string): Promise<Feature> {
  return request(`/features/${id}`);
}

export function createFeature(data: { name: string; description?: string }): Promise<Feature> {
  return request("/features", { method: "POST", body: JSON.stringify(data) });
}

export function updateFeature(feature: Feature): Promise<Feature> {
  return request(`/features/${feature.id}`, { method: "PUT", body: JSON.stringify(feature) });
}

export function deleteFeature(id: string): Promise<{ deleted: string }> {
  return request(`/features/${id}`, { method: "DELETE" });
}

/* ── Phases ─────────────────────────────────────────────────────────── */
export function getPhases(featureId?: string): Promise<Phase[]> {
  const query = featureId ? `?featureId=${featureId}` : "";
  return request(`/phases${query}`);
}

export function getPhase(id: string): Promise<Phase> {
  return request(`/phases/${id}`);
}

export function createPhase(data: { title: string; featureId?: string; summary?: string; description?: string }): Promise<Phase> {
  return request("/phases", { method: "POST", body: JSON.stringify(data) });
}

export function updatePhase(phase: Phase): Promise<Phase> {
  return request(`/phases/${phase.id}`, { method: "PUT", body: JSON.stringify(phase) });
}

export function deletePhase(id: string): Promise<{ deleted: string }> {
  return request(`/phases/${id}`, { method: "DELETE" });
}

/* ── Tasks ──────────────────────────────────────────────────────────── */
export function createTask(phaseId: string, data: { title: string; description?: string; status?: Task["status"] }): Promise<Task> {
  return request(`/phases/${phaseId}/tasks`, { method: "POST", body: JSON.stringify(data) });
}

export function getTask(id: string): Promise<Task> {
  return request(`/tasks/${id}`);
}

export function updateTask(task: Task): Promise<Task> {
  return request(`/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(task) });
}
