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
  resolveFeatureRefStrict,
  type PlanStore,
} from "@agent-plan/core";
import {
  buildTaskMoveReply,
  findPhaseByRef,
  findTaskByRef,
  HandoffFlowRefusal,
  RequirementFlowRefusal,
  TaskFlowRefusal,
  FeatureFlowRefusal,
  PhaseFlowRefusal,
  DiscussFlowRefusal,
  addTaskChecklistItemFlow,
  clearPhaseHandoffFlow,
  createFeatureFlow,
  createPhaseFlow,
  createRequirementFlow,
  createTaskFlow,
  deleteFeatureCascade,
  deletePhaseFlow,
  deleteRequirementFlow,
  discussFeatureFlow,
  discussPhaseFlow,
  discussProjectFlow,
  updateProjectGuidelinesFlow,
  updateProjectLanguageFlow,
  type ProjectRefusalCode,
  discussTaskFlow,
  listFeatureSummaries,
  listPhaseHandoffsFlow,
  listPhaseSummaries,
  listTaskSummaries,
  showFeature,
  showPhase,
  showTask,
  PlannerDocRefusal,
  readPlannerDocument,
  savePlannerDocument,
  listPlannerDocuments,
  searchPlan,
  SessionFlowRefusal,
  PLANNER_SESSION_HEADER,
  endPlannerSession,
  heartbeatPlannerSession,
  registerPlannerSession,
  resolvePlannerSession,
  readFeatureContextFlow,
  readPhaseContextFlow,
  readTaskContextFlow,
  readPhaseRequirementsFlow,
  readProjectContextFlow,
  readProjectGuidelinesFlow,
  startTaskFlow,
  completeTaskFlow,
  pauseTaskFlow,
  reopenTaskFlow,
  switchTaskFlow,
  deleteTaskFlow,
  listIdeasFlow,
  showIdeaFlow,
  createIdeaFlow,
  updateIdeaFlow,
  deleteIdeaFlow,
  beginIdeaPromotionFlow,
  finalizeIdeaPromotionFlow,
  type IdeaRefusalCode,
  recordDeviationFlow,
  recoverSessionFlow,
  type DeviationRefusalCode,
  type RecoveryRefusalCode,
  type TaskSwitchRefusalCode,
  type TaskPauseRefusalCode,
  type TaskReopenRefusalCode,
  type TaskCompleteRefusalCode,
  type TaskStartFlowRefusalCode,
  preparePhaseHandoffFlow,
  removeTaskChecklistItemFlow,
  showPhaseHandoffFlow,
  toggleTaskChecklistItemFlow,
  updateFeatureFlow,
  updatePhaseFlow,
  updateRequirementFlow,
  updateTaskFlow,
  addTaskDependencyFlow,
  removeTaskDependencyFlow,
  moveTasks,
  verifyPhaseHandoffFlow,
  writePhaseHandoffFlow,
  type MacroTaskStatus,
  type PhaseHandoffWriteRequest,
  type ShowFlowRefusalCode,
  type Phase,
  type Task,
  PLANNER_API_V2_BASE_PATH,
  PLANNER_API_V2_VERSION,
} from "@agent-plan/core";

/** Mount point, fixed: the version is part of the URL. */
export const API_V2_BASE_PATH = PLANNER_API_V2_BASE_PATH;
/** v2 is current until a superseding generation is designed. */
export const API_V2_VERSION = PLANNER_API_V2_VERSION;

