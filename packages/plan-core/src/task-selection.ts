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

/** Whether a user-explicit task start is valid, independent of priority advice. */
export interface ExplicitTaskStartEligibility {
  eligible: boolean;
  reason: string;
}

const unavailable = new Set(["blocked", "waiting", "deferred", "canceled", "rejected"]);
const hardUnavailable = new Set(["blocked", "deferred", "canceled", "rejected"]);
const terminal = new Set(["done", "canceled", "rejected"]);

const priority = (entity: { priority?: number; number: number }) => entity.priority && entity.priority > 0 ? entity.priority : Number.MAX_SAFE_INTEGER;
const compare = <T extends { priority?: number; number: number }>(a: T, b: T) => priority(a) - priority(b) || a.number - b.number;

/**
 * Validate an explicitly requested task start. Priority and existing active
 * work remain advisory for explicit user choices; availability and dependency
 * invariants remain mandatory.
 */
export function checkExplicitTaskStart(
  features: Feature[],
  phases: Phase[],
  taskId: string,
  deviations: WorkDeviation[] = [],
): ExplicitTaskStartEligibility {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const candidates = phases.flatMap((phase) => phase.tasks.map((task) => ({ feature: phase.featureId ? featureById.get(phase.featureId) : undefined, phase, task })));
  const candidate = candidates.find(({ task }) => task.id === taskId);
  if (!candidate) return { eligible: false, reason: "Requested task no longer exists." };

  const isTemporaryOverride = deviations.some((deviation) =>
    (deviation.state === "approved" || deviation.state === "active")
    && deviation.temporaryTaskId === taskId,
  );
  const isPreservedResumeTarget = deviations.some((deviation) =>
    (deviation.state === "approved"
      || deviation.state === "active"
      || deviation.state === "resume-required"
      || deviation.state === "resolved")
    && deviation.resumeTaskId === taskId,
  );
  const startableStatus = candidate.task.status === "planned"
    || (candidate.task.status === "waiting" && isTemporaryOverride);
  if (!startableStatus) return { eligible: false, reason: `Task is not startable from ${candidate.task.status}.` };
  const parentHasHardBlock = hardUnavailable.has(candidate.phase.status)
    || (candidate.feature && hardUnavailable.has(candidate.feature.status));
  if (parentHasHardBlock || (!isTemporaryOverride && (unavailable.has(candidate.phase.status) || (candidate.feature && unavailable.has(candidate.feature.status))))) {
    return { eligible: false, reason: "Task belongs to an unavailable phase or feature." };
  }

  const taskById = new Map(candidates.map((entry) => [entry.task.id, entry]));
  if (!isTemporaryOverride && !candidate.task.dependsOn.every((id) => taskById.get(id)?.task.status === "done")) {
    return { eligible: false, reason: "Task dependencies are not complete." };
  }
  return { eligible: true, reason: "Explicit task request is startable." };
}

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
    .filter((deviation) => deviation.state === "approved"
      || deviation.state === "active"
      || deviation.state === "resume-required"
      || deviation.state === "resolved")
    .sort(newestFirst);
  const top = open[0];
  if (top) {
    const temporary = byTaskId.get(top.temporaryTaskId);
    const resume = byTaskId.get(top.resumeTaskId);
    const returnIsRequired = top.state === "resume-required"
      || top.state === "resolved"
      || (temporary && terminal.has(temporary.task.status));
    if (returnIsRequired && resume && resumable(resume)) {
      return { kind: "resume", candidate: resume, deviation: top, reason: "Resume required: return to the task preserved by the most recent deviation." };
    }
    // A deviation explicitly makes its temporary task eligible while it is
    // planned or waiting. Normal priority selection excludes these
    // states unless the deviation deliberately selected them.
    if (temporary && resumable(temporary)) {
      return { kind: "resume", candidate: temporary, deviation: top, reason: "Continue the temporary task of the most recent approved deviation." };
    }
  }

  // A saved checkpoint without a surviving deviation must never disappear
  // behind new priority work. Select the most recent checkpoint (LIFO).
  const checkpointed = candidates
    .filter(({ task }) => task.status === "planned" && task.pauseSnapshot)
    .sort((left, right) => right.task.pauseSnapshot!.pausedAt.localeCompare(left.task.pauseSnapshot!.pausedAt));
  if (checkpointed[0]) {
    return {
      kind: "resume",
      candidate: checkpointed[0],
      reason: "Resume the most recent checkpoint before selecting new priority work.",
    };
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

/**
 * Snapshot fields surfaced in the explicit resume-required proposal. Derived
 * from {@link TaskPauseSnapshot}; kept structural so adapters can build it
 * without importing the full snapshot type.
 */
export interface ResumeRequiredSnapshot {
  reason: string;
  resumeLocation: string;
  howToResume: string;
}

/**
 * Structured, harness-agnostic resume-required proposal. A pending resume must
 * be surfaced loudly (force awareness) but must NOT hard-block an explicit
 * start of a different task. The caller keeps the start advisory/non-blocking;
 * this only standardizes the human-readable message and the machine-readable
 * payload so every harness (Pi, MCP, Web UI) proposes resume the same way.
 */
export interface ResumeRequiredProposal {
  text: string;
  structured: {
    taskId: string;
    phaseId: string;
    snapshot: ResumeRequiredSnapshot | null;
  };
}

/**
 * Build an explicit resume-required proposal. `ref` is the already-formatted
 * composite reference (F00x/P00x/T00x) supplied by the caller; `snapshot` is
 * the task's checkpoint (or the deviation's stored snapshot) when present.
 */
export function buildResumeRequiredProposal(params: {
  ref: string;
  title: string;
  taskId: string;
  phaseId: string;
  snapshot: ResumeRequiredSnapshot | null;
}): ResumeRequiredProposal {
  const { ref, title, taskId, phaseId, snapshot } = params;
  const reason = snapshot?.reason ?? "A preserved task is waiting to be resumed before new work begins.";
  const resumeFrom = snapshot?.resumeLocation ?? "The preserved task's last checkpoint.";
  const howToResume = snapshot?.howToResume ?? "Re-open the task detail and resume from its checkpoint.";
  const text = [
    `↩️ RESUME REQUIRED before starting a different task: ${ref} — ${title}`,
    `Checkpoint reason: ${reason}`,
    `Resume from: ${resumeFrom}`,
    `How to resume: ${howToResume}`,
    `Next action: task_start ${ref}`,
    "Explicit task request honored — but resume the preserved work first, or explicitly confirm you intend to skip it.",
  ].join("\n");
  return {
    text,
    structured: {
      taskId,
      phaseId,
      snapshot: snapshot
        ? { reason: snapshot.reason, resumeLocation: snapshot.resumeLocation, howToResume: snapshot.howToResume }
        : null,
    },
  };
}
