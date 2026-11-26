import { registeredBoardScope } from "./registered-board";
import type { ShortcutSpec } from "./shortcuts";
import type { AcceptedDecision, ArchivedHandoffSummary, Feature, HandoffSummary, HierarchicalDescriptionFreshness, Idea, MacroTask, Phase, PhaseHandoff, Project, Requirement, Task } from "./types";

const API_BASE = "/api";
const BUSY_RETRY_MS = 120;
const BUSY_MAX_RETRIES = 40;

function normalizeTask(task: Task): Task {
  return {
    ...task,
    number: task.number ?? 0,
    descriptionRef: task.descriptionRef ?? "",
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

function normalizeFocusTask(task: FocusTaskSummary | null | undefined): FocusTaskSummary | null {
  if (!task) return null;
  return {
    ...task,
    pauseSnapshot: task.pauseSnapshot ?? null,
    pendingResume: Boolean(task.pendingResume),
    deviationId: task.deviationId ?? "",
  };
}

function normalizePhase(phase: Phase): Phase {
  return {
    ...phase,
    discussedAt: phase.discussedAt ?? "",
    contextReady: phase.contextReady ?? false,
    contextReadyReason: phase.contextReadyReason ?? "",
    descriptionRef: phase.descriptionRef ?? "",
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
    descriptionRef: feature.descriptionRef ?? "",
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
    agentPlanVersion: project.agentPlanVersion ?? "",
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

async function requestV2<T>(path: string, init?: RequestInit): Promise<T> {
  const envelope = await request<{ apiVersion: string; data: T }>(`/v2${path}`, init);
  if (!envelope || envelope.apiVersion !== "2" || !("data" in envelope)) {
    throw new Response("The planner service returned an incompatible application response.", { status: 502 });
  }
  return envelope.data;
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
  nextWork: FocusTaskSummary | null;
  nextWorkReason: string;
}

interface RegisteredBoard {
  project: Project;
  features: Feature[];
  phases: Phase[];
  requirements: Requirement[];
  focus: TaskFocusSummary;
}

let boardRequest: { path: string; promise: Promise<RegisteredBoard> } | undefined;

function loadRegisteredBoard(): Promise<RegisteredBoard> | undefined {
  const scope = registeredBoardScope();
  if (!scope) return undefined;
  const path = `/v2${scope.api}/board`;
  if (boardRequest?.path === path) return boardRequest.promise;
  const entry = {
    path,
    promise: request<{ apiVersion: string; data: RegisteredBoard }>(path).then((result) => {
      if (result.apiVersion !== "2" || !result.data) throw new Response("Registered board response is incompatible.", { status: 502 });
      return result.data;
    }).finally(() => { if (boardRequest === entry) boardRequest = undefined; }),
  };
  boardRequest = entry;
  return entry.promise;
}

let boardSession: { path: string; id: Promise<string>; heartbeat: number } | undefined;

function closeBoardSession() {
  if (!boardSession) return;
  window.clearInterval(boardSession.heartbeat);
  boardSession = undefined;
}

async function registeredLifecycle<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const scope = registeredBoardScope();
  if (!scope) throw new Error("Registered workspace scope is required.");
  if (boardSession?.path !== scope.api) {
    closeBoardSession();
    const id = requestV2<{ sessionId: string }>(`${scope.api}/sessions`, {
      method: "POST", body: JSON.stringify({ clientKind: "web" }),
    }).then((session) => session.sessionId);
    const heartbeat = window.setInterval(() => {
      void id.then((sessionId) => requestV2(`${scope.api}/sessions/${sessionId}/heartbeat`, { method: "POST" }))
        .catch(() => { if (boardSession?.id === id) closeBoardSession(); });
    }, 30_000);
    boardSession = { path: scope.api, id, heartbeat };
  }
  const current = boardSession;
  try {
    const sessionId = await current.id;
    return await requestV2(`${scope.api}${path}`, {
      method: "POST", headers: { "X-Planner-Session": sessionId }, body: JSON.stringify(body),
    });
  } catch (error) {
    if (current === boardSession && error instanceof Response && error.status === 409) {
      const payload = await error.clone().json().catch(() => undefined) as { error?: { code?: string } } | undefined;
      if (payload?.error?.code === "SESSION_EXPIRED") closeBoardSession();
    } else if (current === boardSession) {
      closeBoardSession();
    }
    throw error;
  }
}

function notFound(entity: string): never {
  throw new Response(`${entity} not found in this project.`, { status: 404 });
}

export async function getProject(): Promise<Project> {
  const board = await loadRegisteredBoard();
  return normalizeProject(board?.project ?? await request("/project"));
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

export interface ProjectUpdateInput {
  name?: string;
  goal?: string;
  description?: string;
  descriptionRef?: string;
  projectGuidelines?: { content: string };
  expectedGuidelinesUpdatedAt?: string;
}

export async function updateProject(project: ProjectUpdateInput): Promise<Project> {
  if (registeredBoardScope()) {
    await registeredLifecycle("/project/update", { requestId: crypto.randomUUID(), fields: project });
    return getProject();
  }
  const { descriptionRef, ...rest } = project;
  const payload = {
    ...rest,
    ...(descriptionRef ? { descriptionRef } : {}),
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

export type AcceptedDecisionTargetType = "project" | "feature" | "phase" | "task";

export interface AcceptedDecisionTargetInput {
  targetType: AcceptedDecisionTargetType;
  targetRef?: string;
}

export async function createAcceptedDecision(input: AcceptedDecisionTargetInput & Pick<AcceptedDecision, "title" | "decision" | "rationale" | "implementationNotes">): Promise<AcceptedDecision> {
  if (registeredBoardScope()) {
    const { targetType, targetRef, ...fields } = input;
    return (await registeredLifecycle<{ acceptedDecision: AcceptedDecision }>("/accepted-decisions/create", {
      targetType, targetRef, fields, requestId: crypto.randomUUID(),
    })).acceptedDecision;
  }
  const result = await request<{ acceptedDecision: AcceptedDecision }>("/accepted-decisions", { method: "POST", body: JSON.stringify(input) });
  return result.acceptedDecision;
}

export async function updateAcceptedDecision(input: AcceptedDecisionTargetInput & Pick<AcceptedDecision, "id"> & Partial<Pick<AcceptedDecision, "title" | "decision" | "rationale" | "implementationNotes">>): Promise<AcceptedDecision> {
  if (registeredBoardScope()) {
    const { id: decisionId, targetType, targetRef, ...fields } = input;
    return (await registeredLifecycle<{ acceptedDecision: AcceptedDecision }>("/accepted-decisions/update", {
      decisionId, targetType, targetRef, fields, requestId: crypto.randomUUID(),
    })).acceptedDecision;
  }
  const { id, ...payload } = input;
  const result = await request<{ acceptedDecision: AcceptedDecision }>(`/accepted-decisions/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  return result.acceptedDecision;
}

export async function deleteAcceptedDecision(input: AcceptedDecisionTargetInput & Pick<AcceptedDecision, "id">): Promise<{ deleted: true; decisionId: string }> {
  if (registeredBoardScope()) {
    const { targetType, targetRef, id: decisionId } = input;
    await registeredLifecycle("/accepted-decisions/delete", { targetType, targetRef, decisionId, confirmed: true, requestId: crypto.randomUUID() });
    return { deleted: true, decisionId };
  }
  return request(`/accepted-decisions/${input.id}`, { method: "DELETE", body: JSON.stringify({ targetType: input.targetType, targetRef: input.targetRef, confirmed: true }) });
}

export async function getUiConfig(): Promise<UiConfig> {
  if (registeredBoardScope()) return { server: {
    mode: "local", bindHost: window.location.hostname, port: Number(window.location.port), localUrl: window.location.origin,
  } };
  return request("/ui-config");
}

export interface PlannerDocument {
  path: string;
  content: string;
  id?: string;
  revision?: number;
}

export async function getPlannerDocument(path: string): Promise<PlannerDocument> {
  const scope = registeredBoardScope();
  if (scope) {
    const doc = await requestV2<{ id: string; revision: number; content: string }>(`${scope.api}/documents?${new URLSearchParams({ path })}`);
    return { path, id: doc.id, revision: doc.revision, content: doc.content };
  }
  return request<PlannerDocument>(`/docs/view?path=${encodeURIComponent(path)}`);
}

export async function savePlannerDocument(path: string, content: string, version?: { id: string; revision: number }): Promise<{ path: string; saved: boolean }> {
  const scope = registeredBoardScope();
  if (scope) {
    if (!version?.id || !Number.isSafeInteger(version.revision) || version.revision < 1) {
      throw new Error("The document revision is missing. Reload before saving.");
    }
    await requestV2(`${scope.api}/documents/${encodeURIComponent(version.id)}`, {
      method: "PUT", body: JSON.stringify({ content, requestId: crypto.randomUUID(), expectedDocumentRevision: version.revision }),
    });
    return { path, saved: true };
  }
  return request(`/docs/save`, { method: "PUT", body: JSON.stringify({ path, content, confirmed: true }) });
}

export async function getDescriptionFreshness(): Promise<HierarchicalDescriptionFreshness> {
  return request<HierarchicalDescriptionFreshness>("/description-freshness");
}

export async function getFeatures(): Promise<Feature[]> {
  const board = await loadRegisteredBoard();
  return (board?.features ?? await request<Feature[]>("/features")).map(normalizeFeature);
}

export async function getFeature(featureId: string): Promise<Feature> {
  const board = await loadRegisteredBoard();
  return normalizeFeature(board ? board.features.find((feature) => feature.id === featureId) ?? notFound("Feature") : await request(`/features/${featureId}`));
}

export async function createFeature(payload: { name: string; description?: string }): Promise<Feature> {
  if (registeredBoardScope()) {
    const { feature } = await registeredLifecycle<{ feature: Feature }>("/entities/create", {
      kind: "feature", title: payload.name, description: payload.description, requestId: crypto.randomUUID(),
    });
    return normalizeFeature(feature);
  }
  return normalizeFeature(await request("/features", { method: "POST", body: JSON.stringify(payload) }));
}

export type FeatureUpdateInput = Pick<Feature, "id" | "updatedAt"> & Partial<Pick<Feature,
  "name" | "description" | "descriptionRef" | "status" | "startDate" | "endDate" | "priority" | "workDone" | "workRemaining"
>>;

export async function updateFeature(feature: FeatureUpdateInput): Promise<Feature> {
  const { updatedAt: expectedUpdatedAt, ...fields } = feature;
  if (registeredBoardScope()) {
    const updated = await registeredLifecycle<{ feature: Feature }>("/entities/update", {
      kind: "feature", ref: feature.id, updates: { ...fields, expectedUpdatedAt }, requestId: crypto.randomUUID(),
    });
    return normalizeFeature(updated.feature);
  }
  return normalizeFeature(await request(`/features/${feature.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...fields, expectedUpdatedAt }),
  }));
}

export async function deleteFeature(featureId: string): Promise<{ deleted: string }> {
  if (registeredBoardScope()) {
    const result = await registeredLifecycle<{ id: string }>("/entities/delete", {
      kind: "feature", ref: featureId, requestId: crypto.randomUUID(),
    });
    return { deleted: result.id };
  }
  return request(`/features/${featureId}`, { method: "DELETE" });
}

export async function getIdeas(): Promise<Idea[]> {
  return (await requestV2<{ ideas: Idea[] }>(`${registeredBoardScope()?.api ?? ""}/ideas`)).ideas;
}

export async function createIdea(payload: Pick<Idea, "title" | "description">): Promise<Idea> {
  const scope = registeredBoardScope();
  const result = await requestV2<{ idea: Idea }>(`${scope?.api ?? ""}/ideas`, {
    method: "POST", body: JSON.stringify(scope ? { ...payload, requestId: crypto.randomUUID() } : payload),
  });
  return result.idea;
}

export async function updateIdea({ id, ...fields }: Pick<Idea, "id" | "title" | "description">): Promise<Idea> {
  const scope = registeredBoardScope();
  const result = await requestV2<{ idea: Idea }>(`${scope?.api ?? ""}/ideas/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(scope ? { ...fields, requestId: crypto.randomUUID() } : fields),
  });
  return result.idea;
}

export async function deleteIdea(ideaId: string): Promise<{ deleted: string }> {
  const scope = registeredBoardScope();
  const requestId = scope ? `&requestId=${crypto.randomUUID()}` : "";
  const result = await requestV2<{ ideaId: string }>(`${scope?.api ?? ""}/ideas/${encodeURIComponent(ideaId)}?confirmed=true${requestId}`, { method: "DELETE" });
  return { deleted: result.ideaId };
}

export async function getRequirements(): Promise<Requirement[]> {
  const board = await loadRegisteredBoard();
  if (board) return board.requirements.map(normalizeRequirement);
  return (await requestV2<{ requirements: Requirement[] }>("/requirements")).requirements.map(normalizeRequirement);
}

export type MacroTaskInput = Pick<MacroTask, "title" | "description" | "status"> & { id?: string };

export async function createRequirement(requirement: Pick<Requirement, "title" | "description" | "linkedPhaseIds"> & { macroTasks: MacroTaskInput[] }): Promise<Requirement> {
  if (registeredBoardScope()) {
    const result = await registeredLifecycle<{ requirement: Requirement }>("/requirements/create", {
      requestId: crypto.randomUUID(), fields: requirement,
    });
    return normalizeRequirement(result.requirement);
  }
  const result = await requestV2<{ requirement: Requirement }>("/requirements", {
    method: "POST",
    body: JSON.stringify(requirement),
  });
  return normalizeRequirement(result.requirement);
}

export type RequirementUpdateInput = Pick<Requirement, "id" | "updatedAt"> & Partial<Pick<Requirement,
  "title" | "description" | "linkedPhaseIds"
>> & { macroTasks?: MacroTaskInput[] };

export async function updateRequirement(requirement: RequirementUpdateInput): Promise<Requirement> {
  const { id, updatedAt: expectedUpdatedAt, ...fields } = requirement;
  if (registeredBoardScope()) {
    const result = await registeredLifecycle<{ requirement: Requirement }>("/requirements/update", {
      requestId: crypto.randomUUID(), requirementId: id, fields: { ...fields, expectedUpdatedAt },
    });
    return normalizeRequirement(result.requirement);
  }
  const result = await requestV2<{ requirement: Requirement }>(`/requirements/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ ...fields, expectedUpdatedAt }),
  });
  return normalizeRequirement(result.requirement);
}

