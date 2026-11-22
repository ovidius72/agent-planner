/**
 * Context delivery and read receipts (P128(F025)/T490 — context family).
 *
 * A registered session asks for the context it must hold before doing
 * work: project-level context, Project Guidelines, phase requirements,
 * and full feature/phase/task reads. The flow returns the delivered
 * content and records the matching receipt, so lifecycle gates later
 * verify what the session actually received instead of trusting a flag.
 *
 * Receipts are revision-bound: a persisted read satisfies the gate only
 * while the entity revision it covered is current (read-tracking.ts).
 */

import { formatFeatureRef, formatPhaseRef } from "./naming.js";
import { renderAcceptedDecisionsSection } from "./task-context.js";
import {
  contextReadEligibilityForSession,
  markCanonicalFullReadForSessionId,
  markRequirementReadForSessionId,
  projectGuidelinesReadStateForSession,
  requirementReadEligibilityForSession,
  type ContextReadEligibility,
  type ProjectGuidelinesReadState,
} from "./read-tracking.js";
import { taskStartGateState } from "./task-start-outcome.js";
import { showFeature, showPhase, showTask, type TaskShowOutcome } from "./show-flow.js";
import type { Feature, Phase, PlanStore, Project, Requirement, Task } from "./index.js";
import type { CompleteProjectContextDelivery } from "./project-context.js";

export type ContextFlowRefusal = {
  ok: false;
  code: "FEATURE_NOT_FOUND" | "FEATURE_REF_AMBIGUOUS" | "PHASE_NOT_FOUND" | "TASK_NOT_FOUND";
  message: string;
};

function featureContextText(feature: Feature, ref: string): string {
  const sections = [`${feature.name} — ${ref}${feature.shortId ? ` · ${feature.shortId}` : ""} (${feature.status})`];
  if (feature.description?.trim()) sections.push(feature.description.trim());
  if (feature.descriptionRef) sections.push(`Description reference:\n- ${feature.descriptionRef}`);
  sections.push(renderAcceptedDecisionsSection("Accepted Decisions", feature.acceptedDecisions));
  return sections.join("\n\n");
}

function phaseContextText(phase: Phase, ref: string, requirements: readonly Requirement[]): string {
  const sections = [`${phase.title} — ${ref}${phase.shortId ? ` · ${phase.shortId}` : ""} (${phase.status}; ${phase.tasks.length} tasks)`];
  if (phase.summary?.trim()) sections.push(phase.summary.trim());
  if (phase.description?.trim()) sections.push(phase.description.trim());
  if (phase.descriptionRef) sections.push(`Description reference:\n- ${phase.descriptionRef}`);
  if (requirements.length > 0) {
    sections.push(`Linked requirements (${requirements.length}):\n${requirements.map((requirement) => `- ${requirement.title}${requirement.description?.trim() ? ` — ${requirement.description.trim()}` : ""}`).join("\n")}`);
  }
  sections.push(renderAcceptedDecisionsSection("Accepted Decisions", phase.acceptedDecisions));
  return sections.join("\n\n");
}

function taskContextText(task: Task, ref: string, phaseRef: string, linkedRequirements: readonly Requirement[]): string {
  const sections = [`${task.title} — ${ref}${task.shortId ? ` · ${task.shortId}` : ""} (${task.status}; phase ${phaseRef})`];
  if (task.description?.trim()) sections.push(task.description.trim());
  if (task.descriptionRef) sections.push(`Description reference:\n- ${task.descriptionRef}`);
  if (task.checklist.length > 0) {
    sections.push(`Checklist (${task.checklist.filter((item) => item.checked).length}/${task.checklist.length} done):\n${task.checklist.map((item) => `- [${item.checked ? "x" : " "}] ${item.title}`).join("\n")}`);
  }
  if (task.pauseSnapshot) {
    sections.push([
      "Resume checkpoint:",
      `Checkpoint reason: ${task.pauseSnapshot.reason}`,
      `Work checkpoint: ${task.pauseSnapshot.whatWasBeingDone}`,
      `Resume from: ${task.pauseSnapshot.resumeLocation}`,
      `How to resume: ${task.pauseSnapshot.howToResume}`,
    ].join("\n"));
  }
  if (linkedRequirements.length > 0) {
    sections.push(`Linked requirements (${linkedRequirements.length}):\n${linkedRequirements.map((requirement) => `- ${requirement.title}${requirement.description?.trim() ? ` — ${requirement.description.trim()}` : ""}`).join("\n")}`);
  }
  sections.push(renderAcceptedDecisionsSection("Accepted Decisions", task.acceptedDecisions));
  return sections.join("\n\n");
}

