/**
 * Task lifecycle transitions (P128(F025)/T490 — lifecycle family).
 *
 * Starting a task is domain orchestration: readiness, context receipts,
 * ownership, deviation bookkeeping and persistence verification. The
 * MCP tool and the versioned API run this same flow; adapters render
 * their own refusals and success lines from the facts returned here.
 */

import { createChecklistItemId, formatFeatureRef, formatPhaseRef, taskCompositeRef, featureNumberOfPhase } from "./naming.js";
import { findTaskByRef } from "./refs.js";
import {
  contextReadEligibilityForSession,
  hasValidSessionAttestation,
  projectGuidelinesReadStateForSession,
  requirementReadEligibilityForSession,
  type ContextReadEligibility,
  type ProjectGuidelinesReadState,
  type RequiredContextRead,
} from "./read-tracking.js";
import { buildPhaseContextBlock } from "./task-context.js";
import {
  buildResumeRequiredProposal,
  checkExplicitTaskStart,
  recommendNextTask,
  type ExplicitTaskStartEligibility,
  type TaskRecommendation,
} from "./task-selection.js";
import { findHigherPriorityOpenPhase, type OpenPhaseWork } from "./stranded-phase.js";
import type { TaskStartErrorCode } from "./task-start-outcome.js";
import { PlanStoreError, nowISO } from "./plan-store.js";
import { applyTaskLifecycleDates } from "./task-lifecycle.js";
import {
  evaluateTaskCompletionGate,
  taskCompletionChecklistRefusal,
  taskCompletionForceMotivationRequired,
  taskCompletionOverrideNote,
} from "./task-completion-gate.js";
import type { ChecklistItem, PlanStore, StatusLogEntry, Task, TaskPauseSnapshot } from "./index.js";

export type TaskStartFlowRefusalCode = Exclude<TaskStartErrorCode, "PLAN_NOT_FOUND">;

/**
 * Domain facts behind a refusal. Adapters echo the ones their own
 * envelope promises; they are never a second source of truth.
 */
export interface TaskStartRefusalEvidence {
  contextEligibility?: ContextReadEligibility;
  requirementEligibility?: ContextReadEligibility;
  startEligibility?: ExplicitTaskStartEligibility;
  selection?: TaskRecommendation;
}

export interface TaskStartRefusal {
  ok: false;
  code: TaskStartFlowRefusalCode;
  message: string;
  taskId?: string;
  requirementIds?: string[];
  /** Everything an adapter needs to compose surface-specific next actions. */
  context: {
    taskRef: string;
    phaseRef: string;
    featureRef: string;
    requiredReads?: RequiredContextRead[] | undefined;
    projectGuidelinesReadState?: ProjectGuidelinesReadState | undefined;
    requirementReadRequired?: boolean | undefined;
    /** True when the refusal came from re-claiming an already in-progress task. */
    wasInProgress?: boolean | undefined;
    /** Set on ACTIVE_TASK_CONFLICT when a different task is the active one. */
    activeTaskRef?: string | undefined;
  };
  evidence?: TaskStartRefusalEvidence;
}

export interface TaskStartSuccess {
  ok: true;
  /** True when the task was already in-progress and ownership was re-claimed. */
  alreadyStarted: boolean;
  task: Task;
  taskRef: string;
  phaseRef: string;
  featureRef: string;
  /** Mandatory parent context block; empty on the already-started path. */
  phaseContext: string;
  /** Which advisory applies to an explicit request that differs from the recommendation. */
  advisory: "resume" | "priority" | null;
  /** Canonical ref of the task the recommendation preferred, when it differs. */
  recommendedTaskRef?: string;
  /** Canonical ref of the priority recommendation, when `advisory` is "priority". */
  priorityAdvisoryRef?: string;
  resumeRequired?: ReturnType<typeof buildResumeRequiredProposal>;
  projectContextStale: boolean;
  higherPriorityOpenPhase: OpenPhaseWork | null;
}

export type TaskStartFlowOutcome = TaskStartSuccess | TaskStartRefusal;

function refusal(
  code: TaskStartFlowRefusalCode,
  message: string,
  context: TaskStartRefusal["context"],
  details: { taskId?: string; requirementIds?: string[] } = {},
  evidence: TaskStartRefusalEvidence = {},
): TaskStartRefusal {
  return {
    ok: false,
    code,
    message,
    ...(details.taskId ? { taskId: details.taskId } : {}),
    ...(details.requirementIds ? { requirementIds: details.requirementIds } : {}),
    context,
    ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
  };
}

