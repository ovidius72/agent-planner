import type { Feature, Phase, Task, WorkDeviation } from "./schema.js";

export type TaskRecommendationKind = "active" | "resume" | "priority" | "conflict" | "none";

export interface TaskCandidate {
  feature: Feature | undefined;
  phase: Phase;
  task: Task;
}

export interface TaskRecommendation {
  kind: TaskRecommendationKind;
  candidate?: TaskCandidate;
  /** Multiple active tasks make an autonomous selection unsafe. */
  activeCandidates?: TaskCandidate[];
  /** The approved override that caused this recommendation, when applicable. */
  deviation?: WorkDeviation;
  reason: string;
}

const unavailable = new Set(["blocked", "waiting", "deferred", "canceled", "rejected"]);
const terminal = new Set(["done", "canceled", "rejected"]);

const priority = (entity: { priority?: number; number: number }) => entity.priority && entity.priority > 0 ? entity.priority : Number.MAX_SAFE_INTEGER;
const compare = <T extends { priority?: number; number: number }>(a: T, b: T) => priority(a) - priority(b) || a.number - b.number;

/**
 * Pure, harness-agnostic work selector. It never mutates plan state: adapters
 * may use its recommendation as a default while still allowing an explicitly
 * approved temporary deviation.
 */
export function recommendNextTask(
  features: Feature[],
  phases: Phase[],
  deviations: WorkDeviation[] = [],
): TaskRecommendation {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const candidates = phases.flatMap((phase) => phase.tasks.map((task) => ({ feature: phase.featureId ? featureById.get(phase.featureId) : undefined, phase, task })));
  const byTaskId = new Map(candidates.map((candidate) => [candidate.task.id, candidate]));
  const active = candidates.filter(({ task }) => task.status === "in-progress");
  if (active.length > 1) return { kind: "conflict", activeCandidates: active, reason: "More than one task is in progress; resolve the active-work conflict before autonomous selection." };
  if (active.length === 1) return { kind: "active", candidate: active[0]!, reason: "Resume the single active task." };

  const newestFirst = (left: WorkDeviation, right: WorkDeviation) => right.createdAt.localeCompare(left.createdAt);
  const resumable = (candidate: TaskCandidate | undefined) => candidate
    && (candidate.task.status === "planned" || candidate.task.status === "waiting");
  const open = deviations
    .filter((deviation) => deviation.state === "approved" || deviation.state === "active")
    .sort(newestFirst);
  const top = open[0];
  if (top) {
    const temporary = byTaskId.get(top.temporaryTaskId);
    const resume = byTaskId.get(top.resumeTaskId);
    if (temporary && terminal.has(temporary.task.status) && resume && (resume.task.status === "planned" || resume.task.status === "waiting")) {
      return { kind: "resume", candidate: resume, deviation: top, reason: "Resume the task preserved by the most recent approved deviation." };
    }
    // A deviation explicitly makes its temporary task eligible while it is
    // planned or paused. Normal priority selection still excludes waiting work.
    if (temporary && (temporary.task.status === "planned" || temporary.task.status === "waiting")) {
      return { kind: "resume", candidate: temporary, deviation: top, reason: "Continue the temporary task of the most recent approved deviation." };
    }
  }

  // A completed temporary task resolves its record, but its explicit resume
  // target remains the next recommendation until that target itself changes.
  const resolved = deviations
    .filter((deviation) => deviation.state === "resolved")
    .sort(newestFirst)
    .find((deviation) => resumable(byTaskId.get(deviation.resumeTaskId)));
  if (resolved) {
    const candidate = byTaskId.get(resolved.resumeTaskId);
    if (candidate && resumable(candidate)) {
      return {
        kind: "resume",
        candidate,
        deviation: resolved,
        reason: "Resume the task preserved by the most recently resolved deviation.",
      };
    }
  }

  const ready = candidates.filter(({ feature, phase, task }) => {
    if (task.status !== "planned") return false;
    if (unavailable.has(phase.status) || (feature && unavailable.has(feature.status))) return false;
    return task.dependsOn.every((id) => byTaskId.get(id)?.task.status === "done");
  });
  ready.sort((a, b) => compare(a.feature ?? { priority: 0, number: 0 }, b.feature ?? { priority: 0, number: 0 }) || compare(a.phase, b.phase) || compare(a.task, b.task));
  return ready[0]
    ? { kind: "priority", candidate: ready[0], reason: "Highest-priority ready task by feature, phase, then task." }
    : { kind: "none", reason: "No ready task is available." };
}
