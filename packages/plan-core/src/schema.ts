import { z } from "zod";
import { createChecklistItemId } from "./naming.js";

export const TimestampSchema = z.string().datetime();
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const CodebaseFileSchema = z.object({
  path: z.string().min(1),
  kind: z.string().default("file"),
});

export const AmbientFactsSchema = z.object({
  nodeVersion: z.string().default(""),
  packageManager: z.string().default(""),
  lockfile: z.string().default(""),
  scripts: z.record(z.string()).default({}),
});

export const CodebaseProfileSchema = z.object({
  scannedAt: TimestampSchema,
  rootPath: z.string().default(""),
  rootFiles: z.array(CodebaseFileSchema).default([]),
  directories: z.array(z.string().min(1)).default([]),
  packageJson: z
    .object({
      name: z.string().optional(),
      packageManager: z.string().optional(),
      scripts: z.record(z.string()).default({}),
      dependencies: z.record(z.string()).default({}),
      devDependencies: z.record(z.string()).default({}),
    })
    .nullable()
    .default(null),
  agentsMd: z.string().default(""),
  readme: z.string().default(""),
  tree: z.array(z.string().min(1)).default([]),
  ambient: AmbientFactsSchema.default({ nodeVersion: "", packageManager: "", lockfile: "", scripts: {} }),
});

export const ResumeFocusSchema = z.object({
  updatedAt: TimestampSchema,
  currentPhaseId: z.string().default(""),
  inProgressTaskIds: z.array(z.string().min(1)).default([]),
  nextSteps: z.array(z.string().min(1)).default([]),
  /** When `nextSteps` last changed (free-text can go stale; the recap surfaces
   *  this so staleness is visible). Preserved across refreshResume (which keeps
   *  existing nextSteps); bumped only when saveResume receives new nextSteps. */
  nextStepsUpdatedAt: z.string().default(""),
  blockers: z.array(z.string().min(1)).default([]),
  notes: z.string().default(""),
  lastSessionSummary: z.string().default(""),
  guardBypassUntil: z.string().default(""),
});

export const ActivityEntrySchema = z.object({
  id: z.string().min(1),
  at: TimestampSchema,
  type: z.string().min(1),
  ref: z.string().default(""),
  summary: z.string().default(""),
});

export const ActivityLogSchema = z.object({
  entries: z.array(ActivityEntrySchema).default([]),
});

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const WorkflowRulesSchema = z.object({
  beforePhaseStart: z.array(z.string().min(1)).default([]),
  beforeTaskStart: z.array(z.string().min(1)).default([]),
  afterPhaseComplete: z.array(z.string().min(1)).default([]),
});

export const AcceptedDecisionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  decision: z.string().default(""),
  rationale: z.string().default(""),
  implementationNotes: z.string().default(""),
  acceptedAt: TimestampSchema,
});

export const TaskPauseSnapshotSchema = z.object({
  id: z.string().min(1),
  /** Why work stopped or changed focus. */
  reason: z.string().min(1),
  /** Concrete checkpoint: what was underway when the task was paused. */
  whatWasBeingDone: z.string().min(1),
  /** File, symbol, command, or other exact location from which to continue. */
  resumeLocation: z.string().min(1),
  /** Ordered, actionable instructions for resuming the task. */
  howToResume: z.string().min(1),
  /** Optional temporary/prerequisite task that caused the pause. */
  relatedTaskId: z.string().default(""),
  pausedAt: TimestampSchema,
  pausedBy: z.string().default(""),
});

export const WorkDeviationSchema = z.object({
  id: z.string().min(1),
  /** Task the priority selector recommended when the deviation was approved. */
  recommendedTaskId: z.string().min(1),
  /** Task intentionally chosen instead of the recommendation. */
  temporaryTaskId: z.string().min(1),
  /** Task to surface explicitly after the temporary work is resolved. */
  resumeTaskId: z.string().min(1),
  reason: z.string().default(""),
  /** Durable checkpoint captured when the resume task was paused. */
  snapshot: TaskPauseSnapshotSchema.nullable().default(null),
  requestedBy: z.enum(["agent", "user"]).default("agent"),
  approvedBy: z.string().default("user"),
  state: z.enum(["approved", "active", "resume-required", "resolved", "resumed", "canceled"]).default("approved"),
  createdAt: TimestampSchema,
  activatedAt: z.string().default(""),
  /** When temporary work ended and the resume target became mandatory. */
  resumeRequiredAt: z.string().default(""),
  /** Legacy temporary-work completion timestamp. */
  resolvedAt: z.string().default(""),
  /** When the preserved resume target was actually started again. */
  resumedAt: z.string().default(""),
});