export async function deleteRequirement(requirementId: string): Promise<{ deleted: string }> {
  if (registeredBoardScope()) {
    const result = await registeredLifecycle<{ requirementId: string }>("/requirements/delete", {
      requestId: crypto.randomUUID(), requirementId,
    });
    return { deleted: result.requirementId };
  }
  const result = await requestV2<{ requirementId: string }>(`/requirements/${encodeURIComponent(requirementId)}`, { method: "DELETE" });
  return { deleted: result.requirementId };
}

export async function getPhases(featureId?: string): Promise<Phase[]> {
  const board = await loadRegisteredBoard();
  if (board) return board.phases.filter((phase) => featureId === undefined || phase.featureId === featureId).map(normalizePhase);
  const query = featureId ? `?featureId=${encodeURIComponent(featureId)}` : "";
  return (await request<Phase[]>(`/phases${query}`)).map(normalizePhase);
}

export async function getPhase(phaseId: string): Promise<Phase> {
  const board = await loadRegisteredBoard();
  return normalizePhase(board ? board.phases.find((phase) => phase.id === phaseId) ?? notFound("Phase") : await request(`/phases/${phaseId}`));
}

export async function createPhase(payload: { title: string; featureId: string; summary?: string; description?: string }): Promise<Phase> {
  if (registeredBoardScope()) {
    const { phase } = await registeredLifecycle<{ phase: Phase }>("/entities/create", {
      ...payload, kind: "phase", featureRef: payload.featureId, requestId: crypto.randomUUID(),
    });
    return normalizePhase(phase);
  }
  return normalizePhase(await request("/phases", { method: "POST", body: JSON.stringify(payload) }));
}

