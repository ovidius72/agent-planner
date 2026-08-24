/**
 * Derived parent display-status layer.
 *
 * Parent entities (feature, phase) need a presentation-oriented summary of
 * their children's workflow states that reads clearly in the Web UI, without
 * overloading the canonical workflow statuses persisted in planner data.
 *
 * This module introduces two PARENT-ONLY derived presentation states:
 * - `started`: the entity has clearly begun (historical progress exists) but
 *   no child is active now, and the unfinished remainder is mixed or cannot
 *   honestly collapse to one specific workflow label.
 * - `closed`: every child is terminal, but outcomes are mixed (e.g.
 *   `done + canceled`, `canceled + rejected`).
 *
 * These are NEVER persisted: they are computed on demand from children's
 * canonical workflow statuses. The canonical workflow model
 * (`planned | in-progress | waiting | blocked | deferred | done |
 * canceled | rejected`) includes paused leaf work without implying active execution.
 */

import type { TaskStatus, PhaseStatus } from "./schema.js";

/**
 * Canonical workflow status values used by tasks, phases, and features.
 * Mirrors the union of TaskStatus and PhaseStatus used in the planner data.
 */
export type WorkflowStatus =
  | "planned"
  | "in-progress"
  | "waiting"
  | "blocked"
  | "deferred"
  | "done"
  | "canceled"
  | "rejected";

/**
 * Display status adds parent-only presentation states on top of workflow
 * statuses. Only parent entities (feature, phase) use the full union; leaf
 * tasks always use plain WorkflowStatus.
 */
export type DisplayStatus = WorkflowStatus | "started" | "closed";

/** Per-status counts for a set of children. */
export interface StatusBreakdown {
  planned: number;
  inProgress: number;
  waiting: number;
  blocked: number;
  deferred: number;
  done: number;
  canceled: number;
  rejected: number;
}

/** Derived presentation snapshot for a parent entity. */
export interface ParentDisplay {
  /** Single presentation status for badges/summaries. */
  displayStatus: DisplayStatus;
  /** Counts of children per canonical workflow status. */
  breakdown: StatusBreakdown;
  /** True when at least one meaningful child is not `planned`
   *  (i.e. the entity has clearly begun). */
  hasStarted: boolean;
  /** Total number of children (including canceled/rejected). */
  totalChildren: number;
  /** Meaningful children count (canceled/rejected excluded). */
  meaningfulChildren: number;
}

const ACTIVE = new Set<WorkflowStatus>(["in-progress"]);
const OPEN = new Set<WorkflowStatus>(["planned", "waiting", "blocked", "deferred"]);
const TERMINAL = new Set<WorkflowStatus>(["done", "canceled", "rejected"]);

/** Count children per canonical workflow status. Pure; does not mutate input. */
export function countBreakdown(statuses: readonly WorkflowStatus[]): StatusBreakdown {
  const breakdown: StatusBreakdown = {
    planned: 0, inProgress: 0, waiting: 0, blocked: 0,
    deferred: 0, done: 0, canceled: 0, rejected: 0,
  };
  for (const s of statuses) {
    switch (s) {
      case "planned": breakdown.planned++; break;
      case "in-progress": breakdown.inProgress++; break;
      case "waiting": breakdown.waiting++; break;
      case "blocked": breakdown.blocked++; break;
      case "deferred": breakdown.deferred++; break;
      case "done": breakdown.done++; break;
      case "canceled": breakdown.canceled++; break;
      case "rejected": breakdown.rejected++; break;
    }
  }
  return breakdown;
}

function emptyBreakdown(): StatusBreakdown {
  return { planned: 0, inProgress: 0, waiting: 0, blocked: 0, deferred: 0, done: 0, canceled: 0, rejected: 0 };
}

