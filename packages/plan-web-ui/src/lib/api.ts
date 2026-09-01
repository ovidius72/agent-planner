import type { ShortcutSpec } from "./shortcuts";
import type { ArchivedHandoffSummary, Feature, HandoffSummary, Idea, MacroTask, Phase, PhaseHandoff, Project, Requirement, Task } from "./types";

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
    pauseSnapshot: task.pauseSnapshot ?? null,
    pauseHistory: task.pauseHistory ?? [],
    startedAt: task.startedAt ?? "",
    completedAt: task.completedAt ?? "",
    descriptionUpdatedAt: task.descriptionUpdatedAt ?? "",
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
    linkedRequirements: phase.linkedRequirements ?? [],
    handoff: phase.handoff ?? "",
    handoffUpdatedAt: phase.handoffUpdatedAt ?? "",
    descriptionUpdatedAt: phase.descriptionUpdatedAt ?? "",
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
    descriptionUpdatedAt: feature.descriptionUpdatedAt ?? "",
  };
}

function normalizeProject(project: Project): Project {
  return {
    ...project,
    descriptionRef: project.descriptionRef ?? "",
    projectGuidelines: {
      content: project.projectGuidelines?.content ?? "",
      updatedAt: project.projectGuidelines?.updatedAt ?? "",
      sessionInfo: project.projectGuidelines?.sessionInfo ?? [],
    },
    scope: project.scope ?? [],
    outOfScope: project.outOfScope ?? [],
    decisions: project.decisions ?? [],
    globalRules: project.globalRules ?? [],
    technologies: project.technologies ?? [],
    tools: project.tools ?? [],
    acceptedDecisions: project.acceptedDecisions ?? [],
    workDeviations: project.workDeviations ?? [],
    planRoot: project.planRoot ?? "",
    projectRoot: project.projectRoot ?? "",
    workflowRules: {
      beforePhaseStart: project.workflowRules?.beforePhaseStart ?? [],
      beforeTaskStart: project.workflowRules?.beforeTaskStart ?? [],
      afterPhaseComplete: project.workflowRules?.afterPhaseComplete ?? [],
    },
  };
}

function normalizeRequirement(requirement: Requirement): Requirement {
  return {
    ...requirement,
    description: requirement.description ?? "",
    macroTasks: requirement.macroTasks ?? [],
    linkedPhaseIds: requirement.linkedPhaseIds ?? [],
  };
}

async function fetchOrThrow(path: string, init?: RequestInit): Promise<Response> {
  // Every call from the web UI is the human supervisor. Tag it so the server
  // skips agent-only governance gates (e.g. feature/phase discuss-before-work).
  const headers = {
    "Content-Type": "application/json",
    "X-Planner-Source": "web-ui",
    ...(init?.headers as Record<string, string> | undefined),
  };
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, headers });
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

export interface ServerInfo {
  mode: "local" | "lan";
  bindHost: string;
  port: number;
  localUrl: string;
  lanUrl?: string | undefined;
}

export interface UiConfig {
  shortcuts?: Partial<Record<"create" | "edit" | "delete" | "submit", ShortcutSpec>>;
  server?: ServerInfo | undefined;
}

export interface ActiveTaskSummary {
  id: string;
  number: number;
  shortId?: string;
  title: string;
  phaseId: string;
  phaseNumber: number;
  featureId: string;
  featureNumber: number;
  status: string;
}

export interface FocusTaskSummary extends ActiveTaskSummary {
  status: Task["status"];
  pauseSnapshot: Task["pauseSnapshot"];
  pendingResume: boolean;
  deviationId: string;
}

export interface TaskFocusSummary {
  active: FocusTaskSummary[];
  pendingResume: FocusTaskSummary[];
}

export async function getProject(): Promise<Project> {
  return normalizeProject(await request("/project"));
}

export interface LegacyProjectContextMigrationPreview {
  version: number;
  hasLegacyContext: boolean;
  guidelinesChanged: boolean;
  acceptedDecisionsChanged: boolean;
  guidelineAdditions: Array<{ source: string; text: string }>;
  acceptedDecisionAdditions: Array<{ id: string; title: string; decision: string }>;
  skippedGuidelineDuplicates: number;
  skippedDecisionDuplicates: number;
  resultingGuidelinesContent: string;
  legacyCounts: { globalRules: number; workflowRules: number; decisions: number };
  fieldsClearedOnApply: string[];
}

export interface LegacyProjectContextMigrationResult {
  applied: boolean;
  preview: LegacyProjectContextMigrationPreview;
  project: Project;
}

export async function updateProject(project: Project): Promise<Project> {
  // Runtime workDeviations live in .local/deviations.json (T299); the project
  // editor must never round-trip them into shared project.json. Empty optional
  // description references are UI defaults, not valid persisted references.
  const { descriptionRef, workDeviations: _workDeviations, ...rest } = project;
  const payload = {
    ...rest,
    ...(descriptionRef ? { descriptionRef } : {}),
    workDeviations: [],
  };
  return normalizeProject(await request("/project", { method: "PUT", body: JSON.stringify(payload) }));
}

export async function previewProjectContextMigration(): Promise<LegacyProjectContextMigrationPreview> {
  return request("/project/context-migration");
}

