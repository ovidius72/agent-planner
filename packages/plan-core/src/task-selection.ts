import type { Feature, Phase, Task, WorkDeviation } from "./schema.js";

export type RecommendationClaimKind = "recommendation" | "advisory" | "conflict" | "insufficient";
export type RecommendationClaimSource = "priority" | "active-task" | "resume-deviation" | "dependency-ready" | "handoff" | "archived-handoff";

export interface RecommendationClaim {
  kind: RecommendationClaimKind;
  source: RecommendationClaimSource;
  ref: string;
  title: string;
  reason: string;
  taskId?: string;
  phaseId?: string;
  featureId?: string;
}

export interface RecommendationHandoffEvidence {
  compositeRef: string;
  firstLine: string;
  /** Authoritative only after persisted read-back verification. */
  resumeReady: boolean;
}

export interface RecommendationArchivedHandoffEvidence {
  compositeRef: string;
  firstLine: string;
  reason: string;
}

export interface RecommendationEvidence {
  handoffs?: RecommendationHandoffEvidence[];
  archivedHandoffs?: RecommendationArchivedHandoffEvidence[];
}

export type TaskRecommendationKind = "active" | "resume" | "priority" | "conflict" | "none";

export interface TaskCandidate {
  feature: Feature | undefined;
  phase: Phase;
  task: Task;
}

export interface WorkSummary {
  id: string;
  number: number;
  priority: number;
  title: string;
  status: string;
}