/**
 * Derive the parent display snapshot from its children's canonical statuses.
 *
 * Algorithm (locked by P039 accepted decisions):
 *  1. If any meaningful child is active now → `in-progress`.
 *  2. If every child is terminal:
 *       - all `done` → `done`
 *       - all `canceled` → `canceled`
 *       - all `rejected` → `rejected`
 *       - otherwise → `closed` (mixed terminal outcomes)
 *  3. Compute `unfinished = meaningful ∩ OPEN`.
 *       - homogeneous `waiting` → `waiting`
 *       - homogeneous `blocked` → `blocked`
 *       - homogeneous `deferred` → `deferred`
 *  4. If all unfinished are `planned` and the entity has not started → `planned`.
 *  5. Fallback → `started` (mixed non-active remainder, or planned with
 *     historical progress).
 *
 * Edge cases:
 *  - empty input → `planned` (a parent with no meaningful children yet reads
 *    as not started; this is the least surprising default for empty phases).
 *  - `meaningful` excludes `canceled` and `rejected` (terminal non-positive).
 *  - `hasStarted = meaningful.some(s => s !== "planned")`.
 *
 * Pure and non-persisting. Never mutates the input array.
 */
export function deriveParentDisplay(childStatuses: readonly WorkflowStatus[]): ParentDisplay {
  const statuses = childStatuses as readonly WorkflowStatus[];
  const breakdown = countBreakdown(statuses);
  const totalChildren = statuses.length;

  if (totalChildren === 0) {
    return {
      displayStatus: "planned",
      breakdown: emptyBreakdown(),
      hasStarted: false,
      totalChildren: 0,
      meaningfulChildren: 0,
    };
  }

  // Meaningful set excludes terminal non-positive outcomes.
  const meaningful = statuses.filter((s) => s !== "canceled" && s !== "rejected");
  const meaningfulChildren = meaningful.length;
  const hasStarted = meaningful.some((s) => s !== "planned");

  // 1. Active child work exists now.
  if (meaningful.some((s) => ACTIVE.has(s))) {
    return { displayStatus: "in-progress", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  // 2. All children are terminal.
  if (statuses.every((s) => TERMINAL.has(s))) {
    if (statuses.every((s) => s === "done")) {
      return { displayStatus: "done", breakdown, hasStarted, totalChildren, meaningfulChildren };
    }
    if (statuses.every((s) => s === "canceled")) {
      return { displayStatus: "canceled", breakdown, hasStarted, totalChildren, meaningfulChildren };
    }
    if (statuses.every((s) => s === "rejected")) {
      return { displayStatus: "rejected", breakdown, hasStarted, totalChildren, meaningfulChildren };
    }
    return { displayStatus: "closed", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  // 3. Unfinished meaningful remainder.
  const unfinished = meaningful.filter((s) => OPEN.has(s));

  const allWaiting = unfinished.length > 0 && unfinished.every((s) => s === "waiting");
  if (allWaiting) {
    return { displayStatus: "waiting", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  const allBlocked = unfinished.length > 0 && unfinished.every((s) => s === "blocked");
  if (allBlocked) {
    return { displayStatus: "blocked", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  const allDeferred = unfinished.length > 0 && unfinished.every((s) => s === "deferred");
  if (allDeferred) {
    return { displayStatus: "deferred", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  // 4. All unfinished are planned and the entity has never started.
  const allPlanned = unfinished.length > 0 && unfinished.every((s) => s === "planned");
  if (allPlanned && !hasStarted) {
    return { displayStatus: "planned", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  // 5. Fallback: started (mixed non-active remainder, or planned with history).
  return { displayStatus: "started", breakdown, hasStarted, totalChildren, meaningfulChildren };
}

/**
 * Narrow an arbitrary canonical status string to a WorkflowStatus.
 * Useful for adapters that hold the union of task/phase statuses.
 * Returns `null` when the value is not a recognized workflow status.
 */
export function toWorkflowStatus(value: string): WorkflowStatus | null {
  switch (value) {
    case "planned":
    case "in-progress":
    case "waiting":
    case "blocked":
    case "deferred":
    case "done":
    case "canceled":
    case "rejected":
      return value;
    default:
      return null;
  }
}

/**
 * Convert a canonical task/phase status into the workflow status union used
 * by the display layer. Accepts the extra phase statuses and maps them:
 * - `discovery` → `in-progress` (a phase in discovery is active work)
 * - `draft` → `planned` (a draft phase has no tasks yet → not started)
 */
export function fromCanonicalStatus(status: TaskStatus | PhaseStatus): WorkflowStatus {
  if (status === "discovery") return "in-progress";
  if (status === "draft") return "planned";
  return status as WorkflowStatus;
}