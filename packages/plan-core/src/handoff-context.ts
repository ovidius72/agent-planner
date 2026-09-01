import { createHash } from "node:crypto";
import type {
  Feature,
  HandoffCompletenessAudit,
  HandoffCompletenessEntry,
  HandoffSupportingDocument,
  Phase,
  Task,
} from "./schema.js";

export const COMPLETION_SUMMARY_HEADING = "**Completion summary:**";
export const HANDOFF_COMPLETENESS_AUDIT_VERSION = 1;
export const MAX_HANDOFF_CONTENT_CHARS = 24_000;
export const HANDOFF_AUDIT_START_MARKER = "<!-- agent-plan:handoff-audit:start -->";
export const HANDOFF_AUDIT_END_MARKER = "<!-- agent-plan:handoff-audit:end -->";

export const HANDOFF_COMPLETENESS_CATEGORIES = [
  { id: "exact-focus-resume-point", label: "Exact focus and resume point" },
  { id: "first-resume-action", label: "First resume action" },
  { id: "completed-work", label: "Completed work" },
  { id: "partial-work", label: "Partial work" },
  { id: "remaining-work", label: "Remaining work" },
  { id: "decisions-rationale", label: "Decisions and rationale" },
  { id: "rejected-alternatives", label: "Rejected alternatives" },
  { id: "files-symbols", label: "Files and symbols" },
  { id: "branch-worktree", label: "Branch and worktree" },
  { id: "commands-tools", label: "Commands and tools" },
  { id: "completed-verification", label: "Completed verification" },
  { id: "pending-verification", label: "Pending verification" },
  { id: "runtime-limitations-workarounds", label: "Runtime limitations and workarounds" },
  { id: "blockers-risks", label: "Blockers and risks" },
  { id: "user-visible-behavior", label: "User-visible behavior" },
  { id: "operator-actions", label: "Operator actions" },
  { id: "project-operating-notes", label: "Project-specific operating notes" },
  { id: "conversation-only-facts", label: "Conversation-only facts" },
] as const;

export type HandoffCompletenessCategory = typeof HANDOFF_COMPLETENESS_CATEGORIES[number]["id"];
export type HandoffContractErrorCode = "HANDOFF_COMPLETENESS_AUDIT_REQUIRED" | "HANDOFF_CONTENT_LIMIT_EXCEEDED" | "HANDOFF_SUPPORTING_DOCUMENT_INVALID" | "HANDOFF_PERSISTENCE_VERIFICATION_FAILED";

export class HandoffContractError extends Error {
  readonly code: HandoffContractErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: HandoffContractErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "HandoffContractError";
    this.code = code;
    this.details = details;
  }
}

export interface HandoffCompletenessAuditInput {
  version: number;
  entries: HandoffCompletenessEntry[];
}

export interface HandoffSupportingDocumentInput {
  path: string;
  description: string;
}

export interface HandoffTaskContextUpdate {
  taskId: string;
  completionSummary: string;
  verification: string;
  remainingWork: string;
  filesTouched?: string[];
  decisions?: string[];
}

export interface HandoffPhaseContextUpdate {
  progressSummary: string;
  remainingWork: string;
  decisions?: string[];
}

export interface HandoffFeatureContextUpdate {
  workDone: string;
  workRemaining: string;
}

export interface PhaseHandoffContextSync {
  taskUpdates: HandoffTaskContextUpdate[];
  phaseUpdate?: HandoffPhaseContextUpdate;
  phaseNoUpdateReason?: string;
  featureUpdate?: HandoffFeatureContextUpdate;
  featureNoUpdateReason?: string;
}

export interface PhaseHandoffAudit {
  phaseId: string;
  featureId: string;
  handoff: string;
  handoffUpdatedAt: string;
  missingCompletionTaskIds: string[];
  missingCompletionTasks: Array<{ id: string; number: number; title: string }>;
  completenessVersion: number;
  maxContentChars: number;
  completenessCategories: ReadonlyArray<{ id: HandoffCompletenessCategory; label: string }>;
  existingCompletenessAudit: HandoffCompletenessAudit | null;
}

export interface RefreshPhaseHandoffInput {
  content: string;
  expectedHandoffUpdatedAt: string;
  reconciledExistingHandoff: boolean;
  completenessAudit?: HandoffCompletenessAuditInput;
  supportingDocuments?: HandoffSupportingDocumentInput[];
  /** Populated and verified by PlanStore before pure domain application. */
  verifiedSupportingDocuments?: HandoffSupportingDocument[];
  contextSync: PhaseHandoffContextSync;
}

