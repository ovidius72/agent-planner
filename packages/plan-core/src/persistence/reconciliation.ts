/**
 * Bounded semantic reconciliation after every mutation (P128(F025)/T496).
 *
 * Runs strictly inside the command transaction (executeCommand's apply
 * callback): reverse indexes answer the affected-context question — old/new
 * parents, requirement links and real dependency consumers — without any
 * full-plan or full-ancestor reread. Mechanical consequences (membership,
 * references, derived status read-back) commit with the leaf mutation;
 * semantic prose and decision applicability become durable
 * reconciliation_required obligations committed in the same transaction, so
 * pending obligations survive crashes. A leaf save reports an impact receipt
 * that can never claim complete reconciliation while obligations remain.
 *
 * Prose is never copied upward blindly: an explicit factual update (the
 * caller edits the parent description itself, bumping description_updated_at)
 * or reviewed-unchanged evidence resolves an obligation; unrelated writes
 * never bump a parent's contract revision (domain-contract.md §4).
 */

import { randomUUID } from "node:crypto";
import type { PersistenceDriver } from "./driver.js";
import { PersistenceError, persistenceErrorFrom } from "./driver.js";
import { deriveFeatureStatusFromPhaseStatuses, derivePhaseStatusFromTaskStatuses } from "../status-rollup.js";

/** Cap on entities enumerated inside one receipt; genuine high fan-out stays durable via obligations. */
export const IMPACT_RECEIPT_ENTITY_LIMIT = 50;

export type LeafChangeKind =
  | "task.created"
  | "task.status"
  | "task.description"
  | "task.moved"
  | "task.deleted"
  | "dependency.added";

export interface LeafChange {
  projectId: string;
  kind: LeafChangeKind;
  /** The mutated task, when the change is task-scoped. */
  taskId?: string | undefined;
  /** For moves: the phase the task left. */
  previousPhaseId?: string | undefined;
  /** For moves: the phase the task joined (the current membership after the leaf mutation). */
  newPhaseId?: string | undefined;
  /** For description changes: whether canonical content actually changed (content-hash compared by the caller). */
  descriptionChanged?: boolean | undefined;
}

export interface AffectedParentStatus {
  phaseId: string | undefined;
  featureId: string | undefined;
  derivedPhaseStatus: string | undefined;
  derivedFeatureStatus: string | undefined;
}

export interface ImpactReceipt {
  /** The project revision the receipt is bound to (never valid for another revision). */
  revision: number;
  /** One entry per affected parent (both sides of a move); derived status reads fresh, never persisted. */
  affectedParents: AffectedParentStatus[];
  /** Real dependency consumers found through the reverse index. */
  dependencyConsumers: string[];
  requirementLinks: string[];
  obligations: ImpactObligation[];
  truncated: boolean;
}

export interface ImpactObligation {
  id: string;
  kind: "semantic-review" | "decision-applicability" | "fan-out-continuation";
  entityKind: "project" | "feature" | "phase" | "task";
  entityId: string;
  reason: string;
}

export class ReconciliationError extends PersistenceError {
  constructor(code: "PERSISTENCE_CONSTRAINT" | "PERSISTENCE_BUSY", message: string, readonly subcode: "cyclic-dependency" | "stale-reconciliation" | "foreign-reference" | "unresolvable") {
    super({ code, cause: subcode }, message);
    this.name = "ReconciliationError";
  }
}

interface AffectedParents {
  phaseId: string | undefined;
  featureId: string | undefined;
}

function parentsOfTask(driver: PersistenceDriver, taskId: string): AffectedParents {
  const row = driver
    .prepare("SELECT p.id AS phase_id, p.feature_id AS feature_id FROM tasks t JOIN phases p ON p.id = t.phase_id WHERE t.id = ?")
    .get(taskId);
  return row === undefined
    ? { phaseId: undefined, featureId: undefined }
    : { phaseId: String(row.phase_id), featureId: row.feature_id === null ? undefined : String(row.feature_id) };
}

function parentsOfPhase(driver: PersistenceDriver, phaseId: string): AffectedParents {
  const row = driver.prepare("SELECT id, feature_id FROM phases WHERE id = ?").get(phaseId);
  return row === undefined
    ? { phaseId: undefined, featureId: undefined }
    : { phaseId: String(row.id), featureId: row.feature_id === null ? undefined : String(row.feature_id) };
}

/** Real dependency consumers through the reverse dependency index. */
function dependencyConsumers(driver: PersistenceDriver, taskId: string, limit: number): { ids: string[]; truncated: boolean } {
  const rows = driver
    .prepare("SELECT task_id FROM task_dependencies WHERE depends_on = ? LIMIT ?")
    .all(taskId, limit + 1);
  return { ids: rows.slice(0, limit).map((row) => String(row.task_id)), truncated: rows.length > limit };
}

