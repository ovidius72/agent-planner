/**
 * Session-authority flows shared by every surface.
 *
 * Two operations live here because both are about *who owns side work*,
 * not about a task's lifecycle state:
 *
 * - recording a user-approved deviation (temporary task overrides a
 *   preserved resume target), which never starts, pauses or blocks work;
 * - recovering a stopped caller's ownership, deviations and resume focus
 *   into a fresh connection.
 *
 * The flows return surface-neutral codes and facts; each adapter renders
 * its own words and structured payload.
 */

import { randomUUID } from "node:crypto";
import { PlanStoreError, nowISO } from "./plan-store.js";
import { findTaskByRef, taskCompositeRef } from "./index.js";
import { formatFeatureRef, formatPhaseRef, featureNumberOfPhase } from "./naming.js";
import { isStartableTaskStatus } from "./task-selection.js";
import { recommendNextTask } from "./task-selection.js";
import type { Feature, Phase, PlanStore, Task, WorkDeviation } from "./index.js";

// ── Approved deviation ──────────────────────────────────────────────────

export type DeviationRefusalCode =
  | "TASK_NOT_FOUND"
  | "NO_RESUME_TASK"
  | "DEVIATION_SAME_TASK"
  | "TEMPORARY_TASK_NOT_STARTABLE";

export interface DeviationRefusal {
  ok: false;
  code: DeviationRefusalCode;
  /** Surface-neutral sentence; adapters may render their own words. */
  message: string;
  taskId?: string;
  /** Why no resume target could be derived, when that is the refusal. */
  selectionReason?: string;
  /** Status of the temporary task when it is not startable. */
  temporaryStatus?: Task["status"];
}

export interface RecordDeviationInput {
  temporaryTask: string;
  /** Explicit resume target; defaults to the automatic recommendation. */
  resumeTask?: string | undefined;
  reason: string;
}

export interface DeviationSuccess {
  ok: true;
  deviation: WorkDeviation;
  temporaryRef: string;
  resumeRef: string;
}

/**
 * Record one approved deviation. This is bookkeeping only: it preserves
 * the resume target and never transitions a task.
 */
export async function recordDeviationFlow(
  store: PlanStore,
  sessionId: string,
  input: RecordDeviationInput,
): Promise<DeviationSuccess | DeviationRefusal> {
  const [featuresDoc, phases, focus] = await Promise.all([
    store.loadFeatures(),
    store.loadAllPhases(),
    store.loadResume(sessionId),
  ]);
  const outcome = prepareWorkDeviation(featuresDoc.features, phases, await store.listAllWorkDeviations(),
    focus?.currentPhaseId, sessionId, input);
  if (!outcome.ok) return outcome;
  await store.addWorkDeviation(outcome.deviation, sessionId);
  await store.writeGenerated();
  return outcome;
}

export function prepareWorkDeviation(
  features: Feature[], phases: Phase[], deviations: WorkDeviation[], currentPhaseId: string | undefined,
  sessionId: string, input: RecordDeviationInput,
): DeviationSuccess | DeviationRefusal {
  const temporary = findTaskByRef(phases, features, input.temporaryTask);
  if (!temporary) {
    return { ok: false, code: "TASK_NOT_FOUND", message: `Task not found: ${input.temporaryTask}` };
  }
  const selected = recommendNextTask(features, phases, deviations, currentPhaseId, sessionId);
  const resume = input.resumeTask ? findTaskByRef(phases, features, input.resumeTask) : selected.candidate;
  if (!resume) {
    return {
      ok: false,
      code: "NO_RESUME_TASK",
      message: "No resume task is available.",
      selectionReason: selected.reason,
    };
  }
  if (temporary.task.id === resume.task.id) {
    return {
      ok: false,
      code: "DEVIATION_SAME_TASK",
      message: "A temporary task must differ from its resume target.",
      taskId: temporary.task.id,
    };
  }
  if (!isStartableTaskStatus(temporary.task.status)) {
    return {
      ok: false,
      code: "TEMPORARY_TASK_NOT_STARTABLE",
      message: `Temporary task is not startable: ${temporary.task.status}.`,
      taskId: temporary.task.id,
      temporaryStatus: temporary.task.status,
    };
  }

  const timestamp = nowISO();
  const record: WorkDeviation = {
    id: randomUUID(),
    recommendedTaskId: selected.candidate?.task.id ?? resume.task.id,
    temporaryTaskId: temporary.task.id,
    resumeTaskId: resume.task.id,
    reason: input.reason,
    snapshot: null,
    requestedBy: "user",
    approvedBy: "user",
    state: "approved",
    ownerSession: sessionId,
    createdAt: timestamp,
    activatedAt: "",
    resumeRequiredAt: "",
    resolvedAt: "",
    resumedAt: "",
  };
  return {
    ok: true,
    deviation: record,
    temporaryRef: taskCompositeRef(temporary.task, temporary.phase, features),
    resumeRef: taskCompositeRef(resume.task, resume.phase, features),
  };
}

