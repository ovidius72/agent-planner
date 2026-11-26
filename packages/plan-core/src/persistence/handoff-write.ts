import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  HandoffContractError, TARGET_HANDOFF_CONTENT_CHARS, applyHandoffContextSync, extractHandoffSectionHeadings,
  externalizeOversizedHandoffContent, handoffContentHash, isAutoExternalizedHandoffDocument, materializeHandoffMetadata,
  retainedHandoffContentNotFoundError, supportingDocumentInvalidError,
  type HandoffTaskContextUpdate, type PhaseHandoffContextSync,
} from "../handoff-context.js";
import { HandoffFlowRefusal, normalizeHandoffBody } from "../handoff-flow.js";
import { findTaskByRef } from "../refs.js";
import { HandoffCompletenessEntrySchema } from "../schema.js";
import { CommandRefusal, executeCommand, publishEvent } from "./command-authority.js";
import { createDocumentInTransaction } from "./documents.js";
import type { PersistenceDriver } from "./driver.js";
import { archivePhaseHandoffs } from "./handoff-archive.js";
import { findHandoffTarget, readSupportingDocument } from "./handoffs.js";
import { readProjectLists } from "./overview.js";
import { resolveProjectCaller, type ProjectCaller } from "./project-access.js";
import { reconcileLeafMutation } from "./reconciliation.js";

const strings = z.array(z.string());
const text = z.string();
const coldStartInventory = z.object({
  version: z.number().int().positive(),
  sourceReviews: z.array(z.object({ source: text, detail: text })),
  entries: z.array(z.object({ category: text, items: strings, notApplicableReason: text.optional() })),
}).transform((inventory) => ({ ...inventory, entries: inventory.entries.map(({ category, items, notApplicableReason }) => ({
  category, items, ...(notApplicableReason !== undefined ? { notApplicableReason } : {}),
})) }));

const handoffWrite = z.object({
  confirmed: z.boolean().default(false),
  reason: text.optional(), title: text.optional(), content: text.max(100_000).optional(),
  expectedHandoffUpdatedAt: text.max(64).optional(),
  reconciledExistingHandoff: z.boolean().default(false),
  sectionDispositions: z.array(z.object({ section: text, disposition: text })).optional(),
  completenessAudit: z.object({ version: z.number().int().positive(), entries: z.array(HandoffCompletenessEntrySchema) }).optional(),
  coldStartInventory: coldStartInventory.optional(),
  supportingDocuments: z.array(z.object({ path: text, description: text })).max(50).default([]),
  taskUpdates: z.array(z.object({ taskRef: text, completionSummary: text, verification: text, remainingWork: text,
    filesTouched: strings.optional(), decisions: strings.optional() })).max(100).default([]),
  phaseUpdate: z.object({ progressSummary: text, remainingWork: text, decisions: strings.optional() }).optional(),
  phaseNoUpdateReason: text.optional(),
  featureUpdate: z.object({ workDone: text, workRemaining: text }).optional(),
  featureNoUpdateReason: text.optional(),
});