/** Narrow a store error code to a lifecycle refusal code. */
function storeErrorCode(error: PlanStoreError): TaskStartFlowRefusalCode {
  const code = typeof error.details?.errorCode === "string" ? error.details.errorCode : "";
  return (code || "PERSISTENCE_VERIFICATION_FAILED") as TaskStartFlowRefusalCode;
}

/**
 * Start (or re-claim) one task for a session. Every denial is a typed
 * refusal; nothing is written when a gate fails.
 */
export async function startTaskFlow(store: PlanStore, sessionId: string, ref: string): Promise<TaskStartFlowOutcome> {
  return store.runBatch(async () => {
    const features = (await store.loadFeatures()).features;
    const initialPhases = await store.loadAllPhases();
    const found = findTaskByRef(initialPhases, features, ref);
    if (!found) {
      return refusal("TASK_NOT_FOUND", `Task not found: ${ref}`, { taskRef: ref, phaseRef: "", featureRef: "" });
    }
    const taskRef = taskCompositeRef(found.task, found.phase, features);
    const phaseRef = formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features));
    const parentFeature = found.phase.featureId ? features.find((candidate) => candidate.id === found.phase.featureId) : undefined;
    const featureRef = parentFeature ? formatFeatureRef(parentFeature.number) : "";
    const baseContext = { taskRef, phaseRef, featureRef };

    if (found.task.status === "done") {
      return refusal(
        "TASK_DONE",
        `Task ${taskRef} is done and was not reopened.`,
        baseContext,
        { taskId: found.task.id },
      );
    }

    const project = await store.loadProject(sessionId);
    // Targeted stale-context refresh (P102(F005)/T404): task-start delivery
    // stays scoped to feature/phase/task context, but a session that already
    // did a full planner-load gets a non-blocking advisory when project-level
    // context has drifted since, instead of silently going stale.
    const projectContextReadState = await store.projectContextReadStateForSession(sessionId);
    const linkedRequirements = [
      ...(await store.linkedRequirementsForPhase(found.phase.id)),
      ...(found.phase.featureId ? await store.linkedRequirementsForFeature(found.phase.featureId) : []),
    ].filter((requirement, index, all) => all.findIndex((candidate) => candidate.id === requirement.id) === index);
    const linkedRequirementIds = linkedRequirements.map((requirement) => requirement.id);
    const contextInput = {
      sessionId,
      taskId: found.task.id,
      phaseId: found.phase.id,
      ...(found.phase.featureId ? { featureId: found.phase.featureId } : {}),
      task: found.task,
      phase: found.phase,
      ...(parentFeature ? { feature: parentFeature } : {}),
      requirements: linkedRequirements,
      requirementIds: linkedRequirementIds,
    };
    const contextEligibility = contextReadEligibilityForSession(contextInput);
    const requirementEligibility = requirementReadEligibilityForSession(sessionId, linkedRequirementIds, linkedRequirements);
    const requirementsReady = requirementEligibility.eligible;
    const projectGuidelinesReadState = projectGuidelinesReadStateForSession(project, sessionId);
    const projectGuidelinesReady = projectGuidelinesReadState === "valid" || projectGuidelinesReadState === "not-required";

    if (!projectGuidelinesReady) {
      return refusal(
        "PROJECT_GUIDELINES_READ_REQUIRED",
        `Project Guidelines must be read before task work. Current state: ${projectGuidelinesReadState}.`,
        { ...baseContext, projectGuidelinesReadState, requiredReads: contextEligibility.requiredReads, requirementReadRequired: !requirementsReady },
        { taskId: found.task.id },
        { contextEligibility },
      );
    }
    if (!contextEligibility.eligible) {
      return refusal(
        "CONTEXT_READ_REQUIRED",
        `Required context reads are incomplete or stale. ${contextEligibility.reason}`,
        { ...baseContext, requiredReads: contextEligibility.requiredReads, requirementReadRequired: !requirementsReady },
        { taskId: found.task.id },
        { contextEligibility },
      );
    }
    if (!requirementsReady) {
      return refusal(
        "REQUIREMENTS_READ_REQUIRED",
        `Linked requirements were not read; the task remains unchanged. ${requirementEligibility.reason}`,
        { ...baseContext, requirementReadRequired: true },
        { taskId: found.task.id, requirementIds: linkedRequirementIds },
        { requirementEligibility },
      );
    }
    if (!hasValidSessionAttestation(contextInput)) {
      await store.recordContextRead({
        sessionId,
        phaseId: found.phase.id,
        taskId: found.task.id,
        ...(found.phase.featureId ? { featureId: found.phase.featureId } : {}),
        requirementIds: linkedRequirementIds,
      });
    }

    if (found.task.status === "in-progress") {
      let claimed;
      try {
        claimed = await store.claimTask(found.phase.id, found.task.id, sessionId);
      } catch (error) {
        if (!(error instanceof PlanStoreError)) throw error;
        return refusal(storeErrorCode(error), error.message, { ...baseContext, wasInProgress: true }, { taskId: found.task.id });
      }
      return {
        ok: true,
        alreadyStarted: true,
        task: claimed.task,
        taskRef,
        phaseRef,
        featureRef,
        phaseContext: "",
        advisory: null,
        projectContextStale: projectContextReadState === "stale",
        higherPriorityOpenPhase: findHigherPriorityOpenPhase(initialPhases, features, found.phase.id, found.phase.priority ?? found.phase.number),
      };
    }

    const [phases, focus] = await Promise.all([store.loadAllPhases(), store.loadResume(sessionId)]);
    const eligibility = checkExplicitTaskStart(features, phases, found.task.id, project.workDeviations);
    if (!eligibility.eligible) {
      return refusal("START_NOT_ALLOWED", eligibility.reason, baseContext, { taskId: found.task.id }, { startEligibility: eligibility });
    }
    const selection = (recommendNextTask as any)(features, phases, await store.listAllWorkDeviations(), focus?.currentPhaseId, sessionId);
    if (selection.kind === "conflict") {
      return refusal("ACTIVE_TASK_CONFLICT", selection.reason, baseContext, { taskId: found.task.id }, { selection });
    }
    if (selection.kind === "active" && selection.candidate?.task.id !== found.task.id) {
      const activeRef = taskCompositeRef(selection.candidate!.task, selection.candidate!.phase, features);
      return refusal(
        "ACTIVE_TASK_CONFLICT",
        `${activeRef} is active; ${taskRef} was not started.`,
        { ...baseContext, activeTaskRef: activeRef },
        { taskId: found.task.id },
        { selection },
      );
    }
    let resumeRequired: ReturnType<typeof buildResumeRequiredProposal> | undefined;
    if (selection.kind === "resume" && selection.candidate && selection.candidate.task.id !== found.task.id) {
      // Advisory only: a pending resume must be surfaced loudly, but it must
      // not hard-block an explicit start of a different task.
      const resumeTask = selection.candidate;
      const resumeSnapshot = resumeTask.task.pauseSnapshot
        ?? project.workDeviations.find((deviation) => deviation.resumeTaskId === resumeTask.task.id
          && (deviation.state === "resume-required" || deviation.state === "resolved"))?.snapshot
        ?? null;
      resumeRequired = buildResumeRequiredProposal({
        ref: taskCompositeRef(resumeTask.task, resumeTask.phase, features),
        title: resumeTask.task.title,
        taskId: resumeTask.task.id,
        phaseId: resumeTask.phase.id,
        snapshot: resumeSnapshot
          ? { reason: resumeSnapshot.reason, resumeLocation: resumeSnapshot.resumeLocation, howToResume: resumeSnapshot.howToResume }
          : null,
      });
    }

    // Assemble the mandatory parent context before changing task lifecycle state.
    const [phaseWithRequirements, featureRequirements] = await Promise.all([
      store.loadPhaseWithRequirements(found.phase.id),
      parentFeature ? store.linkedRequirementsForFeature(parentFeature.id) : Promise.resolve([]),
    ]);
    const phaseContext = buildPhaseContextBlock(
      phaseWithRequirements,
      parentFeature,
      phaseWithRequirements.linkedRequirements ?? [],
      featureRequirements,
      found.task,
      project,
    );

    const differsFromSelection = Boolean(selection.candidate && selection.candidate.task.id !== found.task.id);
    const advisory: TaskStartSuccess["advisory"] = differsFromSelection
      ? selection.kind === "resume" ? "resume" : "priority"
      : null;
    const recommendedTaskRef = selection.candidate && differsFromSelection
      ? taskCompositeRef(selection.candidate.task, selection.candidate.phase, features)
      : undefined;
    const priorityAdvisoryRef = differsFromSelection && selection.kind !== "resume" && selection.candidate
      ? recommendedTaskRef
      : undefined;
    const timestamp = nowISO();

    let updatedTask: Task | undefined;
    try {
      updatedTask = (await store.claimTask(found.phase.id, found.task.id, sessionId, timestamp)).task;
    } catch (error) {
      if (!(error instanceof PlanStoreError)) throw error;
      return refusal(storeErrorCode(error), error.message, baseContext, { taskId: found.task.id });
    }
    await store.syncTaskStatusRollup(found.phase.id);
    const approvedDeviation = project.workDeviations.find((deviation) =>
      deviation.temporaryTaskId === found.task.id && deviation.state === "approved",
    );
    if (approvedDeviation) await store.setWorkDeviationState(approvedDeviation.id, "active", timestamp);
    const resumedDeviation = project.workDeviations
      .filter((deviation) => deviation.resumeTaskId === found.task.id
        && (deviation.state === "resume-required" || deviation.state === "resolved"))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (resumedDeviation) await store.setWorkDeviationState(resumedDeviation.id, "resumed", timestamp);
    await store.writeGenerated();
    const persistedTask = (await store.loadPhase(found.phase.id)).tasks.find((candidate) => candidate.id === found.task.id);
    if (!updatedTask || persistedTask?.status !== "in-progress" || persistedTask.activeOwnerSession !== sessionId) {
      return refusal(
        "PERSISTENCE_VERIFICATION_FAILED",
        `The lifecycle write could not be verified as in-progress for ${taskRef}.`,
        baseContext,
        { taskId: found.task.id },
      );
    }
    return {
      ok: true,
      alreadyStarted: false,
      task: persistedTask,
      taskRef,
      phaseRef,
      featureRef,
      phaseContext,
      advisory,
      ...(recommendedTaskRef ? { recommendedTaskRef } : {}),
      ...(priorityAdvisoryRef ? { priorityAdvisoryRef } : {}),
      ...(resumeRequired ? { resumeRequired } : {}),
      projectContextStale: projectContextReadState === "stale",
      higherPriorityOpenPhase: findHigherPriorityOpenPhase(phases, features, found.phase.id, found.phase.priority ?? found.phase.number),
    };
  });
}

