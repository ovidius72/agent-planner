import { createHash } from "node:crypto";
import type {
  Feature,
  HandoffCompletenessAudit,
  HandoffCompletenessEntry,
  HandoffColdStartInventoryEntry,
  HandoffSupportingDocument,
  Phase,
  Task,
} from "./schema.js";

export const COMPLETION_SUMMARY_HEADING = "**Completion summary:**";
export const HANDOFF_COMPLETENESS_AUDIT_VERSION = 1;
export const HANDOFF_COLD_START_INVENTORY_VERSION = 1;
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

export const HANDOFF_COLD_START_SOURCE_REVIEWS = [
  { id: "conversation", label: "Conversation, user corrections, and authorization state" },
  { id: "planner-entities", label: "Task, sibling tasks, phase, feature, requirements, and prior handoff" },
  { id: "working-tree", label: "Changed files, diffs, implementation state, and ownership" },
  { id: "verification-runtime", label: "Commands, test results, runtime observations, and limitations" },
  { id: "peer-agent-output", label: "Peer-agent messages and delegated-work results, or confirmation that none exist" },
] as const;

export const HANDOFF_COLD_START_INVENTORY_CATEGORIES = [
  { id: "files", label: "Exact files" },
  { id: "symbols", label: "Exact symbols and identifiers" },
  { id: "working-tree-ownership", label: "Working-tree state, work ownership, and commit/discard authorization" },
  { id: "negative-state", label: "Work not started, removals not performed, and intentionally untouched state" },
  { id: "commands-tools", label: "Commands and tool paths" },
  { id: "runtime-wiring", label: "Runtime wiring, call sites, and data flow" },
  { id: "preservation-constraints", label: "Behavior and code paths that must survive" },
  { id: "verification-evidence", label: "Concrete observations proving completed, live, dead, or inert state" },
  { id: "related-planned-work", label: "Sibling tasks and related planned capabilities" },
  { id: "user-visible-behavior", label: "User-visible behavior" },
  { id: "operator-actions", label: "Operator actions" },
  { id: "blockers-risks", label: "Blockers and risks" },
  { id: "remaining-work", label: "Remaining work" },
  { id: "ordered-resume-steps", label: "Ordered resume steps" },
] as const;

export const HANDOFF_CANONICAL_SECTIONS = [
  "Created at",
  "Updated at",
  "Reason",
  "Current focus",
  "What was being done",
  "Working tree and ownership",
  "Work not started or intentionally untouched",
  "Runtime wiring",
  "Preservation constraints",
  "Verification evidence",
  "Related planned work",
  "How to resume",
  "Files touched",
  "Blockers",
  "Next steps",
  "Recent decisions",
] as const;

export type HandoffCompletenessCategory = typeof HANDOFF_COMPLETENESS_CATEGORIES[number]["id"];
export type HandoffColdStartInventoryCategory = typeof HANDOFF_COLD_START_INVENTORY_CATEGORIES[number]["id"];
export type HandoffContractErrorCode = "HANDOFF_CANONICAL_SECTIONS_REQUIRED" | "HANDOFF_COMPLETENESS_AUDIT_REQUIRED" | "HANDOFF_COLD_START_INVENTORY_REQUIRED" | "HANDOFF_COLD_START_INVENTORY_UNCOVERED" | "HANDOFF_CONTENT_LIMIT_EXCEEDED" | "HANDOFF_SUPPORTING_DOCUMENT_INVALID" | "HANDOFF_PERSISTENCE_VERIFICATION_FAILED";

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

export interface HandoffColdStartInventoryInput {
  version: number;
  sourceReviews: Array<{ source: string; detail: string }>;
  entries: HandoffColdStartInventoryEntry[];
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
  canonicalSections: ReadonlyArray<string>;
  draftTemplate: string;
  coldStartInventoryVersion: number;
  coldStartSourceReviews: ReadonlyArray<{ id: string; label: string }>;
  coldStartInventoryCategories: ReadonlyArray<{ id: HandoffColdStartInventoryCategory; label: string }>;
  existingCompletenessAudit: HandoffCompletenessAudit | null;
}

