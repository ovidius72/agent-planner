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
import { buildPhaseWorkMap, type PhaseWorkMap } from "./task-context.js";

export const COMPLETION_SUMMARY_HEADING = "**Completion summary:**";
export const HANDOFF_COMPLETENESS_AUDIT_VERSION = 1;
export const HANDOFF_COLD_START_INVENTORY_VERSION = 1;
export const TARGET_HANDOFF_CONTENT_CHARS = 8_000;
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
  "Current focus",
  "Current and partial state",
  "Preservation constraints",
  "Supporting documents",
  "Blockers and risks",
  "How to resume",
] as const;

export type HandoffCompletenessCategory = typeof HANDOFF_COMPLETENESS_CATEGORIES[number]["id"];
export type HandoffColdStartInventoryCategory = typeof HANDOFF_COLD_START_INVENTORY_CATEGORIES[number]["id"];
export type HandoffContractErrorCode = "HANDOFF_PREFLIGHT_REQUIRED" | "HANDOFF_REASON_REQUIRED" | "HANDOFF_CANONICAL_SECTIONS_REQUIRED" | "HANDOFF_COMPLETENESS_AUDIT_REQUIRED" | "HANDOFF_COLD_START_INVENTORY_REQUIRED" | "HANDOFF_COLD_START_INVENTORY_UNCOVERED" | "HANDOFF_CONTENT_LIMIT_EXCEEDED" | "HANDOFF_SUPPORTING_DOCUMENT_INVALID" | "HANDOFF_PERSISTENCE_VERIFICATION_FAILED" | "HANDOFF_READBACK_VERIFICATION_REQUIRED" | "HANDOFF_READBACK_GAPS_FOUND" | "HANDOFF_RETAINED_CONTENT_NOT_FOUND" | "HANDOFF_SECTION_RECONCILIATION_REQUIRED";

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

/** Single source of truth for the supportingDocuments recovery statement.
 * Rendered in prepare output (before drafting) and attached to every
 * agent-supplied-manifest failure of HANDOFF_SUPPORTING_DOCUMENT_INVALID
 * (as details.recovery) so both adapters can render it without duplicating
 * the wording. */
export const HANDOFF_SUPPORTING_DOCUMENTS_GUIDANCE =
  "supportingDocuments is optional and usually unnecessary: content above the target length is externalized automatically into .planner/docs/. Drop the field and retry unless you are linking a document you created yourself.";

/** Build a HANDOFF_SUPPORTING_DOCUMENT_INVALID error for a defect in an
 * agent-supplied manifest entry, always carrying the droppable-field
 * recovery statement. Do not use this for planner-owned failures (e.g. the
 * auto-externalized document's own path) — those are not something dropping
 * the agent's field would fix. */
export function supportingDocumentInvalidError(message: string, details: Record<string, unknown> = {}): HandoffContractError {
  return new HandoffContractError("HANDOFF_SUPPORTING_DOCUMENT_INVALID", message, { ...details, recovery: HANDOFF_SUPPORTING_DOCUMENTS_GUIDANCE });
}

/** Build a HANDOFF_SUPPORTING_DOCUMENT_INVALID error for a PlanStore-internal
 * invariant (the count of requested vs. PlanStore-verified documents must
 * always match; PlanStore either throws for a defective entry or returns one
 * verified entry per requested document, in lockstep). This is unreachable
 * through the documented tool flow, so unlike supportingDocumentInvalidError
 * it must not carry the droppable-field recovery statement: dropping the
 * field would not be the fix for an invariant violation, and advertising it
 * would mislead the agent. */
function supportingDocumentInvariantError(message: string, details: Record<string, unknown> = {}): HandoffContractError {
  return new HandoffContractError("HANDOFF_SUPPORTING_DOCUMENT_INVALID", message, details);
}

/** Build a HANDOFF_RETAINED_CONTENT_NOT_FOUND error: `content` was omitted
 * from a handoff_write call and PlanStore has no body retained for this
 * phase + expectedHandoffUpdatedAt token (see PlanStore.retainHandoffDraft /
 * getRetainedHandoffDraft). Reasons: no write against this token has ever
 * failed, the retained draft aged out, the phase went terminal and its
 * drafts were discarded, or the token itself is wrong/stale. Content is
 * always required on the first write attempt for a token; it becomes
 * optional only on a retry that reuses a retained one. */