export type PhaseUpdateInput = Pick<Phase, "id" | "updatedAt"> & Partial<Pick<Phase,
  "title" | "status" | "priority" | "summary" | "description" | "descriptionRef" | "featureId" | "goals" | "nonGoals" | "dependencies" | "risks" | "openQuestions" | "decisions" | "completionCriteria"
>>;

export async function updatePhase(phase: PhaseUpdateInput): Promise<Phase> {
  const { updatedAt: expectedUpdatedAt, ...fields } = phase;
  if (registeredBoardScope()) {
    const updated = await registeredLifecycle<{ phase: Phase }>("/entities/update", {
      kind: "phase", ref: phase.id, updates: { ...fields, expectedUpdatedAt }, requestId: crypto.randomUUID(),
    });
    return normalizePhase(updated.phase);
  }
  return normalizePhase(await request(`/phases/${phase.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...fields, expectedUpdatedAt }),
  }));
}

export async function deletePhase(phaseId: string): Promise<{ deleted: string }> {
  if (registeredBoardScope()) {
    const result = await registeredLifecycle<{ phaseId: string }>("/entities/delete", {
      kind: "phase", ref: phaseId, requestId: crypto.randomUUID(),
    });
    return { deleted: result.phaseId };
  }
  return request(`/phases/${phaseId}`, { method: "DELETE" });
}

export async function createTask(phaseId: string, payload: { title: string; description?: string; status?: Task["status"]; checklist?: string[] }): Promise<Task> {
  if (registeredBoardScope()) {
    const { task } = await registeredLifecycle<{ task: Task }>("/entities/create", {
      ...payload, kind: "task", phaseRef: phaseId, requestId: crypto.randomUUID(),
    });
    return normalizeTask(task);
  }
  return normalizeTask(await request(`/phases/${phaseId}/tasks`, { method: "POST", body: JSON.stringify(payload) }));
}

export async function getTask(taskId: string): Promise<Task> {
  const board = await loadRegisteredBoard();
  return normalizeTask(board
    ? board.phases.flatMap((phase) => phase.tasks).find((task) => task.id === taskId) ?? notFound("Task")
    : await request(`/tasks/${taskId}`));
}

export type TaskUpdateInput = Pick<Task, "id" | "phaseId" | "updatedAt"> & Partial<Pick<Task,
  "title" | "status" | "priority" | "description" | "descriptionRef" | "notes" | "decisions" | "checklist"
>> & { motivation?: string };

export async function updateTask(task: TaskUpdateInput): Promise<Task> {
  const { updatedAt: expectedUpdatedAt, ...fields } = task;
  if (registeredBoardScope()) {
    const { decisions, checklist, ...metadata } = fields;
    const updated = await registeredLifecycle<{ task: Task }>("/entities/update", {
      kind: "task", ref: task.id, updates: { ...metadata, checklist: checklist?.map((item) => item.title), expectedUpdatedAt }, requestId: crypto.randomUUID(),
    });
    return normalizeTask(updated.task);
  }
  return normalizeTask(await request(`/tasks/${task.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...fields, expectedUpdatedAt }),
  }));
}

