/**
 * Application API v2 for agent clients (P128(F025)/T490).
 *
 * One user-scoped service serves every client of one OS user, and agent
 * harnesses are first-class clients. v1 (api-v1.ts) is a read-only
 * projection for outside programs; v2 is the working surface for agents:
 * the same handoff flows the MCP tools run (plan-core handoff-flow.ts —
 * one orchestration, many surfaces), plus recommendation. Lifecycle
 * start/complete join through the same flows later; this file grows the
 * family, it never forks the logic.
 *
 * Envelope: `{ apiVersion: "2", data }` on success, `{ apiVersion: "2",
 * error }` on failure — mirroring api-v1 conventions. Refusals carry the
 * shared flow refusal code so a client can branch programmatically.
 */

import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  SERVICE_PROTOCOL_VERSION,
  HandoffContractError,
  PlanStoreError,
  recommendNextWork,
  listAcceptedDecisionsForOwner,
  resolveAcceptedDecisionTarget,
  type PlanStore,
} from "@agent-plan/core";
import {
  HandoffFlowRefusal,
  RequirementFlowRefusal,
  clearPhaseHandoffFlow,
  createRequirementFlow,
  deleteRequirementFlow,
  listPhaseHandoffsFlow,
  preparePhaseHandoffFlow,
  showPhaseHandoffFlow,
  updateRequirementFlow,
  verifyPhaseHandoffFlow,
  writePhaseHandoffFlow,
  type MacroTaskStatus,
  type PhaseHandoffWriteRequest,
} from "@agent-plan/core";

/** Mount point, fixed: the version is part of the URL. */
export const API_V2_BASE_PATH = "/api/v2";
/** v2 is current until a superseding generation is designed. */
export const API_V2_VERSION = "2";

