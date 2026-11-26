import { z } from "zod";
import {
  HandoffContractError, auditPhaseHandoff, extractHandoffSectionHeadings, handoffContentHash,
  isAutoExternalizedHandoffDocument, supportingDocumentInvalidError, validateHandoffReadBackVerification,
} from "../handoff-context.js";
import { buildHandoffPrepareReply } from "../handoff-reply.js";
import { formatPhaseRef } from "../naming.js";
import { findPhaseByRef } from "../refs.js";
import { HandoffCompletenessAuditSchema } from "../schema.js";
import { readRegisteredBoard } from "./board.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import { getDocumentByPath, registeredPlannerDocumentPath } from "./documents.js";
import type { PersistenceDriver } from "./driver.js";
import { archivePhaseHandoffs } from "./handoff-archive.js";
import { readProjectLists } from "./overview.js";
import { resolveProjectCaller, type ProjectCaller } from "./project-access.js";

const storedHandoff = z.union([
  z.string().transform((content) => ({ content, audit: null, archiveReason: "" })),
  z.object({ content: z.string(), audit: HandoffCompletenessAuditSchema.nullable().default(null), archiveReason: z.string().default("") }),
]);

const supportingDocumentsSchema = z.array(z.object({ path: z.string().min(1), description: z.string().min(1) })).max(50);
const verification = z.object({
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceReviews: z.array(z.object({ source: z.string(), detail: z.string() })).optional(),
  omissionsFound: z.array(z.string()).optional(),
});

export function findHandoffTarget(driver: PersistenceDriver, caller: ProjectCaller, ref: string) {
  const board = readRegisteredBoard(driver, caller.projectId, caller.workspaceId);
  if (!board) return undefined;
  const phase = findPhaseByRef(board.phases, board.features, ref);
  if (!phase) return undefined;
  const feature = board.features.find(({ id }) => id === phase.featureId);
  const phaseRef = formatPhaseRef(phase.number, feature?.number);
  const row = driver.prepare(`
    SELECT id, content, updated_at FROM phase_handoffs WHERE project_id = ? AND phase_id = ? AND archived = 0
    ORDER BY updated_at DESC, id DESC LIMIT 1
  `).get(caller.projectId, phase.id);
  const handoff = row ? storedHandoff.parse(JSON.parse(String(row.content))) : undefined;
  const priorToken = row ? "" : driver.prepare(`
    SELECT json_extract(content, '$.handoffUpdatedAt') AS token FROM phase_handoffs
    WHERE project_id = ? AND phase_id = ? AND archived = 1 ORDER BY updated_at DESC, id DESC LIMIT 1
  `).get(caller.projectId, phase.id)?.token;
  return { row, feature, phaseRef, phase: {
    ...phase, handoff: handoff?.content ?? "", handoffUpdatedAt: row ? String(row.updated_at) : String(priorToken ?? ""), handoffAudit: handoff?.audit ?? null,
  } };
}

export function readSupportingDocument(driver: PersistenceDriver, projectId: string, path: string) {
  const logical = registeredPlannerDocumentPath(path);
  return logical ? getDocumentByPath(driver, projectId, logical.folder, logical.name) : undefined;
}

export function prepareRegisteredHandoff(driver: PersistenceDriver, caller: ProjectCaller, ref: string, rawDocuments: unknown) {
  return driver.runExclusive(() => {
    if (!resolveProjectCaller(driver, caller)) return { kind: "forbidden" } as const;
    const target = findHandoffTarget(driver, caller, ref);
    if (!target) return { kind: "missing" } as const;
    if (!target.feature) return { kind: "no-feature" } as const;
    const docs = supportingDocumentsSchema.safeParse(rawDocuments);
    try {
      if (!docs.success) throw supportingDocumentInvalidError("Supply valid supporting documents.");
      for (const document of docs.data) {
        if (!readSupportingDocument(driver, caller.projectId, document.path)?.content.trim()) {
          throw supportingDocumentInvalidError("The supporting document is missing or empty.", { path: document.path });
        }
      }
      const audit = auditPhaseHandoff(target.phase, target.feature);
      const externalizedHandoffDocuments = (target.phase.handoffAudit?.supportingDocuments ?? [])
        .filter(isAutoExternalizedHandoffDocument).map((document) => {
          const content = readSupportingDocument(driver, caller.projectId, document.path)?.content ?? null;
          return {
            path: document.path, description: document.description,
            headings: content ? extractHandoffSectionHeadings(content) : [],
            content, contentLength: content?.length ?? document.contentLength, missing: content === null,
          };
        });
      const priorSectionHeadings = [...new Set([...audit.priorSectionHeadings, ...externalizedHandoffDocuments.flatMap(({ headings }) => headings)])];
      const reply = buildHandoffPrepareReply({ phaseRef: target.phaseRef, audit: { ...audit, externalizedHandoffDocuments, priorSectionHeadings } });
      return { kind: "prepared", reply } as const;
    } catch (error) {
      if (!(error instanceof HandoffContractError)) throw error;
      return { kind: "refused", code: error.code, message: error.message, details: { ...error.details, failureKind: "contract" } } as const;
    }
  });
}