/** Routes are relative: mount the result at API_V2_BASE_PATH. */
export function createApiV2App(store: PlanStore, security: { bootId: string; originRef: { current: string | undefined } }): Hono {
  const app = new Hono();

  const envelope = (c: Context, data: unknown, status: ContentfulStatusCode = 200) => c.json({ apiVersion: API_V2_VERSION, data }, status);
  const error = (c: Context, status: ContentfulStatusCode, code: string, message: string, details: Record<string, unknown> = {}) =>
    c.json({ apiVersion: API_V2_VERSION, error: { code, message, ...details } }, status);

  const sessionFailure = (c: Context, err: unknown, fallbackCode: string) => {
    if (err instanceof SessionFlowRefusal) {
      const status: ContentfulStatusCode = err.code === "SESSION_NOT_FOUND"
        ? 404
        : err.code === "SESSION_ENDED" ? 409 : 422;
      return error(c, status, err.code, err.message, err.details);
    }
    return error(c, 500, fallbackCode, err instanceof Error ? err.message : String(err));
  };

  /** Session identity for operations that read or write per-agent state. */
  const requireSession = async (c: Context): Promise<{ sessionId: string } | { response: ReturnType<typeof error> }> => {
    const sessionId = (c.req.header(PLANNER_SESSION_HEADER) ?? "").trim();
    if (!sessionId) {
      return { response: error(c, 400, "SESSION_REQUIRED", `A registered planner session is required in the ${PLANNER_SESSION_HEADER} header.`) };
    }
    try {
      const session = await resolvePlannerSession(store, sessionId);
      return { sessionId: session.sessionId };
    } catch (err) {
      return { response: sessionFailure(c, err, "SESSION_RESOLVE_FAILED") };
    }
  };

  // ── Discovery ─────────────────────────────────────────────────────
  app.get("/", (c) => envelope(c, {
    protocolVersion: SERVICE_PROTOCOL_VERSION,
    bootId: security.bootId,
    serviceOrigin: security.originRef.current ?? null,
    sessionHeader: PLANNER_SESSION_HEADER,
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
      search: "GET /api/v2/search?q=&limit=",
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
      features: {
        list: "GET /api/v2/features?featureRef=",
        show: "GET /api/v2/features/{featureRef}",
        create: "POST /api/v2/features",
        update: "PUT /api/v2/features/{featureRef}",
        discuss: "PUT /api/v2/features/{featureRef}/discuss",
        delete: "DELETE /api/v2/features/{featureRef}?cascade=true",
      },
      phases: {
        list: "GET /api/v2/phases?featureRef=&status=",
        show: "GET /api/v2/phases/{phaseRef}",
        create: "POST /api/v2/phases",
        update: "PUT /api/v2/phases/{phaseRef}",
        discuss: "PUT /api/v2/phases/{phaseRef}/discuss",
        delete: "DELETE /api/v2/phases/{phaseRef}",
      },
      tasks: {
        list: "GET /api/v2/tasks?featureRef=&phaseRef=&status=",
        show: "GET /api/v2/tasks/{taskRef}",
        create: "POST /api/v2/phases/{phaseRef}/tasks",
        update: "PUT /api/v2/tasks/{taskRef}",
        discuss: "PUT /api/v2/tasks/{taskRef}/discuss",
        move: "POST /api/v2/tasks/move",
        dependencyAdd: "POST /api/v2/tasks/{taskRef}/dependencies",
        dependencyRemove: "DELETE /api/v2/tasks/{taskRef}/dependencies?dependsOn=&confirmed=true",
        checklistAdd: "POST /api/v2/tasks/{taskRef}/checklist",
        checklistToggle: "POST /api/v2/tasks/{taskRef}/checklist/toggle",
        checklistRemove: "DELETE /api/v2/tasks/{taskRef}/checklist?item=",
        start: "POST /api/v2/tasks/{taskRef}/start",
        complete: "POST /api/v2/tasks/{taskRef}/complete",
        pause: "POST /api/v2/tasks/{taskRef}/pause",
        reopen: "POST /api/v2/tasks/{taskRef}/reopen",
        switch: "POST /api/v2/tasks/switch",
        delete: "DELETE /api/v2/tasks/{taskRef}",
      },
      ideas: {
        list: "GET /api/v2/ideas",
        show: "GET /api/v2/ideas/{ideaRef}",
        create: "POST /api/v2/ideas",
        update: "PUT /api/v2/ideas/{ideaRef}",
        delete: "DELETE /api/v2/ideas/{ideaRef}?confirmed=true",
        promotionBegin: "POST /api/v2/ideas/{ideaRef}/promotion/begin",
        promotionFinalize: "POST /api/v2/ideas/{ideaRef}/promotion/finalize",
      },
      deviations: {
        approve: "POST /api/v2/deviations",
      },
      project: {
        discuss: "PUT /api/v2/project/discuss",
        guidelines: "PUT /api/v2/project/guidelines",
        language: "PUT /api/v2/project/language",
      },
      documents: {
        list: "GET /api/v2/documents",
        view: "GET /api/v2/documents/view?path=",
        save: "PUT /api/v2/documents/save",
      },
      context: {
        project: "GET /api/v2/context/project?maxChars=",
        guidelines: "GET /api/v2/context/guidelines",
        requirements: "GET /api/v2/context/requirements?phaseRef=",
        feature: "GET /api/v2/context/features/{featureRef}",
        phase: "GET /api/v2/context/phases/{phaseRef}",
        task: "GET /api/v2/context/tasks/{taskRef}",
      },
      sessions: {
        register: "POST /api/v2/sessions",
        heartbeat: "POST /api/v2/sessions/{sessionId}/heartbeat",
        end: "DELETE /api/v2/sessions/{sessionId}",
        recover: "POST /api/v2/sessions/recover",
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
      return error(c, 409, "ACCEPTED_DECISION_DELETE_NOT_CONFIRMED", `Delete not confirmed for accepted decision ${decisionId}. Retry with confirmed=true.`, {
        targetType,
        targetRef: target.resolution.ref,
        decisionId,
        confirmRequired: true,
      });
    }
    try {
      const acceptedDecision = await store.deleteAcceptedDecision(target.resolution.owner, decisionId);
      return envelope(c, { deleted: true, targetType, targetRef: target.resolution.ref, decisionId, acceptedDecision });
    } catch (err) {
      return acceptedDecisionFailure(c, err, "ACCEPTED_DECISION_DELETE_FAILED");
    }
  });

  // ── Tasks family ──────────────────────────────────────────────────
  // Task creation and checklist mutations run the plan-core task-flow
  // orchestration the MCP tools run — same resolution, same ownership
  // validation, same atomic batch. Task refs contain "/" (F001/P001/T001),
  // so routes use mid-path wildcards and the same conservative decode as
  // the handoff family.
  const taskRefusalStatus: Record<string, ContentfulStatusCode> = {
    TASK_NOT_FOUND: 404,
    TASK_FEATURE_NOT_FOUND: 404,
    TASK_PHASE_NOT_FOUND: 404,
    TASK_FEATURE_REQUIRED: 422,
    TASK_PHASE_MISMATCH: 422,
    TASK_TITLE_REQUIRED: 422,
    TASK_DESCRIPTION_TOO_SHORT: 422,
    CHECKLIST_EMPTY: 422,
    CHECKLIST_ITEM_NOT_FOUND: 422,
  };
  const taskFailure = (c: Context, err: unknown, fallbackCode: string) => {
    if (err instanceof TaskFlowRefusal) {
      return error(c, taskRefusalStatus[err.code] ?? 422, err.code, err.message);
    }
    return error(c, 500, fallbackCode, err instanceof Error ? err.message : String(err));
  };
  const taskRefOf = (c: Context, suffix: string): string => {
    const path = c.req.path;
    const start = path.indexOf(`${API_V2_BASE_PATH}/tasks/`);
    const raw = start === -1 ? "" : path.slice(start + `${API_V2_BASE_PATH}/tasks/`.length);
    const stripped = raw.endsWith(suffix) ? raw.slice(0, -suffix.length) : raw;
    try {
      return decodeURIComponent(stripped);
    } catch {
      return stripped;
    }
  };

  app.post("/phases/*/tasks", async (c) => {
    const phaseRef = phaseRefOf(c).replace(/\/tasks$/, "");
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    }
    try {
      const outcome = await createTaskFlow(store, {
        featureRef: typeof body.feature === "string" ? body.feature : "",
        phaseRef,
        title: typeof body.title === "string" ? body.title : "",
        description: typeof body.description === "string" ? body.description : "",
        ...(Array.isArray(body.checklist) ? { checklist: body.checklist.filter((item): item is string => typeof item === "string") } : {}),
      });
      return envelope(c, {
        created: true,
        task: outcome.task,
        taskRef: outcome.compositeRef,
      }, 201);
    } catch (err) {
      return taskFailure(c, err, "TASK_CREATE_FAILED");
    }
  });

  app.post("/tasks/*/checklist", async (c) => {
    const taskRef = taskRefOf(c, "/checklist");
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    }
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return error(c, 422, "TASK_TITLE_REQUIRED", "Checklist item text is required.");
    }
    try {
      const outcome = await addTaskChecklistItemFlow(store, taskRef, body.title);
      return envelope(c, { added: true, item: outcome.item, checklistSize: outcome.checklistSize }, 201);
    } catch (err) {
      return taskFailure(c, err, "CHECKLIST_ADD_FAILED");
    }
  });

  app.post("/tasks/*/checklist/toggle", async (c) => {
    const taskRef = taskRefOf(c, "/checklist/toggle");
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    }
    if (typeof body.item !== "string" || body.item.trim().length === 0) {
      return error(c, 422, "CHECKLIST_ITEM_REQUIRED", "item is required: C{n}, item id, or title.");
    }
    try {
      const outcome = await toggleTaskChecklistItemFlow(store, taskRef, body.item, typeof body.checked === "boolean" ? body.checked : undefined);
      return envelope(c, { toggled: true, item: outcome.item, message: outcome.message });
    } catch (err) {
      return taskFailure(c, err, "CHECKLIST_TOGGLE_FAILED");
    }
  });

  app.delete("/tasks/*/checklist", async (c) => {
    const taskRef = taskRefOf(c, "/checklist");
    const item = c.req.query("item");
    if (!item) {
      return error(c, 422, "CHECKLIST_ITEM_REQUIRED", "item is required: C{n}, item id, or title.");
    }
    try {
      const outcome = await removeTaskChecklistItemFlow(store, taskRef, item);
      return envelope(c, { removed: true, item: outcome.item, checklistSize: outcome.checklistSize });
    } catch (err) {
      return taskFailure(c, err, "CHECKLIST_REMOVE_FAILED");
    }
  });

  // ── Features & phases create family ───────────────────────────────
  // Same plan-core flows the MCP add tools run (feature-flow.ts /
  // phase-flow.ts): identity and lifecycle dates are planner-assigned,
  // the phase write runs under the feature lock inside one batch.
  const readJsonBody = async (c: Context): Promise<Record<string, unknown> | null> => {
    try {
      return (await c.req.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const optionalString = (body: Record<string, unknown>, key: string): string | undefined =>
    typeof body[key] === "string" ? body[key] : undefined;
  const optionalNumber = (body: Record<string, unknown>, key: string): number | undefined =>
    typeof body[key] === "number" && Number.isFinite(body[key]) ? body[key] : undefined;
  const optionalStringArray = (body: Record<string, unknown>, key: string): string[] | undefined =>
    Array.isArray(body[key]) ? body[key].filter((value): value is string => typeof value === "string") : undefined;
  /** Decoded path tail after a fixed prefix; titles may contain "/". */
  const tailAfter = (c: Context, prefix: string): string => {
    const path = c.req.path;
    const start = path.indexOf(prefix);
    const raw = start === -1 ? "" : path.slice(start + prefix.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  /** Canonical ref from the tail of a collection route. */
  const collectionTail = (c: Context, collection: "features" | "phases" | "tasks" | "sessions"): string =>
    tailAfter(c, `${API_V2_BASE_PATH}/${collection}/`);

  const featureRefusalStatus: Partial<Record<FeatureFlowRefusal["code"], ContentfulStatusCode>> = {
    FEATURE_NOT_FOUND: 404,
    FEATURE_STATUS_READ_ONLY: 409,
  };
  const phaseRefusalStatus: Partial<Record<PhaseFlowRefusal["code"], ContentfulStatusCode>> = {
    PHASE_NOT_FOUND: 404,
    PHASE_FEATURE_NOT_FOUND: 404,
    PHASE_STATUS_READ_ONLY: 409,
    PHASE_LEGACY_DECISIONS_READ_ONLY: 409,
  };
  const featureFailure = (c: Context, err: unknown, fallbackCode: string) => {
    if (err instanceof FeatureFlowRefusal) {
      return error(c, featureRefusalStatus[err.code] ?? 422, err.code, err.message, err.details);
    }
    return error(c, 500, fallbackCode, err instanceof Error ? err.message : String(err));
  };
  const phaseFailure = (c: Context, err: unknown, fallbackCode: string) => {
    if (err instanceof PhaseFlowRefusal) {
      return error(c, phaseRefusalStatus[err.code] ?? 422, err.code, err.message, err.details);
    }
    return error(c, 500, fallbackCode, err instanceof Error ? err.message : String(err));
  };

  app.post("/features", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    try {
      const outcome = await createFeatureFlow(store, {
        name: typeof body.name === "string" ? body.name : "",
        description: typeof body.description === "string" ? body.description : "",
        ...(body.status !== undefined ? { status: String(body.status) } : {}),
      });
      return envelope(c, { created: true, feature: outcome.feature, ref: outcome.ref, message: outcome.message }, 201);
    } catch (err) {
      return featureFailure(c, err, "FEATURE_CREATE_FAILED");
    }
  });

  app.post("/phases", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    try {
      const outcome = await createPhaseFlow(store, {
        title: typeof body.title === "string" ? body.title : "",
        featureRef: typeof body.feature === "string" ? body.feature : "",
        ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
        description: typeof body.description === "string" ? body.description : "",
      });
      return envelope(c, { created: true, phase: outcome.phase, ref: outcome.ref, message: outcome.message }, 201);
    } catch (err) {
      return phaseFailure(c, err, "PHASE_CREATE_FAILED");
    }
  });

  // ── Discovery lists ───────────────────────────────────────────────
  // Same selection/ref logic the MCP list tools run (plan-core
  // list-flow.ts). v2 answers 404 for a filter that names nothing: an
  // empty page would silently claim the filter matched zero entities.
  app.get("/features", async (c) => {
    const featureRef = c.req.query("featureRef");
    const outcome = await listFeatureSummaries(store, { featureRef });
    if (outcome.filterResolved === false) {
      return error(c, 404, "FEATURE_NOT_FOUND", `Feature not found: ${featureRef}`);
    }
    return envelope(c, { features: outcome.items, total: outcome.items.length });
  });

  app.get("/phases", async (c) => {
    const outcome = await listPhaseSummaries(store, {
      featureRef: c.req.query("featureRef"),
      status: c.req.query("status"),
    });
    if (!outcome.ok) return error(c, 404, outcome.code, outcome.message);
    return envelope(c, { phases: outcome.items, total: outcome.items.length });
  });

  app.get("/tasks", async (c) => {
    const outcome = await listTaskSummaries(store, {
      featureRef: c.req.query("featureRef"),
      phaseRef: c.req.query("phaseRef"),
      status: c.req.query("status"),
    });
    if (!outcome.ok) return error(c, 404, outcome.code, outcome.message);
    return envelope(c, { tasks: outcome.items, total: outcome.items.length });
  });

  // ── Detail reads ──────────────────────────────────────────────────
  // Same selection and identity the MCP show tools run (plan-core
  // show-flow.ts). An ambiguous feature name is a conflict, not a 404:
  // the ref exists conceptually but does not identify one feature.
  const showRefusalStatus: Record<ShowFlowRefusalCode, ContentfulStatusCode> = {
    FEATURE_NOT_FOUND: 404,
    FEATURE_REF_AMBIGUOUS: 409,
    PHASE_NOT_FOUND: 404,
    TASK_NOT_FOUND: 404,
  };
  const showFailure = (c: Context, outcome: { code: ShowFlowRefusalCode; message: string }) =>
    error(c, showRefusalStatus[outcome.code], outcome.code, outcome.message);

  // Registered after the list routes and after the handoff reads; the
  // question of who wins for ".../handoff" is settled by registration
  // order in Hono, and those routes come first.
  app.get("/features/*", async (c) => {
    const outcome = await showFeature(store, collectionTail(c, "features"));
    if (!outcome.ok) return showFailure(c, outcome);
    return envelope(c, {
      ref: outcome.ref,
      feature: outcome.feature,
      phaseCount: outcome.phaseCount,
      taskCount: outcome.taskCount,
    });
  });

  app.get("/phases/*", async (c) => {
    const outcome = await showPhase(store, collectionTail(c, "phases"));
    if (!outcome.ok) return showFailure(c, outcome);
    return envelope(c, {
      ref: outcome.ref,
      phase: outcome.phase,
      featureNumber: outcome.featureNumber ?? null,
      taskCount: outcome.taskCount,
      linkedRequirements: outcome.linkedRequirements,
    });
  });

  app.get("/tasks/*", async (c) => {
    // No session identity on v2 yet (session registration lands with the
    // context family), so the resume read is unscoped on purpose.
    const outcome = await showTask(store, collectionTail(c, "tasks"));
    if (!outcome.ok) return showFailure(c, outcome);
    return envelope(c, {
      ref: outcome.ref,
      phaseRef: outcome.phaseRef,
      featureRef: outcome.featureRef || null,
      task: outcome.task,
      phase: {
        id: outcome.phase.id,
        ref: outcome.phaseRef,
        title: outcome.phase.title,
        status: outcome.phase.status,
      },
      feature: outcome.feature
        ? { id: outcome.feature.id, ref: outcome.featureRef, name: outcome.feature.name, status: outcome.feature.status }
        : null,
      orderContext: outcome.orderContext,
      snapshot: outcome.snapshot,
      pendingDeviation: outcome.pendingDeviation ?? null,
      linkedRequirements: outcome.linkedRequirements,
    });
  });

  // ── Session family ────────────────────────────────────────────────
  // The service issues the session id; clients send it back in
  // X-Planner-Session. Registration records adapter provenance only —
  // principal authentication and grants are their own checklist item.
  app.post("/sessions", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    try {
      const outcome = await registerPlannerSession(store, {
        clientKind: optionalString(body, "clientKind") ?? "",
        clientVersion: optionalString(body, "clientVersion"),
        agentId: optionalString(body, "agentId"),
        displayName: optionalString(body, "displayName"),
        harnessId: optionalString(body, "harnessId"),
        capabilities: optionalStringArray(body, "capabilities"),
      });
      return envelope(c, { session: outcome.session });
    } catch (err) {
      return sessionFailure(c, err, "SESSION_REGISTER_FAILED");
    }
  });

  // Recovery is a session operation identified by the task the stopped
  // caller owned (or was returning to), not by a client-held id.
  const recoveryRefusalStatus: Record<RecoveryRefusalCode, ContentfulStatusCode> = {
    TASK_NOT_FOUND: 404,
    SESSION_RECOVERY_CONFIRMATION_REQUIRED: 409,
    SESSION_RECOVERY_AMBIGUOUS: 409,
    SESSION_OWNER_UNVERIFIED: 409,
    SESSION_OWNER_ACTIVE: 409,
    SESSION_RECOVERY_CONFLICT: 409,
    SESSION_RECOVERY_VERIFICATION_FAILED: 500,
    SESSION_RECOVERY_FAILED: 500,
  };

  app.post("/sessions/recover", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const task = (optionalString(body, "task") ?? "").trim();
    if (!task) return error(c, 422, "TASK_REF_REQUIRED", "A task ref is required: the task the stopped caller owned or was returning to.");
    const outcome = await recoverSessionFlow(store, auth.sessionId, task, body.confirmed === true);
    if (!outcome.ok) {
      return error(c, recoveryRefusalStatus[outcome.code], outcome.code, outcome.message, {
        ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
      });
    }
    return envelope(c, {
      recovered: true,
      taskRef: outcome.taskRef,
      phaseRef: outcome.phaseRef,
      featureRef: outcome.featureRef || null,
      taskIds: outcome.taskIds,
      deviationIds: outcome.deviationIds,
    });
  });

  app.post("/sessions/*/heartbeat", async (c) => {
    const sessionId = collectionTail(c, "sessions").replace(/\/heartbeat$/, "");
    try {
      const outcome = await heartbeatPlannerSession(store, sessionId);
      return envelope(c, { heartbeat: true, session: outcome.session });
    } catch (err) {
      return sessionFailure(c, err, "SESSION_HEARTBEAT_FAILED");
    }
  });

  app.delete("/sessions/*", async (c) => {
    const sessionId = collectionTail(c, "sessions");
    try {
      const outcome = await endPlannerSession(store, sessionId, c.req.query("reason") ?? undefined);
      return envelope(c, { ended: true, session: outcome.session });
    } catch (err) {
      return sessionFailure(c, err, "SESSION_END_FAILED");
    }
  });

  // ── Context family ────────────────────────────────────────────────
  // Registered sessions only: a receipt names the session that received
  // the content, so an unregistered caller cannot produce one. The
  // delivered payload is what the receipt attests to.
  app.get("/context/project", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const rawMaxChars = c.req.query("maxChars");
    const maxChars = rawMaxChars === undefined ? undefined : Number.parseInt(rawMaxChars, 10);
    if (maxChars !== undefined && (!Number.isFinite(maxChars) || maxChars <= 0)) {
      return error(c, 422, "CONTEXT_MAX_CHARS_INVALID", "maxChars must be a positive integer.");
    }
    const outcome = await readProjectContextFlow(store, auth.sessionId, maxChars);
    return envelope(c, {
      contextComplete: outcome.contextComplete,
      attested: outcome.attested,
      fingerprint: outcome.delivery.evidence.fingerprint,
      totalChunks: outcome.delivery.evidence.totalChunks,
      serializedChars: outcome.delivery.evidence.serializedChars,
      chunks: outcome.delivery.chunks,
    });
  });

  app.get("/context/guidelines", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const outcome = await readProjectGuidelinesFlow(store, auth.sessionId);
    return envelope(c, outcome);
  });

  app.get("/context/requirements", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const phaseRef = c.req.query("phaseRef");
    if (!phaseRef) return error(c, 422, "PHASE_REF_REQUIRED", "A phaseRef query parameter is required.");
    const outcome = await readPhaseRequirementsFlow(store, auth.sessionId, phaseRef);
    if (!outcome.ok) return showFailure(c, outcome);
    return envelope(c, {
      phaseRef: outcome.phaseRef,
      phaseId: outcome.phaseId,
      featureId: outcome.featureId ?? null,
      requirements: outcome.requirements,
      attestedRequirementIds: outcome.attestedRequirementIds,
    });
  });

  app.get("/context/features/*", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const outcome = await readFeatureContextFlow(store, auth.sessionId, tailAfter(c, `${API_V2_BASE_PATH}/context/features/`));
    if (!outcome.ok) return showFailure(c, outcome);
    return envelope(c, outcome);
  });

  app.get("/context/phases/*", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const outcome = await readPhaseContextFlow(store, auth.sessionId, tailAfter(c, `${API_V2_BASE_PATH}/context/phases/`));
    if (!outcome.ok) return showFailure(c, outcome);
    return envelope(c, outcome);
  });

  app.get("/context/tasks/*", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const outcome = await readTaskContextFlow(store, auth.sessionId, tailAfter(c, `${API_V2_BASE_PATH}/context/tasks/`));
    if (!outcome.ok) return showFailure(c, outcome);
    return envelope(c, outcome);
  });

  // ── Lifecycle family ──────────────────────────────────────────────
  // Task start runs the same orchestration as planner-task-start
  // (plan-core task-lifecycle-flow.ts): readiness, context receipts,
  // ownership, deviation bookkeeping and persistence verification. The
  // session header names the caller that owns the started task.
  const taskStartRefusalStatus: Partial<Record<TaskStartFlowRefusalCode, ContentfulStatusCode>> = {
    TASK_NOT_FOUND: 404,
    PERSISTENCE_VERIFICATION_FAILED: 500,
  };

  app.post("/tasks/*/start", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const taskRef = tailAfter(c, `${API_V2_BASE_PATH}/tasks/`).replace(/\/start$/, "");
    const outcome = await startTaskFlow(store, auth.sessionId, taskRef);
    if (!outcome.ok) {
      return error(
        c,
        taskStartRefusalStatus[outcome.code] ?? 409,
        outcome.code,
        outcome.message,
        {
          ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
          ...(outcome.requirementIds ? { requirementIds: outcome.requirementIds } : {}),
          context: outcome.context,
          ...(outcome.evidence ? { evidence: outcome.evidence } : {}),
        },
      );
    }
    return envelope(c, {
      started: true,
      alreadyStarted: outcome.alreadyStarted,
      taskRef: outcome.taskRef,
      phaseRef: outcome.phaseRef,
      featureRef: outcome.featureRef || null,
      task: outcome.task,
      phaseContext: outcome.phaseContext,
      advisory: outcome.advisory,
      ...(outcome.recommendedTaskRef ? { recommendedTaskRef: outcome.recommendedTaskRef } : {}),
      ...(outcome.resumeRequired ? { resumeRequired: outcome.resumeRequired } : {}),
      projectContextStale: outcome.projectContextStale,
      higherPriorityOpenPhase: outcome.higherPriorityOpenPhase,
    });
  });

  // Completion runs the same orchestration as planner-task-complete:
  // evidence and checklist gate, status-log entry, description append,
  // derived-status rollup and deviation transition.
  const taskCompleteRefusalStatus: Record<TaskCompleteRefusalCode, ContentfulStatusCode> = {
    TASK_NOT_FOUND: 404,
    COMPLETION_EVIDENCE_REQUIRED: 422,
    TASK_CHECKPOINT_PENDING: 409,
    CHECKLIST_INCOMPLETE: 409,
    FORCE_MOTIVATION_REQUIRED: 409,
  };

  app.post("/tasks/*/complete", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const outcome = await completeTaskFlow(store, auth.sessionId, {
      task: tailAfter(c, `${API_V2_BASE_PATH}/tasks/`).replace(/\/complete$/, ""),
      force: body.force === true,
      motivation: optionalString(body, "motivation"),
      descriptionUpdate: optionalString(body, "descriptionUpdate") ?? "",
    });
    if (!outcome.ok) {
      return error(c, taskCompleteRefusalStatus[outcome.code], outcome.code, outcome.message, {
        ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
        ...(outcome.taskRef ? { taskRef: outcome.taskRef } : {}),
        ...(outcome.uncheckedItems ? { uncheckedItems: outcome.uncheckedItems.map((item) => item.title) } : {}),
      });
    }
    return envelope(c, {
      completed: true,
      taskRef: outcome.taskRef,
      phaseRef: outcome.phaseRef,
      featureRef: outcome.featureRef || null,
      task: outcome.task,
      clearedHandoffRef: outcome.clearedHandoffRef,
      resumeRequired: outcome.resumeRequired ?? null,
    });
  });

  // Pause and reopen join the same lifecycle family. Pause captures a
  // mandatory durable checkpoint; reopen is a confirmed correction that
  // retains prior completion evidence.
  const taskPauseRefusalStatus: Record<TaskPauseRefusalCode, ContentfulStatusCode> = {
    TASK_NOT_FOUND: 404,
    TASK_NOT_IN_PROGRESS: 409,
  };
  const taskReopenRefusalStatus: Record<TaskReopenRefusalCode, ContentfulStatusCode> = {
    TASK_NOT_FOUND: 404,
    TASK_REOPEN_CONFIRMATION_REQUIRED: 409,
    TASK_REOPEN_NOT_DONE: 409,
    TASK_REOPEN_FAILED: 409,
  };

  app.post("/tasks/*/pause", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const reason = optionalString(body, "reason")?.trim() ?? "";
    const whatWasBeingDone = (optionalString(body, "whatWasBeingDone") ?? optionalString(body, "what_was_being_done") ?? "").trim();
    const resumeLocation = (optionalString(body, "resumeLocation") ?? optionalString(body, "resume_location") ?? "").trim();
    const howToResume = (optionalString(body, "howToResume") ?? optionalString(body, "how_to_resume") ?? "").trim();
    const missing = [
      ...(reason ? [] : ["reason"]),
      ...(whatWasBeingDone ? [] : ["whatWasBeingDone"]),
      ...(resumeLocation ? [] : ["resumeLocation"]),
      ...(howToResume ? [] : ["howToResume"]),
    ];
    if (missing.length > 0) {
      return error(c, 422, "PAUSE_CHECKPOINT_REQUIRED", `A durable checkpoint requires ${missing.join(", ")}.`, { missing });
    }
    const outcome = await pauseTaskFlow(store, auth.sessionId, {
      task: tailAfter(c, `${API_V2_BASE_PATH}/tasks/`).replace(/\/pause$/, ""),
      reason,
      whatWasBeingDone,
      resumeLocation,
      howToResume,
      pausedBy: optionalString(body, "pausedBy"),
    });
    if (!outcome.ok) {
      return error(c, taskPauseRefusalStatus[outcome.code], outcome.code, outcome.message, {
        ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
        ...(outcome.taskRef ? { taskRef: outcome.taskRef } : {}),
      });
    }
    return envelope(c, {
      paused: true,
      taskRef: outcome.taskRef,
      phaseRef: outcome.phaseRef,
      featureRef: outcome.featureRef || null,
      task: outcome.task,
      snapshot: outcome.snapshot,
      resumeRequired: outcome.resumeRequired ?? null,
    });
  });

  app.post("/tasks/*/reopen", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const outcome = await reopenTaskFlow(
      store,
      auth.sessionId,
      tailAfter(c, `${API_V2_BASE_PATH}/tasks/`).replace(/\/reopen$/, ""),
      body.confirmed === true,
    );
    if (!outcome.ok) {
      return error(c, taskReopenRefusalStatus[outcome.code], outcome.code, outcome.message, {
        ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
        ...(outcome.taskRef ? { taskRef: outcome.taskRef } : {}),
      });
    }
    return envelope(c, { reopened: true, taskRef: outcome.taskRef, task: outcome.task });
  });

  // Switching is a lifecycle write, not a task mutation: it pauses the
  // source with a mandatory checkpoint, claims the target and pushes the
  // durable LIFO return target (plan-core switchTaskFlow). The target must
  // satisfy the same read receipts as a start.
  const taskSwitchRefusalStatus: Record<TaskSwitchRefusalCode, ContentfulStatusCode> = {
    TASK_NOT_FOUND: 404,
    SWITCH_SAME_TASK: 409,
    TASK_OWNED_BY_ANOTHER_SESSION: 409,
    SOURCE_NOT_SWITCHABLE: 409,
    SOURCE_OWNED_BY_ANOTHER_SESSION: 409,
    PROJECT_GUIDELINES_READ_REQUIRED: 409,
    CONTEXT_READ_REQUIRED: 409,
    REQUIREMENTS_READ_REQUIRED: 409,
    START_NOT_ALLOWED: 409,
  };

  app.post("/tasks/switch", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const fromTask = (optionalString(body, "fromTask") ?? optionalString(body, "from_task") ?? "").trim();
    const toTask = (optionalString(body, "toTask") ?? optionalString(body, "to_task") ?? "").trim();
    const reason = (optionalString(body, "reason") ?? "").trim();
    const whatWasBeingDone = (optionalString(body, "whatWasBeingDone") ?? optionalString(body, "what_was_being_done") ?? "").trim();
    const resumeLocation = (optionalString(body, "resumeLocation") ?? optionalString(body, "resume_location") ?? "").trim();
    const howToResume = (optionalString(body, "howToResume") ?? optionalString(body, "how_to_resume") ?? "").trim();
    const missing = [
      ...(fromTask ? [] : ["fromTask"]),
      ...(toTask ? [] : ["toTask"]),
      ...(reason ? [] : ["reason"]),
      ...(whatWasBeingDone ? [] : ["whatWasBeingDone"]),
      ...(resumeLocation ? [] : ["resumeLocation"]),
      ...(howToResume ? [] : ["howToResume"]),
    ];
    if (missing.length > 0) {
      return error(c, 422, "SWITCH_CHECKPOINT_REQUIRED", `A task switch requires ${missing.join(", ")}.`, { missing });
    }
    const outcome = await switchTaskFlow(store, auth.sessionId, {
      fromTask,
      toTask,
      reason,
      whatWasBeingDone,
      resumeLocation,
      howToResume,
      switchedBy: optionalString(body, "switchedBy"),
    });
    if (!outcome.ok) {
      return error(c, taskSwitchRefusalStatus[outcome.code], outcome.code, outcome.message, {
        ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
        ...(outcome.requirementIds ? { requirementIds: outcome.requirementIds } : {}),
        context: outcome.context,
        ...(outcome.evidence ? { evidence: outcome.evidence } : {}),
      });
    }
    return envelope(c, {
      switched: true,
      sourceRef: outcome.sourceRef,
      targetRef: outcome.targetRef,
      sourcePhaseRef: outcome.sourcePhaseRef,
      targetPhaseRef: outcome.targetPhaseRef,
      deviation: outcome.deviation,
      snapshot: outcome.snapshot,
    });
  });

  // An approved deviation is bookkeeping, not a lifecycle transition: it
  // preserves the recommended/resume task and never starts or pauses work.
  const deviationRefusalStatus: Record<DeviationRefusalCode, ContentfulStatusCode> = {
    TASK_NOT_FOUND: 404,
    NO_RESUME_TASK: 422,
    DEVIATION_SAME_TASK: 422,
    TEMPORARY_TASK_NOT_STARTABLE: 409,
  };

  app.post("/deviations", async (c) => {
    const auth = await requireSession(c);
    if ("response" in auth) return auth.response;
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const temporaryTask = (optionalString(body, "temporaryTask") ?? optionalString(body, "temporary_task") ?? "").trim();
    const reason = (optionalString(body, "reason") ?? "").trim();
    const missing = [
      ...(temporaryTask ? [] : ["temporaryTask"]),
      ...(reason ? [] : ["reason"]),
    ];
    if (missing.length > 0) {
      return error(c, 422, "DEVIATION_INPUT_REQUIRED", `An approved deviation requires ${missing.join(", ")}.`, { missing });
    }
    const outcome = await recordDeviationFlow(store, auth.sessionId, {
      temporaryTask,
      resumeTask: optionalString(body, "resumeTask") ?? optionalString(body, "resume_task"),
      reason,
    });
    if (!outcome.ok) {
      return error(c, deviationRefusalStatus[outcome.code], outcome.code, outcome.message, {
        ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
        ...(outcome.selectionReason ? { selectionReason: outcome.selectionReason } : {}),
        ...(outcome.temporaryStatus ? { temporaryStatus: outcome.temporaryStatus } : {}),
      });
    }
    return envelope(c, {
      approved: true,
      deviation: outcome.deviation,
      temporaryRef: outcome.temporaryRef,
      resumeRef: outcome.resumeRef,
    });
  });

  // ── Search family ─────────────────────────────────────────────────
  // One query over the operating truth (plan-core search-flow.ts); the
  // hits already carry canonical refs. A query too short to be selective
  // is a validation error, not an empty page.
  app.get("/search", async (c) => {
    const limit = c.req.query("limit");
    const parsedLimit = limit === undefined ? undefined : Number.parseInt(limit, 10);
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) {
      return error(c, 422, "SEARCH_LIMIT_INVALID", "limit must be an integer.");
    }
    const outcome = await searchPlan(store, c.req.query("q") ?? "", parsedLimit);
    if (!outcome.ok) return error(c, 422, outcome.code, outcome.message);
    return envelope(c, {
      query: outcome.query,
      hits: outcome.hits,
      total: outcome.total,
      truncated: outcome.truncated,
      skippedDocuments: outcome.skippedDocuments,
    });
  });

  // ── Documents family ──────────────────────────────────────────────
  // Same rules as the Web UI's viewer/editor (plan-core planner-doc.ts):
  // <planRoot>/docs/*.md only, traversal and symlinks refused, saves
  // require explicit confirmation. This surface maps the shared refusal
  // codes to v2 statuses; the UI keeps its own legacy responses.
  const documentFailure = (c: Context, err: unknown, fallbackCode: string) => {
    if (err instanceof PlannerDocRefusal) {
      const status: ContentfulStatusCode = err.code === "DOCUMENT_PATH_INVALID"
        ? 400
        : err.code === "DOCUMENT_NOT_FOUND" || err.code === "DOCUMENT_NOT_REGULAR_FILE"
          ? 404
          : err.code === "DOCUMENT_CONFIRMATION_REQUIRED" ? 409 : 422;
      return error(c, status, err.code, err.message, {
        path: err.documentPath,
        ...(err.code === "DOCUMENT_CONFIRMATION_REQUIRED" ? { confirmRequired: true } : {}),
      });
    }
    return error(c, 500, fallbackCode, err instanceof Error ? err.message : String(err));
  };

  app.get("/documents", async (c) => {
    try {
      const documents = await listPlannerDocuments(store.root);
      return envelope(c, { documents, total: documents.length });
    } catch (err) {
      return error(c, 500, "DOCUMENT_LIST_FAILED", err instanceof Error ? err.message : String(err));
    }
  });

  app.get("/documents/view", async (c) => {
    try {
      return envelope(c, await readPlannerDocument(store.root, c.req.query("path") ?? ""));
    } catch (err) {
      return documentFailure(c, err, "DOCUMENT_READ_FAILED");
    }
  });

  app.put("/documents/save", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    try {
      const outcome = await savePlannerDocument(store.root, {
        path: optionalString(body, "path") ?? "",
        content: optionalString(body, "content") ?? "",
        confirmed: body.confirmed === true,
      });
      return envelope(c, { path: outcome.path, saved: outcome.saved });
    } catch (err) {
      return documentFailure(c, err, "DOCUMENT_SAVE_FAILED");
    }
  });

  // ── Discuss family ────────────────────────────────────────────────
  // Registered BEFORE the generic PUT /features/* and PUT /phases/*
  // routes: the router matches in registration order, so the specific
  // ".../discuss" paths must win over the collection wildcard.
  const discussRefusalStatus: Partial<Record<DiscussFlowRefusal["code"], ContentfulStatusCode>> = {
    FEATURE_NOT_FOUND: 404,
    PHASE_NOT_FOUND: 404,
    TASK_NOT_FOUND: 404,
    PROJECT_LEGACY_DECISIONS_READ_ONLY: 409,
  };
  const discussFailure = (c: Context, err: unknown, fallbackCode: string) => {
    if (err instanceof DiscussFlowRefusal) {
      return error(c, discussRefusalStatus[err.code] ?? 422, err.code, err.message, err.details);
    }
    return error(c, 500, fallbackCode, err instanceof Error ? err.message : String(err));
  };

  app.put("/project/discuss", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const description = optionalString(body, "description");
    const descriptionRef = optionalString(body, "descriptionRef");
    const goal = optionalString(body, "goal");
    const scope = optionalStringArray(body, "scope");
    const outOfScope = optionalStringArray(body, "outOfScope");
    const technologies = optionalStringArray(body, "technologies");
    const tools = optionalStringArray(body, "tools");
    const globalRules = optionalStringArray(body, "globalRules");
    const decisions = optionalStringArray(body, "decisions");
    try {
      const outcome = await discussProjectFlow(store, {
        ...(description !== undefined ? { description } : {}),
        ...(descriptionRef !== undefined ? { descriptionRef } : {}),
        ...(goal !== undefined ? { goal } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(outOfScope !== undefined ? { outOfScope } : {}),
        ...(technologies !== undefined ? { technologies } : {}),
        ...(tools !== undefined ? { tools } : {}),
        ...(globalRules !== undefined ? { globalRules } : {}),
        ...(decisions !== undefined ? { decisions } : {}),
      });
      return envelope(c, { discussed: true, project: outcome.project, updatedFields: outcome.updatedFields });
    } catch (err) {
      return discussFailure(c, err, "PROJECT_DISCUSS_FAILED");
    }
  });

  // ── Project settings family ───────────────────────────────────────
  // Operator-owned single-record settings on project.json. The guidelines
  // write accepts an optional optimistic guard: a stale expected timestamp
  // is a 409 PLAN_STALE_WRITE, never a silent overwrite.
  const projectRefusalStatus: Record<ProjectRefusalCode, ContentfulStatusCode> = {
    PLAN_STALE_WRITE: 409,
    PROJECT_UPDATE_FAILED: 500,
  };
  const projectFailure = (
    c: Context,
    outcome: { code: ProjectRefusalCode; message: string; details?: Record<string, unknown> },
  ) => error(c, projectRefusalStatus[outcome.code], outcome.code, outcome.message, outcome.details ?? {});

  app.put("/project/guidelines", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const content = optionalString(body, "content");
    if (content === undefined) {
      return error(c, 422, "PROJECT_GUIDELINES_CONTENT_REQUIRED", "content is required; pass an empty string to clear the section.");
    }
    const expected = optionalString(body, "expectedUpdatedAt")
      ?? optionalString(body, "expectedGuidelinesUpdatedAt");
    const outcome = await updateProjectGuidelinesFlow(store, {
      content,
      ...(expected !== undefined ? { expectedGuidelinesUpdatedAt: expected } : {}),
    });
    if (!outcome.ok) return projectFailure(c, outcome);
    return envelope(c, {
      updated: true,
      cleared: outcome.cleared,
      projectGuidelines: outcome.projectGuidelines,
    });
  });

  app.put("/project/language", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const contentLanguage = optionalString(body, "contentLanguage");
    const chatLanguage = optionalString(body, "chatLanguage");
    const outcome = await updateProjectLanguageFlow(store, {
      ...(contentLanguage !== undefined ? { contentLanguage } : {}),
      ...(chatLanguage !== undefined ? { chatLanguage } : {}),
    });
    if (!outcome.ok) return projectFailure(c, outcome);
    return envelope(c, {
      saved: true,
      contentLanguage: outcome.contentLanguage,
      chatLanguage: outcome.chatLanguage,
    });
  });

  app.put("/features/*/discuss", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const featureRef = collectionTail(c, "features").replace(/\/discuss$/, "");
    const description = optionalString(body, "description");
    const descriptionRef = optionalString(body, "descriptionRef");
    const workDone = optionalString(body, "workDone");
    const workRemaining = optionalString(body, "workRemaining");
    const dependencies = optionalStringArray(body, "dependencies");
    // Attribution is the calling surface's fact, so a client may state it;
    // omitting it records the API's own wording.
    const contextReadyReason = optionalString(body, "contextReadyReason");
    try {
      const outcome = await discussFeatureFlow(store, featureRef, {
        ...(description !== undefined ? { description } : {}),
        ...(descriptionRef !== undefined ? { descriptionRef } : {}),
        ...(workDone !== undefined ? { workDone } : {}),
        ...(workRemaining !== undefined ? { workRemaining } : {}),
        ...(dependencies !== undefined ? { dependencies } : {}),
        contextReadyReason: contextReadyReason ?? "Updated through the Agent Plan API v2 discuss operation.",
      });
      return envelope(c, { discussed: true, ref: outcome.ref, feature: outcome.feature, updatedFields: outcome.updatedFields });
    } catch (err) {
      return discussFailure(c, err, "FEATURE_DISCUSS_FAILED");
    }
  });

  app.put("/phases/*/discuss", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const phaseRef = collectionTail(c, "phases").replace(/\/discuss$/, "");
    const goal = optionalString(body, "goal");
    const goals = optionalStringArray(body, "goals");
    const summary = optionalString(body, "summary");
    const scope = optionalString(body, "scope");
    const descriptionRef = optionalString(body, "descriptionRef");
    const nonGoals = optionalStringArray(body, "nonGoals");
    const dependencies = optionalStringArray(body, "dependencies");
    const risks = optionalStringArray(body, "risks");
    const openQuestions = optionalStringArray(body, "openQuestions");
    const completionCriteria = optionalStringArray(body, "completionCriteria");
    const contextReadyReason = optionalString(body, "contextReadyReason");
    try {
      const outcome = await discussPhaseFlow(store, phaseRef, {
        ...(goal !== undefined ? { goal } : {}),
        ...(goals !== undefined ? { goals } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(descriptionRef !== undefined ? { descriptionRef } : {}),
        ...(nonGoals !== undefined ? { nonGoals } : {}),
        ...(dependencies !== undefined ? { dependencies } : {}),
        ...(risks !== undefined ? { risks } : {}),
        ...(openQuestions !== undefined ? { openQuestions } : {}),
        ...(completionCriteria !== undefined ? { completionCriteria } : {}),
        contextReadyReason: contextReadyReason ?? "Updated through the Agent Plan API v2 discuss operation.",
      });
      return envelope(c, { discussed: true, ref: outcome.ref, phase: outcome.phase, updatedFields: outcome.updatedFields });
    } catch (err) {
      return discussFailure(c, err, "PHASE_DISCUSS_FAILED");
    }
  });

  app.put("/tasks/*/discuss", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const taskRef = collectionTail(c, "tasks").replace(/\/discuss$/, "");
    const description = optionalString(body, "description");
    const descriptionRef = optionalString(body, "descriptionRef");
    const checklist = optionalStringArray(body, "checklist");
    try {
      const outcome = await discussTaskFlow(store, taskRef, {
        ...(description !== undefined ? { description } : {}),
        ...(descriptionRef !== undefined ? { descriptionRef } : {}),
        ...(checklist !== undefined ? { checklist } : {}),
      });
      return envelope(c, {
        discussed: true,
        ref: outcome.ref,
        task: outcome.task,
        updatedFields: outcome.updatedFields,
        checklistLostTicks: outcome.checklistLostTicks,
      });
    } catch (err) {
      return discussFailure(c, err, "TASK_DISCUSS_FAILED");
    }
  });

  // ── Features & phases update/delete family ────────────────────────
  // Derived status is read-only for both entities; the flows own that rule
  // and carry the facts (attempted/effective status, mutable field list)
  // so this surface only maps codes to statuses.
  app.put("/features/*", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const name = optionalString(body, "name");
    const description = optionalString(body, "description");
    const descriptionRef = optionalString(body, "descriptionRef");
    const workDone = optionalString(body, "workDone");
    const workRemaining = optionalString(body, "workRemaining");
    const startDate = optionalString(body, "startDate");
    const endDate = optionalString(body, "endDate");
    const priority = optionalNumber(body, "priority");
    const status = optionalString(body, "status");
    try {
      const outcome = await updateFeatureFlow(store, collectionTail(c, "features"), {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(descriptionRef !== undefined ? { descriptionRef } : {}),
        ...(workDone !== undefined ? { workDone } : {}),
        ...(workRemaining !== undefined ? { workRemaining } : {}),
        ...(startDate !== undefined ? { startDate } : {}),
        ...(endDate !== undefined ? { endDate } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(status !== undefined ? { status } : {}),
      });
      return envelope(c, { updated: true, ref: outcome.ref, feature: outcome.feature, updatedFields: outcome.updatedFields });
    } catch (err) {
      return featureFailure(c, err, "FEATURE_UPDATE_FAILED");
    }
  });

  app.delete("/features/*", async (c) => {
    const cascade = c.req.query("cascade") === "true";
    try {
      const features = (await store.loadFeatures()).features;
      const resolved = resolveFeatureRefStrict(features, collectionTail(c, "features"));
      if (!resolved.ok) return error(c, 404, "FEATURE_NOT_FOUND", resolved.error);
      const outcome = await deleteFeatureCascade(store, resolved.feature.id, { cascade });
      if (!outcome.ok) return error(c, 409, outcome.errorCode, outcome.error);
      return envelope(c, { deleted: true, ...outcome.result });
    } catch (err) {
      return error(c, 500, "FEATURE_DELETE_FAILED", err instanceof Error ? err.message : String(err));
    }
  });

  app.put("/phases/*", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const title = optionalString(body, "title");
    const summary = optionalString(body, "summary");
    const description = optionalString(body, "description");
    const descriptionRef = optionalString(body, "descriptionRef");
    const featureId = optionalString(body, "featureId");
    const priority = optionalNumber(body, "priority");
    const goals = optionalStringArray(body, "goals");
    const nonGoals = optionalStringArray(body, "nonGoals");
    const dependencies = optionalStringArray(body, "dependencies");
    const risks = optionalStringArray(body, "risks");
    const openQuestions = optionalStringArray(body, "openQuestions");
    const completionCriteria = optionalStringArray(body, "completionCriteria");
    const status = optionalString(body, "status");
    const decisions = optionalStringArray(body, "decisions");
    try {
      const outcome = await updatePhaseFlow(store, collectionTail(c, "phases"), {
        ...(title !== undefined ? { title } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(descriptionRef !== undefined ? { descriptionRef } : {}),
        ...(featureId !== undefined ? { featureId } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(goals !== undefined ? { goals } : {}),
        ...(nonGoals !== undefined ? { nonGoals } : {}),
        ...(dependencies !== undefined ? { dependencies } : {}),
        ...(risks !== undefined ? { risks } : {}),
        ...(openQuestions !== undefined ? { openQuestions } : {}),
        ...(completionCriteria !== undefined ? { completionCriteria } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(decisions !== undefined ? { decisions } : {}),
      });
      return envelope(c, {
        updated: true,
        ref: outcome.ref,
        phase: outcome.phase,
        updatedFields: outcome.updatedFields,
        descriptionFreshness: outcome.descriptionFreshness,
        staleParentRefs: outcome.staleParentRefs,
      });
    } catch (err) {
      return phaseFailure(c, err, "PHASE_UPDATE_FAILED");
    }
  });

  app.delete("/phases/*", async (c) => {
    try {
      const outcome = await deletePhaseFlow(store, collectionTail(c, "phases"));
      return envelope(c, { deleted: true, ...outcome });
    } catch (err) {
      return phaseFailure(c, err, "PHASE_DELETE_FAILED");
    }
  });

  // ── Task update / dependency / move family ────────────────────────
  // Task refs contain "/", so these live behind mid-path wildcards like
  // the checklist routes. The discuss route above is registered first and
  // therefore keeps winning for ".../discuss".
  const taskMutationRefusalStatus: Partial<Record<TaskFlowRefusal["code"], ContentfulStatusCode>> = {
    TASK_NOT_FOUND: 404,
    DEPENDENCY_TASK_NOT_FOUND: 404,
    TASK_LIFECYCLE_TRANSITION_REQUIRED: 409,
    TASK_LEGACY_DECISIONS_READ_ONLY: 409,
    CONFIRMATION_REQUIRED: 409,
  };
  const taskMutationFailure = (c: Context, err: unknown, fallbackCode: string) => {
    if (err instanceof TaskFlowRefusal) {
      return error(c, taskMutationRefusalStatus[err.code] ?? 422, err.code, err.message, err.details);
    }
    if (err instanceof PlanStoreError) {
      const code = typeof err.details?.errorCode === "string" ? err.details.errorCode : fallbackCode;
      return error(c, 422, code, err.message);
    }
    return error(c, 500, fallbackCode, err instanceof Error ? err.message : String(err));
  };

  app.put("/tasks/*", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const taskRef = collectionTail(c, "tasks");
    const title = optionalString(body, "title");
    const status = optionalString(body, "status");
    const description = optionalString(body, "description");
    const descriptionRef = optionalString(body, "descriptionRef");
    const notes = optionalString(body, "notes");
    const motivation = optionalString(body, "motivation");
    const priority = optionalNumber(body, "priority");
    const checklist = optionalStringArray(body, "checklist");
    const decisions = optionalStringArray(body, "decisions");
    const subtasks = Array.isArray(body.subtasks)
      ? body.subtasks.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      : undefined;
    try {
      const outcome = await updateTaskFlow(store, taskRef, {
        ...(title !== undefined ? { title } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(descriptionRef !== undefined ? { descriptionRef } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(motivation !== undefined ? { motivation } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(checklist !== undefined ? { checklist } : {}),
        ...(decisions !== undefined ? { decisions } : {}),
        ...(subtasks !== undefined
          ? {
            subtasks: subtasks.map((item) => ({
              ...(typeof item.id === "string" ? { id: item.id } : {}),
              title: typeof item.title === "string" ? item.title : "",
              ...(typeof item.description === "string" ? { description: item.description } : {}),
              ...(typeof item.status === "string" ? { status: item.status } : {}),
            })),
          }
          : {}),
      });
      return envelope(c, {
        updated: true,
        ref: outcome.ref,
        task: outcome.task,
        updatedFields: outcome.updatedFields,
        checklistLostTicks: outcome.checklistLostTicks,
        descriptionFreshness: outcome.descriptionFreshness,
        staleParentRefs: outcome.staleParentRefs,
        ...(outcome.resumeRequired ? { resumeRequired: outcome.resumeRequired } : {}),
      });
    } catch (err) {
      return taskMutationFailure(c, err, "TASK_UPDATE_FAILED");
    }
  });

  app.post("/tasks/*/dependencies", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const dependsOn = optionalString(body, "dependsOn");
    if (!dependsOn) return error(c, 422, "DEPENDENCY_TARGET_REQUIRED", "A dependsOn task ref is required.");
    const taskRef = collectionTail(c, "tasks").replace(/\/dependencies$/, "");
    try {
      const outcome = await addTaskDependencyFlow(store, taskRef, dependsOn);
      return envelope(c, { updated: true, ref: outcome.ref, dependsOn: outcome.dependsOn, dependencyRef: outcome.dependencyRef });
    } catch (err) {
      return taskMutationFailure(c, err, "DEPENDENCY_UPDATE_FAILED");
    }
  });

  app.delete("/tasks/*/dependencies", async (c) => {
    const dependsOn = c.req.query("dependsOn");
    if (!dependsOn) return error(c, 422, "DEPENDENCY_TARGET_REQUIRED", "A dependsOn task ref is required.");
    const taskRef = collectionTail(c, "tasks").replace(/\/dependencies$/, "");
    const confirmed = c.req.query("confirmed") === "true";
    try {
      const outcome = await removeTaskDependencyFlow(store, taskRef, dependsOn, confirmed);
      return envelope(c, { updated: true, ref: outcome.ref, dependsOn: outcome.dependsOn, dependencyRef: outcome.dependencyRef });
    } catch (err) {
      return taskMutationFailure(c, err, "DEPENDENCY_DELETE_FAILED");
    }
  });

  // Deleting a task is destructive, so the route requires an explicit
  // intent flag; the flow keeps phase.taskIds consistent and refreshes the
  // derived phase status.
  app.delete("/tasks/*", async (c) => {
    const taskRef = tailAfter(c, `${API_V2_BASE_PATH}/tasks/`);
    if (c.req.query("confirmed") !== "true") {
      return error(c, 409, "TASK_DELETE_CONFIRMATION_REQUIRED", "Task deletion requires confirmed=true.");
    }
    try {
      const outcome = await deleteTaskFlow(store, taskRef);
      return envelope(c, {
        deleted: true,
        taskId: outcome.taskId,
        ref: outcome.ref,
        shortId: outcome.shortId,
        phaseRef: outcome.phaseRef,
      });
    } catch (err) {
      return taskFailure(c, err, "TASK_DELETE_FAILED");
    }
  });

  app.post("/tasks/move", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const refs = optionalStringArray(body, "tasks");
    const targetPhase = optionalString(body, "targetPhase");
    if (!refs || refs.length === 0) return error(c, 422, "NO_TASKS_GIVEN", "A non-empty tasks array is required.");
    if (!targetPhase) return error(c, 422, "TARGET_PHASE_REQUIRED", "A targetPhase ref is required.");
    const phases = await store.loadAllPhases();
    const features = (await store.loadFeatures()).features;
    const target = findPhaseByRef(phases, features, targetPhase);
    if (!target) return error(c, 404, "TARGET_PHASE_NOT_FOUND", `Target phase not found: ${targetPhase}`);
    const resolved: Array<{ phase: Phase; task: Task }> = [];
    for (const ref of refs) {
      const found = findTaskByRef(phases, features, ref);
      if (!found) return error(c, 404, "TASK_NOT_FOUND", `Task not found: ${ref}`);
      resolved.push(found);
    }
    const outcome = await moveTasks(store, resolved.map((entry) => entry.task.id), target.id);
    if (!outcome.ok) {
      const status: ContentfulStatusCode = outcome.errorCode === "TASK_NOT_FOUND" || outcome.errorCode === "TARGET_PHASE_NOT_FOUND" ? 404 : 409;
      return error(c, status, outcome.errorCode, outcome.error);
    }
    const reply = buildTaskMoveReply(outcome.result, `planner-task-show ${outcome.result.targetPhaseRef} full=true`);
    return envelope(c, reply.structured);
  });

  // ── Ideas family ──────────────────────────────────────────────────
  // Ideas never affect feature/phase/task rollups. Promotion is the
  // two-step protocol: a discussion that persists nothing, then a
  // confirmed finalize that records an already-created target.
  const ideaRefusalStatus: Record<IdeaRefusalCode, ContentfulStatusCode> = {
    IDEA_NOT_FOUND: 404,
    IDEA_TITLE_REQUIRED: 422,
    IDEA_NO_MUTABLE_FIELDS: 422,
    IDEA_DELETE_CONFIRMATION_REQUIRED: 409,
    IDEA_ALREADY_PROMOTED: 409,
    IDEA_PROMOTION_CONFIRMATION_REQUIRED: 409,
    IDEA_PROMOTION_TARGET_NOT_FOUND: 404,
  };

  const ideaRefOf = (c: Context, suffix = ""): string => {
    const tail = tailAfter(c, `${API_V2_BASE_PATH}/ideas/`);
    return suffix && tail.endsWith(suffix) ? tail.slice(0, -suffix.length) : tail;
  };

  const ideaFailure = (c: Context, outcome: {
    code: IdeaRefusalCode;
    message: string;
    ideaRef?: string;
    mutableFields?: string[];
    targetRef?: string;
    targetType?: string;
  }) =>
    error(c, ideaRefusalStatus[outcome.code], outcome.code, outcome.message, {
      ...(outcome.ideaRef ? { ideaRef: outcome.ideaRef } : {}),
      ...(outcome.mutableFields ? { mutableFields: outcome.mutableFields } : {}),
      ...(outcome.targetRef ? { targetRef: outcome.targetRef } : {}),
      ...(outcome.targetType ? { targetType: outcome.targetType } : {}),
    });

  app.get("/ideas", async (c) => {
    const outcome = await listIdeasFlow(store);
    return envelope(c, { ideas: outcome.ideas, total: outcome.ideas.length });
  });

  app.get("/ideas/*", async (c) => {
    const outcome = await showIdeaFlow(store, ideaRefOf(c));
    if (!outcome.ok) return ideaFailure(c, outcome);
    return envelope(c, { idea: outcome.idea });
  });

  app.post("/ideas", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const outcome = await createIdeaFlow(store, {
      title: optionalString(body, "title") ?? "",
      description: optionalString(body, "description"),
    });
    if (!outcome.ok) return ideaFailure(c, outcome);
    return envelope(c, { created: true, idea: outcome.idea }, 201);
  });

  app.put("/ideas/*", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const outcome = await updateIdeaFlow(store, ideaRefOf(c), {
      title: optionalString(body, "title"),
      description: optionalString(body, "description"),
    });
    if (!outcome.ok) return ideaFailure(c, outcome);
    return envelope(c, { updated: true, idea: outcome.idea, updatedFields: outcome.updatedFields });
  });

  app.delete("/ideas/*", async (c) => {
    const outcome = await deleteIdeaFlow(store, ideaRefOf(c), c.req.query("confirmed") === "true");
    if (!outcome.ok) return ideaFailure(c, outcome);
    return envelope(c, { deleted: true, ideaRef: outcome.ideaRef, ideaId: outcome.ideaId });
  });

  app.post("/ideas/*/promotion/begin", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const targetType = optionalString(body, "targetType");
    if (targetType !== "feature" && targetType !== "phase" && targetType !== "task") {
      return error(c, 422, "IDEA_TARGET_TYPE_INVALID", "targetType must be feature, phase or task.");
    }
    const outcome = await beginIdeaPromotionFlow(store, ideaRefOf(c, "/promotion/begin"), targetType);
    if (!outcome.ok) return ideaFailure(c, outcome);
    return envelope(c, {
      persisted: false,
      idea: outcome.idea,
      targetType: outcome.targetType,
      recommendation: outcome.recommendation,
      grillMeSkill: outcome.grillMeSkill,
      nextActions: outcome.nextActions,
    });
  });

  app.post("/ideas/*/promotion/finalize", async (c) => {
    const body = await readJsonBody(c);
    if (!body) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const targetType = optionalString(body, "targetType");
    if (targetType !== "feature" && targetType !== "phase" && targetType !== "task") {
      return error(c, 422, "IDEA_TARGET_TYPE_INVALID", "targetType must be feature, phase or task.");
    }
    const targetRef = (optionalString(body, "targetRef") ?? "").trim();
    if (!targetRef) return error(c, 422, "IDEA_TARGET_REF_REQUIRED", "A confirmed targetRef is required.");
    const outcome = await finalizeIdeaPromotionFlow(store, {
      idea: ideaRefOf(c, "/promotion/finalize"),
      targetType,
      targetRef,
      discussionCompleted: body.discussionCompleted === true,
      confirmed: body.confirmed === true,
    });
    if (!outcome.ok) return ideaFailure(c, outcome);
    return envelope(c, { promoted: true, idea: outcome.idea, targetRef: outcome.targetRef });
  });

  return app;
}
