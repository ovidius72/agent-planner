/**
 * Session-scoped, ordered context-read enforcement for agent lifecycle operations.
 *
 * The first complete read for a task must be task(full) → phase(full) →
 * feature(full), with linked requirements read independently. A persisted
 * sessionInfo attestation may satisfy later checks in the same session while
 * the entity's context revision remains at or before its attestation timestamp.
 */

const DEFAULT_SESSION_ID = "__default__";

type SessionInfoEntry = { sessionId: string; createdAt: string };

type ReadTrackedEntity = {
  updatedAt: string;
  descriptionUpdatedAt?: string;
  sessionInfo?: SessionInfoEntry[];
};

type ReadState = {
  tasks: Map<string, number>;
  phases: Map<string, number>;
  features: Map<string, number>;
  requirements: Set<string>;
  nextSequence: number;
};

export type ContextReadEntityKind = "task" | "phase" | "feature";

export type RequiredContextRead = {
  kind: ContextReadEntityKind;
  id: string;
  state: "missing" | "stale";
};

export type ContextReadEligibility = {
  eligible: boolean;
  reason: string;
  requiredReads?: RequiredContextRead[];
};

export interface SessionContextReadInput {
  sessionId: string;
  taskId: string;
  phaseId: string;
  featureId?: string;
  task?: ReadTrackedEntity;
  phase?: ReadTrackedEntity;
  feature?: ReadTrackedEntity;
  requirements?: Array<ReadTrackedEntity & { id: string }>;
  requirementIds?: string[];
}

const newState = (): ReadState => ({
  tasks: new Map(),
  phases: new Map(),
  features: new Map(),
  requirements: new Set(),
  nextSequence: 0,
});

const states = new Map<string, ReadState>([[DEFAULT_SESSION_ID, newState()]]);

function normalizeSessionId(sessionId?: string): string {
  return sessionId?.trim() || DEFAULT_SESSION_ID;
}

function stateFor(sessionId?: string): ReadState {
  const key = normalizeSessionId(sessionId);
  let state = states.get(key);
  if (!state) {
    state = newState();
    states.set(key, state);
  }
  return state;
}

function record(map: Map<string, number>, id: string, state: ReadState): void {
  state.nextSequence += 1;
  map.set(id, state.nextSequence);
}

function markTaskReadForSession(sessionId: string, taskId: string): void {
  const state = stateFor(sessionId);
  record(state.tasks, taskId, state);
}

function markPhaseReadForSession(sessionId: string, phaseId: string): void {
  const state = stateFor(sessionId);
  record(state.phases, phaseId, state);
}

function markFeatureReadForSession(sessionId: string, featureId: string): void {
  const state = stateFor(sessionId);
  record(state.features, featureId, state);
}

/** Record a full feature read in the default compatibility session. */
export function markFeatureRead(featureId: string): void {
  markFeatureReadForSession(DEFAULT_SESSION_ID, featureId);
}

/** Record a full feature read for an explicit harness session. */
export function markFeatureReadForSessionId(sessionId: string, featureId: string): void {
  markFeatureReadForSession(sessionId, featureId);
}

/** Record a full phase read in the default compatibility session. */
export function markPhaseRead(phaseId: string, _featureId?: string): void {
  markPhaseReadForSession(DEFAULT_SESSION_ID, phaseId);
}

/** Record a full phase read for an explicit harness session. */
export function markPhaseReadForSessionId(sessionId: string, phaseId: string): void {
  markPhaseReadForSession(sessionId, phaseId);
}

/** Record a full task read in the default compatibility session. */
export function markTaskRead(taskId: string, _phaseId?: string, _featureId?: string): void {
  markTaskReadForSession(DEFAULT_SESSION_ID, taskId);
}

/** Record a full task read for an explicit harness session. */
export function markTaskReadForSessionId(sessionId: string, taskId: string): void {
  markTaskReadForSession(sessionId, taskId);
}

/** Record that a requirement was explicitly read in the default session. */
export function markRequirementRead(requirementId: string): void {
  stateFor(DEFAULT_SESSION_ID).requirements.add(requirementId);
}

/** Record that a requirement was explicitly read for an explicit session. */
export function markRequirementReadForSessionId(sessionId: string, requirementId: string): void {
  stateFor(sessionId).requirements.add(requirementId);
}