export const ProjectSchema = z.object({
  name: z.string().min(1),
  goal: z.string().default(""),
  description: z.string().default(""),
  webPort: z.number().int().min(0).max(65535).default(0),
  scope: z.array(z.string().min(1)).default([]),
  outOfScope: z.array(z.string().min(1)).default([]),
  decisions: z.array(z.string().min(1)).default([]),
  globalRules: z.array(z.string().min(1)).default([]),
  technologies: z.array(z.string().min(1)).default([]),
  tools: z.array(z.string().min(1)).default([]),
  contentLanguage: z.string().default(""),
  chatLanguage: z.string().default(""),
  workflowRules: WorkflowRulesSchema,
  acceptedDecisions: z.array(AcceptedDecisionSchema).default([]),
  /** Monotonic global sequence counters — assigned at creation, never reused (gaps on delete). */
  nextFeatureNumber: z.number().int().positive().default(1),
  nextPhaseNumber: z.number().int().positive().default(1),
  nextTaskNumber: z.number().int().positive().default(1),
  /** Ordered history of approved temporary work deviations; active entries form a resumable stack. */
  workDeviations: z.array(WorkDeviationSchema).default([]),
});

export const SubtaskStatusSchema = z.enum(["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"]);
export const TaskStatusSchema = z.enum(["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"]);
export const PhaseStatusSchema = z.enum(["draft", "discovery", "planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"]);
export const RequirementStatusSchema = z.enum(["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"]);
export const FeatureStatusSchema = z.enum(["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"]);

export const SubtaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: SubtaskStatusSchema,
  description: z.string().default(""),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ChecklistItemSchema = z.object({
  id: z.string().min(1),
  /** Per-task 1-based position, displayed as C{number} (C1, C2, ...). Default 0
   *  so legacy on-disk items without a number still parse; the TaskSchema
   *  transform overwrites it with the real index+1. */
  number: z.number().int().nonnegative().default(0),
  title: z.string().min(1),
  checked: z.boolean().default(false),
});

const ChecklistInputSchema = z.union([z.string().min(1), ChecklistItemSchema]);

/** Status transitions that require a motivation note from the agent. */
export const STATUS_LOG_MOTIVATION_REQUIRED = new Set([
  "blocked", "canceled", "deferred", "rejected", "waiting",
]);

/**
 * Returns true when a status transition requires a written motivation.
 * - → DONE never requires motivation.
 * - → BLOCKED / CANCELED / DEFERRED / REJECTED / WAITING always require it.
 * - → PLANNED from a non-PLANNED status requires it.
 */
export function needsMotivation(fromStatus: string, toStatus: string): boolean {
  if (toStatus === "done") return false;
  if (STATUS_LOG_MOTIVATION_REQUIRED.has(toStatus)) return true;
  if (toStatus === "planned" && fromStatus !== "planned") return true;
  return false;
}

export const SessionInfoSchema = z.object({
  sessionId: z.string().min(1),
  createdAt: TimestampSchema,
});

export const StatusLogEntrySchema = z.object({
  id: z.string().min(1),
  date: TimestampSchema,
  fromStatus: TaskStatusSchema,
  toStatus: TaskStatusSchema,
  title: z.string().min(1),
  description: z.string().default(""),
});

/** Like StatusLogEntrySchema but for the DERIVED PHASE status, which includes
 *  the "draft" and "discovery" lifecycle states absent from TaskStatus. */
export const PhaseStatusLogEntrySchema = z.object({
  id: z.string().min(1),
  date: TimestampSchema,
  fromStatus: PhaseStatusSchema,
  toStatus: PhaseStatusSchema,
  title: z.string().min(1),
  description: z.string().default(""),
});