function requirementLinks(driver: PersistenceDriver, entityIds: string[], limit: number): { ids: string[]; truncated: boolean } {
  if (entityIds.length === 0) return { ids: [], truncated: false };
  const placeholders = entityIds.map(() => "?").join(",");
  const rows = driver
    .prepare(`SELECT DISTINCT requirement_id FROM entity_requirements WHERE entity_id IN (${placeholders}) LIMIT ?`)
    .all(...entityIds, limit + 1);
  return { ids: rows.slice(0, limit).map((row) => String(row.requirement_id)), truncated: rows.length > limit };
}

function projectRevision(driver: PersistenceDriver, projectId: string): number {
  const row = driver.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId);
  if (row === undefined) throw new ReconciliationError("PERSISTENCE_CONSTRAINT", `Unknown project ${projectId}`, "foreign-reference");
  return Number(row.revision);
}

function derivedStatuses(driver: PersistenceDriver, parents: AffectedParents): { phase: string | undefined; feature: string | undefined } {
  let phase: string | undefined;
  let feature: string | undefined;
  if (parents.phaseId !== undefined) {
    const rows = driver.prepare("SELECT status FROM tasks WHERE phase_id = ?").all(parents.phaseId);
    phase = derivePhaseStatusFromTaskStatuses(rows.map((row) => String(row.status)));
  }
  const featureId = parents.featureId;
  if (featureId !== undefined) {
    const rows = driver.prepare("SELECT status FROM phases WHERE feature_id = ?").all(featureId);
    feature = deriveFeatureStatusFromPhaseStatuses(rows.map((row) => String(row.status)));
  }
  return { phase, feature };
}

function insertObligation(
  driver: PersistenceDriver,
  input: {
    projectId: string;
    revision: number;
    kind: ImpactObligation["kind"];
    entityKind: ImpactObligation["entityKind"];
    entityId: string;
    causedBy: string;
    reason: string;
  },
): ImpactObligation {
  const id = randomUUID();
  driver
    .prepare(
      "INSERT INTO reconciliation_obligations (id, project_id, created_at_revision, kind, entity_kind, entity_id, caused_by, reason, status, created_at) VALUES (?,?,?,?,?,?,?,?, 'open', ?)",
    )
    .run(id, input.projectId, input.revision, input.kind, input.entityKind, input.entityId, input.causedBy, input.reason, new Date().toISOString());
  return { id, kind: input.kind, entityKind: input.entityKind, entityId: input.entityId, reason: input.reason };
}

function obligationsForPhaseFeature(driver: PersistenceDriver, projectId: string, revision: number, change: LeafChange, parents: AffectedParents): ImpactObligation[] {
  const created: ImpactObligation[] = [];
  const causedBy = `${change.kind}:${change.taskId ?? change.newPhaseId ?? ""}`;
  if (parents.phaseId !== undefined) {
    created.push(insertObligation(driver, {
      projectId, revision,
      kind: "semantic-review",
      entityKind: "phase",
      entityId: parents.phaseId,
      causedBy,
      reason: "Child description changed; the phase summary may need an explicit factual update or a reviewed-unchanged record.",
    }));
  }
  if (parents.featureId !== undefined) {
    created.push(insertObligation(driver, {
      projectId, revision,
      kind: "semantic-review",
      entityKind: "feature",
      entityId: parents.featureId,
      causedBy,
      reason: "Child description changed; the feature summary may need an explicit factual update or a reviewed-unchanged record.",
    }));
  }
  return created;
}

/**
 * Reconcile one leaf mutation inside the open command transaction. The leaf
 * mutation itself has already been applied by the caller; this function
 * computes the affected context from reverse indexes, applies the mechanical
 * consequences that persist (none for derived statuses — they read fresh),
 * records durable obligations for semantic follow-up, and returns the
 * version-bound impact receipt.
 */