export interface NextWorkRecommendation {
  selection: TaskRecommendation;
  activeTask: WorkSummary | null;
  nextFeature: WorkSummary | null;
  nextPhase: WorkSummary | null;
  nextTask: WorkSummary | null;
  claims: RecommendationClaim[];
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

const hardUnavailable = new Set(["blocked", "deferred", "canceled", "rejected"]);
const terminal = new Set(["done", "canceled", "rejected"]);

const priority = (entity: { priority?: number; number: number }) => entity.priority != null ? entity.priority : Number.MAX_SAFE_INTEGER;
const compare = <T extends { priority?: number; number: number }>(a: T, b: T) => priority(a) - priority(b) || a.number - b.number;
const summarizeFeature = (feature: Feature): WorkSummary => ({ id: feature.id, number: feature.number, priority: feature.priority, title: feature.name, status: feature.status });
const summarizePhase = (phase: Phase): WorkSummary => ({ id: phase.id, number: phase.number, priority: phase.priority, title: phase.title, status: phase.status });
const summarizeTask = (task: Task): WorkSummary => ({ id: task.id, number: task.number, priority: task.priority, title: task.title, status: task.status });

const RECOMMENDATION_CLAIM_LIMIT = 8;

const selectionClaimKind = (selectionKind: TaskRecommendationKind): RecommendationClaimKind => {
  if (selectionKind === "priority") return "recommendation";
  if (selectionKind === "conflict") return "conflict";
  if (selectionKind === "none") return "insufficient";
  return "advisory";
};

const buildRecommendationClaims = (
  selection: TaskRecommendation,
  evidence: RecommendationEvidence = {},
  dependencyReadyCandidates: TaskCandidate[] = [],
): RecommendationClaim[] => {
  const claims: RecommendationClaim[] = [];
  if (selection.candidate) {
    claims.push({
      kind: selectionClaimKind(selection.kind),
      source: selection.kind === "resume" ? "resume-deviation" : selection.kind === "active" ? "active-task" : "priority",
      ref: selection.candidate.task.id,
      title: selection.candidate.task.title,
      reason: selection.reason,
      taskId: selection.candidate.task.id,
      phaseId: selection.candidate.phase.id,
      ...(selection.candidate.feature?.id ? { featureId: selection.candidate.feature.id } : {}),
    });
  }

  for (const candidate of dependencyReadyCandidates) {
    claims.push({
      kind: "advisory",
      source: "dependency-ready",
      ref: candidate.task.id,
      title: candidate.task.title,
      reason: "All persisted task dependencies are done; this task is ready for explicit priority review.",
      taskId: candidate.task.id,
      phaseId: candidate.phase.id,
      ...(candidate.feature?.id ? { featureId: candidate.feature.id } : {}),
    });
  }

  if (selection.kind === "conflict") {
    for (const activeCandidate of selection.activeCandidates ?? []) {
      claims.push({
        kind: "conflict",
        source: "active-task",
        ref: activeCandidate.task.id,
        title: activeCandidate.task.title,
        reason: "Multiple in-progress tasks are persisted; resolve the active-work conflict before automatic selection.",
        taskId: activeCandidate.task.id,
        phaseId: activeCandidate.phase.id,
        ...(activeCandidate.feature?.id ? { featureId: activeCandidate.feature.id } : {}),
      });
    }
  }

  if (selection.deviation) {
    const deviationTaskId = selection.candidate?.task.id ?? selection.deviation.resumeTaskId;
    claims.push({
      kind: "advisory",
      source: "resume-deviation",
      ref: deviationTaskId,
      title: selection.candidate?.task.title ?? "Resume-required deviation",
      reason: selection.deviation.state === "resume-required"
        ? "Persisted deviation requires resuming the preserved task before new priority work can continue."
        : "Persisted approved deviation competes with priority selection.",
      taskId: deviationTaskId,
    });
  }

  for (const handoff of evidence.handoffs ?? []) {
    if (!handoff.resumeReady) {
      claims.push({
        kind: "insufficient",
        source: "handoff",
        ref: handoff.compositeRef,
        title: handoff.firstLine || handoff.compositeRef,
        reason: "Persisted handoff read-back is incomplete; it is not an actionable resume claim.",
      });
      continue;
    }
    claims.push({
      kind: "advisory",
      source: "handoff",
      ref: handoff.compositeRef,
      title: handoff.firstLine || handoff.compositeRef,
      reason: "Persisted phase handoff is resume-ready and competes with fresh priority work.",
    });
  }

  // Archived Markdown is historical context, not authoritative next-work
  // evidence. A future explicit structured resume target may opt it in; never
  // recover an action by parsing archived prose.
  void evidence.archivedHandoffs;

  if (claims.length === 0) {
    claims.push({
      kind: "insufficient",
      source: "priority",
      ref: "",
      title: "No competing claim evidence",
      reason: selection.reason,
    });
  }

  return claims.slice(0, RECOMMENDATION_CLAIM_LIMIT);
};

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
  const startableStatus = candidate.task.status === "planned"
    || (candidate.task.status === "waiting" && isTemporaryOverride);
  if (!startableStatus) return { eligible: false, reason: `Task is not startable from ${candidate.task.status}.` };
  const parentHasHardBlock = hardUnavailable.has(candidate.phase.status)
    || (candidate.feature && hardUnavailable.has(candidate.feature.status));
  if (parentHasHardBlock) {
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
  currentPhaseId = "",
  sessionId = "",
): TaskRecommendation {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const candidates = phases.flatMap((phase) => phase.tasks.map((task) => ({ feature: phase.featureId ? featureById.get(phase.featureId) : undefined, phase, task })));
  const byTaskId = new Map(candidates.map((candidate) => [candidate.task.id, candidate]));
  const active = candidates.filter(({ task }) => task.status === "in-progress");
  if (sessionId) {
    const ownedActive = active.filter(({ task }) => task.activeOwnerSession === sessionId);
    if (ownedActive.length > 1) return { kind: "conflict", activeCandidates: ownedActive, reason: "This session owns more than one active task; resolve the active-work conflict before autonomous selection." };
    if (ownedActive.length === 1) return { kind: "active", candidate: ownedActive[0]!, reason: "Resume the single active task owned by this session." };
  } else if (active.length > 1) return { kind: "conflict", activeCandidates: active, reason: "More than one task is in progress; resolve the active-work conflict before autonomous selection." };
  else if (active.length === 1) return { kind: "active", candidate: active[0]!, reason: "Resume the single active task." };

  const newestFirst = (left: WorkDeviation, right: WorkDeviation) => right.createdAt.localeCompare(left.createdAt);
  const resumable = (candidate: TaskCandidate | undefined) => candidate
    && (candidate.task.status === "planned" || candidate.task.status === "waiting");
  // "resolved" is a legacy synonym for "resume-required": both mean the
  // temporary work has ended and the preserved task must be returned to.
  // No live code path writes "resolved" anymore (setWorkDeviationState only
  // ever sets "resume-required" / "resumed" / "canceled"), but every reader
  // of persisted deviations still treats the two states identically (see
  // recap.ts, plan-mcp/src/index.ts, plan-server/src/serve.ts, and
  // pi-adapter/src/index.ts). Naming the pair here keeps that equivalence
  // explicit instead of two bare string literals that look like an
  // accidental inclusion of a "closed" state in an "open" list.
  const returnRequiredStates = new Set(["resume-required", "resolved"]);
  const liveDeviations = deviations
    .filter((deviation) => deviation.state === "approved"
      || deviation.state === "active"
      || returnRequiredStates.has(deviation.state))
    .sort(newestFirst);
  const top = liveDeviations[0];
  if (top) {
    const temporary = byTaskId.get(top.temporaryTaskId);
    const resume = byTaskId.get(top.resumeTaskId);
    const returnIsRequired = returnRequiredStates.has(top.state)
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
    if (hardUnavailable.has(phase.status) || (feature && hardUnavailable.has(feature.status))) return false;
    return task.dependsOn.every((id) => byTaskId.get(id)?.task.status === "done");
  });
  const currentPhaseReady = currentPhaseId
    ? ready.filter(({ phase }) => phase.id === currentPhaseId).sort((a, b) => compare(a.task, b.task))
    : [];
  if (currentPhaseReady[0]) {
    return {
      kind: "priority",
      candidate: currentPhaseReady[0],
      reason: "Continue the current phase before selecting new work elsewhere.",
    };
  }

