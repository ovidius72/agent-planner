import { z } from "zod";
import { createRequirementId } from "../naming.js";
import { findPhaseByRef } from "../refs.js";
import { MacroTaskStatusSchema, RequirementSchema } from "../schema.js";
import { reconcileRequirementMacroTasks, RequirementMacroTaskError } from "../requirement-macro-tasks.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectLists } from "./overview.js";
import type { ProjectCaller } from "./project-access.js";

const fields = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  linkedPhaseIds: z.array(z.string()).optional(),
  macroTasks: z.array(z.object({
    id: z.string().min(1).optional(),
    title: z.string(),
    description: z.string().optional(),
    status: MacroTaskStatusSchema.optional(),
  })).optional(),
  expectedUpdatedAt: z.string().optional(),
}).strict();

export interface RegisteredRequirementCommand {
  action: "create" | "update" | "delete";
  requirementId?: string | undefined;
  requestId: string;
  fields: unknown;
}

export function readRegisteredRequirements(driver: PersistenceDriver, projectId: string, requirementId?: string) {
  const links = new Map<string, string[]>();
  for (const link of driver.prepare(`
    SELECT l.requirement_id, l.entity_id FROM entity_requirements l
    JOIN phases p ON p.id = l.entity_id
    WHERE l.entity_kind = 'phase' AND p.project_id = ? ORDER BY l.rowid
  `).all(projectId)) {
    const id = String(link.requirement_id);
    const entries = links.get(id) ?? [];
    entries.push(String(link.entity_id));
    links.set(id, entries);
  }
  return driver.prepare(`
    SELECT id, title, content FROM requirements WHERE project_id = ?
    AND (? IS NULL OR id = ?) ORDER BY number
  `).all(projectId, requirementId ?? null, requirementId ?? null).map((row) => RequirementSchema.parse({
    ...JSON.parse(String(row.content)) as object, id: row.id, title: row.title,
    linkedPhaseIds: links.get(String(row.id)) ?? [], sessionInfo: [],
  }));
}

export function readRegisteredPhaseRequirements(driver: PersistenceDriver, projectId: string, phaseId: string, featureId?: string) {
  const ids = new Set(driver.prepare(`
    SELECT l.requirement_id FROM entity_requirements l WHERE
    (l.entity_kind = 'feature' AND l.entity_id = ?) OR
    (l.entity_kind = 'phase' AND l.entity_id IN (
      SELECT id FROM phases WHERE project_id = ? AND (id = ? OR feature_id = ?)
    ))
  `).all(featureId ?? "", projectId, phaseId, featureId ?? "").map((row) => String(row.requirement_id)));
  return readRegisteredRequirements(driver, projectId).filter((requirement) => ids.has(requirement.id));
}

function phaseLinks(driver: PersistenceDriver, projectId: string, refs: string[]) {
  if (refs.length === 0) {
    throw new CommandRefusal("REQUIREMENT_PHASE_LINK_INVALID", "Provide at least one linked phase reference.");
  }
  const model = readProjectLists(driver, projectId);
  return [...new Set(refs.map((ref) => {
    const phase = findPhaseByRef(model.phases, model.features, ref.trim());
    if (!phase) throw new CommandRefusal("REQUIREMENT_PHASE_LINK_INVALID", `Linked phase not found: ${ref}`);
    return phase.id;
  }))];
}