export function verifyRegisteredHandoff(driver: PersistenceDriver, caller: ProjectCaller, input: { ref: string; requestId: string; fields: unknown }) {
  const { projectId } = caller;
  return executeCommand(driver, { projectId, requestId: input.requestId, operation: "handoff.verify", payload: input }, ({ recordRevision }) => {
    const target = findHandoffTarget(driver, caller, input.ref);
    if (!target) throw new CommandRefusal("PHASE_NOT_FOUND", "The phase could not be resolved.", { failureKind: "refusal" });
    const parsed = verification.safeParse(input.fields);
    if (!parsed.success) throw new CommandRefusal("INVALID_HANDOFF_VERIFICATION", "Supply a valid content hash and verification evidence.", { failureKind: "validation" });
    const { expectedContentHash, sourceReviews, omissionsFound } = parsed.data;
    let reviews;
    try {
      reviews = validateHandoffReadBackVerification(target.phase, {
        expectedContentHash, ...(sourceReviews ? { sourceReviews } : {}), ...(omissionsFound ? { omissionsFound } : {}),
      });
    } catch (error) {
      if (!(error instanceof HandoffContractError)) throw error;
      throw new CommandRefusal(error.code, error.message, { ...error.details, failureKind: "contract" });
    }
    if (!target.row || !target.phase.handoffAudit) throw new Error("The validated handoff is missing.");
    const resumeReadyAt = new Date().toISOString();
    const audit = { ...target.phase.handoffAudit, resumeReadyAt, readBackSourceReviews: reviews };
    driver.prepare("UPDATE phase_handoffs SET content = ? WHERE project_id = ? AND id = ? AND archived = 0")
      .run(JSON.stringify({ content: target.phase.handoff, audit }), projectId, target.row.id ?? null);
    recordRevision();
    publishEvent(driver, projectId, "handoff.verified", { phaseId: target.phase.id, contentHash: audit.contentHash });
    return { phaseId: target.phase.id, phaseRef: target.phaseRef, handoffUpdatedAt: target.phase.handoffUpdatedAt,
      contentHash: audit.contentHash, resumeReadyAt, sourceReviews: reviews, resumeReady: true };
  }, caller);
}

export function readRegisteredHandoffs(driver: PersistenceDriver, projectId: string, archived: boolean) {
  const { features, phases } = readProjectLists(driver, projectId);
  const featureNumbers = new Map(features.map((feature) => [feature.id, feature.number]));
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  return driver.prepare(`
    SELECT id, phase_id, content, updated_at FROM phase_handoffs WHERE project_id = ? AND archived = ?
    ORDER BY updated_at DESC, id DESC
  `).all(projectId, Number(archived)).flatMap((row) => {
    const phase = phaseById.get(String(row.phase_id));
    if (!phase || (!archived && ["done", "rejected", "canceled"].includes(phase.status))) return [];
    const { content, audit, archiveReason } = storedHandoff.parse(JSON.parse(String(row.content)));
    if (!content.trim()) return [];
    const firstLine = (content.split(/\r?\n/).find((line) => line.trim()) ?? "").trim().replace(/^#+\s*/, "").slice(0, 80);
    const updatedAt = String(row.updated_at);
    const contentHash = handoffContentHash(content);
    const resumeReady = !archived && audit?.contentHash === contentHash && audit.contentLength === content.length && Boolean(audit.resumeReadyAt);
    return [{
      phaseId: phase.id, featureId: phase.featureId, compositeRef: formatPhaseRef(phase.number, featureNumbers.get(phase.featureId ?? "")),
      firstLine, content, updatedAt, contentLength: content.length, contentHash,
      auditVersion: audit?.version ?? null, verifiedAt: audit?.verifiedAt ?? "",
      resumeReady, resumeReadyAt: resumeReady ? audit?.resumeReadyAt ?? "" : "", audit,
      file: String(row.id), archivedAt: archived ? updatedAt : "", reason: archiveReason,
    }];
  });
}

export function clearRegisteredHandoff(driver: PersistenceDriver, caller: ProjectCaller, input: { ref: string; requestId: string; confirmed: boolean }) {
  const { projectId } = caller;
  return executeCommand(driver, {
    projectId, requestId: input.requestId, operation: "handoff.clear", payload: input,
  }, ({ recordRevision }) => {
    if (!input.confirmed) throw new CommandRefusal("CONFIRMATION_REQUIRED", "Confirm archiving the selected phase handoff.");
    const { features, phases } = readProjectLists(driver, projectId);
    const phase = findPhaseByRef(phases, features, input.ref);
    if (!phase) throw new CommandRefusal("PHASE_NOT_FOUND", "The phase could not be resolved.");
    const phaseRef = formatPhaseRef(phase.number, features.find(({ id }) => id === phase.featureId)?.number);
    if (archivePhaseHandoffs(driver, projectId, phase.id, "manual", new Date().toISOString())) {
      recordRevision();
      publishEvent(driver, projectId, "handoff.cleared", { phaseId: phase.id });
    }
    return { cleared: true, phaseId: phase.id, phaseRef };
  }, caller);
}
