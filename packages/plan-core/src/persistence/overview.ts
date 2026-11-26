import type { FeatureListSource, PhaseListSource, PlannerListSource, TaskListSource } from "../list-flow.js";
import { deriveFeatureStatusFromPhaseStatuses, derivePhaseStatusFromTaskStatuses } from "../status-rollup.js";
import type { PlannerOverviewSource } from "../planner-overview.js";
import { AcceptedDecisionSchema, ProjectSchema } from "../schema.js";
import type { PersistenceDriver } from "./driver.js";

/** Load normalized identity and live status without reading descriptions or task notes. */
export function readProjectLists(driver: PersistenceDriver, projectId: string) {
  const tasksByPhase = new Map<string, TaskListSource[]>();
  const phasesByFeature = new Map<string, string[]>();
  const dependencyIds = new Map<string, string[]>();
  for (const row of driver.prepare(`
    SELECT d.task_id, d.depends_on FROM task_dependencies d
    JOIN tasks t ON t.id = d.task_id WHERE t.project_id = ?
    ORDER BY d.task_id, d.depends_on
  `).all(projectId)) {
    const id = String(row.task_id);
    const dependencies = dependencyIds.get(id) ?? [];
    dependencies.push(String(row.depends_on));
    dependencyIds.set(id, dependencies);
  }
  const baseFields = "id, number, priority, COALESCE(json_extract(metadata, '$.shortId'), '') AS short_id";
  for (const row of driver.prepare(`
    SELECT ${baseFields}, phase_id, title, status FROM tasks WHERE project_id = ? ORDER BY priority, number
  `).all(projectId)) {
    const phaseId = String(row.phase_id);
    const tasks = tasksByPhase.get(phaseId) ?? [];
    tasks.push({
      id: String(row.id), number: Number(row.number), priority: Number(row.priority),
      shortId: String(row.short_id), title: String(row.title), status: String(row.status), dependsOn: dependencyIds.get(String(row.id)) ?? [],
    });
    tasksByPhase.set(phaseId, tasks);
  }
  const phases: PhaseListSource[] = driver.prepare(`
    SELECT ${baseFields}, feature_id, title FROM phases WHERE project_id = ? ORDER BY priority, number
  `).all(projectId).map((row) => {
    const tasks = tasksByPhase.get(String(row.id)) ?? [];
    const status = derivePhaseStatusFromTaskStatuses(tasks.map((task) => task.status));
    const featureId = typeof row.feature_id === "string" ? row.feature_id : undefined;
    if (featureId) {
      const statuses = phasesByFeature.get(featureId) ?? [];
      statuses.push(status);
      phasesByFeature.set(featureId, statuses);
    }
    return {
      id: String(row.id), number: Number(row.number), priority: Number(row.priority),
      shortId: String(row.short_id), title: String(row.title), ...(featureId ? { featureId } : {}), status, tasks,
    };
  });
  const features: FeatureListSource[] = driver.prepare(`
    SELECT ${baseFields}, name FROM features WHERE project_id = ? ORDER BY priority, number
  `).all(projectId).map((row) => ({
    id: String(row.id), number: Number(row.number), priority: Number(row.priority),
    shortId: String(row.short_id), name: String(row.name),
    status: deriveFeatureStatusFromPhaseStatuses(phasesByFeature.get(String(row.id)) ?? []),
  }));
  return { features, phases, loadFeatures: async () => ({ features }), loadAllPhases: async () => phases } satisfies PlannerListSource & {
    features: FeatureListSource[]; phases: PhaseListSource[];
  };
}

const ProjectOverviewMetadata = ProjectSchema.pick({ description: true, descriptionRef: true, goal: true });

/** Build all sections from the same database transaction and canonical rows. */
export function readProjectOverviewSource(
  driver: PersistenceDriver, projectId: string, knownProject?: Awaited<ReturnType<PlannerOverviewSource["loadProject"]>>,
): PlannerOverviewSource | undefined {
  const row = driver.prepare("SELECT name, metadata, updated_at FROM projects WHERE id = ?").get(projectId);
  if (!row) return undefined;
  const list = readProjectLists(driver, projectId);
  const acceptedDecisions = knownProject?.acceptedDecisions ?? driver.prepare(`
    SELECT id, content, accepted_at FROM decisions
    WHERE project_id = ? AND owner_id = ? AND superseded_by IS NULL ORDER BY accepted_at, id
  `).all(projectId, projectId).map((decision) => AcceptedDecisionSchema.parse({
    ...JSON.parse(String(decision.content)) as object, id: decision.id, acceptedAt: decision.accepted_at,
  }));
  const project = knownProject ?? { ...ProjectOverviewMetadata.parse(JSON.parse(String(row.metadata))), name: String(row.name), acceptedDecisions };
  return {
    ...list,
    loadProject: async () => project,
    loadManifest: async () => ({ updatedAt: String(row.updated_at) }),
  };
}