export interface RefreshPhaseHandoffInput {
  content: string;
  expectedHandoffUpdatedAt: string;
  reconciledExistingHandoff: boolean;
  completenessAudit?: HandoffCompletenessAuditInput;
  coldStartInventory?: HandoffColdStartInventoryInput;
  supportingDocuments?: HandoffSupportingDocumentInput[];
  /** Populated and verified by PlanStore before pure domain application. */
  verifiedSupportingDocuments?: HandoffSupportingDocument[];
  /** Content is kept in-memory only for cold-start coverage validation. */
  verifiedSupportingDocumentContents?: string[];
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

export function buildHandoffDraftTemplate(phase: Phase, feature: Feature): string {
  const featureRef = `F${String(feature.number).padStart(3, "0")}`;
  const phaseRef = `P${String(phase.number).padStart(3, "0")}(${featureRef})`;
  const taskLines = phase.tasks.length > 0
    ? phase.tasks.map((task) => `- ${phaseRef}/T${String(task.number).padStart(3, "0")} — ${task.title} (${task.status})`).join("\n")
    : "- No tasks currently belong to this phase.";
  return [
    `# ${phaseRef} — {{REQUIRED: meaningful handoff title}}`,
    "",
    "Created at: {{REQUIRED: ISO-8601 timestamp}}",
    "Updated at: {{REQUIRED: ISO-8601 timestamp}}",
    "Reason: {{REQUIRED: why work is stopping and why a cold agent needs this handoff}}",
    "",
    "## Current focus",
    `- Feature: ${featureRef} — ${feature.name}`,
    `- Phase: ${phaseRef} — ${phase.title}`,
    "- Exact resume point: {{REQUIRED: file, symbol, command, or state boundary}}",
    "",
    "## What was being done",
    "{{REQUIRED: concrete completed and partial work}}",
    "",
    "## Working tree and ownership",
    "{{REQUIRED: branch/worktree, whether the diff is finished or in flight, who produced it, preserve/discard rule, and commit authorization}}",
    "",
    "## Work not started or intentionally untouched",
    "{{REQUIRED: destructive work not yet performed, files not changed, and boundaries intentionally left intact}}",
    "",
    "## Runtime wiring",
    "{{REQUIRED: exact call sites, symbols, state transitions, and data flow}}",
    "",
    "## Preservation constraints",
    "{{REQUIRED: behavior and code paths that must continue working}}",
    "",
    "## Verification evidence",
    "{{REQUIRED: commands, results, observations, and evidence for live/dead/inert claims}}",
    "",
    "## Related planned work",
    taskLines,
    "{{REQUIRED: sibling-task boundaries and related capabilities that must not be duplicated}}",
    "",
    "## How to resume",
    "1. {{REQUIRED: first exact action, including the file/symbol/command to use}}",
    "2. {{REQUIRED: subsequent ordered actions and required verification}}",
    "",
    "## Files touched",
    "- {{REQUIRED: path — exact symbols and why they matter}}",
    "",
    "## Blockers",
    "- {{REQUIRED: blocker/risk, or a substantive reason none apply}}",
    "",
    "## Next steps",
    "1. {{REQUIRED: remaining implementation step}}",
    "",
    "## Recent decisions",
    "- {{REQUIRED: decision — rationale — behavior to preserve}}",
  ].join("\n");
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
    canonicalSections: HANDOFF_CANONICAL_SECTIONS,
    draftTemplate: buildHandoffDraftTemplate(phase, feature),
    coldStartInventoryVersion: HANDOFF_COLD_START_INVENTORY_VERSION,
    coldStartSourceReviews: HANDOFF_COLD_START_SOURCE_REVIEWS,
    coldStartInventoryCategories: HANDOFF_COLD_START_INVENTORY_CATEGORIES,
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

export function validateHandoffColdStartInventory(
  inventory: HandoffColdStartInventoryInput | undefined,
  content: string,
  supportingDocumentContents: string[] = [],
): HandoffColdStartInventoryEntry[] {
  const expectedIds = HANDOFF_COLD_START_INVENTORY_CATEGORIES.map((entry) => entry.id);
  if (!inventory || inventory.version !== HANDOFF_COLD_START_INVENTORY_VERSION) {
    throw new HandoffContractError(
      "HANDOFF_COLD_START_INVENTORY_REQUIRED",
      `Cold-start inventory version ${HANDOFF_COLD_START_INVENTORY_VERSION} is required before handoff persistence. Populate it from the scaffold returned by handoff_prepare.`,
      { requiredVersion: HANDOFF_COLD_START_INVENTORY_VERSION, missingCategories: expectedIds },
    );
  }

  const requiredSources = HANDOFF_COLD_START_SOURCE_REVIEWS.map((entry) => entry.id);
  const requiredSourceIds = new Set<string>(requiredSources);
  const sourceReviews = new Map<string, string>();
  const duplicateSources: string[] = [];
  for (const review of inventory.sourceReviews) {
    if (sourceReviews.has(review.source)) duplicateSources.push(review.source);
    else sourceReviews.set(review.source, review.detail);
  }
  const missingSources = requiredSources.filter((source) => !sourceReviews.has(source));
  const unknownSources = [...sourceReviews.keys()].filter((source) => !requiredSourceIds.has(source));
  const invalidSources = requiredSources.filter((source) => {
    const detail = sourceReviews.get(source);
    return detail !== undefined && !isSubstantive(detail);
  });

  const byCategory = new Map<string, HandoffColdStartInventoryEntry>();
  const duplicates: string[] = [];
  for (const entry of inventory.entries) {
    if (byCategory.has(entry.category)) duplicates.push(entry.category);
    else byCategory.set(entry.category, entry);
  }
  const missingCategories = expectedIds.filter((id) => !byCategory.has(id));
  const unknownCategories = [...byCategory.keys()].filter((id) => !expectedIds.includes(id as HandoffColdStartInventoryCategory));
  const invalidCategories: string[] = [];
  for (const id of expectedIds) {
    const entry = byCategory.get(id);
    if (!entry) continue;
    const items = uniqueStrings(entry.items);
    const notApplicableReason = entry.notApplicableReason?.trim() ?? "";
    if (items.length === 0) invalidCategories.push(id);
    if (notApplicableReason && !isSubstantive(notApplicableReason)) invalidCategories.push(id);
    if (items.some((item) => /^(?:n\/?a|none|nothing|unknown|tbd|see above)$/i.test(item.trim()))) invalidCategories.push(id);
  }
  if (
    missingSources.length > 0 || unknownSources.length > 0 || duplicateSources.length > 0 || invalidSources.length > 0
    || missingCategories.length > 0 || unknownCategories.length > 0 || duplicates.length > 0 || invalidCategories.length > 0
  ) {
    throw new HandoffContractError(
      "HANDOFF_COLD_START_INVENTORY_REQUIRED",
      "The cold-start inventory is incomplete. Review every prepared source before drafting; every category needs at least one concrete item. When nothing exists, the item must explicitly state the verified absence and why it matters (for example, 'No deletion has started; all original files remain intact').",
      {
        missingSources,
        invalidSources,
        unknownSources,
        duplicateSources: [...new Set(duplicateSources)],
        missingCategories,
        invalidCategories: [...new Set(invalidCategories)],
        unknownCategories,
        duplicateCategories: [...new Set(duplicates)],
      },
    );
  }

  const normalize = (value: string): string => value.normalize("NFKC").replace(/[`*_]/g, "").replace(/\s+/g, " ").toLowerCase();
  const corpus = normalize([content, ...supportingDocumentContents].join("\n"));
  const uncoveredItems = expectedIds.flatMap((id) => {
    const entry = byCategory.get(id)!;
    return uniqueStrings(entry.items)
      .filter((item) => !corpus.includes(normalize(item)))
      .map((item) => ({ category: id, item }));
  });
  if (uncoveredItems.length > 0) {
    throw new HandoffContractError(
      "HANDOFF_COLD_START_INVENTORY_UNCOVERED",
      "Resume-critical inventory items are missing from the canonical handoff and validated supporting documents. Add each exact item before retrying; do not certify from generic prose.",
      { uncoveredItems },
    );
  }
  return expectedIds.map((id) => {
    const entry = byCategory.get(id)!;
    return {
      category: entry.category,
      items: uniqueStrings(entry.items),
      ...(entry.notApplicableReason?.trim() ? { notApplicableReason: entry.notApplicableReason.trim() } : {}),
    };
  });
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

export function renderVerifiedHandoffContent(
  content: string,
  audit?: HandoffCompletenessAuditInput,
  coldStartInventory?: HandoffColdStartInventoryInput,
  supportingDocumentContents: string[] = [],
): string {
  const base = stripRenderedCompletenessAudit(content);
  validateCanonicalHandoffContent(base);
  validateHandoffCompletenessAudit(audit);
  validateHandoffColdStartInventory(coldStartInventory, base, supportingDocumentContents);
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
    { label: "Working tree and ownership", pattern: /^##\s+Working tree and ownership\s*$/im },
    { label: "Work not started or intentionally untouched", pattern: /^##\s+Work not started or intentionally untouched\s*$/im },
    { label: "Runtime wiring", pattern: /^##\s+Runtime wiring\s*$/im },
    { label: "Preservation constraints", pattern: /^##\s+Preservation constraints\s*$/im },
    { label: "Verification evidence", pattern: /^##\s+Verification evidence\s*$/im },
    { label: "Related planned work", pattern: /^##\s+Related planned work\s*$/im },
    { label: "How to resume", pattern: /^##\s+How to resume\s*$/im },
    { label: "Files touched", pattern: /^##\s+Files touched\s*$/im },
    { label: "Blockers", pattern: /^##\s+Blockers\s*$/im },
    { label: "Next steps", pattern: /^##\s+Next steps\s*$/im },
    { label: "Recent decisions", pattern: /^##\s+Recent decisions\s*$/im },
  ];
  const missing = required.filter((entry) => !entry.pattern.test(body)).map((entry) => entry.label);
  const unresolvedPlaceholders = [...body.matchAll(/\{\{REQUIRED:[^}]+\}\}/g)].map((match) => match[0]);
  if (missing.length > 0 || unresolvedPlaceholders.length > 0) {
    throw new HandoffContractError(
      "HANDOFF_CANONICAL_SECTIONS_REQUIRED",
      "The canonical handoff does not match the prepared scaffold. Fill every required heading and replace every placeholder before writing.",
      { missingSections: missing, unresolvedPlaceholders: [...new Set(unresolvedPlaceholders)] },
    );
  }
}

export function validateHandoffContextSync(
  phase: Phase,
  feature: Feature,
  input: RefreshPhaseHandoffInput,
): void {
  const requestedDocuments = input.supportingDocuments ?? [];
  const verifiedDocuments = input.verifiedSupportingDocuments ?? [];
  if (requestedDocuments.length !== verifiedDocuments.length) {
    throw new HandoffContractError(
      "HANDOFF_SUPPORTING_DOCUMENT_INVALID",
      "Every supporting document must be validated by PlanStore before the handoff is written.",
      { requestedCount: requestedDocuments.length, verifiedCount: verifiedDocuments.length },
    );
  }
  const verifiedContents = input.verifiedSupportingDocumentContents ?? [];
  if (verifiedContents.length !== verifiedDocuments.length) {
    throw new HandoffContractError(
      "HANDOFF_SUPPORTING_DOCUMENT_INVALID",
      "Validated supporting-document content is required for cold-start inventory coverage checks.",
      { verifiedDocumentCount: verifiedDocuments.length, verifiedContentCount: verifiedContents.length },
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
  renderVerifiedHandoffContent(input.content, input.completenessAudit, input.coldStartInventory, verifiedContents);
  if (phase.status === "done" || phase.status === "rejected" || phase.status === "canceled") {
    throw new Error(`Cannot write a handoff on ${phase.status} phase ${phase.id}; terminal phases have no pending handoff.`);
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
  const handoffContent = renderVerifiedHandoffContent(
    input.content,
    input.completenessAudit,
    input.coldStartInventory,
    input.verifiedSupportingDocumentContents ?? [],
  );
  const auditEntries = validateHandoffCompletenessAudit(input.completenessAudit);
  const coldStartInventoryEntries = validateHandoffColdStartInventory(
    input.coldStartInventory,
    stripRenderedCompletenessAudit(input.content),
    input.verifiedSupportingDocumentContents ?? [],
  );
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
    coldStartInventory: {
      version: HANDOFF_COLD_START_INVENTORY_VERSION,
      sourceReviews: HANDOFF_COLD_START_SOURCE_REVIEWS.map(({ id }) => {
        const review = input.coldStartInventory!.sourceReviews.find((entry) => entry.source === id)!;
        return { source: id, detail: review.detail.trim() };
      }),
      entries: coldStartInventoryEntries,
    },
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
