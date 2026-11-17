/**
 * Handoff application flows (P128(F025)/T490 — one coordinated authority).
 *
 * The orchestration that turns a client request into handoff work against
 * the PlanStore: resolving the target phase, normalizing the submitted
 * body, resolving task refs, and driving prepare/show/write/verify/clear
 * plus the paged list. It lives in core so every client surface — MCP
 * tools today, the versioned HTTP API next — runs the exact same flow
 * (AGENTS.md rule 19: fix at the library level, never per call site).
 *
 * Adapters own presentation only: an MCP tool renders refusals as tool
 * results with its own wording, the HTTP API maps them to typed error
 * envelopes. The refusal `code` is the contract both share.
 */

import {
  boundedPage,
  buildHandoffPrepareReply,
  buildHandoffShowReply,
  buildPhaseWorkMap,
  findPhaseByRef,
  findTaskByRef,
  formatPhaseRef,
  type HandoffCompletenessAuditInput,
  type HandoffColdStartInventoryInput,
  type HandoffSectionDispositionInput,
  type HandoffSupportingDocumentInput,
  type Phase,
  type PhaseHandoffContextSync,
  type PlanStore,
  type RefreshPhaseHandoffResult,
  type VerifyPhaseHandoffReadBackInput,
  type VerifyPhaseHandoffReadBackResult,
} from "./index.js";

/** Refusal codes shared by every handoff client surface. */
export type PhaseHandoffRefusalCode =
  | "PHASE_REF_REQUIRED"
  | "PHASE_NOT_FOUND"
  | "GENERIC_HANDOFF_TITLE"
  | "TASK_NOT_IN_PHASE"
  | "HANDOFF_CONFIRMATION_REQUIRED"
  | "HANDOFF_PREFLIGHT_REQUIRED"
  | "HANDOFF_REASON_REQUIRED";

/**
 * A typed refusal raised by a flow before any store mutation. Adapters
 * map the code to their own presentation; the code is the stable part.
 */
export class HandoffFlowRefusal extends Error {
  readonly code: PhaseHandoffRefusalCode;
  readonly details: Record<string, unknown>;

  constructor(code: PhaseHandoffRefusalCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "HandoffFlowRefusal";
    this.code = code;
    this.details = details;
  }
}

export interface ResolvedHandoffPhase {
  phase: Phase;
  /** Composite ref like `P003(F002)`, for replies and links. */
  phaseRef: string;
}

/**
 * Resolve a client-supplied phase ref (P00x | P00x(F00x) | UUID | title)
 * to the canonical phase. Throws PHASE_REF_REQUIRED / PHASE_NOT_FOUND.
 */
export async function resolveHandoffPhase(store: PlanStore, ref: string | undefined): Promise<ResolvedHandoffPhase> {
  const phases = await store.loadAllPhases();
  const features = (await store.loadFeatures()).features;
  let phase: Phase | undefined;
  if (ref && ref.trim()) {
    phase = findPhaseByRef(phases, features, ref.trim());
  }
  if (!phase) {
    throw new HandoffFlowRefusal(
      ref && ref.trim() ? "PHASE_NOT_FOUND" : "PHASE_REF_REQUIRED",
      ref && ref.trim()
        ? `Phase not found: "${ref.trim()}". Use P00x, P00x(F00x), UUID, or title.`
        : "A phaseRef is required. First identify the exact feature and phase with the user, then pass P00x or P00x(F00x).",
    );
  }
  const feature = phase.featureId ? features.find((entry) => entry.id === phase.featureId) : undefined;
  return { phase, phaseRef: formatPhaseRef(phase.number, feature?.number) };
}

/**
 * Normalize a freshly-submitted handoff body: apply the requested title as
 * the first heading (or synthesize one from the body) and refuse generic
 * titles. Returns undefined when the caller omitted content — a retry that
 * reuses the body the store retained against the same token.
 */