export interface RefreshPhaseHandoffResult {
  phase: Phase;
  feature: Feature;
  updatedTaskIds: string[];
  handoffUpdatedAt: string;
  handoffAudit: HandoffCompletenessAudit;
}

export function hasTaskCompletionEvidence(task: Task): boolean {
  if (task.status !== "done") return true;
  if (task.description.includes(COMPLETION_SUMMARY_HEADING)) return true;
  return task.statusLog.some((entry) => entry.toStatus === "done" && entry.description.trim().length > 0);
}

export function auditPhaseHandoff(phase: Phase, feature: Feature): PhaseHandoffAudit {
  const missingCompletionTasks = phase.tasks
    .filter((task) => task.status === "done" && !hasTaskCompletionEvidence(task))
    .map((task) => ({ id: task.id, number: task.number, title: task.title }));
  return {
    phaseId: phase.id,
    featureId: feature.id,
    handoff: phase.handoff,
    handoffUpdatedAt: phase.handoffUpdatedAt,
    missingCompletionTaskIds: missingCompletionTasks.map((task) => task.id),
    missingCompletionTasks,
    completenessVersion: HANDOFF_COMPLETENESS_AUDIT_VERSION,
    maxContentChars: MAX_HANDOFF_CONTENT_CHARS,
    completenessCategories: HANDOFF_COMPLETENESS_CATEGORIES,
    existingCompletenessAudit: phase.handoffAudit,
  };
}

function nonEmpty(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function appendSection(existing: string, section: string): string {
  const normalized = section.trim();
  if (!normalized || existing.includes(normalized)) return existing;
  return existing.trim() ? `${existing.trim()}\n\n---\n${normalized}` : normalized;
}

function isSubstantive(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 12) return false;
  return !/^(?:n\/?a|none|nothing|unknown|same as above|see (?:above|handoff|document)|not applicable|tbd)[.!]?$/i.test(normalized);
}

function stripRenderedCompletenessAudit(content: string): string {
  const start = content.indexOf(HANDOFF_AUDIT_START_MARKER);
  if (start < 0) return content.trim();
  const end = content.indexOf(HANDOFF_AUDIT_END_MARKER, start);
  if (end < 0) return content.slice(0, start).trim();
  return `${content.slice(0, start)}${content.slice(end + HANDOFF_AUDIT_END_MARKER.length)}`.trim();
}

export function handoffContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function validateHandoffCompletenessAudit(audit: HandoffCompletenessAuditInput | undefined): HandoffCompletenessEntry[] {
  const expectedIds = HANDOFF_COMPLETENESS_CATEGORIES.map((entry) => entry.id);
  if (!audit || audit.version !== HANDOFF_COMPLETENESS_AUDIT_VERSION) {
    throw new HandoffContractError(
      "HANDOFF_COMPLETENESS_AUDIT_REQUIRED",
      `Handoff completeness audit version ${HANDOFF_COMPLETENESS_AUDIT_VERSION} is required.`,
      { requiredVersion: HANDOFF_COMPLETENESS_AUDIT_VERSION, missingCategories: expectedIds },
    );
  }

  const byCategory = new Map<string, HandoffCompletenessEntry>();
  const duplicates: string[] = [];
  for (const entry of audit.entries) {
    if (byCategory.has(entry.category)) duplicates.push(entry.category);
    else byCategory.set(entry.category, entry);
  }
  const missingCategories = expectedIds.filter((id) => !byCategory.has(id));
  const unknownCategories = [...byCategory.keys()].filter((id) => !expectedIds.includes(id as HandoffCompletenessCategory));
  const invalidCategories = expectedIds.filter((id) => {
    const entry = byCategory.get(id);
    return entry ? !isSubstantive(entry.detail) : false;
  });
  if (missingCategories.length > 0 || unknownCategories.length > 0 || duplicates.length > 0 || invalidCategories.length > 0) {
    throw new HandoffContractError(
      "HANDOFF_COMPLETENESS_AUDIT_REQUIRED",
      "The handoff completeness audit is missing required categories or contains non-substantive entries.",
      { missingCategories, invalidCategories, unknownCategories, duplicateCategories: [...new Set(duplicates)] },
    );
  }
  return expectedIds.map((id) => byCategory.get(id)!);
}

export function renderHandoffCompletenessAudit(audit: HandoffCompletenessAuditInput): string {
  const entries = validateHandoffCompletenessAudit(audit);
  const labels = new Map(HANDOFF_COMPLETENESS_CATEGORIES.map((entry) => [entry.id, entry.label] as const));
  return [
    HANDOFF_AUDIT_START_MARKER,
    `## Operational completeness audit (v${HANDOFF_COMPLETENESS_AUDIT_VERSION})`,
    "",
    ...entries.flatMap((entry) => [
      `### ${labels.get(entry.category as HandoffCompletenessCategory) ?? entry.category}`,
      `**Status:** ${entry.status}`,
      entry.detail.trim(),
      "",
    ]),
    HANDOFF_AUDIT_END_MARKER,
  ].join("\n").trim();
}

