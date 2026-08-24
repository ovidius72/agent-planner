/**
 * Per-session, ordered context-read enforcement for agent lifecycle operations.
 *
 * An agent must read the exact task, then its parent phase, then its parent
 * feature with full=true before it can start, resume, or switch to that task.
 * Compact list/identity reads never count. The state is process-local and is
 * cleared on pause, switch, and session startup by the harness adapters.
 *
 * Linked requirements remain a separate explicit-read gate. They are recorded
 * only through the requirement list tool and never by an entity read.
 */

type ReadState = {
  tasks: Map<string, number>;
  phases: Map<string, number>;
  features: Map<string, number>;
  requirements: Set<string>;
  nextSequence: number;
};

export type ContextReadEligibility = {
  eligible: boolean;
  reason: string;
};

let state: ReadState = {
  tasks: new Map(),
  phases: new Map(),
  features: new Map(),
  requirements: new Set(),
  nextSequence: 0,
};

function record(map: Map<string, number>, id: string): void {
  state.nextSequence += 1;
  map.set(id, state.nextSequence);
}

/** Record a full feature read. */
export function markFeatureRead(featureId: string): void {
  record(state.features, featureId);
}

/** Record a full phase read. The parent feature is intentionally not implied. */
export function markPhaseRead(phaseId: string, _featureId?: string): void {
  record(state.phases, phaseId);
}

/** Record a full task read. Its parent phase and feature are intentionally not implied. */
export function markTaskRead(taskId: string, _phaseId?: string, _featureId?: string): void {
  record(state.tasks, taskId);
}

/** Record that a requirement was explicitly read via the requirement list tool. */
export function markRequirementRead(requirementId: string): void {
  state.requirements.add(requirementId);
}

/**
 * Verify the required task(full) → phase(full) → feature(full) order for one
 * exact task lineage. Orphan phases do not require a feature read.
 */
export function contextReadEligibility(taskId: string, phaseId: string, featureId?: string): ContextReadEligibility {
  const taskSequence = state.tasks.get(taskId);
  if (taskSequence === undefined) {
    return { eligible: false, reason: "Read this exact task with full=true first." };
  }

  const phaseSequence = state.phases.get(phaseId);
  if (phaseSequence === undefined || phaseSequence <= taskSequence) {
    return { eligible: false, reason: "After reading the task, read its parent phase with full=true." };
  }

  if (!featureId) return { eligible: true, reason: "" };

  const featureSequence = state.features.get(featureId);
  if (featureSequence === undefined || featureSequence <= phaseSequence) {
    return { eligible: false, reason: "After reading the phase, read its parent feature with full=true." };
  }

  return { eligible: true, reason: "" };
}

/**
 * Legacy parent-read check retained for callers that only need to know whether
 * both parent entities have been read. Lifecycle gates must use
 * contextReadEligibility so the task and ordering cannot be bypassed.
 */
export function hasReadParents(featureId: string | undefined, phaseId: string): boolean {
  const phaseOk = state.phases.has(phaseId);
  const featureOk = featureId ? state.features.has(featureId) : true;
  return phaseOk && featureOk;
}

/** Whether every linked requirement has been explicitly read. */
export function hasReadRequirements(requirementIds: string[]): boolean {
  return requirementIds.every((id) => state.requirements.has(id));
}

/** Clear all read state so later lifecycle work requires fresh context. */
export function invalidateReads(): void {
  state = {
    tasks: new Map(),
    phases: new Map(),
    features: new Map(),
    requirements: new Set(),
    nextSequence: 0,
  };
}

/** Compatibility advisory for non-lifecycle callers. */
export function parentReadAdvisory(featureId: string | undefined, phaseId: string): string {
  if (hasReadParents(featureId, phaseId)) return "";
  return "\n\n⚠️ READ REQUIRED before proceeding: read the parent phase and feature with full=true.";
}

/** Advisory text for the separate linked-requirements gate. */
export function requirementReadAdvisory(requirementIds: string[]): string {
  if (requirementIds.length === 0) return "";
  const unread = requirementIds.filter((id) => !state.requirements.has(id));
  if (unread.length === 0) return "";
  return "\n\n⚠️ REQUIREMENTS READ REQUIRED before proceeding: read the requirements linked to this phase and feature.";
}

/** Snapshot for diagnostics and tests. */
export function readTrackingSnapshot(): { features: string[]; phases: string[]; requirements: string[] } {
  return {
    features: [...state.features.keys()],
    phases: [...state.phases.keys()],
    requirements: [...state.requirements],
  };
}
