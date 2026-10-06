/**
 * Agent Plan API v1 — the contract for programs outside Agent Plan.
 *
 * The stored schemas (schema.ts) are internal and change freely. The views in
 * this file are what outside programs are promised: every field is picked by
 * name, so a stored-schema change can never leak into the contract. Adding a
 * field keeps `API_V1_VERSION`; removing or renaming one, or changing what it
 * means, needs a new version (see docs/api-v1.md).
 *
 * Harness-agnostic: no server, Pi or MCP imports. The HTTP routes, the change
 * events and any other adapter build on these same mappers.
 */

import { formatFeatureRef, formatIdeaRef, formatPhaseRef, formatThreeDigitNumber } from "./naming.js";
import type { AcceptedDecision, Feature, Idea, Phase, Project, Task } from "./schema.js";

export const API_V1_VERSION = "1";

export interface ApiV1Envelope<T> {
  apiVersion: typeof API_V1_VERSION;
  data: T;
}

export interface ApiV1ErrorEnvelope {
  apiVersion: typeof API_V1_VERSION;
  error: { code: string; message: string };
}

export function apiV1Envelope<T>(data: T): ApiV1Envelope<T> {
  return { apiVersion: API_V1_VERSION, data };
}

export function apiV1Error(code: string, message: string): ApiV1ErrorEnvelope {
  return { apiVersion: API_V1_VERSION, error: { code, message } };
}

export type ApiV1EntityKind = "project" | "feature" | "phase" | "task" | "decision" | "handoff" | "idea";

export interface ApiV1Project {
  name: string;
  description: string;
  goal: string;
  guidelines: string;
  guidelinesUpdatedAt: string;
  scope: string[];
  outOfScope: string[];
  technologies: string[];
  tools: string[];
  contentLanguage: string;
  chatLanguage: string;
}

