/**
 * Shared reply shaping for the handoff show/prepare tools.
 *
 * Every adapter (MCP, Pi, and any future harness) calls the same builders
 * here instead of assembling its own text/structuredContent pair. Each
 * builder returns exactly one copy of every piece of information: the
 * human-readable channel (`text`) and the machine-readable channel
 * (`structured`) never both carry the same field. Which channel is
 * canonical for a given piece of content is decided per field below, based
 * on what a structuredContent-only host needs in order to act (see the
 * per-field comments) rather than by a single blanket rule — see AGENTS.md
 * rule 4: this placement decision belongs in the core exactly once, not
 * once per adapter.
 */
import type { HandoffCompletenessAudit, HandoffSupportingDocument, Phase } from "./schema.js";
import type { PhaseWorkMap } from "./task-context.js";
import { MAX_HANDOFF_CONTENT_CHARS, handoffContentHash, type PhaseHandoffAudit } from "./handoff-context.js";

export interface BoundedHandoffContent {
  content: string;
  fullLength: number;
  truncated: boolean;
}

/** Bound raw handoff content to the absolute compatibility ceiling for
 * transport. Legacy or externally-written content can exceed the ceiling;
 * everything produced through the normal write path already respects it. */
export function boundedHandoffForTransport(content: string): BoundedHandoffContent {
  if (content.length <= MAX_HANDOFF_CONTENT_CHARS) return { content, fullLength: content.length, truncated: false };
  const suffix = "\n\n[Legacy handoff truncated for transport safety. Move extended detail to a linked file under .planner/docs/ and refresh the handoff.]";
  return {
    content: `${content.slice(0, MAX_HANDOFF_CONTENT_CHARS - suffix.length)}${suffix}`,
    fullLength: content.length,
    truncated: true,
  };
}

/** A tool reply as one result: the human-readable body and the structured
 * payload, with no field present in both. */
export interface HandoffReply {
  text: string;
  structured: Record<string, unknown>;
}

/**
 * Transport shape of the phase work map. `entries` is the machine-readable
 * twin of the rendered `content` — the same siblings spelled as JSON — and
 * no caller reads it off a reply, so only the counts travel. Pass
 * `includeContent` for the reply that renders the map in no other channel.
 */
function workMapForTransport(map: PhaseWorkMap, includeContent: boolean): Record<string, unknown> {
  return {
    ...(includeContent ? { content: map.content } : {}),
    total: map.total,
    truncated: map.truncated,
    maxChars: map.maxChars,
  };
}

/**
 * Transport shape of the persisted audit. `entries`, `coldStartInventory`
 * and `readBackSourceReviews` are planner-owned legacy evidence that agents
 * are told not to reproduce (P100(F021)/T396) and that nothing reads back
 * off a reply; only the verification facts travel.
 */
function handoffAuditForTransport(audit: HandoffCompletenessAudit | null): Record<string, unknown> | null {
  if (!audit) return null;
  return {
    version: audit.version,
    contentHash: audit.contentHash,
    contentLength: audit.contentLength,
    verifiedAt: audit.verifiedAt,
    resumeReadyAt: audit.resumeReadyAt,
    supportingDocuments: audit.supportingDocuments,
  };
}

export type HandoffShowReplyInput =
  | {
      kind: "empty";
      phaseRef: string;
      phaseId: string;
      handoffAudit: HandoffCompletenessAudit | null;
    }
  | {
      kind: "archived";
      phaseRef: string;
      phaseId: string;
      /** Raw archived content; the builder bounds it for transport. */
      content: string;
      archiveReason: string;
      archivedAt: string;
      archiveFile: string;
      handoffAudit: HandoffCompletenessAudit | null;
    }
  | {
      kind: "active";
      phaseRef: string;
      phase: Phase;
      phaseWorkMap: PhaseWorkMap;
    };

/**
 * Build the reply for `planner-handoff-show` / `handoff_show`, covering the
 * empty, archived, and active branches through one shared shape so no
 * surface keeps its own construction.
 *
 * Placement: the resume capsule body is prose meant to be read, and every
 * existing consumer reads it from `text` (never from `structured`), so
 * `text` is its one home; `structured` carries only `fullLength`/
 * `truncated` flags plus the identifiers, hash, and verification flags a
 * structuredContent-only host needs to drive the candidate-then-verify
 * contract (call verify with the right hash) without needing the prose
 * itself.
 */