export function reconcileLeafMutation(driver: PersistenceDriver, change: LeafChange): ImpactReceipt {
  try {
    const revision = projectRevision(driver, change.projectId);
    const obligations: ImpactObligation[] = [];
    let truncated = false;

    // Resolve affected parents: for a move, both old and new; otherwise the current membership.
    const affectedParents = new Map<string, AffectedParents>();
    if (change.kind === "task.moved" && change.previousPhaseId !== undefined) {
      const oldParents = parentsOfPhase(driver, change.previousPhaseId);
      if (oldParents.phaseId !== undefined) affectedParents.set(oldParents.phaseId, oldParents);
    }
    if (change.taskId !== undefined) {
      const current = parentsOfTask(driver, change.taskId);
      if (current.phaseId !== undefined) affectedParents.set(current.phaseId, current);
    }

    let consumers: string[] = [];
    if (change.taskId !== undefined) {
      const found = dependencyConsumers(driver, change.taskId, IMPACT_RECEIPT_ENTITY_LIMIT);
      consumers = found.ids;
      truncated = truncated || found.truncated;
    }

    const parentIds = [
      ...new Set(
        [...affectedParents.values()]
          .flatMap((entry) => (entry.featureId !== undefined ? [entry.phaseId!, entry.featureId] : [entry.phaseId!])),
      ),
    ];
    const links = requirementLinks(driver, parentIds, IMPACT_RECEIPT_ENTITY_LIMIT);
    truncated = truncated || links.truncated;

    // Durable obligations: semantic prose review on description changes; a
    // fan-out continuation when the receipt had to omit entities. Mechanical
    // status/reference consequences persist nothing — derived state reads
    // fresh through reverse indexes every time.
    if (change.descriptionChanged === true) {
      for (const parents of affectedParents.values()) {
        obligations.push(...obligationsForPhaseFeature(driver, change.projectId, revision, change, parents));
      }
      if (affectedParents.size === 0) {
        obligations.push(insertObligation(driver, {
          projectId: change.projectId, revision,
          kind: "semantic-review", entityKind: "task",
          entityId: change.taskId ?? "", causedBy: `${change.kind}:${change.taskId ?? ""}`,
          reason: "Description changed without resolvable parents; record the review on the task itself.",
        }));
      }
    }
    if (truncated) {
      obligations.push(insertObligation(driver, {
        projectId: change.projectId, revision,
        kind: "fan-out-continuation",
        entityKind: change.taskId !== undefined ? "task" : "phase",
        entityId: change.taskId ?? change.newPhaseId ?? "",
        causedBy: `${change.kind}:${change.taskId ?? change.newPhaseId ?? ""}`,
        reason: `Affected-context enumeration exceeded ${IMPACT_RECEIPT_ENTITY_LIMIT} entities; continue with the paginated obligation listing.`,
      }));
    }

    const affectedParentsList: AffectedParentStatus[] = [];
    for (const parents of affectedParents.values()) {
      const derived = derivedStatuses(driver, parents);
      affectedParentsList.push({
        phaseId: parents.phaseId,
        featureId: parents.featureId,
        derivedPhaseStatus: derived.phase,
        derivedFeatureStatus: derived.feature,
      });
    }

    return {
      revision,
      affectedParents: affectedParentsList,
      dependencyConsumers: consumers,
      requirementLinks: links.ids,
      obligations,
      truncated,
    };
  } catch (error) {
    if (error instanceof ReconciliationError || error instanceof PersistenceError) throw error;
    throw persistenceErrorFrom(error, undefined);
  }
}

export interface ReconciliationObligationRow {
  id: string;
  kind: string;
  entityKind: string;
  entityId: string;
  causedBy: string;
  reason: string;
  status: string;
  createdAtRevision: number;
  resolutionEvidence: unknown | undefined;
  createdAt: string;
  resolvedAt: string | undefined;
}

/** Paginated listing; the receipt's fan-out continuation points here. */
export function listReconciliationObligations(driver: PersistenceDriver, projectId: string, options: { status?: "open" | "resolved-applied" | "resolved-reviewed"; limit?: number; offset?: number } = {}): { obligations: ReconciliationObligationRow[]; truncated: boolean } {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const statusClause = options.status === undefined ? "" : "AND status = ?";
  const args = options.status === undefined ? [projectId, limit + 1, offset] : [projectId, options.status, limit + 1, offset];
  const rows = driver
    .prepare(`SELECT * FROM reconciliation_obligations WHERE project_id = ? ${statusClause} ORDER BY created_at, id LIMIT ? OFFSET ?`)
    .all(...args);
  const truncated = rows.length > limit;
  return {
    obligations: rows.slice(0, limit).map(rowToObligation),
    truncated,
  };
}

function rowToObligation(row: Record<string, unknown>): ReconciliationObligationRow {
  return {
    id: String(row.id),
    kind: String(row.kind),
    entityKind: String(row.entity_kind),
    entityId: String(row.entity_id),
    causedBy: String(row.caused_by),
    reason: String(row.reason),
    status: String(row.status),
    createdAtRevision: Number(row.created_at_revision),
    resolutionEvidence: row.resolution_evidence === null ? undefined : JSON.parse(String(row.resolution_evidence)) as unknown,
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at === null ? undefined : String(row.resolved_at),
  };
}

export type ObligationResolution = "applied" | "reviewed-unchanged";