export function normalizeHandoffBody(title: string | undefined, content: string | undefined): string | undefined {
  let body: string | undefined = content?.trim() || undefined;
  if (body === undefined) return undefined;
  const firstLine = body.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const firstHeadingText = firstLine.replace(/^#+\s*/, "").trim();
  const effectiveHeadingText = title?.trim() || firstHeadingText;
  if (!effectiveHeadingText || /^(handoff|canonical handoff|session handoff)$/i.test(effectiveHeadingText)) {
    throw new HandoffFlowRefusal("GENERIC_HANDOFF_TITLE", "Generic handoff title. Provide a meaningful title summarizing the work.");
  }
  if (title?.trim()) {
    const lines = body.split(/\r?\n/);
    const firstIdx = lines.findIndex((line) => line.trim().length > 0);
    if (firstIdx !== -1 && /^#+\s/.test(lines[firstIdx] ?? "")) lines[firstIdx] = `# ${title.trim()}`;
    else lines.unshift(`# ${title.trim()}`, "");
    body = lines.join("\n");
  }
  return body;
}

/**
 * Prepare the handoff target: compact resume scaffold, work map, current
 * token and missing task evidence. Throws HandoffContractError from the
 * store when preparation is denied.
 */
export async function preparePhaseHandoffFlow(
  store: PlanStore,
  ref: string,
  supportingDocuments?: HandoffSupportingDocumentInput[],
) {
  const resolved = await resolveHandoffPhase(store, ref);
  const audit = await store.preparePhaseHandoff(resolved.phase.id, supportingDocuments);
  return buildHandoffPrepareReply({ phaseRef: resolved.phaseRef, audit });
}

/**
 * Read the active handoff (or its latest terminal archive) with a bounded
 * phase work map — the full show reply both surfaces render verbatim.
 */
export async function showPhaseHandoffFlow(store: PlanStore, ref: string) {
  const resolved = await resolveHandoffPhase(store, ref);
  const phase = await store.loadPhase(resolved.phase.id);
  if (!phase.handoff.trim()) {
    const archived = (await store.listArchivedHandoffs()).find((entry) => entry.phaseId === phase.id
      && new Set(["phase-done", "phase-rejected", "phase-canceled"]).has(entry.reason));
    return archived
      ? buildHandoffShowReply({
        kind: "archived",
        phaseRef: resolved.phaseRef,
        phaseId: phase.id,
        content: archived.content,
        archiveReason: archived.reason,
        archivedAt: archived.archivedAt,
        archiveFile: archived.file,
        handoffAudit: phase.handoffAudit,
      })
      : buildHandoffShowReply({ kind: "empty", phaseRef: resolved.phaseRef, phaseId: resolved.phase.id, handoffAudit: phase.handoffAudit });
  }
  const feature = (await store.loadFeatures()).features.find((entry) => entry.id === phase.featureId);
  const phaseWorkMap = buildPhaseWorkMap(phase, feature?.number);
  return buildHandoffShowReply({ kind: "active", phaseRef: resolved.phaseRef, phase, phaseWorkMap });
}

/** Client-neutral write request; every field is validated by the flow. */
export interface PhaseHandoffWriteRequest {
  confirmed: boolean;
  /** Why work is stopping; required for confirmed writes. */
  reason?: string | undefined;
  /** Fresh body; omit only to reuse the retained body from a failed attempt. */
  content?: string | undefined;
  title?: string | undefined;
  /** Exact token from prepare; required (may be empty when no handoff exists). */
  expectedHandoffUpdatedAt?: string | undefined;
  reconciledExistingHandoff?: boolean | undefined;
  sectionDispositions?: HandoffSectionDispositionInput[] | undefined;
  completenessAudit?: HandoffCompletenessAuditInput | undefined;
  coldStartInventory?: HandoffColdStartInventoryInput | undefined;
  supportingDocuments?: HandoffSupportingDocumentInput[] | undefined;
  taskUpdates?: Array<{
    taskRef: string;
    completionSummary: string;
    verification: string;
    remainingWork: string;
    filesTouched?: string[] | undefined;
    decisions?: string[] | undefined;
  }> | undefined;
  phaseUpdate?: { progressSummary: string; remainingWork: string; decisions?: string[] | undefined } | undefined;
  phaseNoUpdateReason?: string | undefined;
  featureUpdate?: { workDone: string; workRemaining: string } | undefined;
  featureNoUpdateReason?: string | undefined;
}

export interface PhaseHandoffWriteOutcome {
  phaseRef: string;
  phaseId: string;
  result: RefreshPhaseHandoffResult;
}

/**
 * Write one reconciled handoff candidate. Enforces the whole admission
 * contract (confirmation, preflight token, reason, task ownership) and
 * persists through PlanStore.refreshPhaseHandoff, then regenerates
 * derived files. Throws typed refusals; store contract errors propagate
 * as HandoffContractError.
 */
export async function writePhaseHandoffFlow(store: PlanStore, ref: string, request: PhaseHandoffWriteRequest): Promise<PhaseHandoffWriteOutcome> {
  // Title normalization first, exactly as the tool contract has always done:
  // a generic title is refused even when the phase ref is also invalid.
  const body = normalizeHandoffBody(request.title, request.content);
  const resolved = await resolveHandoffPhase(store, ref);
  if (!request.confirmed) {
    throw new HandoffFlowRefusal("HANDOFF_CONFIRMATION_REQUIRED", "The user must confirm the proposed feature+phase target before persistence.", { phaseRef: resolved.phaseRef });
  }
  if (request.expectedHandoffUpdatedAt === undefined) {
    throw new HandoffFlowRefusal("HANDOFF_PREFLIGHT_REQUIRED", "Run the handoff prepare flow first and pass expectedHandoffUpdatedAt.");
  }
  if (!request.reason?.trim()) {
    throw new HandoffFlowRefusal("HANDOFF_REASON_REQUIRED", "Handoff reason is required before persistence. Created at and Updated at are generated by the planner; do not add them to Markdown.", { requiredInputs: ["title", "reason"], generatedMetadata: ["Created at", "Updated at"] });
  }
  const phases = await store.loadAllPhases();
  const features = (await store.loadFeatures()).features;
  const resolvedTaskUpdates = [];
  for (const update of request.taskUpdates ?? []) {
    const found = findTaskByRef(phases, features, update.taskRef.trim());
    if (!found || found.phase.id !== resolved.phase.id) {
      throw new HandoffFlowRefusal("TASK_NOT_IN_PHASE", `Task ${update.taskRef} does not belong to ${resolved.phaseRef}.`, { taskRef: update.taskRef });
    }
    resolvedTaskUpdates.push({
      taskId: found.task.id,
      completionSummary: update.completionSummary,
      verification: update.verification,
      remainingWork: update.remainingWork,
      ...(update.filesTouched ? { filesTouched: update.filesTouched } : {}),
      ...(update.decisions ? { decisions: update.decisions } : {}),
    });
  }
  const contextSync: PhaseHandoffContextSync = {
    taskUpdates: resolvedTaskUpdates,
    ...(request.phaseUpdate ? { phaseUpdate: {
      progressSummary: request.phaseUpdate.progressSummary,
      remainingWork: request.phaseUpdate.remainingWork,
      ...(request.phaseUpdate.decisions ? { decisions: request.phaseUpdate.decisions } : {}),
    } } : {}),
    ...(request.phaseNoUpdateReason ? { phaseNoUpdateReason: request.phaseNoUpdateReason } : {}),
    ...(request.featureUpdate ? { featureUpdate: request.featureUpdate } : {}),
    ...(request.featureNoUpdateReason ? { featureNoUpdateReason: request.featureNoUpdateReason } : {}),
  };
  const result = await store.refreshPhaseHandoff(resolved.phase.id, {
    reason: request.reason.trim(),
    ...(body !== undefined ? { content: body } : {}),
    expectedHandoffUpdatedAt: request.expectedHandoffUpdatedAt,
    reconciledExistingHandoff: request.reconciledExistingHandoff === true,
    ...(request.sectionDispositions ? { sectionDispositions: request.sectionDispositions } : {}),
    ...(request.completenessAudit ? { completenessAudit: request.completenessAudit } : {}),
    ...(request.coldStartInventory ? { coldStartInventory: request.coldStartInventory } : {}),
    ...(request.supportingDocuments ? { supportingDocuments: request.supportingDocuments } : {}),
    contextSync,
  });
  await store.writeGenerated();
  return { phaseRef: resolved.phaseRef, phaseId: resolved.phase.id, result };
}

/**
 * Finalize a persisted handoff as resume-ready after the client read back
 * the shown capsule and confirmed its contentHash.
 */
export async function verifyPhaseHandoffFlow(
  store: PlanStore,
  ref: string,
  input: VerifyPhaseHandoffReadBackInput,
): Promise<{ phaseRef: string; result: VerifyPhaseHandoffReadBackResult }> {
  const resolved = await resolveHandoffPhase(store, ref);
  const result = await store.verifyPhaseHandoffReadBack(resolved.phase.id, input);
  await store.writeGenerated();
  return { phaseRef: resolved.phaseRef, result };
}

/** Clear/archive the phase handoff (manual reason), preserving the token as audit. */
export async function clearPhaseHandoffFlow(store: PlanStore, ref: string): Promise<{ phaseRef: string; phaseId: string }> {
  const resolved = await resolveHandoffPhase(store, ref);
  await store.clearPhaseHandoff(resolved.phase.id, "manual");
  return { phaseRef: resolved.phaseRef, phaseId: resolved.phase.id };
}

export interface PhaseHandoffListPage {
  items: Awaited<ReturnType<PlanStore["listHandoffs"]>>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Paged active-handoff summaries; full bodies are never embedded. */
export async function listPhaseHandoffsFlow(store: PlanStore, page: number, pageSize: number): Promise<PhaseHandoffListPage> {
  const list = await store.listHandoffs();
  if (list.length === 0) {
    return { items: [], page: 1, pageSize, total: 0, totalPages: 1 };
  }
  const result = boundedPage(list, page, pageSize);
  return { items: result.items, page: result.page, pageSize, total: result.total, totalPages: result.totalPages };
}