export function buildHandoffShowReply(input: HandoffShowReplyInput): HandoffReply {
  if (input.kind === "empty") {
    return {
      text: `No handoff set on ${input.phaseRef}.`,
      structured: {
        phaseRef: input.phaseRef,
        phaseId: input.phaseId,
        content: "",
        empty: true,
        resumeReady: false,
        handoffAudit: handoffAuditForTransport(input.handoffAudit),
      },
    };
  }

  if (input.kind === "archived") {
    const bounded = boundedHandoffForTransport(input.content);
    const supportingDocuments: HandoffSupportingDocument[] = input.handoffAudit?.supportingDocuments ?? [];
    const documentLines = supportingDocuments.map((document) => `- ${document.path} — ${document.description}`);
    return {
      text: [
        `Archived terminal-phase handoff for ${input.phaseRef} (${input.archiveReason}; archived ${input.archivedAt})`,
        ...(documentLines.length ? ["Supporting documents:", ...documentLines] : []),
        "",
        bounded.content,
      ].join("\n"),
      structured: {
        phaseRef: input.phaseRef,
        phaseId: input.phaseId,
        active: false,
        archived: true,
        archiveReason: input.archiveReason,
        archivedAt: input.archivedAt,
        archiveFile: input.archiveFile,
        fullLength: bounded.fullLength,
        truncated: bounded.truncated,
        supportingDocuments,
        empty: false,
        resumeReady: false,
        handoffAudit: handoffAuditForTransport(input.handoffAudit),
      },
    };
  }

  const { phase, phaseRef, phaseWorkMap } = input;
  const bounded = boundedHandoffForTransport(phase.handoff);
  const contentHash = handoffContentHash(phase.handoff);
  const persistenceVerified = Boolean(phase.handoffAudit
    && phase.handoffAudit.contentHash === contentHash
    && phase.handoffAudit.contentLength === phase.handoff.length);
  const resumeReady = persistenceVerified && Boolean(phase.handoffAudit?.resumeReadyAt);
  const status = resumeReady
    ? "Resume-ready: persisted compact capsule read-back completed."
    : "NOT resume-ready: after reading this persisted capsule, call planner-handoff-verify with its contentHash. The planner derives legacy evidence from persisted state; rewrite only if the capsule itself omits resume-critical context.";
  return {
    text: `Handoff for ${phaseRef}\n${status}\nContent hash: ${contentHash}\n\n${phaseWorkMap.content}\n\nBefore proposing new work, reread the canonical phase and relevant sibling task full view; do not duplicate an already-owned capability.\n\n${bounded.content}`,
    structured: {
      phaseRef,
      phaseId: phase.id,
      // The rendered map is already in `text`, so only the counts travel.
      phaseWorkMap: workMapForTransport(phaseWorkMap, false),
      fullLength: bounded.fullLength,
      truncated: bounded.truncated,
      contentHash,
      persistenceVerified,
      resumeReady,
      verificationRequired: !resumeReady,
      handoffAudit: handoffAuditForTransport(phase.handoffAudit),
    },
  };
}

/** Single source of truth for the prepare-reply evidence-contract sentence,
 * previously hardcoded identically in both adapters. */
export const HANDOFF_PREPARE_EVIDENCE_CONTRACT =
  "Planner-owned completeness and cold-start evidence is derived from persisted state; no category inventory is required from the agent.";

export interface HandoffPrepareReplyInput {
  phaseRef: string;
  audit: PhaseHandoffAudit;
}

/**
 * Build the reply for `planner-handoff-prepare` / `handoff_prepare`.
 *
 * Placement: `draftTemplate` has no consumer in `text` (only the intro line
 * pointing at it is read there) and every existing consumer reads it from
 * `structured`, so `structured` is its one home; `text` gets a pointer
 * instead of a second copy. The existing active handoff being reconciled is
 * the opposite: nothing reads it from `structured`, so it stays prose in
 * `text` only, bounded for transport, with `structured` carrying just its
 * length/truncated flags. `missingCompletionTasks` duplicates the same
 * titles already rendered into `text`; `structured` keeps only the task ids
 * needed to address `taskUpdates`.
 */
export function buildHandoffPrepareReply(input: HandoffPrepareReplyInput): HandoffReply {
  const { phaseRef, audit } = input;
  const {
    completenessCategories: _completenessCategories,
    coldStartSourceReviews: _coldStartSourceReviews,
    coldStartInventoryCategories: _coldStartInventoryCategories,
    handoff,
    missingCompletionTasks,
    // Guidance is instruction the agent reads; the text channel renders it,
    // so it must not travel again in the structured payload.
    supportingDocumentsGuidance: _supportingDocumentsGuidance,
    ...structuredAudit
  } = audit;

  const missingLines = missingCompletionTasks
    .map((task) => `- T${String(task.number).padStart(3, "0")} — ${task.title}`)
    .join("\n") || "- None";
  const existingBounded = boundedHandoffForTransport(handoff);
  const existingText = existingBounded.content.trim() || "(none)";

  const text = [
    `Handoff preparation for ${phaseRef}`,
    `Base handoffUpdatedAt: ${audit.handoffUpdatedAt || "(empty)"}`,
    "Required human inputs before drafting:",
    ...audit.requiredHumanInputs.map((requiredInput) => `- ${requiredInput.id} — ${requiredInput.description}`),
    "Planner-generated metadata (do not add these to Markdown): Created at, Updated at, Reason.",
    "The exact drafting scaffold is provided in the structured result's draftTemplate field; replace every angle-bracket placeholder and retain every heading.",
    "",
    "Done tasks missing durable completion/verification evidence:",
    missingLines,
    "",
    "Compact handoff contract: include only the exact focus/resume point, current or partial state, constraints, blockers, decisions, verification, and ordered next actions needed by the next agent.",
    "No Markdown heading is mandatory: concise free-form resume prose is accepted. Use headings only when they make the capsule clearer.",
    "Completeness audit and cold-start evidence are planner-owned metadata; do not copy their categories or source reviews into Markdown.",
    `Inline target: ${audit.targetContentChars} characters; absolute compatibility ceiling: ${audit.maxContentChars}. Extended detail is externalized automatically when needed.`,
    `Supporting documents: ${audit.supportingDocumentsGuidance}`,
    "",
    "Existing active handoff (reconcile all still-relevant content):",
    existingText,
  ].join("\n");

  return {
    text,
    structured: {
      phaseRef,
      ...structuredAudit,
      // Prepare renders the map in no text channel, so it keeps `content`
      // here — but not the JSON twin of the same siblings.
      phaseWorkMap: workMapForTransport(structuredAudit.phaseWorkMap, true),
      existingCompletenessAudit: handoffAuditForTransport(structuredAudit.existingCompletenessAudit),
      existingHandoffLength: existingBounded.fullLength,
      existingHandoffTruncated: existingBounded.truncated,
      evidenceContract: HANDOFF_PREPARE_EVIDENCE_CONTRACT,
    },
  };
}