export interface FeatureContextOutcome {
  ref: string;
  feature: Feature;
  /** Delivered text; exactly what the receipt attests. */
  text: string;
  attested: true;
}

/** Deliver one feature in full and record the session's read. */
export async function readFeatureContextFlow(store: PlanStore, sessionId: string, ref: string): Promise<({ ok: true } & FeatureContextOutcome) | ContextFlowRefusal> {
  const outcome = await showFeature(store, ref);
  if (!outcome.ok) return outcome;
  const text = featureContextText(outcome.feature, outcome.ref);
  markCanonicalFullReadForSessionId(sessionId, "feature", outcome.feature, text);
  return { ok: true, ref: outcome.ref, feature: outcome.feature, text, attested: true };
}

export interface PhaseContextOutcome {
  ref: string;
  phase: Phase;
  linkedRequirements: Requirement[];
  text: string;
  attested: true;
}

/** Deliver one phase in full, with its linked requirements, and record the read. */
export async function readPhaseContextFlow(store: PlanStore, sessionId: string, ref: string): Promise<({ ok: true } & PhaseContextOutcome) | ContextFlowRefusal> {
  const outcome = await showPhase(store, ref);
  if (!outcome.ok) return outcome;
  const text = phaseContextText(outcome.phase, outcome.ref, outcome.linkedRequirements);
  markCanonicalFullReadForSessionId(sessionId, "phase", outcome.phase, text);
  return { ok: true, ref: outcome.ref, phase: outcome.phase, linkedRequirements: outcome.linkedRequirements, text, attested: true };
}

/** The start gate as the read leaves it: what this delivery did not satisfy. */
export interface TaskContextGate {
  contextEligibility: ContextReadEligibility;
  requirementEligibility: ContextReadEligibility;
  projectGuidelinesReadState: ProjectGuidelinesReadState;
  state: ReturnType<typeof taskStartGateState>;
}

export interface TaskContextOutcome {
  ref: string;
  phaseRef: string;
  featureRef: string | null;
  task: Task;
  phase: Phase;
  feature: Feature | null;
  linkedRequirements: Requirement[];
  /** The same order/resume view planner-task-show renders. */
  orderContext: TaskShowOutcome["orderContext"];
  snapshot: TaskShowOutcome["snapshot"];
  pendingDeviation: TaskShowOutcome["pendingDeviation"];
  gate: TaskContextGate;
  /** Text for the task, its phase and its feature; all three receipts attest to these. */
  taskText: string;
  phaseText: string;
  featureText: string | null;
  /** Requirement receipts recorded for this session. */
  attestedRequirementIds: string[];
  /** True when the durable task/phase/feature read was persisted. */
  persisted: boolean;
}

/**
 * Deliver the complete context of one task — task, parent phase, parent
 * feature and linked requirements — and record revision-sensitive durable
 * attestations for the lifecycle gates. This is the v2
 * equivalent of the MCP sequence task show → phase show → feature show →
 * requirement list, done in one call and verified the same way.
 */