export function retainedHandoffContentNotFoundError(phaseId: string, expectedHandoffUpdatedAt: string): HandoffContractError {
  return new HandoffContractError(
    "HANDOFF_RETAINED_CONTENT_NOT_FOUND",
    "content was omitted but no retained draft was found for this phase and expectedHandoffUpdatedAt token.",
    {
      phaseId,
      expectedHandoffUpdatedAt,
      recovery: "Provide content once. After a write fails, a retry against the exact same expectedHandoffUpdatedAt may omit content to reuse the body just submitted; a fresh token (from a new handoff_prepare) or a phase that has since gone terminal has nothing retained.",
    },
  );
}

/** One prior section's fate, supplied by the author when validateHandoffSectionReconciliation
 * names it as unaccounted for. `section` must match a heading named in the
 * error's `unaccountedSections`; `disposition` is a short, substantive
 * statement of what happened to it — dropped deliberately, superseded by
 * newer content, or folded into a different section (including a rename).
 * See P104(F005)/T416: this is the evidence that replaces the unchecked
 * `reconciledExistingHandoff` boolean for the sections most likely to be
 * silently lost. */
export interface HandoffSectionDispositionInput {
  section: string;
  disposition: string;
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

export interface HandoffContentExternalization {
  content: string;
  externalized: boolean;
  extendedContent: string;
  supportingDocument?: HandoffSupportingDocumentInput;
}

/** One document that a previous handoff refresh moved out of the inline
 * capsule because it exceeded TARGET_HANDOFF_CONTENT_CHARS. Populated by
 * PlanStore.preparePhaseHandoff (which alone has filesystem access); pure
 * code here only shapes the type and the recognition/heading helpers below.
 * `headings` and `missing` are always meaningful even when `content` is
 * omitted for budget reasons, so a caller who cannot inline the body can
 * still name what it contained (see handoff-reply.ts). */
export interface HandoffExternalizedDocumentAudit {
  path: string;
  description: string;
  /** Level-2 (`##`) headings found in the document, in order. Present even
   *  when `content` is null, so the omission names what the document held. */
  headings: string[];
  /** Full document body, or null when it could not be read back from disk
   *  (deleted, moved, or unreadable). Bounding this for transport is the
   *  reply builder's job (handoff-reply.ts), not this audit's. */
  content: string | null;
  contentLength: number;
  missing: boolean;
}

/** The exact description externalizeOversizedHandoffContent stamps on the
 * supporting-document entry it generates for an auto-externalized document.
 * The single source of truth for recognizing one later: handoff_prepare
 * matches on this instead of the timestamped file-naming convention, so
 * detection and generation cannot drift apart. A document a human or agent
 * linked deliberately (a different description) is already named in the
 * persisted capsule's own "Supporting documents" bullet and is out of scope
 * here — only content the tooling itself moved out without being asked. */
export const HANDOFF_AUTO_EXTERNALIZED_DOCUMENT_DESCRIPTION =
  "Full submitted handoff detail externalized automatically; required for cold resume and reconciliation.";

export function isAutoExternalizedHandoffDocument(document: { description: string }): boolean {
  return document.description === HANDOFF_AUTO_EXTERNALIZED_DOCUMENT_DESCRIPTION;
}

/** Level-2 (`##`) headings of a handoff document, in order. Used to name
 * what an externalized document contains when its content cannot be
 * inlined (budget, or the file is missing) and as a table of contents
 * alongside content that is inlined. */
export function extractHandoffSectionHeadings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) headings.push(match[1]!);
  }
  return headings;
}

/** Prior `##` headings with no counterpart heading in `newContent`. A
 * section counts as carried forward only if its exact heading text
 * (case-insensitive) still appears as a `##` heading somewhere in the new
 * content — matching by heading, not by scanning prose for the words, keeps
 * this a narrow structural check rather than a fuzzy content audit. Callers
 * needing "did the author account for this" evidence use
 * validateHandoffSectionReconciliation below, which turns this list into a
 * typed refusal unless every entry has a disposition. */
function unaccountedHandoffSections(priorSectionHeadings: string[], newContent: string): string[] {
  const newHeadings = new Set(extractHandoffSectionHeadings(newContent).map((heading) => heading.trim().toLowerCase()));
  return priorSectionHeadings.filter((heading) => !newHeadings.has(heading.trim().toLowerCase()));
}