export interface ApiV1Feature {
  id: string;
  ref: string;
  shortId: string;
  number: number;
  name: string;
  description: string;
  status: string;
  priority: number;
  startDate: string;
  endDate: string;
  workDone: string;
  workRemaining: string;
  phaseRefs: string[];
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiV1Phase {
  id: string;
  ref: string;
  shortId: string;
  number: number;
  featureRef: string | null;
  title: string;
  summary: string;
  description: string;
  status: string;
  priority: number;
  goals: string[];
  dependsOn: string[];
  taskRefs: string[];
  hasHandoff: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiV1ChecklistItem {
  id: string;
  number: number;
  title: string;
  checked: boolean;
}

export interface ApiV1TaskPause {
  reason: string;
  resumeLocation: string;
  pausedAt: string;
}

export interface ApiV1Task {
  id: string;
  ref: string;
  shortId: string;
  number: number;
  phaseRef: string;
  featureRef: string | null;
  title: string;
  description: string;
  status: string;
  priority: number;
  checklist: ApiV1ChecklistItem[];
  dependsOn: string[];
  pause: ApiV1TaskPause | null;
  startedAt: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type ApiV1DecisionOwnerKind = "project" | "feature" | "phase" | "task";

export interface ApiV1AcceptedDecision {
  id: string;
  ref: string;
  title: string;
  decision: string;
  rationale: string;
  implementationNotes: string;
  acceptedAt: string;
  owner: { kind: ApiV1DecisionOwnerKind; ref: string | null };
}

export interface ApiV1Handoff {
  phaseRef: string;
  content: string;
  updatedAt: string;
  resumeReady: boolean;
  resumeReadyAt: string;
}

export interface ApiV1Idea {
  id: string;
  ref: string;
  shortId: string;
  number: number;
  title: string;
  description: string;
  promotion: { targetType: string; targetRef: string; promotedAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** Refs for every entity that other entities point at, built once per model. */
export interface ApiV1RefContext {
  featureRefById: ReadonlyMap<string, string>;
  phaseRefById: ReadonlyMap<string, string>;
  taskRefById: ReadonlyMap<string, string>;
}

export interface ApiV1Source {
  project: Project;
  features: readonly Feature[];
  phases: readonly Phase[];
  ideas: readonly Idea[];
}

export interface ApiV1Model {
  project: ApiV1Project;
  features: ApiV1Feature[];
  phases: ApiV1Phase[];
  tasks: ApiV1Task[];
  decisions: ApiV1AcceptedDecision[];
  handoffs: ApiV1Handoff[];
  ideas: ApiV1Idea[];
}

/** A phase in one of these statuses has no active handoff (it is archived). */
const TERMINAL_PHASE_STATUSES: ReadonlySet<string> = new Set(["done", "canceled", "rejected"]);

export function formatTaskRef(phaseRef: string, taskNumber: number): string {
  return `${phaseRef}/T${formatThreeDigitNumber(taskNumber)}`;
}

export function buildApiV1RefContext(features: readonly Feature[], phases: readonly Phase[]): ApiV1RefContext {
  const featureNumberById = new Map(features.map((feature) => [feature.id, feature.number]));
  const featureRefById = new Map(features.map((feature) => [feature.id, formatFeatureRef(feature.number)]));
  const phaseRefById = new Map<string, string>();
  const taskRefById = new Map<string, string>();
  for (const phase of phases) {
    const featureNumber = phase.featureId ? featureNumberById.get(phase.featureId) : undefined;
    const phaseRef = formatPhaseRef(phase.number, featureNumber);
    phaseRefById.set(phase.id, phaseRef);
    for (const task of phase.tasks) taskRefById.set(task.id, formatTaskRef(phaseRef, task.number));
  }
  return { featureRefById, phaseRefById, taskRefById };
}

/** A dependency that no longer resolves keeps its stored id rather than vanishing. */
function refsOf(ids: readonly string[], refById: ReadonlyMap<string, string>): string[] {
  return ids.map((id) => refById.get(id) ?? id);
}

export function toApiV1Project(project: Project): ApiV1Project {
  return {
    name: project.name,
    description: project.description,
    goal: project.goal,
    guidelines: project.projectGuidelines.content,
    guidelinesUpdatedAt: project.projectGuidelines.updatedAt,
    scope: [...project.scope],
    outOfScope: [...project.outOfScope],
    technologies: [...project.technologies],
    tools: [...project.tools],
    contentLanguage: project.contentLanguage,
    chatLanguage: project.chatLanguage,
  };
}

export function toApiV1Feature(feature: Feature, context: ApiV1RefContext): ApiV1Feature {
  return {
    id: feature.id,
    ref: formatFeatureRef(feature.number),
    shortId: feature.shortId,
    number: feature.number,
    name: feature.name,
    description: feature.description,
    status: feature.status,
    priority: feature.priority,
    startDate: feature.startDate,
    endDate: feature.endDate,
    workDone: feature.workDone,
    workRemaining: feature.workRemaining,
    phaseRefs: refsOf(feature.phaseIds, context.phaseRefById),
    dependsOn: refsOf(feature.dependsOn, context.featureRefById),
    createdAt: feature.createdAt,
    updatedAt: feature.updatedAt,
  };
}

export function toApiV1Phase(phase: Phase, context: ApiV1RefContext): ApiV1Phase {
  return {
    id: phase.id,
    ref: context.phaseRefById.get(phase.id) ?? formatPhaseRef(phase.number),
    shortId: phase.shortId,
    number: phase.number,
    featureRef: phase.featureId ? context.featureRefById.get(phase.featureId) ?? null : null,
    title: phase.title,
    summary: phase.summary,
    description: phase.description,
    status: phase.status,
    priority: phase.priority,
    goals: [...phase.goals],
    dependsOn: refsOf(phase.dependsOn, context.phaseRefById),
    taskRefs: phase.tasks.map((task) => context.taskRefById.get(task.id) ?? task.id),
    hasHandoff: hasActiveHandoff(phase),
    createdAt: phase.createdAt,
    updatedAt: phase.updatedAt,
  };
}

export function toApiV1Task(task: Task, phase: Phase, context: ApiV1RefContext): ApiV1Task {
  return {
    id: task.id,
    ref: context.taskRefById.get(task.id) ?? formatTaskRef(formatPhaseRef(phase.number), task.number),
    shortId: task.shortId,
    number: task.number,
    phaseRef: context.phaseRefById.get(phase.id) ?? formatPhaseRef(phase.number),
    featureRef: phase.featureId ? context.featureRefById.get(phase.featureId) ?? null : null,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    checklist: task.checklist.map((item) => {
      // The schema transform always expands string items into objects.
      const entry = typeof item === "string" ? { id: item, number: 0, title: item, checked: false } : item;
      return { id: entry.id, number: entry.number, title: entry.title, checked: entry.checked };
    }),
    dependsOn: refsOf(task.dependsOn, context.taskRefById),
    pause: task.pauseSnapshot
      ? { reason: task.pauseSnapshot.reason, resumeLocation: task.pauseSnapshot.resumeLocation, pausedAt: task.pauseSnapshot.pausedAt }
      : null,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toApiV1Decision(
  decision: AcceptedDecision,
  owner: { kind: ApiV1DecisionOwnerKind; ref: string | null },
): ApiV1AcceptedDecision {
  return {
    id: decision.id,
    ref: `${owner.ref ?? "project"}#${decision.id}`,
    title: decision.title,
    decision: decision.decision,
    rationale: decision.rationale,
    implementationNotes: decision.implementationNotes,
    acceptedAt: decision.acceptedAt,
    owner: { kind: owner.kind, ref: owner.ref },
  };
}

function hasActiveHandoff(phase: Phase): boolean {
  return phase.handoff.length > 0 && !TERMINAL_PHASE_STATUSES.has(phase.status);
}

/** The active handoff of a phase, or null when it has none (or the phase is finished). */
export function toApiV1Handoff(phase: Phase, context: ApiV1RefContext): ApiV1Handoff | null {
  if (!hasActiveHandoff(phase)) return null;
  const resumeReadyAt = phase.handoffAudit?.resumeReadyAt ?? "";
  return {
    phaseRef: context.phaseRefById.get(phase.id) ?? formatPhaseRef(phase.number),
    content: phase.handoff,
    updatedAt: phase.handoffUpdatedAt || phase.updatedAt,
    resumeReady: resumeReadyAt !== "",
    resumeReadyAt,
  };
}

export function toApiV1Idea(idea: Idea): ApiV1Idea {
  return {
    id: idea.id,
    ref: formatIdeaRef(idea.number),
    shortId: idea.shortId,
    number: idea.number,
    title: idea.title,
    description: idea.description,
    promotion: idea.promotion
      ? { targetType: idea.promotion.targetType, targetRef: idea.promotion.targetRef, promotedAt: idea.promotion.promotedAt }
      : null,
    createdAt: idea.createdAt,
    updatedAt: idea.updatedAt,
  };
}

/** Every view of a loaded planner, with all cross-references turned into human refs. */
export function buildApiV1Model(source: ApiV1Source): ApiV1Model {
  const context = buildApiV1RefContext(source.features, source.phases);
  const decisions: ApiV1AcceptedDecision[] = source.project.acceptedDecisions.map((decision) =>
    toApiV1Decision(decision, { kind: "project", ref: null }));
  for (const feature of source.features) {
    const owner = { kind: "feature" as const, ref: formatFeatureRef(feature.number) };
    for (const decision of feature.acceptedDecisions) decisions.push(toApiV1Decision(decision, owner));
  }
  const tasks: ApiV1Task[] = [];
  const handoffs: ApiV1Handoff[] = [];
  for (const phase of source.phases) {
    const phaseRef = context.phaseRefById.get(phase.id) ?? formatPhaseRef(phase.number);
    for (const decision of phase.acceptedDecisions) decisions.push(toApiV1Decision(decision, { kind: "phase", ref: phaseRef }));
    const handoff = toApiV1Handoff(phase, context);
    if (handoff) handoffs.push(handoff);
    for (const task of phase.tasks) {
      tasks.push(toApiV1Task(task, phase, context));
      const taskRef = context.taskRefById.get(task.id) ?? task.id;
      for (const decision of task.acceptedDecisions) decisions.push(toApiV1Decision(decision, { kind: "task", ref: taskRef }));
    }
  }
  return {
    project: toApiV1Project(source.project),
    features: source.features.map((feature) => toApiV1Feature(feature, context)),
    phases: source.phases.map((phase) => toApiV1Phase(phase, context)),
    tasks,
    decisions,
    handoffs,
    ideas: source.ideas.map(toApiV1Idea),
  };
}

/** One entry per entity, with its parents, for change detection and indexes. */
export interface ApiV1EntityEntry {
  kind: ApiV1EntityKind;
  /** Unique within its kind. Decisions repeat ids across owners, so theirs includes the owner. */
  key: string;
  id: string;
  ref: string;
  parents: { featureRef?: string; phaseRef?: string };
  view: unknown;
}

export function listApiV1Entities(model: ApiV1Model): ApiV1EntityEntry[] {
  const entries: ApiV1EntityEntry[] = [
    { kind: "project", key: "project", id: "project", ref: "project", parents: {}, view: model.project },
  ];
  for (const feature of model.features) {
    entries.push({ kind: "feature", key: feature.id, id: feature.id, ref: feature.ref, parents: {}, view: feature });
  }
  for (const phase of model.phases) {
    entries.push({ kind: "phase", key: phase.id, id: phase.id, ref: phase.ref, parents: phase.featureRef ? { featureRef: phase.featureRef } : {}, view: phase });
  }
  for (const task of model.tasks) {
    entries.push({
      kind: "task", key: task.id, id: task.id, ref: task.ref,
      parents: { ...(task.featureRef ? { featureRef: task.featureRef } : {}), phaseRef: task.phaseRef },
      view: task,
    });
  }
  for (const decision of model.decisions) {
    entries.push({ kind: "decision", key: decision.ref, id: decision.id, ref: decision.ref, parents: {}, view: decision });
  }
  for (const handoff of model.handoffs) {
    entries.push({ kind: "handoff", key: handoff.phaseRef, id: handoff.phaseRef, ref: handoff.phaseRef, parents: { phaseRef: handoff.phaseRef }, view: handoff });
  }
  for (const idea of model.ideas) {
    entries.push({ kind: "idea", key: idea.id, id: idea.id, ref: idea.ref, parents: {}, view: idea });
  }
  return entries;
}