export const TaskSchema = z.object({
  id: z.string(),
  /** MUST be a phase UUID (not a ref like "P003"). Validated at the schema
   *  layer so no adapter can persist an unresolved ref string. */
  phaseId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "phaseId must be a UUID, not a ref string like P003"),
  /** Global project-wide task sequence (assigned once at creation from project.nextTaskNumber; stable, gaps on delete). Bare T00x is unambiguous. */
  number: z.number().int().nonnegative().default(0),
  shortId: z.string().regex(/^(|[A-Z2-9]{5})$/).default(""),
  priority: z.number().int().nonnegative().default(0),
  shortName: SlugSchema,
  title: z.string().min(1),
  status: TaskStatusSchema,
  description: z.string().default(""),
  /** Updated only when this task's description changes; distinct from entity updatedAt. */
  descriptionUpdatedAt: z.string().default(""),
  notes: z.string().default(""),
  statusLog: z.array(StatusLogEntrySchema).default([]),
  decisions: z.array(z.string().min(1)).default([]),
  acceptedDecisions: z.array(AcceptedDecisionSchema).default([]),
  checklist: z.array(ChecklistInputSchema).default([]),
  subtasks: z.array(SubtaskSchema).default([]),
  dependsOn: z.array(z.string().min(1)).default([]),
  /** Current durable checkpoint while this task is paused. */
  pauseSnapshot: TaskPauseSnapshotSchema.nullable().default(null),
  /** Append-only checkpoint history retained after each resume. */
  pauseHistory: z.array(TaskPauseSnapshotSchema).default([]),
  startedAt: z.string().default(""),
  completedAt: z.string().default(""),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** Durable attestations of completed full context reads by harness session. */
  sessionInfo: z.array(SessionInfoSchema).default([]),
}).transform((task) => ({
  ...task,
  checklist: task.checklist
    .map((item, index) => typeof item === "string"
      ? { id: createChecklistItemId(task.id, index + 1, item), number: index + 1, title: item.trim(), checked: false }
      : { ...item, id: item.id || createChecklistItemId(task.id, index + 1, item.title), number: index + 1, title: item.title.trim(), checked: item.checked ?? false })
    .filter((item) => item.title.length > 0),
}));

export const HandoffHistoryEntrySchema = z.object({
  /** Relative path under .planner/.local/handoff-archive/ (e.g. <phaseId>-<ISO>.md). */
  file: z.string().default(""),
  clearedAt: TimestampSchema,
  /** Why the handoff was cleared: "task-started" | "phase-done" | "manual" | "superseded" | "imported". */
  reason: z.string().default(""),
});
export const PhaseSchema = z.object({
  id: z.string(),
  /** MUST be a feature UUID (not a ref like "F005"). Validated at the schema
   *  layer so no adapter can persist an unresolved ref string. Optional only
   *  for legacy pre-feature phases. */
  featureId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "featureId must be a UUID, not a ref string like F005").optional(),
  /** Global project-wide phase sequence (assigned once at creation from project.nextPhaseNumber; stable, gaps on delete). Bare P00x is unambiguous. */
  number: z.number().int().positive(),
  shortId: z.string().regex(/^(|[A-Z2-9]{5})$/).default(""),
  priority: z.number().int().nonnegative().default(0),
  slug: SlugSchema,
  title: z.string().min(1),
  // NOTE: `status` is intentionally ABSENT from the schema — it is a DERIVED
  // value (computed from child tasks at read time) and is never persisted.
  // The runtime `Phase` type re-adds it as a non-optional field (see below).
  discussedAt: z.string().default(""),
  contextReady: z.boolean().default(false),
  contextReadyReason: z.string().default(""),
  summary: z.string().default(""),
  description: z.string().default(""),
  /** Updated only when this phase's description changes; distinct from entity updatedAt. */
  descriptionUpdatedAt: z.string().default(""),
  notes: z.string().default(""),
  goals: z.array(z.string().min(1)).default([]),
  nonGoals: z.array(z.string().min(1)).default([]),
  dependencies: z.array(z.string().min(1)).default([]),
  dependsOn: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  openQuestions: z.array(z.string().min(1)).default([]),
  decisions: z.array(z.string().min(1)).default([]),
  acceptedDecisions: z.array(AcceptedDecisionSchema).default([]),
  completionCriteria: z.array(z.string().min(1)).default([]),
  taskIds: z.array(z.string().min(1)).default([]),
  tasks: z.array(TaskSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  handoff: z.string().default(""),
  handoffUpdatedAt: z.string().default(""),
  /** When the handoff was last read/acknowledged on recap (ISO). Non-empty means
   *  the agent has seen it; the recap won't re-prompt every turn. Reading is
   *  non-mutating: content remains until every task is done/canceled, a later
   *  handoff supersedes it, or the user explicitly clears it. */
  handoffReadAt: z.string().default(""),
  /** Metadata for recently-cleared handoffs (newest-first, capped at 5). The
   *  full content lives as .md files in .planner/.local/handoff-archive/ (gitignored);
   *  this array only holds the pointer + clear reason + timestamp, so the phase
   *  JSON stays lean and the archive is recoverable. */
  handoffHistory: z.array(HandoffHistoryEntrySchema).default([]),
  /** Chronological audit trail of the DERIVED status (planned/in-progress/blocked/done/...). Appended ONLY when the derived status changes during a rollup; `status` itself is NOT persisted (still computed from child tasks at read time). Empty = no transition recorded yet (treated as "planned"). */
  statusLog: z.array(PhaseStatusLogEntrySchema).default([]),
  /** Durable attestations of completed full context reads by harness session. */
  sessionInfo: z.array(SessionInfoSchema).default([]),
});