/** Routes are relative: mount the result at API_V2_BASE_PATH. */
export function createApiV2App(store: PlanStore, security: { bootId: string; originRef: { current: string | undefined } }): Hono {
  const app = new Hono();

  const envelope = (c: Context, data: unknown, status: ContentfulStatusCode = 200) => c.json({ apiVersion: API_V2_VERSION, data }, status);
  const error = (c: Context, status: ContentfulStatusCode, code: string, message: string, details: Record<string, unknown> = {}) =>
    c.json({ apiVersion: API_V2_VERSION, error: { code, message, ...details } }, status);

  // ── Discovery ─────────────────────────────────────────────────────
  app.get("/", (c) => envelope(c, {
    protocolVersion: SERVICE_PROTOCOL_VERSION,
    bootId: security.bootId,
    serviceOrigin: security.originRef.current ?? null,
    families: {
      handoffs: {
        list: "GET /api/v2/handoffs?page=&pageSize=",
        prepare: "GET /api/v2/phases/{phaseRef}/handoff/prepare",
        show: "GET /api/v2/phases/{phaseRef}/handoff",
        write: "POST /api/v2/phases/{phaseRef}/handoff",
        verify: "POST /api/v2/phases/{phaseRef}/handoff/verify",
        clear: "DELETE /api/v2/phases/{phaseRef}/handoff",
      },
      recommend: "GET /api/v2/recommend",
      requirements: {
        list: "GET /api/v2/requirements",
        create: "POST /api/v2/requirements",
        update: "PUT /api/v2/requirements/{requirementId}",
        delete: "DELETE /api/v2/requirements/{requirementId}",
      },
      acceptedDecisions: {
        list: "GET /api/v2/accepted-decisions?targetType=&targetRef=",
        create: "POST /api/v2/accepted-decisions",
        update: "PUT /api/v2/accepted-decisions/{decisionId}",
        delete: "DELETE /api/v2/accepted-decisions/{decisionId}?targetType=&targetRef=&confirmed=true",
      },
    },
  }));

  // ── Recommendation ────────────────────────────────────────────────
  app.get("/recommend", async (c) => {
    try {
      // Same evidence the MCP recommendation flow consumes; HTTP clients
      // are request-scoped, so no session resume pointer is applied.
      const [features, phases, handoffs, archivedHandoffs] = await Promise.all([
        store.loadFeatures(),
        store.loadAllPhases(),
        store.listHandoffs(),
        store.listArchivedHandoffs(),
      ]);
      const recommendation = recommendNextWork(
        features.features,
        phases,
        await store.listAllWorkDeviations(),
        "",
        "",
        {
          handoffs: handoffs.map((handoff) => ({
            compositeRef: handoff.compositeRef,
            firstLine: handoff.firstLine,
            resumeReady: handoff.resumeReady,
          })),
          archivedHandoffs: archivedHandoffs.map(({ compositeRef, firstLine, reason }) => ({ compositeRef, firstLine, reason })),
        },
      );
      return envelope(c, recommendation);
    } catch (err) {
      return error(c, 500, "RECOMMENDATION_FAILED", err instanceof Error ? err.message : String(err));
    }
  });

  // ── Handoff family ────────────────────────────────────────────────
  const refusalStatus: Record<string, ContentfulStatusCode> = {
    PHASE_REF_REQUIRED: 400,
    PHASE_NOT_FOUND: 404,
    GENERIC_HANDOFF_TITLE: 422,
    TASK_NOT_IN_PHASE: 422,
    HANDOFF_CONFIRMATION_REQUIRED: 409,
    HANDOFF_PREFLIGHT_REQUIRED: 409,
    HANDOFF_REASON_REQUIRED: 422,
  };
  const flowFailure = (c: Context, err: unknown, fallbackCode: string, fallbackStatus: ContentfulStatusCode, extra: Record<string, unknown> = {}) => {
    if (err instanceof HandoffFlowRefusal) {
      return error(c, refusalStatus[err.code] ?? 422, err.code, err.message, err.details);
    }
    if (err instanceof HandoffContractError) {
      return error(c, 409, err.code, err.message, { details: err.details });
    }
    return error(c, fallbackStatus, fallbackCode, err instanceof Error ? err.message : String(err), extra);
  };

  // phaseRef may contain "/" (P002(F001)/T005-style refs are tasks, but a
  // phase ref itself never does; still decode conservatively like v1).
  const phaseRefOf = (c: Context): string => {
    const path = c.req.path;
    const start = path.indexOf(`${API_V2_BASE_PATH}/phases/`);
    const raw = start === -1 ? "" : path.slice(start + `${API_V2_BASE_PATH}/phases/`.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };

  app.get("/handoffs", async (c) => {
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "10");
    const result = await listPhaseHandoffsFlow(store, Number.isFinite(page) ? page : 1, Number.isFinite(pageSize) ? pageSize : 10);
    return envelope(c, result);
  });

  app.get("/phases/*/handoff/prepare", async (c) => {
    const phaseRef = phaseRefOf(c).replace(/\/handoff\/prepare$/, "");
    try {
      const reply = await preparePhaseHandoffFlow(store, phaseRef, undefined);
      return envelope(c, reply.structured, 200);
    } catch (err) {
      return flowFailure(c, err, "HANDOFF_PREPARE_FAILED", 500);
    }
  });

  app.get("/phases/*/handoff", async (c) => {
    const phaseRef = phaseRefOf(c).replace(/\/handoff$/, "");
    try {
      const reply = await showPhaseHandoffFlow(store, phaseRef);
      return envelope(c, reply.structured);
    } catch (err) {
      return flowFailure(c, err, "HANDOFF_SHOW_FAILED", 500);
    }
  });

  app.post("/phases/*/handoff", async (c) => {
    const phaseRef = phaseRefOf(c).replace(/\/handoff$/, "");
    let body: Partial<PhaseHandoffWriteRequest>;
    try {
      body = await c.req.json<Partial<PhaseHandoffWriteRequest>>();
    } catch {
      return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    }
    const request: PhaseHandoffWriteRequest = {
      confirmed: body.confirmed === true,
      title: body.title,
      reason: body.reason,
      content: body.content,
      expectedHandoffUpdatedAt: body.expectedHandoffUpdatedAt,
      reconciledExistingHandoff: body.reconciledExistingHandoff,
      sectionDispositions: body.sectionDispositions,
      completenessAudit: body.completenessAudit,
      coldStartInventory: body.coldStartInventory,
      supportingDocuments: body.supportingDocuments,
      taskUpdates: body.taskUpdates,
      phaseUpdate: body.phaseUpdate,
      phaseNoUpdateReason: body.phaseNoUpdateReason,
      featureUpdate: body.featureUpdate,
      featureNoUpdateReason: body.featureNoUpdateReason,
    };
    try {
      const outcome = await writePhaseHandoffFlow(store, phaseRef, request);
      return envelope(c, {
        phaseRef: outcome.phaseRef,
        phaseId: outcome.phaseId,
        updatedTaskIds: outcome.result.updatedTaskIds,
        handoffUpdatedAt: outcome.result.handoffUpdatedAt,
        handoffAudit: outcome.result.handoffAudit,
        persisted: true,
        resumeReady: false,
        verificationRequired: true,
      }, 202);
    } catch (err) {
      return flowFailure(c, err, "HANDOFF_WRITE_FAILED", 500);
    }
  });

  app.post("/phases/*/handoff/verify", async (c) => {
    const phaseRef = phaseRefOf(c).replace(/\/handoff\/verify$/, "");
    let body: { expectedContentHash?: unknown; sourceReviews?: unknown; omissionsFound?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    }
    if (typeof body.expectedContentHash !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedContentHash)) {
      return error(c, 422, "EXPECTED_CONTENT_HASH_INVALID", "expectedContentHash must be the 64-hex contentHash shown by the show reply.");
    }
    try {
      const outcome = await verifyPhaseHandoffFlow(store, phaseRef, {
        expectedContentHash: body.expectedContentHash,
        ...(Array.isArray(body.sourceReviews) ? { sourceReviews: body.sourceReviews as Array<{ source: string; detail: string }> } : {}),
        ...(Array.isArray(body.omissionsFound) ? { omissionsFound: body.omissionsFound as string[] } : {}),
      });
      return envelope(c, { phaseRef: outcome.phaseRef, ...outcome.result, resumeReady: true, verificationRequired: false });
    } catch (err) {
      return flowFailure(c, err, "HANDOFF_VERIFY_FAILED", 500, { resumeReady: false });
    }
  });

  app.delete("/phases/*/handoff", async (c) => {
    const phaseRef = phaseRefOf(c).replace(/\/handoff$/, "");
    try {
      const cleared = await clearPhaseHandoffFlow(store, phaseRef);
      return envelope(c, { ...cleared, cleared: true });
    } catch (err) {
      return flowFailure(c, err, "HANDOFF_CLEAR_FAILED", 500);
    }
  });

  // ── Requirements family ───────────────────────────────────────────
  // Same flows the MCP requirement tools run (plan-core
  // requirement-flow.ts): one orchestration, many surfaces. Macro-task
  // statuses arrive as untrusted strings and are cast through; the
  // canonical reconciler is the validator and reports through
  // REQUIREMENT_MACRO_TASK_INVALID.
  const requirementFailure = (c: Context, err: unknown, fallbackCode: string) => {
    if (err instanceof RequirementFlowRefusal) {
      const status: ContentfulStatusCode = err.code === "REQUIREMENT_NOT_FOUND" ? 404 : 422;
      return error(c, status, err.code, err.message);
    }
    return error(c, 500, fallbackCode, err instanceof Error ? err.message : String(err));
  };

  app.get("/requirements", async (c) => {
    const document = await store.loadRequirements();
    return envelope(c, { requirements: document.requirements });
  });

  app.post("/requirements", async (c) => {
    let body: {
      title?: unknown;
      description?: unknown;
      linkedPhaseIds?: unknown;
      macroTasks?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    }
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return error(c, 422, "REQUIREMENT_TITLE_REQUIRED", "title is required.");
    }
    if (!Array.isArray(body.linkedPhaseIds) || body.linkedPhaseIds.some((ref) => typeof ref !== "string")) {
      return error(c, 422, "REQUIREMENT_PHASE_LINK_INVALID", "linkedPhaseIds must be an array of phase references.");
    }
    try {
      const requirement = await createRequirementFlow(store, {
        title: body.title,
        ...(typeof body.description === "string" ? { description: body.description } : {}),
        linkedPhaseIds: body.linkedPhaseIds as string[],
        ...(Array.isArray(body.macroTasks) ? {
          macroTasks: (body.macroTasks as Array<Record<string, unknown>>).map((task) => ({
            title: String(task.title ?? ""),
            ...(typeof task.description === "string" ? { description: task.description } : {}),
            ...(task.status !== undefined ? { status: task.status as MacroTaskStatus } : {}),
          })),
        } : {}),
      });
      return envelope(c, { requirement, created: true }, 201);
    } catch (err) {
      return requirementFailure(c, err, "REQUIREMENT_CREATE_FAILED");
    }
  });

  app.put("/requirements/:requirementId", async (c) => {
    const requirementId = c.req.param("requirementId");
    let body: {
      title?: unknown;
      description?: unknown;
      linkedPhaseIds?: unknown;
      macroTasks?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    }
    const hasField = body.title !== undefined || body.description !== undefined
      || body.linkedPhaseIds !== undefined || body.macroTasks !== undefined;
    if (!hasField) {
      return error(c, 422, "NO_MUTABLE_FIELDS", "Provide at least one of title, description, linkedPhaseIds, macroTasks.");
    }
    if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length === 0)) {
      return error(c, 422, "REQUIREMENT_TITLE_REQUIRED", "title must be a non-empty string.");
    }
    if (body.linkedPhaseIds !== undefined && (!Array.isArray(body.linkedPhaseIds) || body.linkedPhaseIds.some((ref) => typeof ref !== "string"))) {
      return error(c, 422, "REQUIREMENT_PHASE_LINK_INVALID", "linkedPhaseIds must be an array of phase references.");
    }
    try {
      const outcome = await updateRequirementFlow(store, requirementId, {
        ...(body.title !== undefined ? { title: body.title as string } : {}),
        ...(body.description !== undefined ? { description: body.description as string } : {}),
        ...(body.linkedPhaseIds !== undefined ? { linkedPhaseIds: body.linkedPhaseIds as string[] } : {}),
        ...(body.macroTasks !== undefined ? {
          macroTasks: (body.macroTasks as Array<Record<string, unknown>>).map((task) => ({
            ...(task.id !== undefined ? { id: String(task.id) } : {}),
            title: String(task.title ?? ""),
            ...(typeof task.description === "string" ? { description: task.description } : {}),
            status: task.status as MacroTaskStatus,
          })),
        } : {}),
      });
      return envelope(c, { requirement: outcome.requirement, updatedFields: outcome.updatedFields, updated: true });
    } catch (err) {
      return requirementFailure(c, err, "REQUIREMENT_UPDATE_FAILED");
    }
  });

  app.delete("/requirements/:requirementId", async (c) => {
    const requirementId = c.req.param("requirementId");
    try {
      const { deleted } = await deleteRequirementFlow(store, requirementId);
      if (!deleted) {
        return error(c, 404, "REQUIREMENT_NOT_FOUND", `Requirement not found: ${requirementId}`);
      }
      return envelope(c, { deleted: true, requirementId });
    } catch (err) {
      return requirementFailure(c, err, "REQUIREMENT_DELETE_FAILED");
    }
  });

  // ── Accepted-decisions family ─────────────────────────────────────
  // The ownership rule (exactly one owner) is enforced in plan-core
  // accepted-decision-guard.ts; target resolution and the semantic store
  // mutations are the same primitives the MCP tools run. HTTP adds only
  // the envelope and the status mapping.
  const targetOfType = (raw: unknown): "project" | "feature" | "phase" | "task" | null =>
    raw === "project" || raw === "feature" || raw === "phase" || raw === "task" ? raw : null;
  const acceptedDecisionStatus: Record<string, ContentfulStatusCode> = {
    ACCEPTED_DECISION_TARGET_NOT_FOUND: 404,
    ACCEPTED_DECISION_NOT_FOUND: 404,
    ACCEPTED_DECISION_TITLE_REQUIRED: 422,
    ACCEPTED_DECISION_SEMANTIC_MUTATION_REQUIRED: 422,
    ACCEPTED_DECISION_RAW_REPLACEMENT_DISABLED: 422,
    NO_MUTABLE_FIELDS_RECEIVED: 422,
  };
  const acceptedDecisionFailure = (c: Context, err: unknown, fallbackCode: string) => {
    if (err instanceof PlanStoreError) {
      const code = String(err.details?.errorCode ?? "");
      if (code) return error(c, acceptedDecisionStatus[code] ?? 422, code, err.message, { details: err.details });
    }
    return error(c, 500, fallbackCode, err instanceof Error ? err.message : String(err));
  };
  const resolveTarget = async (c: Context, targetType: "project" | "feature" | "phase" | "task", targetRef: string | undefined) => {
    const resolution = await resolveAcceptedDecisionTarget(store, targetType, targetRef);
    if (!resolution.ok) {
      return { failure: error(c, 404, "ACCEPTED_DECISION_TARGET_NOT_FOUND", resolution.error) } as const;
    }
    return { resolution } as const;
  };

  app.get("/accepted-decisions", async (c) => {
    const targetType = targetOfType(c.req.query("targetType"));
    if (!targetType) {
      return error(c, 422, "ACCEPTED_DECISION_TARGET_TYPE_INVALID", "targetType must be project, feature, phase, or task.");
    }
    const targetRef = c.req.query("targetRef");
    const listed = await listAcceptedDecisionsForOwner(store, targetType, targetRef);
    if (!listed.ok) {
      return error(c, 404, "ACCEPTED_DECISION_TARGET_NOT_FOUND", listed.error);
    }
    return envelope(c, { targetType, targetRef: listed.ref, owner: listed.owner, decisions: listed.decisions });
  });

  app.post("/accepted-decisions", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    }
    const targetType = targetOfType(body.targetType);
    if (!targetType) {
      return error(c, 422, "ACCEPTED_DECISION_TARGET_TYPE_INVALID", "targetType must be project, feature, phase, or task.");
    }
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return error(c, 422, "ACCEPTED_DECISION_TITLE_REQUIRED", "title is required.");
    }
    const targetRef = typeof body.targetRef === "string" ? body.targetRef : undefined;
    const target = await resolveTarget(c, targetType, targetRef);
    if ("failure" in target) return target.failure;
    try {
      const acceptedDecision = await store.createAcceptedDecision(target.resolution.owner, {
        title: body.title as string,
        ...(typeof body.decision === "string" ? { decision: body.decision } : {}),
        ...(typeof body.rationale === "string" ? { rationale: body.rationale } : {}),
        ...(typeof body.implementationNotes === "string" ? { implementationNotes: body.implementationNotes } : {}),
      });
      return envelope(c, { created: true, targetType, targetRef: target.resolution.ref, acceptedDecision }, 201);
    } catch (err) {
      return acceptedDecisionFailure(c, err, "ACCEPTED_DECISION_CREATE_FAILED");
    }
  });

  app.put("/accepted-decisions/:decisionId", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    }
    const targetType = targetOfType(body.targetType);
    if (!targetType) {
      return error(c, 422, "ACCEPTED_DECISION_TARGET_TYPE_INVALID", "targetType must be project, feature, phase, or task.");
    }
    const targetRef = typeof body.targetRef === "string" ? body.targetRef : undefined;
    const decisionId = c.req.param("decisionId");
    const target = await resolveTarget(c, targetType, targetRef);
    if ("failure" in target) return target.failure;
    try {
      const acceptedDecision = await store.updateAcceptedDecision(target.resolution.owner, decisionId, {
        ...(body.title !== undefined ? { title: body.title as string } : {}),
        ...(body.decision !== undefined ? { decision: body.decision as string } : {}),
        ...(body.rationale !== undefined ? { rationale: body.rationale as string } : {}),
        ...(body.implementationNotes !== undefined ? { implementationNotes: body.implementationNotes as string } : {}),
      });
      return envelope(c, { updated: true, targetType, targetRef: target.resolution.ref, acceptedDecision });
    } catch (err) {
      return acceptedDecisionFailure(c, err, "ACCEPTED_DECISION_UPDATE_FAILED");
    }
  });

  app.delete("/accepted-decisions/:decisionId", async (c) => {
    const targetType = targetOfType(c.req.query("targetType"));
    if (!targetType) {
      return error(c, 422, "ACCEPTED_DECISION_TARGET_TYPE_INVALID", "targetType must be project, feature, phase, or task.");
    }
    const targetRef = c.req.query("targetRef");
    const decisionId = c.req.param("decisionId");
    const target = await resolveTarget(c, targetType, targetRef);
    if ("failure" in target) return target.failure;
    if (c.req.query("confirmed") !== "true") {
      return error(c, 409, "ACCEPTED_DECISION_DELETE_NOT_CONFIRMED", `Delete not confirmed for accepted decision ${decisionId}. Retry with confirmed=true.`);
    }
    try {
      const acceptedDecision = await store.deleteAcceptedDecision(target.resolution.owner, decisionId);
      return envelope(c, { deleted: true, targetType, targetRef: target.resolution.ref, decisionId, acceptedDecision });
    } catch (err) {
      return acceptedDecisionFailure(c, err, "ACCEPTED_DECISION_DELETE_FAILED");
    }
  });

  return app;
}