/**
 * Make reconciliation evidenced rather than asserted (P104(F005)/T416).
 *
 * Narrow by design: this compares `##` heading text only, never section
 * content or a fixed category list — it is not a return to the 16-section
 * scaffold and 14-category cold-start inventory P100(F021)/T396 removed for
 * making authoring verbose and failing late. A prior capsule with no
 * headings (or a new submission with none) simply has nothing to name here;
 * the check degrades to a no-op rather than blocking the write.
 *
 * A prior section vanishes from the new content in three ways an author
 * might legitimately intend: dropped because it no longer matters,
 * superseded by newer content, or folded into a different section (a rename
 * reads the same way — the old heading is gone, the content lives under a
 * new one). This function does not try to tell those apart; it only
 * requires the author to say which happened, per named section, before the
 * write proceeds. A deliberate full rewrite where every prior section is
 * obsolete is handled the same way: every heading is named, and the author
 * writes one disposition per heading.
 */
export function validateHandoffSectionReconciliation(
  priorSectionHeadings: string[],
  newContent: string,
  dispositions: HandoffSectionDispositionInput[] | undefined,
): void {
  const unaccounted = unaccountedHandoffSections(priorSectionHeadings, newContent);
  if (unaccounted.length === 0) return;
  const bySection = new Map<string, string>();
  for (const entry of dispositions ?? []) {
    const section = entry.section?.trim();
    if (section) bySection.set(section.toLowerCase(), entry.disposition ?? "");
  }
  const stillUnaccounted = unaccounted.filter((section) => !isSubstantive(bySection.get(section.trim().toLowerCase()) ?? ""));
  if (stillUnaccounted.length > 0) {
    throw new HandoffContractError(
      "HANDOFF_SECTION_RECONCILIATION_REQUIRED",
      "Prior handoff sections have no counterpart in the new content. Supply sectionDispositions with one substantive entry per named section (dropped, superseded, or folded into another section) before writing.",
      {
        unaccountedSections: stillUnaccounted,
        recovery: "Retry against the same phaseRef and expectedHandoffUpdatedAt with sectionDispositions only; content may be omitted to reuse the body just submitted.",
      },
    );
  }
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
  targetContentChars: number;
  maxContentChars: number;
  completenessCategories: ReadonlyArray<{ id: HandoffCompletenessCategory; label: string }>;
  canonicalSections: ReadonlyArray<string>;
  requiredHumanInputs: ReadonlyArray<{ id: "title" | "reason"; label: string; description: string }>;
  draftTemplate: string;
  coldStartInventoryVersion: number;
  coldStartSourceReviews: ReadonlyArray<{ id: string; label: string }>;
  coldStartInventoryCategories: ReadonlyArray<{ id: HandoffColdStartInventoryCategory; label: string }>;
  existingCompletenessAudit: HandoffCompletenessAudit | null;
  phaseWorkMap: PhaseWorkMap;
  /** Read before drafting: supportingDocuments is optional and rarely needed. */
  supportingDocumentsGuidance: string;
  /** Documents the existing active handoff's own auto-externalization moved
   *  out of the inline capsule (see HANDOFF_AUTO_EXTERNALIZED_DOCUMENT_DESCRIPTION).
   *  Empty when there is no active handoff or nothing was ever externalized
   *  from it. auditPhaseHandoff itself never populates this (it is pure and
   *  has no filesystem access) — PlanStore.preparePhaseHandoff fills it in
   *  after reading each document back from .planner/docs/. */
  externalizedHandoffDocuments: HandoffExternalizedDocumentAudit[];
  /** `##` headings of the full prior capsule the next write will supersede:
   *  the active handoff's own headings plus, per P104(F005)/T415, the
   *  headings of every document its own auto-externalization moved out —
   *  never the elided copy, so a heading that survives only in the
   *  externalized file is still named. Empty when there is no active
   *  handoff to reconcile against (first write, or one already archived by
   *  handoff_clear). auditPhaseHandoff itself only derives this from the
   *  compact capsule text (no filesystem access); PlanStore.preparePhaseHandoff
   *  and PlanStore.refreshPhaseHandoff both overlay the externalized
   *  documents' own headings after reading them back. See
   *  validateHandoffSectionReconciliation, which consumes this list. */
  priorSectionHeadings: string[];
}