export function writeRegisteredHandoff(driver: PersistenceDriver, caller: ProjectCaller, input: { ref: string; requestId: string; fields: unknown }) {
  const { projectId } = caller;
  let failedDraft: { prefix: string; key: string; content: string } | undefined;
  const outcome = executeCommand(driver, { projectId, requestId: input.requestId, operation: "handoff.write", payload: input }, ({ recordRevision }) => {
    try {
      const parsed = handoffWrite.safeParse(input.fields);
      if (!parsed.success) throw new CommandRefusal("INVALID_HANDOFF_WRITE", "Supply valid handoff fields.", { failureKind: "validation" });
      const fields = parsed.data;
      const submitted = normalizeHandoffBody(fields.title, fields.content);
      const target = findHandoffTarget(driver, caller, input.ref);
      if (!target) throw new HandoffFlowRefusal("PHASE_NOT_FOUND", "The phase could not be resolved.");
      const { phase, feature, phaseRef } = target;
      if (!fields.confirmed) throw new HandoffFlowRefusal("HANDOFF_CONFIRMATION_REQUIRED", "Confirm the feature and phase before writing the handoff.");
      if (fields.expectedHandoffUpdatedAt === undefined) throw new HandoffFlowRefusal("HANDOFF_PREFLIGHT_REQUIRED", "Prepare the handoff and supply its write token.");
      if (!fields.reason?.trim()) throw new HandoffFlowRefusal("HANDOFF_REASON_REQUIRED", "A handoff reason is required.");
      if (!feature || ["done", "canceled", "rejected"].includes(phase.status)) {
        throw new CommandRefusal("HANDOFF_TARGET_UNAVAILABLE", "A handoff requires a nonterminal phase with a registered feature.");
      }
      const prefix = `handoff.draft:${projectId}:${phase.id}:`;
      const key = prefix + fields.expectedHandoffUpdatedAt;
      const retained = submitted === undefined ? driver.prepare("SELECT value FROM store_meta WHERE key = ?").get(key)?.value : undefined;
      const draft = submitted ?? (typeof retained === "string" ? retained : undefined);
      if (!draft) throw retainedHandoffContentNotFoundError(phase.id, fields.expectedHandoffUpdatedAt);
      failedDraft = { prefix, key, content: draft };
      const previous = Date.parse(phase.handoffUpdatedAt);
      const now = new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
      const originalCreatedAt = phase.handoff.match(/^Created at:\s*(\S+)\s*$/im)?.[1] ?? now;
      const materialized = materializeHandoffMetadata(draft, fields.reason.trim(), originalCreatedAt, now);
      const docs = fields.supportingDocuments.map(({ path, description }) => ({ path: path.trim(), description: description.trim() }));
      let content = materialized;
      if (materialized.length > TARGET_HANDOFF_CONTENT_CHARS) {
        const named = `handoff-p${String(phase.number).padStart(3, "0")}-${randomUUID()}.md`;
        const external = externalizeOversizedHandoffContent(materialized, `.planner/docs/${named}`);
        if (external.externalized && external.supportingDocument) {
          createDocumentInTransaction(driver, { projectId, id: randomUUID(), folder: "", name: named, content: external.extendedContent });
          docs.push(external.supportingDocument);
          content = external.content;
        }
      }
      const verified = docs.map((document) => {
        const item = readSupportingDocument(driver, projectId, document.path);
        if (!item?.content.trim() || !document.description) {
          throw supportingDocumentInvalidError("The supporting document is missing, empty or invalid.", { path: document.path });
        }
        return { ...document, contentHash: handoffContentHash(item.content), contentLength: item.content.length, content: item.content };
      });
      const headings = extractHandoffSectionHeadings(phase.handoff);
      for (const document of phase.handoffAudit?.supportingDocuments.filter(isAutoExternalizedHandoffDocument) ?? []) {
        const prior = readSupportingDocument(driver, projectId, document.path);
        if (prior) headings.push(...extractHandoffSectionHeadings(prior.content));
      }
      const model = readProjectLists(driver, projectId);
      const taskUpdates: HandoffTaskContextUpdate[] = fields.taskUpdates.map(({ taskRef, decisions, filesTouched, ...update }) => {
        const found = findTaskByRef(model.phases, model.features, taskRef);
        if (!found || found.phase.id !== phase.id) throw new HandoffFlowRefusal("TASK_NOT_IN_PHASE", `Task ${taskRef} does not belong to ${phaseRef}.`, { taskRef });
        return { ...update, taskId: found.task.id, ...(decisions ? { decisions } : {}), ...(filesTouched ? { filesTouched } : {}) };
      });
      const contextSync: PhaseHandoffContextSync = {
        taskUpdates,
        ...(fields.phaseUpdate ? { phaseUpdate: {
          progressSummary: fields.phaseUpdate.progressSummary, remainingWork: fields.phaseUpdate.remainingWork,
          ...(fields.phaseUpdate.decisions ? { decisions: fields.phaseUpdate.decisions } : {}),
        } } : {}),
        ...(fields.phaseNoUpdateReason ? { phaseNoUpdateReason: fields.phaseNoUpdateReason } : {}),
        ...(fields.featureUpdate ? { featureUpdate: fields.featureUpdate } : {}),
        ...(fields.featureNoUpdateReason ? { featureNoUpdateReason: fields.featureNoUpdateReason } : {}),
      };
      let next;
      try {
        next = applyHandoffContextSync(phase, feature, {
          reason: fields.reason.trim(), content, expectedHandoffUpdatedAt: fields.expectedHandoffUpdatedAt,
          reconciledExistingHandoff: fields.reconciledExistingHandoff, priorSectionHeadings: [...new Set(headings)],
          ...(fields.sectionDispositions ? { sectionDispositions: fields.sectionDispositions } : {}),
          ...(fields.completenessAudit ? { completenessAudit: fields.completenessAudit } : {}),
          ...(fields.coldStartInventory ? { coldStartInventory: fields.coldStartInventory } : {}),
          ...(content !== materialized ? { submittedContent: materialized } : {}),
          supportingDocuments: docs, verifiedSupportingDocuments: verified.map(({ content: _, ...document }) => document),
          verifiedSupportingDocumentContents: verified.map((document) => document.content), contextSync,
        }, now);
      } catch (error) {
        if (!(error instanceof Error) || error instanceof HandoffContractError) throw error;
        throw new CommandRefusal("HANDOFF_REFRESH_REFUSED", error.message, { failureKind: "validation" });
      }
      if (target.row) {
        archivePhaseHandoffs(driver, projectId, phase.id, "superseded", now);
      }
      const id = randomUUID();
      driver.prepare("INSERT INTO phase_handoffs (id, project_id, phase_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, projectId, phase.id, JSON.stringify({ content: next.phase.handoff, audit: next.phase.handoffAudit }), now, now);
      driver.prepare("UPDATE phases SET updated_at = ?, metadata = json_set(metadata, '$.notes', ?) WHERE project_id = ? AND id = ?")
        .run(now, next.phase.notes, projectId, phase.id);
      driver.prepare("UPDATE features SET updated_at = ?, metadata = json_set(metadata, '$.workDone', ?, '$.workRemaining', ?) WHERE project_id = ? AND id = ?")
        .run(now, next.feature.workDone, next.feature.workRemaining, projectId, feature.id);
      recordRevision();
      const taskIds = new Set(next.updatedTaskIds);
      for (const task of next.phase.tasks.filter(({ id }) => taskIds.has(id))) {
        driver.prepare(`
          UPDATE tasks SET updated_at = ?, metadata = json_set(metadata, '$.description', ?, '$.descriptionUpdatedAt', ?)
          WHERE project_id = ? AND id = ?
        `).run(now, task.description, task.descriptionUpdatedAt, projectId, task.id);
        reconcileLeafMutation(driver, { projectId, taskId: task.id, kind: "task.description", descriptionChanged: true });
      }
      const saved = findHandoffTarget(driver, caller, phase.id)?.phase;
      if (!saved || saved.handoff !== next.phase.handoff || saved.handoffAudit?.contentHash !== handoffContentHash(saved.handoff)
        || saved.handoffAudit.contentLength !== saved.handoff.length) {
        throw new HandoffContractError("HANDOFF_PERSISTENCE_VERIFICATION_FAILED", "The persisted handoff failed its read-back check.");
      }
      driver.prepare("DELETE FROM store_meta WHERE key = ?").run(key);
      publishEvent(driver, projectId, "handoff.written", { phaseId: phase.id, handoffId: id });
      return { phaseId: phase.id, phaseRef, updatedTaskIds: next.updatedTaskIds, handoffUpdatedAt: saved.handoffUpdatedAt, handoffAudit: saved.handoffAudit,
        persisted: true, resumeReady: false, verificationRequired: true };
    } catch (error) {
      if (error instanceof HandoffFlowRefusal) throw new CommandRefusal(error.code, error.message, { ...error.details, failureKind: "refusal" });
      if (error instanceof HandoffContractError) throw new CommandRefusal(error.code, error.message, { ...error.details, failureKind: "contract" });
      throw error;
    }
  }, caller);
  if (failedDraft && outcome.status === "refused") {
    const { key, content, prefix } = failedDraft;
    driver.runExclusive(() => {
      if (!resolveProjectCaller(driver, caller)) return;
      driver.prepare("INSERT INTO store_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, content);
      driver.prepare(`
        DELETE FROM store_meta WHERE key IN (
          SELECT key FROM store_meta WHERE substr(key, 1, ?) = ? AND key <> ? ORDER BY key DESC LIMIT -1 OFFSET 7
        )
      `).run(prefix.length, prefix, key);
    });
  }
  return outcome;
}
