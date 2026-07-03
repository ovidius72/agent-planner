import type { ShortcutSpec } from "./shortcuts";
import type { Feature, HandoffDocument, Phase, Project, Task } from "./types";

const API_BASE = "/api";
const BUSY_RETRY_MS = 120;
const BUSY_MAX_RETRIES = 40;

function normalizeTask(task: Task): Task {
  return {
    ...task,
    number: task.number ?? 0,
    decisions: task.decisions ?? [],
    acceptedDecisions: task.acceptedDecisions ?? [],
    checklist: task.checklist ?? [],
    subtasks: task.subtasks ?? [],
    startedAt: task.startedAt ?? "",
    completedAt: task.completedAt ?? "",
  };
}

function normalizePhase(phase: Phase): Phase {
  return {
    ...phase,
    discussedAt: phase.discussedAt ?? "",
    contextReady: phase.contextReady ?? false,
    contextReadyReason: phase.contextReadyReason ?? "",
    notes: phase.notes ?? "",
    goals: phase.goals ?? [],
    nonGoals: phase.nonGoals ?? [],
    dependencies: phase.dependencies ?? [],
    risks: phase.risks ?? [],
    openQuestions: phase.openQuestions ?? [],
    decisions: phase.decisions ?? [],
    acceptedDecisions: phase.acceptedDecisions ?? [],
    completionCriteria: phase.completionCriteria ?? [],
    taskIds: phase.taskIds ?? [],
    tasks: (phase.tasks ?? []).map(normalizeTask),
  };
}

function normalizeFeature(feature: Feature): Feature {
  return {
    ...feature,
    number: feature.number ?? 0,
    discussedAt: feature.discussedAt ?? "",
    contextReady: feature.contextReady ?? false,
    contextReadyReason: feature.contextReadyReason ?? "",
    acceptedDecisions: feature.acceptedDecisions ?? [],
    phaseIds: feature.phaseIds ?? [],
  };
}

function normalizeProject(project: Project): Project {
  return {
    ...project,
    scope: project.scope ?? [],
    outOfScope: project.outOfScope ?? [],
    decisions: project.decisions ?? [],
    globalRules: project.globalRules ?? [],
    technologies: project.technologies ?? [],
    tools: project.tools ?? [],
    acceptedDecisions: project.acceptedDecisions ?? [],
    planRoot: project.planRoot ?? "",
    projectRoot: project.projectRoot ?? "",
    workflowRules: {
      beforePhaseStart: project.workflowRules?.beforePhaseStart ?? [],
      beforeTaskStart: project.workflowRules?.beforeTaskStart ?? [],
      afterPhaseComplete: project.workflowRules?.afterPhaseComplete ?? [],
    },
  };
}

async function fetchOrThrow(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new Response("Planner web server unavailable. Pi or planner-web may have stopped. Restart the planner web UI or Pi, then reload this page.", {
      status: 503,
      statusText: "Planner web server unavailable",
    });
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response = await fetchOrThrow(path, init);

  // Retry on 503 plan-busy (agent is mutating .planner/ files). Brief pauses, not a crash.
  let retries = 0;
  while (response.status === 503 && retries < BUSY_MAX_RETRIES) {
    await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
    retries += 1;
    response = await fetchOrThrow(path, init);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Response(text || response.statusText, { status: response.status, statusText: response.statusText });
  }

  return response.json() as Promise<T>;
}

export interface UiConfig {
  shortcuts?: Partial<Record<"create" | "edit" | "delete" | "submit", ShortcutSpec>>;
}

export interface ActiveTaskSummary {
  id: string;
  number: number;
  title: string;
  phaseId: string;
  featureId: string;
  status: string;
}

export async function getProject(): Promise<Project> {
  return normalizeProject(await request("/project"));
}

export async function updateProject(project: Project): Promise<Project> {
  return normalizeProject(await request("/project", { method: "PUT", body: JSON.stringify(project) }));
}

export async function getUiConfig(): Promise<UiConfig> {
  return request("/ui-config");
}

export async function getFeatures(): Promise<Feature[]> {
  return (await request<Feature[]>("/features")).map(normalizeFeature);
}

export async function getFeature(featureId: string): Promise<Feature> {
  return normalizeFeature(await request(`/features/${featureId}`));
}

export async function createFeature(payload: { name: string; description?: string }): Promise<Feature> {
  return normalizeFeature(await request("/features", { method: "POST", body: JSON.stringify(payload) }));
}

export async function updateFeature(feature: Feature): Promise<Feature> {
  return normalizeFeature(await request(`/features/${feature.id}`, { method: "PUT", body: JSON.stringify(feature) }));
}

export async function deleteFeature(featureId: string): Promise<{ deleted: string }> {
  return request(`/features/${featureId}`, { method: "DELETE" });
}

export async function getPhases(featureId?: string): Promise<Phase[]> {
  const query = featureId ? `?featureId=${encodeURIComponent(featureId)}` : "";
  return (await request<Phase[]>(`/phases${query}`)).map(normalizePhase);
}

export async function getPhase(phaseId: string): Promise<Phase> {
  return normalizePhase(await request(`/phases/${phaseId}`));
}

export async function createPhase(payload: { title: string; featureId: string; summary?: string; description?: string }): Promise<Phase> {
  return normalizePhase(await request("/phases", { method: "POST", body: JSON.stringify(payload) }));
}

export async function updatePhase(phase: Phase): Promise<Phase> {
  return normalizePhase(await request(`/phases/${phase.id}`, { method: "PUT", body: JSON.stringify(phase) }));
}

export async function deletePhase(phaseId: string): Promise<{ deleted: string }> {
  return request(`/phases/${phaseId}`, { method: "DELETE" });
}

export async function createTask(phaseId: string, payload: { title: string; description?: string; status?: Task["status"] }): Promise<Task> {
  return normalizeTask(await request(`/phases/${phaseId}/tasks`, { method: "POST", body: JSON.stringify(payload) }));
}

export async function getTask(taskId: string): Promise<Task> {
  return normalizeTask(await request(`/tasks/${taskId}`));
}

export async function updateTask(task: Task): Promise<Task> {
  return normalizeTask(await request(`/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(task) }));
}

export async function deleteTask(taskId: string): Promise<{ deleted: string }> {
  return request(`/tasks/${taskId}`, { method: "DELETE" });
}

export async function getActiveTasks(): Promise<ActiveTaskSummary[]> {
  return request("/tasks/active");
}

export async function getHandoff(): Promise<HandoffDocument> {
  return request("/handoff");
}

export async function deleteHandoff(): Promise<{ deleted: boolean }> {
  return request("/handoff", { method: "DELETE" });
}

export interface ExportReport {
  markdown: string;
  filePath: string;
}

export async function exportPlan(full = false): Promise<ExportReport> {
  return request(`/export?full=${full ? "true" : "false"}`);
}

export interface RepairReport {
  migrated: { renamed: number; repaired: number; inferred: number };
  integrity: { duplicatePhaseIds: string[]; danglingPhaseIds: string[] };
}

export async function repairPlan(): Promise<RepairReport> {
  return request("/repair", { method: "POST" });
}

export async function getIntegrity(): Promise<RepairReport["integrity"]> {
  return request("/integrity");
}
