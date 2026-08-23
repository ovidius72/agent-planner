/**
 * T307 (P072/F005) — tracked, deduplicated parent read-enforcement.
 *
 * Analogous to the existing NO ACTIVE TASK advisory: an in-memory, per-session
 * record of which feature/phase refs the agent has actually read (via the
 * feature/phase/task get/show tools). Starting, resuming, or switching a task
 * checks that the target's parent feature + phase are in the read set; a missing
 * read yields an unavoidable (non-blocking) advisory instead of a silent skip.
 *
 * Dedupe: reading a phase (or any task inside it) records both its phase and
 * feature, so 10 sibling tasks need a single feature + phase read. Switching to
 * a different phase/feature naturally fails (that phase is not recorded). A
 * pause invalidates the set, so resuming forces a fresh read.
 */

type ReadState = {
  features: Set<string>;
  phases: Set<string>;
};

let state: ReadState = { features: new Set(), phases: new Set() };

/** Record that a feature was read. Does NOT imply any phase was read. */
export function markFeatureRead(featureId: string): void {
  state.features.add(featureId);
}

/** Record that a phase (and, when known, its feature) was read. */
export function markPhaseRead(phaseId: string, featureId?: string): void {
  state.phases.add(phaseId);
  if (featureId) state.features.add(featureId);
}

/** Record that a task (and, by context, its parent phase + feature) was read. */
export function markTaskRead(_taskId: string, phaseId: string, featureId?: string): void {
  state.phases.add(phaseId);
  if (featureId) state.features.add(featureId);
}

/**
 * Whether the target task's parent feature + phase have both been read.
 * `featureId` is optional: an orphan phase (no feature) only requires the phase.
 */
export function hasReadParents(featureId: string | undefined, phaseId: string): boolean {
  const phaseOk = state.phases.has(phaseId);
  const featureOk = featureId ? state.features.has(featureId) : true;
  return phaseOk && featureOk;
}

/** Clear the read set (e.g. on pause, so resuming forces a fresh read). */
export function invalidateReads(): void {
  state = { features: new Set(), phases: new Set() };
}

/**
 * Non-blocking advisory (mirrors the NO ACTIVE TASK pattern): empty when the
 * target's parent feature + phase have both been read, otherwise a loud
 * READ REQUIRED notice the agent cannot silently skip.
 */
export function parentReadAdvisory(featureId: string | undefined, phaseId: string): string {
  if (hasReadParents(featureId, phaseId)) return "";
  return "\n\n⚠️ READ REQUIRED before proceeding: read the parent feature and phase (full=true) for this task before starting or resuming it. One feature+phase read covers every task in that phase; a pause/resume invalidates the read and requires re-reading.";
}

/** Snapshot for diagnostics/tests. */
export function readTrackingSnapshot(): { features: string[]; phases: string[] } {
  return { features: [...state.features], phases: [...state.phases] };
}