export function mutateRegisteredRequirement(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredRequirementCommand) {
  const { projectId } = caller;
  const { action, requirementId } = input;
  return executeCommand(driver, {
    projectId, requestId: input.requestId, operation: `requirement.${action}`, payload: input,
  }, ({ recordRevision }) => {
    const current = requirementId ? readRegisteredRequirements(driver, projectId, requirementId)[0] : undefined;
    if (!current && action !== "create") throw new CommandRefusal("REQUIREMENT_NOT_FOUND", "The requirement could not be resolved.");
    if (current && action === "delete") {
      driver.prepare("DELETE FROM entity_requirements WHERE requirement_id = ?").run(current.id);
      driver.prepare("DELETE FROM requirements WHERE project_id = ? AND id = ?").run(projectId, current.id);
      recordRevision();
      publishEvent(driver, projectId, "requirement.deleted", { requirementId: current.id });
      return { deleted: true, requirementId: current.id };
    }
    const parsed = fields.safeParse(input.fields);
    if (!parsed.success) throw new CommandRefusal("INVALID_REQUIREMENT", "Provide valid requirement fields.");
    const { expectedUpdatedAt, ...updates } = parsed.data;
    if (current && expectedUpdatedAt !== undefined && expectedUpdatedAt !== current.updatedAt) {
      throw new CommandRefusal("PLAN_STALE_WRITE", "The requirement has changed. Reload it before submitting an edit.");
    }
    const updatedFields = Object.keys(updates);
    if (updatedFields.length === 0) throw new CommandRefusal("NO_MUTABLE_FIELDS", "Provide requirement fields to change.");
    if (!current && !updates.title) throw new CommandRefusal("REQUIREMENT_TITLE_REQUIRED", "A requirement title is required.");
    const previousTimestamp = current ? Date.parse(current.updatedAt) : Number.NaN;
    const minimumTimestamp = Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0;
    const now = new Date(Math.max(Date.now(), minimumTimestamp)).toISOString();
    const links = updates.linkedPhaseIds === undefined && current
      ? current.linkedPhaseIds : phaseLinks(driver, projectId, updates.linkedPhaseIds ?? []);
    const existingTasks = current?.macroTasks ?? [];
    let macroTasks = existingTasks;
    if (updates.macroTasks !== undefined) {
      if (current && updates.macroTasks.some((task) => task.status === undefined)) {
        throw new CommandRefusal("REQUIREMENT_MACRO_TASK_INVALID", "Each updated macro task must have a status.");
      }
      try {
        macroTasks = reconcileRequirementMacroTasks(existingTasks, updates.macroTasks.map((task) => ({
          title: task.title,
          ...(task.id !== undefined ? { id: task.id } : {}),
          ...(task.description !== undefined ? { description: task.description } : {}),
          status: task.status ?? "planned",
        })), now);
      } catch (error) {
        if (!(error instanceof RequirementMacroTaskError)) throw error;
        throw new CommandRefusal("REQUIREMENT_MACRO_TASK_INVALID", error.message);
      }
    }
    const requirement = RequirementSchema.parse({
      id: current?.id ?? createRequirementId(), title: updates.title ?? current?.title,
      description: updates.description ?? current?.description, macroTasks, linkedPhaseIds: links,
      createdAt: current?.createdAt ?? now, updatedAt: now,
    });
    const content = JSON.stringify({
      description: requirement.description, macroTasks, createdAt: requirement.createdAt, updatedAt: now,
    });
    if (current) {
      driver.prepare("UPDATE requirements SET title = ?, content = ? WHERE project_id = ? AND id = ?")
        .run(requirement.title, content, projectId, current.id);
    } else {
      driver.prepare(`
        INSERT INTO requirements (id, project_id, number, title, content)
        VALUES (?, ?, (SELECT COALESCE(MAX(number), 0) + 1 FROM requirements WHERE project_id = ?), ?, ?)
      `).run(requirement.id, projectId, projectId, requirement.title, content);
    }
    if (!current || updates.linkedPhaseIds !== undefined) {
      driver.prepare("DELETE FROM entity_requirements WHERE entity_kind = 'phase' AND requirement_id = ?").run(requirement.id);
      const insert = driver.prepare("INSERT INTO entity_requirements (entity_kind, entity_id, requirement_id) VALUES ('phase', ?, ?)");
      for (const id of links) insert.run(id, requirement.id);
    }
    recordRevision();
    publishEvent(driver, projectId, current ? "requirement.updated" : "requirement.created", { requirementId: requirement.id });
    return { requirement, updatedFields, ...(current ? { updated: true } : { created: true }) };
  }, caller);
}
