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

export const StatusLogEntrySchema = z.object({
  id: z.string().min(1),
  date: TimestampSchema,
  fromStatus: TaskStatusSchema,
  toStatus: TaskStatusSchema,
  title: z.string().min(1),
  description: z.string().default(""),
});

export const TaskSchema = z.object({
  id: z.string(),
  phaseId: z.string(),
  number: z.number().int().nonnegative().default(0),
  shortName: SlugSchema,
  title: z.string().min(1),
  status: TaskStatusSchema,
  description: z.string().default(""),
  notes: z.string().default(""),
  statusLog: z.array(StatusLogEntrySchema).default([]),
  decisions: z.array(z.string().min(1)).default([]),
  acceptedDecisions: z.array(AcceptedDecisionSchema).default([]),
  checklist: z.array(ChecklistInputSchema).default([]),
  subtasks: z.array(SubtaskSchema).default([]),
  dependsOn: z.array(z.string().min(1)).default([]),
  startedAt: z.string().default(""),
  completedAt: z.string().default(""),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).transform((task) => ({
  ...task,
  checklist: task.checklist
    .map((item, index) => typeof item === "string"
      ? { id: createChecklistItemId(task.id, index + 1, item), title: item.trim(), checked: false }
      : { ...item, id: item.id || createChecklistItemId(task.id, index + 1, item.title), title: item.title.trim(), checked: item.checked ?? false })
    .filter((item) => item.title.length > 0),
}));

export const PhaseSchema = z.object({
  id: z.string(),
  featureId: z.string().optional(),
  number: z.number().int().positive(),
  slug: SlugSchema,
  title: z.string().min(1),
  status: PhaseStatusSchema,
  discussedAt: z.string().default(""),
  contextReady: z.boolean().default(false),
  contextReadyReason: z.string().default(""),
  summary: z.string().default(""),
  description: z.string().default(""),
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
});

export const FeatureSchema = z.object({
  id: z.string(),
  number: z.number().int().nonnegative().default(0),
  name: z.string().min(1),
  description: z.string().default(""),
  status: FeatureStatusSchema,
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
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
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
export type CodebaseFile = z.infer<typeof CodebaseFileSchema>;
export type CodebaseProfile = z.infer<typeof CodebaseProfileSchema>;
export type AmbientFacts = z.infer<typeof AmbientFactsSchema>;
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export type ActivityLog = z.infer<typeof ActivityLogSchema>;
export type ResumeFocus = z.infer<typeof ResumeFocusSchema>;
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type FeaturesDocument = z.infer<typeof FeaturesDocumentSchema>;
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;
export type SubtaskStatus = z.infer<typeof SubtaskStatusSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type WorkflowRules = z.infer<typeof WorkflowRulesSchema>;
export type AcceptedDecision = z.infer<typeof AcceptedDecisionSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type StatusLogEntry = z.infer<typeof StatusLogEntrySchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type MacroTask = z.infer<typeof MacroTaskSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type RequirementsDocument = z.infer<typeof RequirementsDocumentSchema>;
export type PlanWorkspace = z.infer<typeof PlanWorkspaceSchema>;