export interface RefreshPhaseHandoffInput {
  /** Structured, human-supplied explanation; rendered by the planner. */
  reason: string;
  content: string;
  expectedHandoffUpdatedAt: string;
  reconciledExistingHandoff: boolean;
  /** The full prior capsule's `##` headings (see PhaseHandoffAudit.priorSectionHeadings),
   *  as PlanStore derived them from the live phase this write is targeting —
   *  never a stale copy captured at prepare time, so a handoff archived
   *  between prepare and write (phase.handoff now "") correctly yields no
   *  sections to reconcile instead of demanding dispositions for content
   *  that is no longer live. Populated by PlanStore; absent only in direct
   *  unit calls to applyHandoffContextSync/validateHandoffContextSync that
   *  do not exercise this check. */
  priorSectionHeadings?: string[];
  /** Per-section account for each entry in priorSectionHeadings that has no
   *  counterpart heading in the submitted content. See
   *  validateHandoffSectionReconciliation. */
  sectionDispositions?: HandoffSectionDispositionInput[];
  completenessAudit?: HandoffCompletenessAuditInput;
  coldStartInventory?: HandoffColdStartInventoryInput;
  supportingDocuments?: HandoffSupportingDocumentInput[];
  /** The body exactly as the agent submitted it, before auto-externalization
   *  rewrote `content`. Set by PlanStore only when a rewrite happened, so the
   *  agent's own document links are still judged against what the agent wrote. */
  submittedContent?: string;
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

export interface VerifyPhaseHandoffReadBackInput {
  expectedContentHash: string;
  /** Optional legacy evidence; compact handoffs derive this from persisted state. */
  sourceReviews?: Array<{ source: string; detail: string }>;
  omissionsFound?: string[];
}

export interface VerifyPhaseHandoffReadBackResult {
  phaseId: string;
  handoffUpdatedAt: string;
  contentHash: string;
  resumeReadyAt: string;
  sourceReviews: Array<{ source: string; detail: string }>;
}

export function hasTaskCompletionEvidence(task: Task): boolean {
  if (task.status !== "done") return true;
  if (task.description.includes(COMPLETION_SUMMARY_HEADING)) return true;
  return task.statusLog.some((entry) => entry.toStatus === "done" && entry.description.trim().length > 0);
}

export function buildHandoffDraftTemplate(phase: Phase, feature: Feature): string {
  const featureRef = `F${String(feature.number).padStart(3, "0")}`;
  const phaseRef = `P${String(phase.number).padStart(3, "0")}(${featureRef})`;
  return [
    `# ${phaseRef} — {{REQUIRED: meaningful handoff title}}`,
    "",
    "<!-- Planner-generated: Created at, Updated at, and structured Reason. Do not write these lines in the draft. -->",
    "",
    "## Current focus",
    `- Feature: ${featureRef} — ${feature.name}`,
    `- Phase: ${phaseRef} — ${phase.title}`,
    "- Task: {{REQUIRED: exact composite task ref and title}}",
    "- Exact resume point: {{REQUIRED: file, symbol, command, or state boundary}}",
    "",
    "## Current and partial state",
    "{{REQUIRED: concise completed/current/partial state only; keep extended detail in supporting documents}}",
    "",
    "## Preservation constraints",
    "{{REQUIRED: minimal behaviors and boundaries that must survive}}",
    "",
    "## Supporting documents",
    "- {{REQUIRED: ordered .planner/docs/*.md links with why each is needed, or an explicit verified statement that none are needed}}",
    "",
    "## Blockers and risks",
    "- {{REQUIRED: blocker/risk, or a substantive verified statement that none apply}}",
    "",
    "## How to resume",
    "1. {{REQUIRED: first exact action, including file/symbol/command}}",
    "2. {{REQUIRED: subsequent ordered actions and verification}}",
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
    targetContentChars: TARGET_HANDOFF_CONTENT_CHARS,
    maxContentChars: MAX_HANDOFF_CONTENT_CHARS,
    completenessCategories: HANDOFF_COMPLETENESS_CATEGORIES,
    canonicalSections: HANDOFF_CANONICAL_SECTIONS,
    requiredHumanInputs: [
      { id: "title", label: "Meaningful title", description: "A concise handoff title; the planner renders it as the H1." },
      { id: "reason", label: "Reason", description: "Why work is stopping and why a cold agent needs this handoff; the planner renders it as metadata." },
    ],
    draftTemplate: buildHandoffDraftTemplate(phase, feature),
    coldStartInventoryVersion: HANDOFF_COLD_START_INVENTORY_VERSION,
    coldStartSourceReviews: HANDOFF_COLD_START_SOURCE_REVIEWS,
    coldStartInventoryCategories: HANDOFF_COLD_START_INVENTORY_CATEGORIES,
    existingCompletenessAudit: phase.handoffAudit,
    phaseWorkMap: buildPhaseWorkMap(phase, feature.number),
    supportingDocumentsGuidance: HANDOFF_SUPPORTING_DOCUMENTS_GUIDANCE,
    // Filled in by PlanStore.preparePhaseHandoff, which alone can read
    // .planner/docs/; this pure function has no filesystem access.
    externalizedHandoffDocuments: [],
    // Compact-capsule headings only; PlanStore.preparePhaseHandoff overlays
    // headings from auto-externalized documents once it has read them back.
    priorSectionHeadings: phase.handoff.trim() ? extractHandoffSectionHeadings(phase.handoff) : [],
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
  if (!audit) {
    return expectedIds.map((category) => ({
      category,
      status: "captured",
      detail: "Derived from the compact handoff and persisted planner state; no duplicate prose audit was supplied.",
    }));
  }
  if (audit.version !== HANDOFF_COMPLETENESS_AUDIT_VERSION) {
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
  if (!inventory) {
    return expectedIds.map((category) => ({
      category,
      items: ["Derived from the compact handoff and persisted planner state."],
    }));
  }
  if (inventory.version !== HANDOFF_COLD_START_INVENTORY_VERSION) {
    throw new HandoffContractError(
      "HANDOFF_COLD_START_INVENTORY_REQUIRED",
      `Cold-start inventory version ${HANDOFF_COLD_START_INVENTORY_VERSION} is required when legacy inventory evidence is supplied.`,
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

export function validateHandoffReadBackVerification(
  phase: Phase,
  input: VerifyPhaseHandoffReadBackInput,
): Array<{ source: string; detail: string }> {
  const audit = phase.handoffAudit;
  const actualContentHash = phase.handoff.trim() ? handoffContentHash(phase.handoff) : "";
  if (!phase.handoff.trim() || !audit || audit.contentHash !== actualContentHash || audit.contentLength !== phase.handoff.length) {
    throw new HandoffContractError(
      "HANDOFF_READBACK_VERIFICATION_REQUIRED",
      "The persisted handoff or its audit metadata is missing or inconsistent. Run handoff_prepare, rewrite the handoff, then read it back before verification.",
      { expectedContentHash: input.expectedContentHash, actualContentHash, auditContentHash: audit?.contentHash ?? "" },
    );
  }
  if (!input.expectedContentHash.trim() || input.expectedContentHash !== actualContentHash) {
    throw new HandoffContractError(
      "HANDOFF_READBACK_VERIFICATION_REQUIRED",
      "The handoff changed after the read-back candidate was selected. Call handoff_show again and verify the returned contentHash.",
      { expectedContentHash: input.expectedContentHash, actualContentHash },
    );
  }

  const requiredSources = HANDOFF_COLD_START_SOURCE_REVIEWS.map((entry) => entry.id);
  const suppliedReviews = input.sourceReviews ?? [];
  if (suppliedReviews.length === 0 && (input.omissionsFound ?? []).length === 0) {
    return requiredSources.map((source) => ({
      source,
      detail: "Derived from persisted handoff content, planner entities, and read-back state; no duplicate source inventory was supplied.",
    }));
  }
  const bySource = new Map<string, string>();
  const duplicateSources: string[] = [];
  for (const review of suppliedReviews) {
    if (bySource.has(review.source)) duplicateSources.push(review.source);
    else bySource.set(review.source, review.detail.trim());
  }
  const missingSources = requiredSources.filter((source) => !bySource.has(source));
  const unknownSources = [...bySource.keys()].filter((source) => !requiredSources.includes(source as typeof requiredSources[number]));
  const invalidSources = requiredSources.filter((source) => {
    const detail = bySource.get(source);
    return detail !== undefined && !isSubstantive(detail);
  });
  if (missingSources.length > 0 || unknownSources.length > 0 || duplicateSources.length > 0 || invalidSources.length > 0) {
    throw new HandoffContractError(
      "HANDOFF_READBACK_VERIFICATION_REQUIRED",
      "Legacy read-back source evidence is incomplete. For compact handoffs omit sourceReviews and omissionsFound so the planner can derive evidence from persisted state.",
      { missingSources, unknownSources, duplicateSources: [...new Set(duplicateSources)], invalidSources },
    );
  }

  const omissionsFound = uniqueStrings(input.omissionsFound ?? []);
  if (omissionsFound.length > 0) {
    throw new HandoffContractError(
      "HANDOFF_READBACK_GAPS_FOUND",
      "The persisted handoff is not resume-ready because the read-back found omissions. Run handoff_prepare again, reconcile every listed gap, and rewrite before retrying verification.",
      { omissionsFound },
    );
  }
  return requiredSources.map((source) => ({ source, detail: bySource.get(source)! }));
}

function sectionBody(content: string, headings: string[]): string {
  const lines = content.split(/\r?\n/);
  const normalized = new Set(headings.map((heading) => heading.toLowerCase()));
  const start = lines.findIndex((line) => {
    const match = line.match(/^##\s+(.+?)\s*$/);
    return Boolean(match && normalized.has(match[1]!.toLowerCase()));
  });
  if (start < 0) return "";
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index]!)) break;
    body.push(lines[index]!);
  }
  return body.join("\n").trim();
}

/**
 * Truncate `value` to at most `maxChars`, cutting at the nearest paragraph
 * break, then line break, then word boundary before the limit — never
 * mid-word and never mid-list-item. A raw `slice(0, maxChars)` is what
 * previously cut a reporter's handoff mid-word ("Ownershi|p") and moved half
 * of a numbered list into the externalized file while leaving the other
 * half incoherent in the compact capsule; this is the one place that
 * decides where an oversized section breaks, reused by every caller that
 * needs to bound arbitrary handoff prose for transport (see
 * handoff-reply.ts's boundedHandoffForTransport and its per-document use
 * for externalized content).
 */
export function truncateAtSafeBoundary(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  const slice = value.slice(0, maxChars);
  const paragraphBreak = slice.lastIndexOf("\n\n");
  const lineBreak = slice.lastIndexOf("\n");
  const wordBreak = slice.lastIndexOf(" ");
  const cut = paragraphBreak >= 0 ? paragraphBreak : lineBreak >= 0 ? lineBreak : wordBreak >= 0 ? wordBreak : maxChars;
  return slice.slice(0, cut).trimEnd();
}

/** Truncate `content` to at most `maxChars` at a safe boundary (see
 * truncateAtSafeBoundary) and report whether a cut happened. Callers append
 * their own contextual continuation message — this stays message-agnostic
 * so both the top-level handoff bound and the externalized-document bound
 * in handoff-reply.ts share one truncation rule without sharing wording
 * that fits only one of them. */
export function boundedContentForTransport(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  return { content: truncateAtSafeBoundary(content, maxChars), truncated: true };
}

function boundedSection(value: string, fallback: string, maxChars: number): string {
  const normalized = value.trim() || fallback;
  if (normalized.length <= maxChars) return normalized;
  const safe = truncateAtSafeBoundary(normalized, Math.max(0, maxChars - 86));
  return `${safe}\n\n[Extended detail continues in the linked planner document.]`;
}

/**
 * Mechanically compact oversized legacy or verbose handoffs while retaining the
 * complete submitted body in one planner-owned Markdown document.
 */
export function externalizeOversizedHandoffContent(
  content: string,
  supportingDocumentPath: string,
): HandoffContentExternalization {
  const base = stripRenderedCompletenessAudit(content);
  if (base.length <= TARGET_HANDOFF_CONTENT_CHARS) {
    return { content: base, externalized: false, extendedContent: "" };
  }
  const firstHeading = base.split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()))?.trim() ?? "# Handoff resume capsule";
  const metadata = ["Created at", "Updated at", "Reason"].map((label) =>
    base.split(/\r?\n/).find((line) => line.toLowerCase().startsWith(`${label.toLowerCase()}:`))?.trim() ?? `${label}: See supporting document.`,
  );
  const currentFocus = boundedSection(sectionBody(base, ["Current focus"]), "Exact focus and resume point are preserved in the supporting document.", 1_200);
  const currentState = boundedSection(sectionBody(base, ["Current and partial state", "What was being done"]), "Current and partial work details are preserved in the supporting document.", 1_500);
  const preservation = boundedSection(sectionBody(base, ["Preservation constraints"]), "Preservation constraints are recorded in the supporting document.", 900);
  const blockers = boundedSection(sectionBody(base, ["Blockers and risks", "Blockers"]), "Blockers and risks are recorded in the supporting document.", 900);
  const resume = boundedSection(sectionBody(base, ["How to resume", "Next steps"]), "1. Read the linked supporting document completely, then resume from its first ordered action.", 1_500);
  const compact = [
    firstHeading,
    "",
    ...metadata,
    "",
    "## Current focus",
    currentFocus,
    "",
    "## Current and partial state",
    currentState,
    "",
    "## Preservation constraints",
    preservation,
    "",
    "## Supporting documents",
    `- ${supportingDocumentPath} — Full submitted handoff detail externalized automatically because the inline resume capsule exceeded ${TARGET_HANDOFF_CONTENT_CHARS} characters. Read this document before resuming.`,
    "",
    "## Blockers and risks",
    blockers,
    "",
    "## How to resume",
    resume,
  ].join("\n").trim();
  return {
    content: compact,
    externalized: true,
    extendedContent: `${firstHeading} — extended detail\n\n${base}\n`,
    supportingDocument: {
      path: supportingDocumentPath,
      description: HANDOFF_AUTO_EXTERNALIZED_DOCUMENT_DESCRIPTION,
    },
  };
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
  if (base.length > MAX_HANDOFF_CONTENT_CHARS) {
    throw new HandoffContractError(
      "HANDOFF_CONTENT_LIMIT_EXCEEDED",
      `Inline handoff content is ${base.length} characters after compaction; the absolute compatibility ceiling is ${MAX_HANDOFF_CONTENT_CHARS}. Retry through PlanStore so extended detail can be externalized automatically.`,
      { contentLength: base.length, targetContentChars: TARGET_HANDOFF_CONTENT_CHARS, maxContentChars: MAX_HANDOFF_CONTENT_CHARS, continuation: "externalize-and-retry" },
    );
  }
  return base;
}

export function materializeHandoffMetadata(content: string, reason: string, createdAt: string, updatedAt: string): string {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new HandoffContractError(
      "HANDOFF_REASON_REQUIRED",
      "A structured handoff reason is required before drafting or persistence. Run handoff_prepare and provide reason; timestamps are planner-generated.",
      { requiredInputs: ["title", "reason"], generatedMetadata: ["Created at", "Updated at"] },
    );
  }
  const existingCreatedAt = content.match(/^Created at:\s*(\S+)\s*$/im)?.[1] ?? createdAt;
  const withoutMetadata = content
    .split(/\r?\n/)
    .filter((line) => !/^(?:Created at|Updated at|Reason):\s*/i.test(line.trim()))
    .join("\n")
    .trim();
  const lines = withoutMetadata.split("\n");
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  const metadata = [`Created at: ${existingCreatedAt}`, `Updated at: ${updatedAt}`, `Reason: ${normalizedReason}`];
  if (firstContent >= 0 && /^#\s+/.test(lines[firstContent] ?? "")) {
    lines.splice(firstContent + 1, 0, "", ...metadata);
  } else {
    lines.unshift(...metadata, "");
  }
  return lines.join("\n").trim();
}