// ── Completion ──────────────────────────────────────────────────────────

export type TaskCompleteRefusalCode =
  | "TASK_NOT_FOUND"
  | "COMPLETION_EVIDENCE_REQUIRED"
  | "TASK_CHECKPOINT_PENDING"
  | "CHECKLIST_INCOMPLETE"
  | "FORCE_MOTIVATION_REQUIRED";

export interface TaskCompleteRefusal {
  ok: false;
  code: TaskCompleteRefusalCode;
  /** Surface-neutral refusal sentence. Adapters may render their own words. */
  message: string;
  taskId?: string;
  taskRef?: string;
  /** Open checklist items behind a checklist refusal. */
  uncheckedItems?: ChecklistItem[];
}

export interface TaskCompletionResumeRequired {
  taskId: string;
  phaseId: string;
  /** Canonical ref of the preserved task that must be resumed. */
  taskRef: string;
  title: string;
  snapshot: TaskPauseSnapshot | null;
}

export interface TaskCompleteSuccess {
  ok: true;
  task: Task;
  taskRef: string;
  phaseRef: string;
  featureRef: string;
  /** Handoff reference the derived-status rollup auto-cleared, if any. */
  clearedHandoffRef: string | null;
  /** Set when this completion ended temporary work: the resume target is now mandatory. */
  resumeRequired?: TaskCompletionResumeRequired;
}