export function renderVerifiedHandoffContent(content: string, audit?: HandoffCompletenessAuditInput): string {
  const base = stripRenderedCompletenessAudit(content);
  validateCanonicalHandoffContent(base);
  validateHandoffCompletenessAudit(audit);
  const rendered = `${base}\n\n${renderHandoffCompletenessAudit(audit!)}`.trim();
  if (rendered.length > MAX_HANDOFF_CONTENT_CHARS) {
    throw new HandoffContractError(
      "HANDOFF_CONTENT_LIMIT_EXCEEDED",
      `Canonical handoff content is ${rendered.length} characters; the maximum is ${MAX_HANDOFF_CONTENT_CHARS}. Move extended detail to committed Markdown under .planner/docs/ and link it with a substantive explanation.`,
      { contentLength: rendered.length, maxContentChars: MAX_HANDOFF_CONTENT_CHARS },
    );
  }
  return rendered;
}

export function validateCanonicalHandoffContent(content: string): void {
  const body = nonEmpty(content, "Handoff content");
  const required = [
    { label: "Created at", pattern: /^Created at:\s*\S+/im },
    { label: "Updated at", pattern: /^Updated at:\s*\S+/im },
    { label: "Reason", pattern: /^Reason:\s*\S+/im },
    { label: "Current focus", pattern: /^##\s+Current focus\s*$/im },
    { label: "What was being done", pattern: /^##\s+What was being done\s*$/im },
    { label: "How to resume", pattern: /^##\s+How to resume\s*$/im },
    { label: "Files touched", pattern: /^##\s+Files touched\s*$/im },
    { label: "Blockers", pattern: /^##\s+Blockers\s*$/im },
    { label: "Next steps", pattern: /^##\s+Next steps\s*$/im },
    { label: "Recent decisions", pattern: /^##\s+Recent decisions\s*$/im },
  ];
  const missing = required.filter((entry) => !entry.pattern.test(body)).map((entry) => entry.label);
  if (missing.length > 0) throw new Error(`Canonical handoff is missing required sections: ${missing.join(", ")}.`);
}

export function validateHandoffContextSync(
  phase: Phase,
  feature: Feature,
  input: RefreshPhaseHandoffInput,
): void {
  renderVerifiedHandoffContent(input.content, input.completenessAudit);
  const requestedDocuments = input.supportingDocuments ?? [];
  const verifiedDocuments = input.verifiedSupportingDocuments ?? [];
  if (requestedDocuments.length !== verifiedDocuments.length) {
    throw new HandoffContractError(
      "HANDOFF_SUPPORTING_DOCUMENT_INVALID",
      "Every supporting document must be validated by PlanStore before the handoff is written.",
      { requestedCount: requestedDocuments.length, verifiedCount: verifiedDocuments.length },
    );
  }
  for (let index = 0; index < requestedDocuments.length; index += 1) {
    const requested = requestedDocuments[index]!;
    const verified = verifiedDocuments[index]!;
    if (requested.path !== verified.path || !isSubstantive(requested.description) || requested.description.trim() !== verified.description) {
      throw new HandoffContractError(
        "HANDOFF_SUPPORTING_DOCUMENT_INVALID",
        `Supporting document ${requested.path || `(index ${index})`} is not valid or lacks a substantive description.`,
        { index, path: requested.path },
      );
    }
    if (!input.content.includes(requested.path)) {
      throw new HandoffContractError(
        "HANDOFF_SUPPORTING_DOCUMENT_INVALID",
        `Canonical handoff content must link supporting document ${requested.path}.`,
        { index, path: requested.path },
      );
    }
  }
  if (phase.status === "done" || phase.status === "canceled") {
    throw new Error(`Cannot write a handoff on ${phase.status} phase ${phase.id}; completed phases have no pending handoff.`);
  }
  if (phase.handoffUpdatedAt !== input.expectedHandoffUpdatedAt) {
    throw new Error("Handoff changed after preparation. Run handoff_prepare again and reconcile the latest content before writing.");
  }
  if (phase.handoff.trim() && !input.reconciledExistingHandoff) {
    throw new Error("An active handoff already exists. Reconcile its still-relevant content and set reconciledExistingHandoff=true.");
  }

  const sync = input.contextSync;
  const taskIds = sync.taskUpdates.map((update) => nonEmpty(update.taskId, "Task update taskId"));
  if (new Set(taskIds).size !== taskIds.length) throw new Error("Each task may appear only once in handoff context updates.");
  const phaseTaskIds = new Set(phase.tasks.map((task) => task.id));
  for (const taskId of taskIds) {
    if (!phaseTaskIds.has(taskId)) throw new Error(`Task ${taskId} does not belong to phase ${phase.id}.`);
  }
  for (const update of sync.taskUpdates) {
    nonEmpty(update.completionSummary, `Task ${update.taskId} completionSummary`);
    nonEmpty(update.verification, `Task ${update.taskId} verification`);
    nonEmpty(update.remainingWork, `Task ${update.taskId} remainingWork`);
  }

  const audit = auditPhaseHandoff(phase, feature);
  const covered = new Set(taskIds);
  const uncovered = audit.missingCompletionTaskIds.filter((taskId) => !covered.has(taskId));
  if (uncovered.length > 0) {
    throw new Error(`Done tasks are missing durable completion evidence: ${uncovered.join(", ")}. Include context updates for every listed task.`);
  }

  if (sync.phaseUpdate) {
    nonEmpty(sync.phaseUpdate.progressSummary, "Phase progressSummary");
    nonEmpty(sync.phaseUpdate.remainingWork, "Phase remainingWork");
  } else {
    nonEmpty(sync.phaseNoUpdateReason, "phaseNoUpdateReason");
  }
  if (sync.featureUpdate) {
    nonEmpty(sync.featureUpdate.workDone, "Feature workDone");
    nonEmpty(sync.featureUpdate.workRemaining, "Feature workRemaining");
  } else {
    nonEmpty(sync.featureNoUpdateReason, "featureNoUpdateReason");
  }
}

export function applyHandoffContextSync(
  phase: Phase,
  feature: Feature,
  input: RefreshPhaseHandoffInput,
  timestamp: string,
): { phase: Phase; feature: Feature; updatedTaskIds: string[] } {
  validateHandoffContextSync(phase, feature, input);
  const handoffContent = renderVerifiedHandoffContent(input.content, input.completenessAudit);
  const auditEntries = validateHandoffCompletenessAudit(input.completenessAudit);
  const nextPhase = structuredClone(phase);
  const nextFeature = structuredClone(feature);
  const updatedTaskIds: string[] = [];

  for (const update of input.contextSync.taskUpdates) {
    const task = nextPhase.tasks.find((candidate) => candidate.id === update.taskId)!;
    const files = uniqueStrings(update.filesTouched ?? []);
    const decisions = uniqueStrings(update.decisions ?? []);
    const section = [
      COMPLETION_SUMMARY_HEADING,
      update.completionSummary.trim(),
      "",
      "**Verification:**",
      update.verification.trim(),
      "",
      "**Remaining or unverified:**",
      update.remainingWork.trim(),
      ...(files.length > 0 ? ["", "**Files touched:**", ...files.map((file) => `- ${file}`)] : []),
    ].join("\n");
    task.description = appendSection(task.description, section);
    task.descriptionUpdatedAt = timestamp;
    task.decisions = uniqueStrings([...(task.decisions ?? []), ...decisions]);
    task.updatedAt = timestamp;
    updatedTaskIds.push(task.id);
  }

  const phaseUpdate = input.contextSync.phaseUpdate;
  if (phaseUpdate) {
    const section = [
      "**Handoff context update:**",
      phaseUpdate.progressSummary.trim(),
      "",
      "**Remaining work:**",
      phaseUpdate.remainingWork.trim(),
    ].join("\n");
    nextPhase.notes = appendSection(nextPhase.notes, section);
    nextPhase.decisions = uniqueStrings([...(nextPhase.decisions ?? []), ...(phaseUpdate.decisions ?? [])]);
  }

  const featureUpdate = input.contextSync.featureUpdate;
  if (featureUpdate) {
    nextFeature.workDone = appendSection(nextFeature.workDone, featureUpdate.workDone);
    nextFeature.workRemaining = appendSection(nextFeature.workRemaining, featureUpdate.workRemaining);
  }

  nextPhase.handoff = handoffContent;
  nextPhase.handoffUpdatedAt = timestamp;
  nextPhase.handoffAudit = {
    version: HANDOFF_COMPLETENESS_AUDIT_VERSION,
    entries: auditEntries,
    supportingDocuments: input.verifiedSupportingDocuments ?? [],
    contentHash: handoffContentHash(handoffContent),
    contentLength: handoffContent.length,
    verifiedAt: timestamp,
  };
  nextPhase.handoffReadAt = "";
  nextPhase.updatedAt = timestamp;
  nextFeature.updatedAt = timestamp;
  return { phase: nextPhase, feature: nextFeature, updatedTaskIds };
}