export function validateCanonicalHandoffContent(content: string): void {
  // A handoff is a resume capsule, not a form. The prepared scaffold documents
  // useful headings, but requiring agents to reproduce those headings creates a
  // late write-time failure and makes them draft the same handoff twice.
  const body = nonEmpty(content, "Handoff content");
  const unresolvedPlaceholders = [...body.matchAll(/\{\{REQUIRED:[^}]+\}\}/g)].map((match) => match[0]);
  if (unresolvedPlaceholders.length > 0) {
    throw new HandoffContractError(
      "HANDOFF_CANONICAL_SECTIONS_REQUIRED",
      "The handoff still contains unresolved placeholders. Replace every placeholder before writing.",
      { missingSections: [], unresolvedPlaceholders: [...new Set(unresolvedPlaceholders)] },
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
    throw supportingDocumentInvariantError(
      "Every supporting document must be validated by PlanStore before the handoff is written.",
      { requestedCount: requestedDocuments.length, verifiedCount: verifiedDocuments.length },
    );
  }
  const verifiedContents = input.verifiedSupportingDocumentContents ?? [];
  if (verifiedContents.length !== verifiedDocuments.length) {
    throw supportingDocumentInvariantError(
      "Validated supporting-document content is required for cold-start inventory coverage checks.",
      { verifiedDocumentCount: verifiedDocuments.length, verifiedContentCount: verifiedContents.length },
    );
  }
  for (let index = 0; index < requestedDocuments.length; index += 1) {
    const requested = requestedDocuments[index]!;
    const verified = verifiedDocuments[index]!;
    if (requested.path !== verified.path || !isSubstantive(requested.description) || requested.description.trim() !== verified.description) {
      throw supportingDocumentInvalidError(
        `Supporting document ${requested.path || `(index ${index})`} is not valid or lacks a substantive description.`,
        { index, path: requested.path },
      );
    }
    // Body-dependent: the manifest is valid on its own, but the drafted content
    // never linked it. This is the one check that cannot move to prepare, since
    // prepare runs before the body exists.
    //
    // Check the submitted body as well as the persisted one. Auto-externalization
    // rewrites `content` after the agent submitted it, moving whole sections into
    // a .planner/docs/ file; a path the author linked inside one of those sections
    // is no longer in `content` through no fault of theirs. The planner's own
    // auto-externalized document is the mirror case — its path is generated during
    // the rewrite, so it appears only in `content`. Accepting either body covers
    // both without letting through a path the agent never linked anywhere.
    const linkedBodies = [input.content, ...(input.submittedContent ? [input.submittedContent] : [])];
    if (!linkedBodies.some((body) => body.includes(requested.path))) {
      throw supportingDocumentInvalidError(
        `Canonical handoff content must link supporting document ${requested.path}. Checked the ${input.submittedContent ? "submitted body and the auto-externalized body" : "submitted body"}.`,
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
  if (phase.handoff.trim()) {
    // Judge against the body the author actually wrote, not the planner's
    // own auto-externalized compaction (mirrors the supporting-document link
    // check above): when this write itself got compacted, submittedContent
    // is the full pre-compaction text and is what a prior section's heading
    // would still appear in.
    const newContentForHeadings = input.submittedContent ?? input.content;
    validateHandoffSectionReconciliation(input.priorSectionHeadings ?? [], newContentForHeadings, input.sectionDispositions);
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
    // Decisions mentioned in a completion summary are prose, not decision
    // authority (a completion summary is explicitly one of the places a new
    // durable decision must not live only in). Render them into the section
    // text with that caveat instead of appending to the legacy task.decisions
    // array, which nothing treats as authoritative and which is otherwise
    // read-only going forward (see accepted-decision-guard.ts). A decision
    // worth keeping needs its own accepted_decision_create call on the right
    // owner; this list is not a substitute for that.
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
      ...(decisions.length > 0 ? ["", "**Decisions mentioned (not decision authority; record any durable decision with accepted_decision_create on its actual owner):**", ...decisions.map((decision) => `- ${decision}`)] : []),
    ].join("\n");
    task.description = appendSection(task.description, section);
    task.descriptionUpdatedAt = timestamp;
    task.updatedAt = timestamp;
    updatedTaskIds.push(task.id);
  }

  const phaseUpdate = input.contextSync.phaseUpdate;
  if (phaseUpdate) {
    const phaseDecisions = uniqueStrings(phaseUpdate.decisions ?? []);
    const section = [
      "**Handoff context update:**",
      phaseUpdate.progressSummary.trim(),
      "",
      "**Remaining work:**",
      phaseUpdate.remainingWork.trim(),
      ...(phaseDecisions.length > 0 ? ["", "**Decisions mentioned (not decision authority; record any durable decision with accepted_decision_create on its actual owner):**", ...phaseDecisions.map((decision) => `- ${decision}`)] : []),
    ].join("\n");
    nextPhase.notes = appendSection(nextPhase.notes, section);
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
        const review = input.coldStartInventory?.sourceReviews.find((entry) => entry.source === id);
        return {
          source: id,
          detail: review?.detail.trim() || "Derived from persisted handoff content, planner entities, and read-back state; no duplicate source inventory was supplied.",
        };
      }),
      entries: coldStartInventoryEntries,
    },
    supportingDocuments: input.verifiedSupportingDocuments ?? [],
    contentHash: handoffContentHash(handoffContent),
    contentLength: handoffContent.length,
    verifiedAt: timestamp,
    resumeReadyAt: "",
    readBackSourceReviews: [],
  };
  nextPhase.handoffReadAt = "";
  nextPhase.updatedAt = timestamp;
  nextFeature.updatedAt = timestamp;
  return { phase: nextPhase, feature: nextFeature, updatedTaskIds };
}