export interface ResolveObligationInput {
  projectId: string;
  obligationId: string;
  resolution: ObligationResolution;
  /**
   * Reviewed-unchanged evidence or a factual-update reference. Must state
   * what was inspected; never a bare "done".
   */
  evidence: unknown;
  /**
   * Required when the entity changed since the obligation was created
   * (created_at_revision < current project revision) and the caller has
   * re-reviewed: acknowledging records the re-review instead of refusing.
   */
  acknowledgeRevisionChange?: boolean | undefined;
}

/**
 * Resolve one obligation with explicit evidence. A stale resolution — the
 * obligation names a revision older than the current one and the caller does
 * not acknowledge re-review — is refused, never silently accepted.
 */
export function resolveReconciliationObligation(driver: PersistenceDriver, input: ResolveObligationInput): { resolved: boolean; reason?: string } {
  return driver.runExclusive(() => {
    const row = driver.prepare("SELECT * FROM reconciliation_obligations WHERE id = ? AND project_id = ?").get(input.obligationId, input.projectId);
    if (row === undefined) {
      return { resolved: false, reason: `Obligation ${input.obligationId} does not exist in this project.` };
    }
    const obligation = rowToObligation(row);
    if (obligation.status !== "open") {
      return { resolved: false, reason: `Obligation is already resolved (${obligation.status}).` };
    }
    const evidenceEmpty = input.evidence === undefined || input.evidence === null || input.evidence === "";
    if (evidenceEmpty) {
      return { resolved: false, reason: "Resolution requires explicit evidence (a factual update reference or reviewed-unchanged note); never a bare done." };
    }
    const currentRevision = projectRevision(driver, input.projectId);
    if (currentRevision !== obligation.createdAtRevision && input.acknowledgeRevisionChange !== true) {
      return {
        resolved: false,
        reason: `Stale reconciliation: obligation was recorded at revision ${obligation.createdAtRevision}, project is now at ${currentRevision}. Re-review and acknowledge the revision change.`,
      };
    }
    const status = input.resolution === "applied" ? "resolved-applied" : "resolved-reviewed";
    driver
      .prepare("UPDATE reconciliation_obligations SET status = ?, resolution_evidence = ?, resolved_at = ? WHERE id = ?")
      .run(status, JSON.stringify(input.evidence), new Date().toISOString(), input.obligationId);
    return { resolved: true };
  });
}

/** A leaf save must consult this before claiming complete reconciliation. */
export function hasOpenObligations(driver: PersistenceDriver, projectId: string, entityIds: string[]): boolean {
  if (entityIds.length === 0) return false;
  const placeholders = entityIds.map(() => "?").join(",");
  const row = driver
    .prepare(`SELECT COUNT(*) AS c FROM reconciliation_obligations WHERE project_id = ? AND status = 'open' AND entity_id IN (${placeholders})`)
    .get(projectId, ...entityIds);
  return Number(row?.c ?? 0) > 0;
}

/**
 * Add a dependency edge with cycle rejection: walking only the forward
 * `depends_on` closure from the candidate target, bounded by the planner's
 * own dependency graph (not the whole plan). Foreign references are refused
 * explicitly (the FK alone would roll back with a generic constraint error).
 */
export function addTaskDependencyValidated(driver: PersistenceDriver, input: { projectId: string; taskId: string; dependsOn: string }): void {
  const exists = driver.prepare("SELECT id FROM tasks WHERE id = ? AND project_id = ?").get(input.dependsOn, input.projectId);
  if (exists === undefined) {
    throw new ReconciliationError("PERSISTENCE_CONSTRAINT", `Dependency target ${input.dependsOn} does not exist in project ${input.projectId}.`, "foreign-reference");
  }
  if (input.dependsOn === input.taskId) {
    throw new ReconciliationError("PERSISTENCE_CONSTRAINT", "A task cannot depend on itself.", "cyclic-dependency");
  }
  // Cycle iff the new edge closes a path dependsOn -> ... -> taskId. Walk the
  // forward closure from dependsOn with a bounded BFS over reverse rows.
  const frontier = [input.dependsOn];
  const seen = new Set<string>([input.dependsOn]);
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    if (current === input.taskId) {
      throw new ReconciliationError("PERSISTENCE_CONSTRAINT", `Dependency ${input.taskId} -> ${input.dependsOn} closes an existing cycle.`, "cyclic-dependency");
    }
    const rows = driver.prepare("SELECT depends_on FROM task_dependencies WHERE task_id = ?").all(current);
    for (const row of rows) {
      const next = String(row.depends_on);
      if (!seen.has(next)) {
        seen.add(next);
        frontier.push(next);
      }
    }
  }
  try {
    driver.prepare("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?,?)").run(input.taskId, input.dependsOn);
  } catch (error) {
    throw persistenceErrorFrom(error, undefined);
  }
}