export const FeatureSchema = z.object({
  id: z.string(),
  /** Global project-wide feature sequence (assigned once at creation from project.nextFeatureNumber; stable, gaps on delete). */
  number: z.number().int().nonnegative().default(0),
  shortId: z.string().regex(/^(|[A-Z2-9]{5})$/).default(""),
  priority: z.number().int().nonnegative().default(0),
  name: z.string().min(1),
  description: z.string().default(""),
  /** Updated only when this feature's description changes; distinct from entity updatedAt. */
  descriptionUpdatedAt: z.string().default(""),
  // NOTE: `status` is intentionally ABSENT — it is DERIVED from child phases
  // at read time and never persisted. The runtime `Feature` type re-adds it.
  discussedAt: z.string().default(""),
  contextReady: z.boolean().default(false),
  contextReadyReason: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  workDone: z.string().default(""),
  workRemaining: z.string().default(""),
  acceptedDecisions: z.array(AcceptedDecisionSchema).default([]),
  phaseIds: z.array(z.string().min(1)).default([]),
  dependsOn: z.array(z.string().min(1)).default([]),
  /** Chronological audit trail of the DERIVED status (computed from child phases at read time). Appended ONLY when the derived status changes during a rollup; `status` itself is NOT persisted. Empty = no transition recorded yet (treated as "planned"). */
  statusLog: z.array(StatusLogEntrySchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** Durable attestations of completed full context reads by harness session. */
  sessionInfo: z.array(SessionInfoSchema).default([]),
});

export const FeaturesDocumentSchema = z.object({
  features: z.array(FeatureSchema),
});

export const MacroTaskSchema = z.object({
  id: z.string().regex(/^MT-\d{3}$/),
  title: z.string().min(1),
  description: z.string().default(""),
  status: RequirementStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const RequirementSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(""),
  status: RequirementStatusSchema,
  macroTasks: z.array(MacroTaskSchema).default([]),
  linkedPhaseIds: z.array(z.string().min(1)).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** Durable attestations of completed full context reads by harness session. */
  sessionInfo: z.array(SessionInfoSchema).default([]),
});

export const RequirementsDocumentSchema = z.object({
  requirements: z.array(RequirementSchema),
});

export const PlanWorkspaceSchema = z.object({
  manifest: ManifestSchema,
  project: ProjectSchema,
  features: FeaturesDocumentSchema,
  requirements: RequirementsDocumentSchema,
  phases: z.array(PhaseSchema),
});

export type Timestamp = z.infer<typeof TimestampSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export type CodebaseFile = z.infer<typeof CodebaseFileSchema>;
export type CodebaseProfile = z.infer<typeof CodebaseProfileSchema>;
export type AmbientFacts = z.infer<typeof AmbientFactsSchema>;
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export type ActivityLog = z.infer<typeof ActivityLogSchema>;
export type ResumeFocus = z.infer<typeof ResumeFocusSchema>;
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;
export type Feature = z.infer<typeof FeatureSchema> & { status: FeatureStatus };
export type FeaturesDocument = { features: Feature[] };
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;
export type SubtaskStatus = z.infer<typeof SubtaskStatusSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type WorkflowRules = z.infer<typeof WorkflowRulesSchema>;
export type AcceptedDecision = z.infer<typeof AcceptedDecisionSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type WorkDeviation = z.infer<typeof WorkDeviationSchema>;
export type TaskPauseSnapshot = z.infer<typeof TaskPauseSnapshotSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type StatusLogEntry = z.infer<typeof StatusLogEntrySchema>;
export type PhaseStatusLogEntry = z.infer<typeof PhaseStatusLogEntrySchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Phase = z.infer<typeof PhaseSchema> & { status: PhaseStatus };
export type MacroTask = z.infer<typeof MacroTaskSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type RequirementsDocument = z.infer<typeof RequirementsDocumentSchema>;
export type PlanWorkspace = Omit<z.infer<typeof PlanWorkspaceSchema>, "phases" | "features"> & { phases: Phase[]; features: FeaturesDocument };