// ── Session recovery ────────────────────────────────────────────────────

export type RecoveryRefusalCode =
  | "TASK_NOT_FOUND"
  | "SESSION_RECOVERY_CONFIRMATION_REQUIRED"
  | "SESSION_RECOVERY_AMBIGUOUS"
  | "SESSION_OWNER_UNVERIFIED"
  | "SESSION_OWNER_ACTIVE"
  | "SESSION_RECOVERY_CONFLICT"
  | "SESSION_RECOVERY_VERIFICATION_FAILED"
  | "SESSION_RECOVERY_FAILED";

const RECOVERY_REFUSAL_CODES: readonly RecoveryRefusalCode[] = [
  "TASK_NOT_FOUND",
  "SESSION_RECOVERY_CONFIRMATION_REQUIRED",
  "SESSION_RECOVERY_AMBIGUOUS",
  "SESSION_OWNER_UNVERIFIED",
  "SESSION_OWNER_ACTIVE",
  "SESSION_RECOVERY_CONFLICT",
  "SESSION_RECOVERY_VERIFICATION_FAILED",
];

export interface RecoveryRefusal {
  ok: false;
  code: RecoveryRefusalCode;
  message: string;
  taskId?: string;
}

export interface RecoverySuccess {
  ok: true;
  taskId: string;
  taskRef: string;
  phaseRef: string;
  featureRef: string;
  /** Task ids whose active ownership moved to the recovering session. */
  taskIds: string[];
  /** Deviation ids whose owner session moved to the recovering session. */
  deviationIds: string[];
}

/**
 * Recover a stopped caller's ownership into this connection. The store
 * verifies the previous process is gone and that this caller owns no work
 * already; task statuses, checkpoints and read gates are untouched.
 */
export async function recoverSessionFlow(
  store: PlanStore,
  sessionId: string,
  ref: string,
  confirmed: boolean,
): Promise<RecoverySuccess | RecoveryRefusal> {
  const featuresDoc = await store.loadFeatures();
  const features = featuresDoc.features;
  const found = findTaskByRef(await store.loadAllPhases(), features, ref);
  if (!found) {
    return { ok: false, code: "TASK_NOT_FOUND", message: `Task not found: ${ref}` };
  }
  const parentFeature = found.phase.featureId
    ? features.find((candidate) => candidate.id === found.phase.featureId)
    : undefined;
  try {
    const result = await store.recoverSessionForTask(found.phase.id, found.task.id, sessionId, confirmed);
    await store.writeGenerated();
    return {
      ok: true,
      taskId: found.task.id,
      taskRef: taskCompositeRef(found.task, found.phase, features),
      phaseRef: formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features)),
      featureRef: parentFeature ? formatFeatureRef(parentFeature.number) : "",
      taskIds: result.taskIds,
      deviationIds: result.deviationIds,
    };
  } catch (error) {
    const rawCode = error instanceof PlanStoreError && typeof error.details?.errorCode === "string"
      ? error.details.errorCode
      : "";
    return {
      ok: false,
      code: RECOVERY_REFUSAL_CODES.find((candidate) => candidate === rawCode) ?? "SESSION_RECOVERY_FAILED",
      message: error instanceof Error ? error.message : "unknown error",
      taskId: found.task.id,
    };
  }
}