export async function applyProjectContextMigration(): Promise<LegacyProjectContextMigrationResult> {
  const result = await request<LegacyProjectContextMigrationResult>("/project/context-migration", {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  return { ...result, project: normalizeProject(result.project) };
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

export async function getIdeas(): Promise<Idea[]> {
  return (await request<{ ideas: Idea[] }>("/ideas")).ideas;
}

export async function createIdea(payload: Pick<Idea, "title" | "description">): Promise<Idea> {
  return request("/ideas", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateIdea(idea: Pick<Idea, "id" | "title" | "description">): Promise<Idea> {
  return request(`/ideas/${idea.id}`, { method: "PUT", body: JSON.stringify(idea) });
}

export async function deleteIdea(ideaId: string): Promise<{ deleted: string }> {
  return request(`/ideas/${ideaId}`, { method: "DELETE" });
}

export async function getRequirements(): Promise<Requirement[]> {
  return (await request<{ requirements: Requirement[] }>("/requirements")).requirements.map(normalizeRequirement);
}

export type MacroTaskInput = Pick<MacroTask, "title" | "description" | "status"> & { id?: string };

export async function createRequirement(requirement: Pick<Requirement, "title" | "description" | "status" | "linkedPhaseIds"> & { macroTasks: MacroTaskInput[] }): Promise<Requirement> {
  return normalizeRequirement(await request("/requirements", {
    method: "POST",
    body: JSON.stringify(requirement),
  }));
}

export type RequirementUpdateInput = Omit<Requirement, "macroTasks"> & { macroTasks: MacroTaskInput[] };

export async function updateRequirement(requirement: RequirementUpdateInput): Promise<Requirement> {
  return normalizeRequirement(await request(`/requirements/${requirement.id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...requirement,
      updatedAt: new Date().toISOString(),
    }),
  }));
}

export async function deleteRequirement(requirementId: string): Promise<{ deleted: string }> {
  return request(`/requirements/${requirementId}`, { method: "DELETE" });
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

export async function createTask(phaseId: string, payload: { title: string; description?: string; status?: Task["status"]; checklist?: string[] }): Promise<Task> {
  return normalizeTask(await request(`/phases/${phaseId}/tasks`, { method: "POST", body: JSON.stringify(payload) }));
}

export async function getTask(taskId: string): Promise<Task> {
  return normalizeTask(await request(`/tasks/${taskId}`));
}

export async function updateTask(task: Task): Promise<Task> {
  return normalizeTask(await request(`/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(task) }));
}

/** Start planned work or resume a checkpoint through the canonical lifecycle. */
export async function startTask(taskId: string): Promise<Task> {
  return normalizeTask(await request(`/tasks/${taskId}/start`, { method: "POST" }));
}

export async function deleteTask(taskId: string): Promise<{ deleted: string }> {
  return request(`/tasks/${taskId}`, { method: "DELETE" });
}

export async function getActiveTasks(): Promise<ActiveTaskSummary[]> {
  return request("/tasks/active");
}

export async function getTaskFocus(): Promise<TaskFocusSummary> {
  const result = await request<TaskFocusSummary>("/tasks/focus");
  return { active: result.active ?? [], pendingResume: result.pendingResume ?? [] };
}

export async function listHandoffs(): Promise<HandoffSummary[]> {
  const r = await request<{ handoffs: HandoffSummary[] }>("/handoffs");
  return r.handoffs ?? [];
}

export async function listArchivedHandoffs(): Promise<ArchivedHandoffSummary[]> {
  const r = await request<{ archived: ArchivedHandoffSummary[] }>("/handoffs/archive");
  return r.archived ?? [];
}

export async function getPhaseHandoff(phaseId: string): Promise<PhaseHandoff> {
  return request(`/phases/${phaseId}/handoff`);
}

export async function setPhaseHandoff(phaseId: string, content: string): Promise<PhaseHandoff | { cleared: boolean }> {
  return request(`/phases/${phaseId}/handoff`, { method: "PUT", body: JSON.stringify({ content }) });
}

export async function clearPhaseHandoff(phaseId: string): Promise<{ cleared: boolean }> {
  return request(`/phases/${phaseId}/handoff`, { method: "DELETE" });
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
  backfill: { shortIdsAssigned: number; prioritiesAssigned: number; duplicateShortIds: string[] };
  containment: { changed: number; tasks: number; orphan: number };
  handoffs: { archived: number };
  integrity: { duplicatePhaseIds: string[]; danglingPhaseIds: string[]; duplicateShortIds: string[] };
}

export async function repairPlan(): Promise<RepairReport> {
  return request("/repair", { method: "POST" });
}

export async function getIntegrity(): Promise<RepairReport["integrity"]> {
  return request("/integrity");
}

export type ReorderKind = "feature" | "phase" | "task";

export async function reorder(
  kind: ReorderKind,
  movedId: string,
  beforeId: string | null,
  afterId: string | null,
): Promise<{ ok: boolean; kind: ReorderKind; movedId: string }> {
  return request("/reorder", { method: "POST", body: JSON.stringify({ kind, movedId, beforeId, afterId }) });
}