export interface CompleteTaskInput {
  task: string;
  /** Override open checklist items; requires `motivation`. */
  force?: boolean | undefined;
  motivation?: string | undefined;
  /** Durable completion and verification evidence. */
  descriptionUpdate: string;
}

/**
 * Complete one task: evidence and checklist gate, status-log entry,
 * description append, derived-status rollup (which may clear the phase
 * handoff), deviation transition to resume-required and, when that
 * happens, the preserved task the caller must return to.
 */
export async function completeTaskFlow(
  store: PlanStore,
  sessionId: string,
  input: CompleteTaskInput,
): Promise<TaskCompleteSuccess | TaskCompleteRefusal> {
  const features = (await store.loadFeatures()).features;
  const found = findTaskByRef(await store.loadAllPhases(), features, input.task);
  if (!found) {
    return { ok: false, code: "TASK_NOT_FOUND", message: `Task not found: ${input.task}` };
  }
  const taskRef = taskCompositeRef(found.task, found.phase, features);
  const parentFeature = found.phase.featureId ? features.find((candidate) => candidate.id === found.phase.featureId) : undefined;
  const phaseRef = formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features));
  const featureRef = parentFeature ? formatFeatureRef(parentFeature.number) : "";

  const completionSummary = input.descriptionUpdate.trim();
  if (completionSummary.length < 10) {
    return {
      ok: false,
      code: "COMPLETION_EVIDENCE_REQUIRED",
      message: "Task completion denied: provide at least 10 characters of durable completion and verification evidence.",
      taskId: found.task.id,
      taskRef,
    };
  }
  if (found.task.pauseSnapshot) {
    return {
      ok: false,
      code: "TASK_CHECKPOINT_PENDING",
      message: "Task completion denied: resume checkpointed work with the lifecycle start operation before completing it, or cancel it explicitly with motivation.",
      taskId: found.task.id,
      taskRef,
    };
  }
  const gate = evaluateTaskCompletionGate(found.task.checklist, input.force === true, input.motivation);
  if (!gate.allowed) {
    const refusalCode: TaskCompleteRefusalCode = gate.errorCode === "FORCE_MOTIVATION_REQUIRED"
      ? "FORCE_MOTIVATION_REQUIRED"
      : "CHECKLIST_INCOMPLETE";
    return {
      ok: false,
      code: refusalCode,
      message: gate.errorCode === "FORCE_MOTIVATION_REQUIRED"
        ? taskCompletionForceMotivationRequired(gate.uncheckedItems)
        : taskCompletionChecklistRefusal(gate.uncheckedItems, "the checklist toggle operation"),
      taskId: found.task.id,
      taskRef,
      uncheckedItems: gate.uncheckedItems,
    };
  }

  const overrideNote = taskCompletionOverrideNote(gate.overriddenItems, input.motivation);
  const completionEvidence = overrideNote ? `${completionSummary}\n\n${overrideNote}` : completionSummary;
  const timestamp = nowISO();
  let updatedTask: Task | undefined;
  await store.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) return phase;
    const previousStatus = task.status;
    applyTaskLifecycleDates(task, "done", timestamp);
    const entry: StatusLogEntry = {
      id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${previousStatus}-done`),
      date: timestamp,
      fromStatus: previousStatus,
      toStatus: "done",
      title: `${previousStatus} → done`,
      description: completionEvidence,
    };
    task.statusLog = [...(task.statusLog ?? []), entry];
    const separator = task.description ? "\n\n---\n**Completion summary:**\n" : "**Completion summary:**\n";
    task.description = task.description + separator + completionEvidence;
    task.descriptionUpdatedAt = timestamp;
    task.updatedAt = timestamp;
    phase.updatedAt = timestamp;
    updatedTask = task;
    return phase;
  });
  const clearedHandoffRef = await store.syncTaskStatusRollup(found.phase.id);

  const completedDeviation = (await store.loadProject(sessionId)).workDeviations
    .filter((deviation) => (deviation.state === "approved" || deviation.state === "active") && deviation.temporaryTaskId === found.task.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (completedDeviation) await store.setWorkDeviationState(completedDeviation.id, "resume-required", timestamp);

  const refreshedFeatures = (await store.loadFeatures()).features;
  const completedTask = updatedTask ?? found.task;
  let resumeRequired: TaskCompletionResumeRequired | undefined;
  if (completedDeviation) {
    const resume = findTaskByRef(await store.loadAllPhases(), refreshedFeatures, completedDeviation.resumeTaskId);
    if (resume) {
      resumeRequired = {
        taskId: resume.task.id,
        phaseId: resume.phase.id,
        taskRef: taskCompositeRef(resume.task, resume.phase, refreshedFeatures),
        title: resume.task.title,
        snapshot: resume.task.pauseSnapshot ?? completedDeviation.snapshot,
      };
    }
  }

  await store.writeGenerated();
  return {
    ok: true,
    task: completedTask,
    taskRef,
    phaseRef,
    featureRef,
    clearedHandoffRef,
    ...(resumeRequired ? { resumeRequired } : {}),
  };
}