/** Start planned work or resume a checkpoint through the canonical lifecycle. */
export async function startTask(taskId: string): Promise<Task> {
  if (registeredBoardScope()) {
    const read = await registeredLifecycle<{ kind: string; requiredChars?: number }>("/tasks/context", { ref: taskId, maxChars: 1_000_000 });
    if (read.kind !== "context") throw new Response(`Task context requires ${read.requiredChars} characters.`, { status: 409 });
    await registeredLifecycle("/tasks/start", { ref: taskId, requestId: crypto.randomUUID() });
    return getTask(taskId);
  }
  return normalizeTask(await request(`/tasks/${taskId}/start`, { method: "POST" }));
}

/** Reopen completed work through the confirmation-gated lifecycle endpoint. */
export async function reopenTask(taskId: string): Promise<Task> {
  if (registeredBoardScope()) {
    await registeredLifecycle("/tasks/reopen", { ref: taskId, confirmed: true, requestId: crypto.randomUUID() });
    return getTask(taskId);
  }
  const result = await request<{ reopened: true; task: Task }>(`/tasks/${taskId}/reopen`, { method: "POST", body: JSON.stringify({ confirmed: true }) });
  return normalizeTask(result.task);
}

export async function releaseTask(taskId: string): Promise<void> {
  await registeredLifecycle("/tasks/release", { ref: taskId, confirmed: true, requestId: crypto.randomUUID() });
}