  const bestTaskInPhase = (phaseId: string): TaskCandidate | undefined => ready
    .filter((candidate) => candidate.phase.id === phaseId)
    .sort((a, b) => compare(a.task, b.task))[0];
  const bestPhaseInFeature = (featureId: string): Phase | undefined => {
    const phaseIds = new Set(ready.filter((candidate) => candidate.feature?.id === featureId).map((candidate) => candidate.phase.id));
    return phases
      .filter((phase) => phase.featureId === featureId && phaseIds.has(phase.id))
      .sort((a, b) => compare(a, b))[0];
  };

  const bestFeature = features
    .filter((feature) => ready.some((candidate) => candidate.feature?.id === feature.id))
    .sort((a, b) => compare(a, b))[0];
  if (!bestFeature) return { kind: "none", reason: "No ready task is available." };

  const bestPhase = bestPhaseInFeature(bestFeature.id);
  if (!bestPhase) return { kind: "none", reason: "No ready task is available." };

  const candidate = bestTaskInPhase(bestPhase.id);
  return candidate
    ? { kind: "priority", candidate, reason: "Select the lowest-priority ready feature, then phase, then task." }
    : { kind: "none", reason: "No ready task is available." };
}

export function recommendNextWork(
  features: Feature[],
  phases: Phase[],
  deviations: WorkDeviation[] = [],
  currentPhaseId = "",
  sessionId = "",
  evidence: RecommendationEvidence = {},
): NextWorkRecommendation {
  const selection = recommendNextTask(features, phases, deviations, currentPhaseId, sessionId);
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const taskById = new Map(phases.flatMap((phase) => phase.tasks.map((task) => [task.id, task] as const)));
  const dependencyReadyCandidates = phases.flatMap((phase) => phase.tasks.map((task) => ({
    feature: phase.featureId ? featureById.get(phase.featureId) : undefined,
    phase,
    task,
  })))
    .filter(({ feature, phase, task }) => task.status === "planned"
      && task.dependsOn.length > 0
      && !hardUnavailable.has(phase.status)
      && !(feature && hardUnavailable.has(feature.status))
      && task.dependsOn.every((id) => taskById.get(id)?.status === "done"))
    .sort((left, right) => compare(left.feature ?? { priority: 0, number: 0 }, right.feature ?? { priority: 0, number: 0 }) || compare(left.phase, right.phase) || compare(left.task, right.task));
  const activeTask = selection.kind === "active" && selection.candidate
    ? summarizeTask(selection.candidate.task)
    : null;
  return {
    selection,
    activeTask,
    nextFeature: selection.candidate?.feature ? summarizeFeature(selection.candidate.feature) : null,
    nextPhase: selection.candidate ? summarizePhase(selection.candidate.phase) : null,
    nextTask: selection.candidate ? summarizeTask(selection.candidate.task) : null,
    claims: buildRecommendationClaims(selection, evidence, dependencyReadyCandidates),
  };
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
