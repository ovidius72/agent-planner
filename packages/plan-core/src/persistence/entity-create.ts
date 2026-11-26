import { randomUUID } from "node:crypto";
import { clampSlug, createChecklistItemId, createShortId, formatFeatureRef, formatPhaseRef, taskCompositeRef } from "../naming.js";
import { findPhaseByRef, resolveFeatureRefStrict } from "../refs.js";
import { FeatureSchema, PhaseSchema, TaskSchema } from "../schema.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectLists } from "./overview.js";
import type { ProjectCaller } from "./project-access.js";
import { reconcileLeafMutation } from "./reconciliation.js";

type EntityKind = "feature" | "phase" | "task";

export interface RegisteredEntityCreate {
  kind: EntityKind;
  title: string;
  description: string;
  requestId: string;
  sessionId: string;
  featureRef?: string | undefined;
  phaseRef?: string | undefined;
  summary?: string | undefined;
  checklist?: string[] | undefined;
  status?: string | undefined;
  supervisor: boolean;
}

const identityColumns = {
  feature: { table: "features", counter: "nextFeatureNumber", parent: "" },
  phase: { table: "phases", counter: "nextPhaseNumber", parent: "feature_id" },
  task: { table: "tasks", counter: "nextTaskNumber", parent: "phase_id" },
} as const;

function allocateIdentity(driver: PersistenceDriver, projectId: string, kind: EntityKind, parentId?: string) {
  const { table, counter, parent } = identityColumns[kind];
  const scopes: string[] = [projectId];
  const where = parent && parentId ? ` AND ${parent} = ?` : "";
  if (where && parentId) scopes.push(parentId);
  const priority = Number(driver.prepare(`SELECT MAX(priority) AS value FROM ${table} WHERE project_id = ?${where}`).get(...scopes)?.value ?? 0) + 1;
  const maximum = Number(driver.prepare(`SELECT MAX(number) AS value FROM ${table} WHERE project_id = ?`).get(projectId)?.value ?? 0);
  const next = Number(driver.prepare("SELECT json_extract(metadata, ?) AS value FROM projects WHERE id = ?").get(`$.${counter}`, projectId)?.value ?? 1);
  const number = Math.max(maximum + 1, next);
  const id = randomUUID();
  const assigned = new Set(driver.prepare(`
    SELECT json_extract(metadata, '$.shortId') AS shortId FROM features WHERE project_id = ?
    UNION SELECT json_extract(metadata, '$.shortId') FROM phases WHERE project_id = ?
    UNION SELECT json_extract(metadata, '$.shortId') FROM tasks WHERE project_id = ?
    UNION SELECT json_extract(idea.value, '$.shortId') FROM projects p, json_each(p.metadata, '$.ideasInbox.ideas') idea WHERE p.id = ?
  `).all(projectId, projectId, projectId, projectId).map((row) => String(row.shortId ?? "")));
  const shortId = createShortId(assigned, `${kind}:${id}`);
  driver.prepare("UPDATE projects SET metadata = json_set(metadata, ?, ?) WHERE id = ?").run(`$.${counter}`, number + 1, projectId);
  return { id, number, priority, shortId };
}