function orderedEligibility(sessionId: string, taskId: string, phaseId: string, featureId?: string): ContextReadEligibility {
  const state = stateFor(sessionId);
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

type StoredReadState = "valid" | "missing" | "stale";

function entityRevision(entity: ReadTrackedEntity, kind: ContextReadEntityKind | "requirement"): string {
  if ((kind === "phase" || kind === "feature") && entity.descriptionUpdatedAt?.trim()) {
    return entity.descriptionUpdatedAt;
  }
  return entity.updatedAt;
}

function storedReadState(
  entity: ReadTrackedEntity | undefined,
  sessionId: string,
  kind: ContextReadEntityKind | "requirement",
): StoredReadState {
  const entry = entity?.sessionInfo?.find((candidate) => candidate.sessionId === sessionId);
  if (!entity || !entry) return "missing";
  return entityRevision(entity, kind) <= entry.createdAt ? "valid" : "stale";
}

function validSessionInfo(
  entity: ReadTrackedEntity | undefined,
  sessionId: string,
  kind: ContextReadEntityKind | "requirement" = "requirement",
): boolean {
  return storedReadState(entity, sessionId, kind) === "valid";
}

function persistedEligibility(input: SessionContextReadInput): boolean {
  if (!validSessionInfo(input.task, input.sessionId, "task") || !validSessionInfo(input.phase, input.sessionId, "phase")) return false;
  if (input.featureId && !validSessionInfo(input.feature, input.sessionId, "feature")) return false;
  const requirementIds = input.requirementIds ?? [];
  return requirementIds.every((id) => validSessionInfo(input.requirements?.find((requirement) => requirement.id === id), input.sessionId));
}

function requiredReadReason(requiredReads: RequiredContextRead[]): string {
  const labels = requiredReads.map((read) => `${read.kind} ${read.id} (${read.state})`);
  return `Read required context only for: ${labels.join(", ")}. Follow these reads in the listed order, then retry.`;
}

/**
 * Combine valid persisted attestations with fresh in-memory reads. An entity read
 * in the current session satisfies eligibility regardless of sequence order,
 * so agents can read task, phase, and feature in any order; only persisted
 * attestations are checked for revision freshness (stale) and missing entities
 * remain reported as missing.
 */
export function contextReadEligibilityForSession(input: SessionContextReadInput): ContextReadEligibility {
  const state = stateFor(input.sessionId);
  const requiredReads: RequiredContextRead[] = [];

  const taskStored = storedReadState(input.task, input.sessionId, "task");
  const taskSequence = state.tasks.get(input.taskId);
  const taskReady = taskStored === "valid" || taskSequence !== undefined;
  if (!taskReady) {
    requiredReads.push({ kind: "task", id: input.taskId, state: taskStored === "stale" ? "stale" : "missing" });
  }

  const phaseStored = storedReadState(input.phase, input.sessionId, "phase");
  const phaseSequence = state.phases.get(input.phaseId);
  const phaseReady = phaseStored === "valid" || phaseSequence !== undefined;
  if (!phaseReady) {
    requiredReads.push({
      kind: "phase",
      id: input.phaseId,
      state: phaseStored === "stale" ? "stale" : "missing",
    });
  }

  if (input.featureId) {
    const featureStored = storedReadState(input.feature, input.sessionId, "feature");
    const featureSequence = state.features.get(input.featureId);
    const featureReady = featureStored === "valid" || featureSequence !== undefined;
    if (!featureReady) {
      requiredReads.push({
        kind: "feature",
        id: input.featureId,
        state: featureStored === "stale" ? "stale" : "missing",
      });
    }
  }

  if (requiredReads.length === 0) return { eligible: true, reason: "" };
  return { eligible: false, reason: requiredReadReason(requiredReads), requiredReads };
}

/** Return true only when the persisted attestation covers the current revisions. */
export function hasValidSessionAttestation(input: SessionContextReadInput): boolean {
  return persistedEligibility(input);
}

/** Compatibility check for the default session and in-memory reads only. */
export function contextReadEligibility(taskId: string, phaseId: string, featureId?: string): ContextReadEligibility {
  return orderedEligibility(DEFAULT_SESSION_ID, taskId, phaseId, featureId);
}

/** Legacy parent-read check retained for callers that only need independent parent state. */
export function hasReadParents(featureId: string | undefined, phaseId: string): boolean {
  const state = stateFor(DEFAULT_SESSION_ID);
  return state.phases.has(phaseId) && (!featureId || state.features.has(featureId));
}

/**
 * Whether linked requirements are read in memory or have valid persisted
 * attestations for the current session and entity revisions.
 */
export function hasReadRequirementsForSession(
  sessionId: string,
  requirementIds: string[],
  requirements: Array<ReadTrackedEntity & { id: string }> = [],
): boolean {
  const state = stateFor(sessionId);
  return requirementIds.every((id) => state.requirements.has(id) || validSessionInfo(requirements.find((requirement) => requirement.id === id), sessionId));
}

/** Legacy requirement check for the default compatibility session. */
export function hasReadRequirements(requirementIds: string[]): boolean {
  return requirementIds.every((id) => stateFor(DEFAULT_SESSION_ID).requirements.has(id));
}

/** Clear one session's read state, or all state for legacy callers. */
export function invalidateReads(sessionId?: string): void {
  if (sessionId) {
    states.delete(normalizeSessionId(sessionId));
    stateFor(sessionId);
    return;
  }
  states.clear();
  states.set(DEFAULT_SESSION_ID, newState());
}

/** Initialize an explicit session without clearing other harness sessions. */
export function startReadSession(sessionId: string): void {
  stateFor(sessionId);
}

/** Compatibility advisory for non-lifecycle callers. */
export function parentReadAdvisory(featureId: string | undefined, phaseId: string): string {
  const state = stateFor(DEFAULT_SESSION_ID);
  if (state.phases.has(phaseId) && (!featureId || state.features.has(featureId))) return "";
  return "\n\n⚠️ READ REQUIRED before proceeding: read the parent phase and feature with full=true.";
}

/** Advisory text for the separate linked-requirements gate. */
export function requirementReadAdvisory(requirementIds: string[]): string {
  const state = stateFor(DEFAULT_SESSION_ID);
  if (requirementIds.length === 0) return "";
  const unread = requirementIds.filter((id) => !state.requirements.has(id));
  if (unread.length === 0) return "";
  return "\n\n⚠️ REQUIREMENTS READ REQUIRED before proceeding: read the requirements linked to this phase and feature.";
}

/** Snapshot for diagnostics. */
export function readTrackingSnapshot(sessionId?: string): { features: string[]; phases: string[]; requirements: string[] } {
  const state = stateFor(sessionId);
  return {
    features: [...state.features.keys()],
    phases: [...state.phases.keys()],
    requirements: [...state.requirements],
  };
}