export async function setTaskChecklistItem(taskId: string, phaseId: string, itemId: string, checked: boolean): Promise<void> {
  if (registeredBoardScope()) {
    await registeredLifecycle("/tasks/checklist/toggle", { ref: taskId, item: itemId, checked, requestId: crypto.randomUUID() });
    return;
  }
  const current = await getTask(taskId);
  await updateTask({
    ...current, phaseId,
    checklist: current.checklist.map((item) => item.id === itemId ? { ...item, checked } : item),
  });
}

export async function createSubtask(taskId: string, phaseId: string, payload: { title: string; description?: string }): Promise<Task> {
  if (registeredBoardScope()) {
    const current = await getTask(taskId);
    const result = await registeredLifecycle<{ task: Task }>("/entities/update", {
      kind: "task", ref: taskId, requestId: crypto.randomUUID(),
      updates: { expectedUpdatedAt: current.updatedAt, subtasks: [...current.subtasks, payload] },
    });
    return normalizeTask(result.task);
  }
  const result = await request<{ task: Task }>(`/tasks/${taskId}/subtasks`, { method: "POST", body: JSON.stringify({ phaseId, ...payload }) });
  return normalizeTask(result.task);
}

export async function addTaskDependency(taskId: string, phaseId: string, dependsOnId: string): Promise<Task> {
  if (registeredBoardScope()) {
    await registeredLifecycle("/tasks/dependencies", { action: "add", ref: taskId, dependsOn: dependsOnId, requestId: crypto.randomUUID() });
    return getTask(taskId);
  }
  const result = await request<{ task: Task }>(`/tasks/${taskId}/dependencies`, { method: "POST", body: JSON.stringify({ phaseId, dependsOnId }) });
  return normalizeTask(result.task);
}