export function createRegisteredEntity(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredEntityCreate) {
  const { kind } = input;
  return executeCommand(driver, {
    projectId: caller.projectId, requestId: input.requestId, operation: `${kind}.create`,
    payload: input,
  }, ({ recordRevision }) => {
    const projectId = caller.projectId;
    const now = new Date().toISOString();
    const session = driver.prepare(`
      SELECT id FROM project_sessions WHERE project_id = ? AND workspace_id = ? AND principal_id = ?
      AND id = ? AND ended_at IS NULL AND expires_at > ?
    `).get(projectId, caller.workspaceId, caller.principalId, input.sessionId, now);
    if (!session) throw new CommandRefusal("SESSION_EXPIRED", "A live session is required to create planner entities.");
    const title = input.title.trim();
    if (!title) throw new CommandRefusal(kind === "feature" ? "FEATURE_NAME_REQUIRED" : `${kind.toUpperCase()}_TITLE_REQUIRED`, "A name or title is required.");
    const initialStatus = kind === "phase" ? "draft" : "planned";
    if (input.status && input.status !== initialStatus) {
      throw new CommandRefusal("INITIAL_STATUS_INVALID", `Create this ${kind} with status ${initialStatus}, then use its lifecycle operations.`);
    }
    const description = input.description.trim();
    if (!input.supervisor && description.length < 50) {
      throw new CommandRefusal(`${kind.toUpperCase()}_DESCRIPTION_TOO_SHORT`, "Provide at least 50 characters of implementation context and behaviors to preserve.");
    }
    if (kind === "feature") {
      const feature = FeatureSchema.parse({
        ...allocateIdentity(driver, projectId, kind), name: title, description, descriptionUpdatedAt: now, createdAt: now, updatedAt: now,
      });
      driver.prepare(`
        INSERT INTO features(id, project_id, number, priority, status, name, description_updated_at, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?)
      `).run(feature.id, projectId, feature.number, feature.priority, title, now, JSON.stringify(feature), now, now);
      recordRevision();
      publishEvent(driver, projectId, "feature.created", { featureId: feature.id });
      const ref = formatFeatureRef(feature.number);
      return { feature: { ...feature, status: "planned" }, ref, message: `Feature created: ${ref} — ${title}` };
    }

    const model = readProjectLists(driver, projectId);
    const inferredPhase = kind === "task" ? findPhaseByRef(model.phases, model.features, input.phaseRef ?? "") : undefined;
    const featureRef = input.featureRef?.trim() || (input.supervisor ? inferredPhase?.featureId : undefined);
    if (!featureRef) throw new CommandRefusal(`${kind.toUpperCase()}_FEATURE_REQUIRED`, "A feature reference is required.");
    const resolvedFeature = resolveFeatureRefStrict(model.features, featureRef);
    if (!resolvedFeature.ok) throw new CommandRefusal(`${kind.toUpperCase()}_FEATURE_NOT_FOUND`, resolvedFeature.error);
    const { feature } = resolvedFeature;
    if (kind === "phase") {
      const identity = allocateIdentity(driver, projectId, kind, feature.id);
      const phase = PhaseSchema.parse({
        ...identity, featureId: feature.id, title, slug: clampSlug(title, 30, `phase-${identity.number}`),
        description, descriptionUpdatedAt: now, summary: input.summary?.trim(), createdAt: now, updatedAt: now,
      });
      driver.prepare(`
        INSERT INTO phases(id, project_id, feature_id, number, priority, status, title, description_updated_at, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?)
      `).run(phase.id, projectId, feature.id, phase.number, phase.priority, title, now, JSON.stringify(phase), now, now);
      recordRevision();
      publishEvent(driver, projectId, "phase.created", { featureId: feature.id, phaseId: phase.id });
      const ref = formatPhaseRef(phase.number, feature.number);
      return { phase: { ...phase, status: "draft" }, ref, message: `Phase created: ${ref} — ${title}` };
    }

    if (!inferredPhase) throw new CommandRefusal("TASK_PHASE_NOT_FOUND", "The specified phase could not be resolved.");
    if (inferredPhase.featureId !== feature.id) throw new CommandRefusal("TASK_PHASE_MISMATCH", "The phase does not belong to the specified feature.");
    const identity = allocateIdentity(driver, projectId, kind, inferredPhase.id);
    const task = TaskSchema.parse({
      ...identity, title, phaseId: inferredPhase.id, shortName: clampSlug(title, 30, `task-${identity.number}`),
      status: "planned", description, descriptionUpdatedAt: now, checklist: input.checklist ?? [], createdAt: now, updatedAt: now,
    });
    driver.prepare(`
      INSERT INTO tasks(id, project_id, phase_id, number, priority, status, title, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?)
    `).run(task.id, projectId, task.phaseId, task.number, task.priority, title, JSON.stringify({ ...task, checklist: [] }), now, now);
    const addItem = driver.prepare("INSERT INTO task_checklists(task_id, item_id, text, checked) VALUES (?, ?, ?, 0)");
    for (const [index, item] of task.checklist.entries()) addItem.run(task.id, createChecklistItemId(task.id, index + 1, item.title), item.title);
    recordRevision();
    const impact = reconcileLeafMutation(driver, { projectId, kind: "task.created", taskId: task.id });
    publishEvent(driver, projectId, "task.created", { taskId: task.id, phaseId: task.phaseId, impact });
    const ref = taskCompositeRef(task, inferredPhase, model.features);
    return { task, ref, message: `Task created: ${ref} — ${title}` };
  }, caller);
}
