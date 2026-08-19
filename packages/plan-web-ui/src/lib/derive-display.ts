/**
 * Browser-safe mirror of the parent display-status derivation from
 * @agent-plan/core. Kept local to the Web UI so the bundle does not pull in
 * Node-only planner code.
 */

import type { TaskStatus, PhaseStatus, Task, Phase } from "./types";

export type WorkflowStatus =
  | "planned"
  | "in-progress"
  | "paused"
  | "waiting"
  | "blocked"
  | "deferred"
  | "done"
  | "canceled"
  | "rejected";

export type DisplayStatus = WorkflowStatus | "started" | "closed";

export interface StatusBreakdown {
  planned: number;
  inProgress: number;
  paused: number;
  waiting: number;
  blocked: number;
  deferred: number;
  done: number;
  canceled: number;
  rejected: number;
}

export interface ParentDisplay {
  displayStatus: DisplayStatus;
  breakdown: StatusBreakdown;
  hasStarted: boolean;
  totalChildren: number;
  meaningfulChildren: number;
}

const ACTIVE = new Set<WorkflowStatus>(["in-progress"]);
const OPEN = new Set<WorkflowStatus>(["planned", "paused", "waiting", "blocked", "deferred"]);
const TERMINAL = new Set<WorkflowStatus>(["done", "canceled", "rejected"]);

export function fromCanonicalStatus(status: TaskStatus | PhaseStatus): WorkflowStatus {
  if (status === "discovery") return "in-progress";
  if (status === "draft") return "planned";
  return status as WorkflowStatus;
}

export function countBreakdown(statuses: readonly WorkflowStatus[]): StatusBreakdown {
  const breakdown: StatusBreakdown = {
    planned: 0, inProgress: 0, paused: 0, waiting: 0, blocked: 0,
    deferred: 0, done: 0, canceled: 0, rejected: 0,
  };
  for (const s of statuses) {
    switch (s) {
      case "planned": breakdown.planned++; break;
      case "in-progress": breakdown.inProgress++; break;
      case "paused": breakdown.paused++; break;
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
  return { planned: 0, inProgress: 0, paused: 0, waiting: 0, blocked: 0, deferred: 0, done: 0, canceled: 0, rejected: 0 };
}

export function deriveParentDisplay(childStatuses: readonly WorkflowStatus[]): ParentDisplay {
  const statuses = childStatuses;
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

  const meaningful = statuses.filter((s) => s !== "canceled" && s !== "rejected");
  const meaningfulChildren = meaningful.length;
  const hasStarted = meaningful.some((s) => s !== "planned");

  if (meaningful.some((s) => ACTIVE.has(s))) {
    return { displayStatus: "in-progress", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  if (statuses.every((s) => TERMINAL.has(s))) {
    if (statuses.every((s) => s === "done")) return { displayStatus: "done", breakdown, hasStarted, totalChildren, meaningfulChildren };
    if (statuses.every((s) => s === "canceled")) return { displayStatus: "canceled", breakdown, hasStarted, totalChildren, meaningfulChildren };
    if (statuses.every((s) => s === "rejected")) return { displayStatus: "rejected", breakdown, hasStarted, totalChildren, meaningfulChildren };
    return { displayStatus: "closed", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  const unfinished = meaningful.filter((s) => OPEN.has(s));

  if (unfinished.length > 0 && unfinished.every((s) => s === "paused")) {
    return { displayStatus: "paused", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }
  if (unfinished.length > 0 && unfinished.every((s) => s === "waiting")) {
    return { displayStatus: "waiting", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }
  if (unfinished.length > 0 && unfinished.every((s) => s === "blocked")) {
    return { displayStatus: "blocked", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }
  if (unfinished.length > 0 && unfinished.every((s) => s === "deferred")) {
    return { displayStatus: "deferred", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  const allPlanned = unfinished.length > 0 && unfinished.every((s) => s === "planned");
  if (allPlanned && !hasStarted) {
    return { displayStatus: "planned", breakdown, hasStarted, totalChildren, meaningfulChildren };
  }

  return { displayStatus: "started", breakdown, hasStarted, totalChildren, meaningfulChildren };
}

/** Derive display status for a phase from its tasks. */
export function derivePhaseDisplay(tasks: { status: TaskStatus }[]): ParentDisplay {
  const statuses = tasks.map((t) => fromCanonicalStatus(t.status));
  return deriveParentDisplay(statuses);
}

/** Derive display status for a feature from its phases. */
export function deriveFeatureDisplay(phases: { status: PhaseStatus }[]): ParentDisplay {
  const statuses = phases.map((p) => fromCanonicalStatus(p.status));
  return deriveParentDisplay(statuses);
}

/** Derive display status for a feature from full Phase objects (convenience). */
export function deriveFeatureDisplayFromPhases(phases: Phase[]): ParentDisplay {
  return deriveFeatureDisplay(phases);
}

/** Derive display status for a phase from full Task objects (convenience). */
export function derivePhaseDisplayFromTasks(tasks: Task[]): ParentDisplay {
  return derivePhaseDisplay(tasks);
}
