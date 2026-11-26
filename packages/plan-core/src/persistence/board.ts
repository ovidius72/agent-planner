import { normalizeSlug } from "../naming.js";
import {
  FeatureSchema, PhaseSchema, ProjectSchema, TaskSchema, WorkflowRulesSchema,
  type Feature, type Phase,
} from "../schema.js";
import { recommendNextTask } from "../task-selection.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectLists } from "./overview.js";
import { readRegisteredRequirements } from "./requirements.js";
import { taskExecutionState } from "./task-execution.js";
import { readRegisteredDecisionsByOwner } from "./decisions.js";

export function readRegisteredBoard(driver: PersistenceDriver, projectId: string, workspaceId: string) {
  const row = driver.prepare(`
    SELECT p.name, p.metadata, p.updated_at, w.source_path FROM projects p
    JOIN project_workspaces w ON w.project_id = p.id WHERE p.id = ? AND w.id = ?
  `).get(projectId, workspaceId);
  if (!row) return undefined;

  const decisions = readRegisteredDecisionsByOwner(driver, projectId);

  const model = readProjectLists(driver, projectId);
  const tables = {
    task: driver.prepare(`
      SELECT t.id, t.metadata, t.pause_snapshot, t.created_at, t.updated_at,
      s.id AS owner_id, s.ended_at, s.expires_at FROM tasks t
      LEFT JOIN project_sessions s ON s.project_id = t.project_id AND s.id = t.active_owner_session
      WHERE t.project_id = ?
    `),
    phase: driver.prepare("SELECT id, metadata, description_updated_at, created_at, updated_at FROM phases WHERE project_id = ?"),
    feature: driver.prepare("SELECT id, metadata, description_updated_at, created_at, updated_at FROM features WHERE project_id = ?"),
  };
  const rowsById = Object.fromEntries(Object.entries(tables).map(([kind, statement]) => [
    kind, new Map(statement.all(projectId).map((entry) => [String(entry.id), entry])),
  ]));
  const checklist = new Map<string, Array<{ id: string; title: string; checked: boolean }>>();
  for (const item of driver.prepare(`
    SELECT c.task_id, c.item_id, c.text, c.checked FROM task_checklists c
    JOIN tasks t ON t.id = c.task_id WHERE t.project_id = ? ORDER BY c.rowid
  `).all(projectId)) {
    const id = String(item.task_id);
    const entries = checklist.get(id) ?? [];
    entries.push({ id: String(item.item_id), title: String(item.text), checked: Number(item.checked) === 1 });
    checklist.set(id, entries);
  }
  const requirements = readRegisteredRequirements(driver, projectId);

  const now = new Date().toISOString();
  const phases = model.phases.map((phase) => {
    const record = rowsById.phase?.get(phase.id);
    const tasks = phase.tasks.map((task) => {
      const entry = rowsById.task?.get(task.id);
      const metadata = JSON.parse(String(entry?.metadata ?? "{}")) as { executionActivityAt?: string };
      const entity = TaskSchema.parse({
        shortName: normalizeSlug(task.title) || `task-${task.number}`, ...metadata,
        ...task, phaseId: phase.id, acceptedDecisions: decisions.get(task.id) ?? [], checklist: checklist.get(task.id) ?? [],
        pauseSnapshot: entry?.pause_snapshot ? JSON.parse(String(entry.pause_snapshot)) : null,
        activeOwnerSession: "", sessionInfo: [], createdAt: entry?.created_at, updatedAt: entry?.updated_at,
      });
      const executionState = task.status === "in-progress"
        ? taskExecutionState(entry?.owner_id ? entry : undefined, metadata.executionActivityAt ?? entity.updatedAt, now)
        : undefined;
      return { ...entity, executionState };
    });
    const entity = PhaseSchema.parse({
      slug: normalizeSlug(phase.title) || `phase-${phase.number}`, ...JSON.parse(String(record?.metadata ?? "{}")) as object,
      ...phase, featureId: phase.featureId, tasks, taskIds: tasks.map((task) => task.id), acceptedDecisions: decisions.get(phase.id) ?? [],
      descriptionUpdatedAt: record?.description_updated_at ?? "", sessionInfo: [],
      createdAt: record?.created_at, updatedAt: record?.updated_at,
    });
    return { ...entity, tasks, status: phase.status as Phase["status"],
      linkedRequirements: requirements.filter((requirement) => requirement.linkedPhaseIds.includes(phase.id)) };
  });

  const featurePhases = new Map<string, string[]>();
  for (const phase of phases) {
    if (!phase.featureId) continue;
    const entries = featurePhases.get(phase.featureId) ?? [];
    entries.push(phase.id);
    featurePhases.set(phase.featureId, entries);
  }
  const features = model.features.map((feature): Feature => {
    const record = rowsById.feature?.get(feature.id);
    const entity = FeatureSchema.parse({
      ...JSON.parse(String(record?.metadata ?? "{}")) as object, ...feature,
      acceptedDecisions: decisions.get(feature.id) ?? [], phaseIds: featurePhases.get(feature.id) ?? [],
      descriptionUpdatedAt: record?.description_updated_at ?? "", sessionInfo: [],
      createdAt: record?.created_at, updatedAt: record?.updated_at,
    });
    return { ...entity, status: feature.status as Feature["status"] };
  });
  const project = ProjectSchema.parse({
    workflowRules: WorkflowRulesSchema.parse({}), ...JSON.parse(String(row.metadata)) as object,
    name: row.name, acceptedDecisions: decisions.get(projectId) ?? [], workDeviations: [],
  });

  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const summarize = (task: Phase["tasks"][number] & { executionState?: string | undefined }, phase: Phase) => ({
    id: task.id, number: task.number, shortId: task.shortId, title: task.title, status: task.status,
    phaseId: phase.id, phaseNumber: phase.number, featureId: phase.featureId ?? "",
    featureNumber: featureById.get(phase.featureId ?? "")?.number ?? 0, pauseSnapshot: task.pauseSnapshot,
    pendingResume: task.pauseSnapshot !== null, deviationId: "",
    executionState: task.executionState,
  });
  const candidates = phases.flatMap((phase) => phase.tasks.map((task) => summarize(task, phase)));
  const recommendation = recommendNextTask(features, phases);
  const next = recommendation.kind === "priority" ? recommendation.candidate : undefined;
  return {
    project: { ...project, projectRoot: String(row.source_path), planRoot: "", updatedAt: String(row.updated_at) },
    features,
    phases,
    requirements,
    focus: {
      active: candidates.filter((task) => task.status === "in-progress"),
      pendingResume: candidates.filter((task) => task.pendingResume),
      nextWork: next ? summarize(next.task, next.phase) : null,
      nextWorkReason: recommendation.reason,
    },
  };
}