export async function deleteTaskDependency(taskId: string, phaseId: string, dependencyId: string): Promise<Task> {
  if (registeredBoardScope()) {
    await registeredLifecycle("/tasks/dependencies", { action: "delete", ref: taskId, dependsOn: dependencyId, confirmed: true, requestId: crypto.randomUUID() });
    return getTask(taskId);
  }
  const result = await request<{ task: Task }>(`/tasks/${taskId}/dependencies/${dependencyId}`, { method: "DELETE", body: JSON.stringify({ phaseId, confirmed: true }) });
  return normalizeTask(result.task);
}

export async function deleteTask(taskId: string): Promise<{ deleted: string }> {
  if (registeredBoardScope()) {
    const result = await registeredLifecycle<{ taskId: string }>("/entities/delete", {
      kind: "task", ref: taskId, requestId: crypto.randomUUID(), confirmed: true,
    });
    return { deleted: result.taskId };
  }
  return request(`/tasks/${taskId}`, { method: "DELETE" });
}

export async function getActiveTasks(): Promise<ActiveTaskSummary[]> {
  const board = await loadRegisteredBoard();
  return board?.focus.active ?? request("/tasks/active");
}

export async function getTaskFocus(): Promise<TaskFocusSummary> {
  const board = await loadRegisteredBoard();
  const result = board?.focus ?? await request<TaskFocusSummary>("/tasks/focus");
  return {
    active: (result.active ?? []).map((task) => normalizeFocusTask(task)!),
    pendingResume: (result.pendingResume ?? []).map((task) => normalizeFocusTask(task)!),
    nextWork: normalizeFocusTask(result.nextWork),
    nextWorkReason: result.nextWorkReason ?? "",
  };
}