export async function readTaskContextFlow(store: PlanStore, sessionId: string, ref: string): Promise<({ ok: true } & TaskContextOutcome) | ContextFlowRefusal> {
  return store.runBatch(async () => {
    const outcome = await showTask(store, ref, { sessionId });
    if (!outcome.ok) return outcome;
    const { task, phase, feature, linkedRequirements } = outcome;

    const taskText = taskContextText(task, outcome.ref, outcome.phaseRef, linkedRequirements);
    const phaseText = phaseContextText(phase, outcome.phaseRef, linkedRequirements);
    const featureText = feature ? featureContextText(feature, formatFeatureRef(feature.number)) : null;

    const requirementIds = linkedRequirements.map((requirement) => requirement.id);
    const receipt = await store.recordContextRead({
      sessionId,
      taskId: task.id,
      phaseId: phase.id,
      ...(phase.featureId ? { featureId: phase.featureId } : {}),
      requirementIds,
    });

    const project = await store.loadProject();
    // The durable receipt is revision-sensitive. A plain in-memory read mark
    // would let a later mutation defeat that freshness check.
    const contextEligibility = contextReadEligibilityForSession({
      sessionId,
      taskId: task.id,
      phaseId: phase.id,
      ...(receipt.feature ? { featureId: receipt.feature.id, feature: receipt.feature } : {}),
      task: receipt.phase.tasks.find((entry) => entry.id === task.id)!,
      phase: receipt.phase,
      requirements: receipt.requirements,
      requirementIds,
    });
    const requirementEligibility = requirementReadEligibilityForSession(sessionId, requirementIds, receipt.requirements);
    const projectGuidelinesReadState = projectGuidelinesReadStateForSession(project, sessionId);
    return {
      ok: true,
      ref: outcome.ref,
      phaseRef: outcome.phaseRef,
      featureRef: outcome.featureRef || null,
      task,
      phase,
      feature: feature ?? null,
      linkedRequirements,
      orderContext: outcome.orderContext,
      snapshot: outcome.snapshot,
      pendingDeviation: outcome.pendingDeviation,
      gate: {
        contextEligibility,
        requirementEligibility,
        projectGuidelinesReadState,
        state: taskStartGateState(contextEligibility, requirementEligibility, projectGuidelinesReadState),
      },
      taskText,
      phaseText,
      featureText,
      attestedRequirementIds: requirementIds,
      persisted: true,
    };
  });
}

export interface PhaseRequirementsOutcome {
  phaseRef: string;
  phaseId: string;
  featureId: string | undefined;
  requirements: Requirement[];
  attestedRequirementIds: string[];
}

/** Deliver the requirements linked to one phase (or its feature) and record the read. */
export async function readPhaseRequirementsFlow(store: PlanStore, sessionId: string, ref: string): Promise<({ ok: true } & PhaseRequirementsOutcome) | ContextFlowRefusal> {
  const outcome = await showPhase(store, ref);
  if (!outcome.ok) return outcome;
  const requirements = outcome.linkedRequirements;
  requirements.forEach((requirement) => markRequirementReadForSessionId(sessionId, requirement.id));
  return {
    ok: true,
    phaseRef: formatPhaseRef(outcome.phase.number, outcome.featureNumber),
    phaseId: outcome.phase.id,
    featureId: outcome.phase.featureId,
    requirements,
    attestedRequirementIds: requirements.map((requirement) => requirement.id),
  };
}

export interface ProjectContextOutcome {
  delivery: CompleteProjectContextDelivery;
  /** True when the whole project context fit in the response bound. */
  contextComplete: boolean;
  /** True when the complete delivery was attested for this session. */
  attested: boolean;
  maxChars: number;
}

/**
 * Deliver project-level context. A delivery split across chunks is
 * reported as incomplete and not attested: callers must retry with a
 * larger bound, exactly like planner-load.
 */
export async function readProjectContextFlow(store: PlanStore, sessionId: string, maxChars?: number | undefined): Promise<ProjectContextOutcome> {
  const delivery = await store.loadProjectContextDelivery(maxChars);
  const contextComplete = delivery.chunks.length <= 1;
  let attested = false;
  if (contextComplete) {
    await store.recordProjectContextRead({ sessionId, chunks: delivery.chunks });
    attested = true;
  }
  return { delivery, contextComplete, attested, maxChars: maxChars ?? 0 };
}

export interface ProjectGuidelinesOutcome {
  projectGuidelines: Project["projectGuidelines"];
  readRecorded: boolean;
}

/** Deliver the canonical Project Guidelines and stamp the session's read. */
export async function readProjectGuidelinesFlow(store: PlanStore, sessionId: string): Promise<ProjectGuidelinesOutcome> {
  const project = await store.loadProject();
  const content = project.projectGuidelines.content.trim();
  if (content) await store.recordProjectGuidelinesRead({ sessionId });
  const refreshed = await store.loadProject();
  return { projectGuidelines: refreshed.projectGuidelines, readRecorded: Boolean(content) };
}
