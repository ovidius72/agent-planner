import { randomUUID } from "node:crypto";
import { z } from "zod";
import { formatFeatureRef, formatPhaseRef, taskCompositeRef } from "../naming.js";
import { findPhaseByRef, findTaskByRef, resolveFeatureRefStrict } from "../refs.js";
import { AcceptedDecisionSchema, type AcceptedDecision } from "../schema.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import type { PersistenceDriver } from "./driver.js";
import { readProjectLists } from "./overview.js";
import type { ProjectCaller } from "./project-access.js";

type TargetKind = "project" | "feature" | "phase" | "task";

export interface RegisteredDecisionTarget {
  targetType: TargetKind;
  targetRef?: string | undefined;
}

export interface RegisteredDecisionMutation extends RegisteredDecisionTarget {
  action: "create" | "update" | "delete";
  decisionId?: string | undefined;
  confirmed: boolean;
  fields: unknown;
  requestId: string;
}

const text = z.string().trim();
const fields = z.object({
  title: text.min(1).optional(), decision: text.optional(), rationale: text.optional(), implementationNotes: text.optional(),
}).strict();

function ownerOf(driver: PersistenceDriver, projectId: string, target: RegisteredDecisionTarget) {
  const { targetType, targetRef } = target;
  if (targetType === "project") return { id: projectId, ref: "project", table: "projects" } as const;
  if (!targetRef) return undefined;
  const model = readProjectLists(driver, projectId);
  if (targetType === "feature") {
    const result = resolveFeatureRefStrict(model.features, targetRef);
    return result.ok ? { id: result.feature.id, ref: formatFeatureRef(result.feature.number), table: "features" } as const : undefined;
  }
  if (targetType === "phase") {
    const phase = findPhaseByRef(model.phases, model.features, targetRef);
    const feature = model.features.find(({ id }) => id === phase?.featureId);
    return phase ? { id: phase.id, ref: formatPhaseRef(phase.number, feature?.number), table: "phases" } as const : undefined;
  }
  const found = findTaskByRef(model.phases, model.features, targetRef);
  return found ? { id: found.task.id, ref: taskCompositeRef(found.task, found.phase, model.features), table: "tasks" } as const : undefined;
}

function decisionFromRow(row: { id?: unknown; content?: unknown; accepted_at?: unknown }): AcceptedDecision {
  return AcceptedDecisionSchema.parse({
    ...JSON.parse(String(row.content)) as object, id: row.id, acceptedAt: row.accepted_at,
  });
}

export function readRegisteredDecisionsByOwner(driver: PersistenceDriver, projectId: string) {
  const byOwner = new Map<string, AcceptedDecision[]>();
  for (const row of driver.prepare(`
    SELECT id, owner_id, content, accepted_at FROM decisions
    WHERE project_id = ? AND superseded_by IS NULL ORDER BY accepted_at, id
  `).all(projectId)) {
    const owner = String(row.owner_id);
    const decisions = byOwner.get(owner) ?? [];
    decisions.push(decisionFromRow(row));
    byOwner.set(owner, decisions);
  }
  return byOwner;
}

export function readRegisteredDecisions(driver: PersistenceDriver, projectId: string, target: RegisteredDecisionTarget) {
  const owner = ownerOf(driver, projectId, target);
  if (!owner) return undefined;
  const decisions = driver.prepare(`
    SELECT id, content, accepted_at FROM decisions WHERE project_id = ?
    AND owner_id = ? AND superseded_by IS NULL ORDER BY accepted_at, id
  `).all(projectId, owner.id).map(decisionFromRow);
  return { targetType: target.targetType, targetRef: owner.ref, decisions };
}

export function mutateRegisteredDecision(driver: PersistenceDriver, caller: ProjectCaller, input: RegisteredDecisionMutation) {
  const { projectId } = caller;
  const { action, targetType } = input;
  return executeCommand(driver, {
    projectId, requestId: input.requestId, operation: `accepted-decision.${action}`, payload: input,
  }, ({ recordRevision }) => {
    const owner = ownerOf(driver, projectId, input);
    if (!owner) throw new CommandRefusal("ACCEPTED_DECISION_TARGET_NOT_FOUND", "The decision owner could not be resolved.");
    const row = input.decisionId ? driver.prepare(`
      SELECT id, content, accepted_at FROM decisions
      WHERE project_id = ? AND owner_id = ? AND id = ? AND superseded_by IS NULL
    `).get(projectId, owner.id, input.decisionId) : undefined;
    if (action === "delete" && !input.confirmed) {
      throw new CommandRefusal("ACCEPTED_DECISION_DELETE_NOT_CONFIRMED", `Confirm deletion of the accepted decision on ${owner.ref}.`);
    }
    if (action !== "create" && !row) throw new CommandRefusal("ACCEPTED_DECISION_NOT_FOUND", "The accepted decision was not found on this owner.");
    const now = new Date().toISOString();
    const current = row ? decisionFromRow(row) : undefined;
    let acceptedDecision: AcceptedDecision;
    let updatedFields: string[] = [];
    if (action === "delete" && current) {
      acceptedDecision = current;
      driver.prepare("DELETE FROM decisions WHERE project_id = ? AND owner_id = ? AND id = ?").run(projectId, owner.id, current.id);
    } else {
      const parsed = fields.safeParse(input.fields);
      if (!parsed.success) throw new CommandRefusal("ACCEPTED_DECISION_FIELDS_INVALID", "Provide valid accepted decision fields.");
      updatedFields = Object.keys(parsed.data);
      if (!current && !parsed.data.title) throw new CommandRefusal("ACCEPTED_DECISION_TITLE_REQUIRED", "A title is required.");
      if (!updatedFields.length) throw new CommandRefusal("NO_MUTABLE_FIELDS_RECEIVED", "Provide fields to update.");
      acceptedDecision = AcceptedDecisionSchema.parse({
        ...current, ...parsed.data, id: current?.id ?? randomUUID(), acceptedAt: current?.acceptedAt ?? now,
      });
      if (current) {
        driver.prepare("UPDATE decisions SET content = ?, revision = revision + 1, updated_at = ? WHERE project_id = ? AND id = ?")
          .run(JSON.stringify(acceptedDecision), now, projectId, current.id);
      } else {
        driver.prepare("INSERT INTO decisions (id, project_id, owner_id, content, accepted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(acceptedDecision.id, projectId, owner.id, JSON.stringify(acceptedDecision), now, now);
      }
    }
    recordRevision();
    if (owner.table !== "projects") {
      driver.prepare(`UPDATE ${owner.table} SET updated_at = ? WHERE project_id = ? AND id = ?`).run(now, projectId, owner.id);
    }
    publishEvent(driver, projectId, `accepted-decision.${action}`, { ownerId: owner.id, targetType, decisionId: acceptedDecision.id });
    return { targetType, targetRef: owner.ref, decisionId: acceptedDecision.id, acceptedDecision, updatedFields };
  }, caller);
}