export async function listHandoffs(): Promise<HandoffSummary[]> {
  const scope = registeredBoardScope();
  if (scope) return loadRegisteredHandoffs<HandoffSummary>(scope.api, false);
  const r = await request<{ handoffs: HandoffSummary[] }>("/handoffs");
  return r.handoffs ?? [];
}

export async function listArchivedHandoffs(): Promise<ArchivedHandoffSummary[]> {
  const scope = registeredBoardScope();
  if (scope) return loadRegisteredHandoffs<ArchivedHandoffSummary>(scope.api, true);
  const r = await request<{ archived: ArchivedHandoffSummary[] }>("/handoffs/archive");
  return r.archived ?? [];
}

async function loadRegisteredHandoffs<T>(scope: string, archived: boolean): Promise<T[]> {
  const handoffs: T[] = [];
  let page = 1;
  let totalPages: number;
  do {
    const result = await requestV2<{ items: T[]; totalPages: number }>(`${scope}/handoffs?page=${page}&pageSize=25&includeContent=true&archived=${archived}`);
    handoffs.push(...result.items);
    totalPages = result.totalPages;
    page++;
  } while (page <= totalPages);
  return handoffs;
}

export async function getPhaseHandoff(phaseId: string): Promise<PhaseHandoff> {
  const scope = registeredBoardScope();
  if (scope) return requestV2(`${scope.api}/handoffs/${encodeURIComponent(phaseId)}`);
  return request(`/phases/${phaseId}/handoff`);
}

export async function setPhaseHandoff(phaseId: string, content: string): Promise<PhaseHandoff | { cleared: boolean }> {
  return request(`/phases/${phaseId}/handoff`, { method: "PUT", body: JSON.stringify({ content }) });
}

export async function clearPhaseHandoff(phaseId: string): Promise<{ cleared: boolean }> {
  if (registeredBoardScope()) {
    return registeredLifecycle("/handoffs/clear", { ref: phaseId, requestId: crypto.randomUUID(), confirmed: true });
  }
  return request(`/phases/${phaseId}/handoff`, { method: "DELETE" });
}

export interface ExportReport {
  markdown: string;
  filePath: string;
}

export async function exportPlan(full = false): Promise<ExportReport> {
  const scope = registeredBoardScope();
  if (scope) return requestV2<ExportReport>(`${scope.api}/project/export?full=${full}`);
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
  if (registeredBoardScope()) {
    return registeredLifecycle("/entities/reorder", { kind, movedId, beforeId, afterId, requestId: crypto.randomUUID() });
  }
  return request("/reorder", { method: "POST", body: JSON.stringify({ kind, movedId, beforeId, afterId }) });
}
