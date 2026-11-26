import { isAbsolute } from "node:path";
import { Worker } from "node:worker_threads";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DEFAULT_PROJECT_CONTEXT_CHUNK_CHARS, PLANNER_API_V2_VERSION, PLANNER_SESSION_HEADER } from "@agent-plan/core";
import type { ProjectCaller } from "@agent-plan/core/persistence";
import type { Principal } from "./auth.js";
import type { ProjectOperation, ProjectReply } from "./project-worker.js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const root = "/:projectId/workspaces/:workspaceId";
const maximumWorkers = 4;
const maximumQueued = 8;
const unavailable: ProjectReply = {
  status: 503, code: "PROJECT_WORKER_UNAVAILABLE", message: "The project worker is unavailable. Retry a write with the same requestId.",
};

type ProjectScope = { Variables: { projectCaller: ProjectCaller; principal: Principal | undefined } };

function decisionTarget(value: unknown) {
  return value === "project" || value === "feature" || value === "phase" || value === "task" ? value : undefined;
}

export function createProjectApi(runtimeHome: string, onProjectChanged: (projectId: string) => void) {
  const app = new Hono<ProjectScope>();
  const workers = new Set<Worker>();
  const waiting: Array<{ operation: ProjectOperation; resolve: (reply: ProjectReply) => void }> = [];
  let closed = false;

  const error = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 413 | 500 | 503, code: string, message: string, details?: Record<string, unknown>) =>
    c.json({ apiVersion: PLANNER_API_V2_VERSION, error: { ...details, code, message } }, status);

  function drain(): void {
    while (!closed && workers.size < maximumWorkers && waiting.length > 0) {
      const entry = waiting.shift();
      if (entry) start(entry.operation, entry.resolve);
    }
  }

  function start(operation: ProjectOperation, resolve: (reply: ProjectReply) => void): void {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./project-worker.js", import.meta.url), { workerData: { operation, home: runtimeHome } });
    } catch {
      resolve(unavailable);
      return;
    }
    workers.add(worker);
    const timeout = setTimeout(() => {
      resolve(unavailable);
      void worker.terminate().catch(() => {});
    }, 5_000);
    worker.once("message", (result: ProjectReply) => {
      clearTimeout(timeout);
      resolve(result);
    });
    worker.once("error", () => resolve(unavailable));
    worker.once("exit", () => {
      clearTimeout(timeout);
      workers.delete(worker);
      resolve(unavailable);
      drain();
    });
  }

  function execute(operation: ProjectOperation): Promise<ProjectReply> {
    if (closed || waiting.length >= maximumQueued) return Promise.resolve(unavailable);
    return new Promise((resolve) => {
      waiting.push({ operation, resolve });
      drain();
    });
  }

  const respond = async (c: Context, operation: ProjectOperation) => {
    const result = await execute(operation);
    if ("requestId" in operation && result.status === 200) onProjectChanged(operation.caller.projectId);
    return result.status === 200
      ? c.json({ apiVersion: PLANNER_API_V2_VERSION, data: result.data })
      : error(c, result.status, result.code, result.message, result.details);
  };

  app.post("/resolve", bodyLimit({
    maxSize: 8 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 8 KiB."),
  }), async (c) => {
    const principal = c.get("principal");
    if (!principal) return error(c, 401, "UNAUTHENTICATED", "This operation requires a resolved principal.");
    const body = await c.req.json<unknown>().catch(() => null);
    if (typeof body !== "object" || body === null || !("cwd" in body) || typeof body.cwd !== "string" || !isAbsolute(body.cwd)) {
      return error(c, 400, "WORKSPACE_PATH_REQUIRED", "An absolute local workspace path is required.");
    }
    return respond(c, { kind: "workspace.resolve", cwd: body.cwd, principalId: principal.principalId, requesterId: principal.requesterId });
  });

  app.use(`${root}/*`, async (c, next) => {
    const principal = c.get("principal");
    if (!principal) return error(c, 401, "UNAUTHENTICATED", "This operation requires a resolved principal.");
    const projectId = c.req.param("projectId");
    const workspaceId = c.req.param("workspaceId");
    if (!projectId || !workspaceId || !uuid.test(projectId) || !uuid.test(workspaceId)) {
      return error(c, 400, "INVALID_PROJECT_SCOPE", "A project and workspace UUID are required.");
    }
    c.set("projectCaller", { projectId, workspaceId, principalId: principal.principalId, requesterId: principal.requesterId });
    await next();
  });

  app.get(root, (c) => respond(c, { caller: c.get("projectCaller"), kind: "project.get" }));
  app.get(`${root}/board`, (c) => respond(c, { caller: c.get("projectCaller"), kind: "project.board" }));
  app.get(`${root}/ideas`, (c) => respond(c, { caller: c.get("projectCaller"), kind: "idea.read" }));
  app.get(`${root}/ideas/:ref`, (c) => respond(c, { caller: c.get("projectCaller"), kind: "idea.read", ref: c.req.param("ref") }));
  app.delete(`${root}/ideas/:ref`, (c) => {
    const requestId = c.req.query("requestId");
    if (!requestId || !uuid.test(requestId)) return error(c, 400, "IDEA_REQUEST_ID_REQUIRED", "A request ID is required.");
    return respond(c, { caller: c.get("projectCaller"), kind: "idea.mutate", action: "delete", ref: c.req.param("ref"), requestId,
      fields: { confirmed: c.req.query("confirmed") === "true" } });
  });
  app.post(`${root}/ideas/:ref/promotion/begin`, bodyLimit({
    maxSize: 8 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 8 KiB."),
  }), async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    const target = body && typeof body === "object" && "targetType" in body ? decisionTarget(body.targetType) : undefined;
    if (!target || target === "project") return error(c, 400, "IDEA_PROMOTION_TARGET_NOT_FOUND", "Select a feature, phase or task.");
    return respond(c, { caller: c.get("projectCaller"), kind: "idea.promotion.begin", ref: c.req.param("ref"), targetType: target });
  });
  for (const route of [
    { method: "post", path: "", action: "create" },
    { method: "put", path: "/:ref", action: "update" },
    { method: "post", path: "/:ref/promotion/finalize", action: "promote" },
  ] as const) {
    app[route.method](`${root}/ideas${route.path}`, bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 64 KiB."),
    }), async (c) => {
      const body = await c.req.json<unknown>().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)
        || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)) {
        return error(c, 400, "IDEA_REQUEST_ID_REQUIRED", "A request ID is required.");
      }
      const { requestId, ...fields } = body;
      return respond(c, { caller: c.get("projectCaller"), kind: "idea.mutate", action: route.action, ref: c.req.param("ref"), requestId, fields });
    });
  }
  app.get(`${root}/handoffs`, (c) => {
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "10");
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 25) {
      return error(c, 400, "INVALID_HANDOFF_PAGE", "Provide a positive page and a page size from 1 to 25.");
    }
    return respond(c, { caller: c.get("projectCaller"), kind: "handoff.list", page, pageSize,
      archived: c.req.query("archived") === "true", includeContent: c.req.query("includeContent") === "true" });
  });
  app.get(`${root}/handoffs/:ref`, (c) => respond(c, {
    caller: c.get("projectCaller"), kind: "handoff.show", ref: c.req.param("ref").trim(),
  }));
  app.post(`${root}/handoffs/:operation{prepare|verify|write}`, bodyLimit({
    maxSize: 128 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 128 KiB."),
  }), async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || !("ref" in body) || typeof body.ref !== "string" || !body.ref.trim()) {
      return error(c, 400, "PHASE_REF_REQUIRED", "A phase reference is required.", { failureKind: "refusal" });
    }
    const target = { caller: c.get("projectCaller"), ref: body.ref.trim() };
    if (c.req.param("operation") === "prepare") {
      return respond(c, { ...target, kind: "handoff.prepare", supportingDocuments: "supportingDocuments" in body ? body.supportingDocuments : [] });
    }
    if (!("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)) {
      return error(c, 400, "COMMAND_ID_REQUIRED", "A request ID is required.", { failureKind: "validation" });
    }
    const kind = c.req.param("operation") === "write" ? "handoff.write" : "handoff.verify";
    return respond(c, { ...target, kind, requestId: body.requestId, fields: "fields" in body ? body.fields : {} });
  });
  app.post(`${root}/handoffs/clear`, bodyLimit({
    maxSize: 8 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 8 KiB."),
  }), async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)
      || !("ref" in body) || typeof body.ref !== "string" || !body.ref.trim()) {
      return error(c, 400, "INVALID_HANDOFF_COMMAND", "A phase reference and request ID are required.");
    }
    return respond(c, { caller: c.get("projectCaller"), kind: "handoff.clear", requestId: body.requestId,
      ref: body.ref.trim(), confirmed: "confirmed" in body && body.confirmed === true });
  });
  app.get(`${root}/accepted-decisions`, (c) => {
    const targetType = decisionTarget(c.req.query("targetType"));
    if (!targetType) return error(c, 400, "ACCEPTED_DECISION_TARGET_TYPE_INVALID", "A decision owner type is required.");
    return respond(c, { caller: c.get("projectCaller"), kind: "decision.list", targetType, targetRef: c.req.query("targetRef")?.trim() });
  });
  app.post(`${root}/accepted-decisions/:action`, bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 64 KiB."),
  }), async (c) => {
    const action = c.req.param("action");
    if (action !== "create" && action !== "update" && action !== "delete") {
      return error(c, 404, "DECISION_ACTION_NOT_FOUND", "The accepted decision action is unsupported.");
    }
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)) {
      return error(c, 400, "INVALID_DECISION_COMMAND", "A request ID is required.");
    }
    const targetType = "targetType" in body ? decisionTarget(body.targetType) : undefined;
    if (!targetType) return error(c, 400, "ACCEPTED_DECISION_TARGET_TYPE_INVALID", "A decision owner type is required.");
    const decisionId = "decisionId" in body && typeof body.decisionId === "string" ? body.decisionId.trim() : undefined;
    if (action !== "create" && !decisionId) return error(c, 400, "ACCEPTED_DECISION_ID_REQUIRED", "A decision ID is required.");
    return respond(c, {
      caller: c.get("projectCaller"), kind: "decision.mutate", action, targetType,
      targetRef: "targetRef" in body && typeof body.targetRef === "string" ? body.targetRef.trim() : undefined,
      decisionId: action === "create" ? undefined : decisionId, requestId: body.requestId,
      confirmed: "confirmed" in body && body.confirmed === true, fields: "fields" in body ? body.fields : {},
    });
  });
  app.get(`${root}/requirements`, (c) => respond(c, {
    caller: c.get("projectCaller"), kind: "requirement.list", phaseRef: c.req.query("phaseRef")?.trim(),
  }));
  app.post(`${root}/requirements/:action`, bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 64 KiB."),
  }), async (c) => {
    const action = c.req.param("action");
    if (action !== "create" && action !== "update" && action !== "delete") {
      return error(c, 404, "REQUIREMENT_ACTION_NOT_FOUND", "The requirement action is unsupported.");
    }
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)) {
      return error(c, 400, "INVALID_REQUIREMENT_COMMAND", "A request ID is required.");
    }
    const requirementId = "requirementId" in body && typeof body.requirementId === "string" ? body.requirementId.trim() : undefined;
    if (action !== "create" && !requirementId) return error(c, 400, "REQUIREMENT_ID_REQUIRED", "A requirement ID is required.");
    return respond(c, {
      caller: c.get("projectCaller"), kind: "requirement.mutate", action, requirementId: action === "create" ? undefined : requirementId,
      requestId: body.requestId, fields: "fields" in body ? body.fields : {},
    });
  });
  app.get(`${root}/project/description-freshness`, (c) => respond(c, {
    caller: c.get("projectCaller"), kind: "project.description-freshness",
  }));
  app.get(`${root}/project/overview`, (c) => respond(c, { caller: c.get("projectCaller"), kind: "project.overview" }));
  app.get(`${root}/project/export`, (c) => respond(c, {
    caller: c.get("projectCaller"), kind: "project.export", full: c.req.query("full") === "true",
  }));
  app.get(`${root}/project/plan`, (c) => respond(c, { caller: c.get("projectCaller"), kind: "project.plan" }));
  app.get(`${root}/recommend`, (c) => {
    const sessionId = c.req.header(PLANNER_SESSION_HEADER);
    if (!sessionId || !uuid.test(sessionId)) return error(c, 401, "SESSION_REQUIRED", "A registered session ID is required.");
    return respond(c, { caller: c.get("projectCaller"), kind: "project.recommend", sessionId });
  });
  app.get(`${root}/project/guidelines`, (c) => respond(c, { caller: c.get("projectCaller"), kind: "project.guidelines" }));
  app.post(`${root}/project/update`, bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 64 KiB."),
  }), async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)
      || !("fields" in body) || !body.fields || typeof body.fields !== "object" || Array.isArray(body.fields)) {
      return error(c, 400, "INVALID_PROJECT_COMMAND", "An update payload and a request ID are required.");
    }
    return respond(c, { caller: c.get("projectCaller"), kind: "project.update", requestId: body.requestId, fields: body.fields });
  });
  for (const collection of ["features", "phases", "tasks"] as const) {
    app.get(`${root}/${collection}`, (c) => respond(c, {
      caller: c.get("projectCaller"), kind: "project.list", collection,
      filters: { featureRef: c.req.query("featureRef"), phaseRef: c.req.query("phaseRef"), status: c.req.query("status") },
    }));
    app.get(`${root}/${collection}/:ref`, (c) => respond(c, {
      caller: c.get("projectCaller"), kind: "project.detail", collection, ref: c.req.param("ref").trim(),
      full: collection !== "tasks" && c.req.query("full") === "true",
    }));
  }
  app.get(`${root}/snapshot`, (c) => respond(c, { caller: c.get("projectCaller"), kind: "project.snapshot" }));
  app.post(`${root}/tasks/move`, bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 16 KiB."),
  }), async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    const tasks: unknown[] | undefined = body && typeof body === "object" && "tasks" in body && Array.isArray(body.tasks) ? body.tasks : undefined;
    if (!body || typeof body !== "object" || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)
      || !("targetPhase" in body) || typeof body.targetPhase !== "string" || !body.targetPhase.trim()
      || !tasks || tasks.length > 100 || !tasks.every((ref): ref is string => typeof ref === "string" && !!ref.trim())) {
      return error(c, 400, "INVALID_TASK_MOVE", "Provide a request ID, a destination phase and up to 100 task references.");
    }
    return respond(c, {
      caller: c.get("projectCaller"), kind: "task.move", requestId: body.requestId, targetPhase: body.targetPhase.trim(), tasks,
    });
  });
  app.post(`${root}/tasks/dependencies`, bodyLimit({
    maxSize: 8 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 8 KiB."),
  }), async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)
      || !("ref" in body) || typeof body.ref !== "string" || !body.ref.trim()
      || !("dependsOn" in body) || typeof body.dependsOn !== "string" || !body.dependsOn.trim()
      || !("action" in body) || (body.action !== "add" && body.action !== "delete")) {
      return error(c, 400, "INVALID_DEPENDENCY_COMMAND", "Provide an action, request ID, task reference and dependency reference.");
    }
    return respond(c, { caller: c.get("projectCaller"), kind: "task.dependency", action: body.action, ref: body.ref.trim(),
      requestId: body.requestId, dependsOn: body.dependsOn.trim(), confirmed: "confirmed" in body && body.confirmed === true });
  });
  app.get(`${root}/events`, (c) => {
    const raw = c.req.query("after") ?? "0";
    const after = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(after)) return error(c, 400, "INVALID_EVENT_CURSOR", "A non-negative event cursor is required.");
    return respond(c, { caller: c.get("projectCaller"), kind: "events.replay", after });
  });
  app.get(`${root}/search`, (c) => {
    const query = c.req.query("q")?.trim();
    if (!query || query.length > 256) return error(c, 400, "INVALID_QUERY", "A search query of 1–256 characters is required.");
    return respond(c, { caller: c.get("projectCaller"), kind: "documents.search", query });
  });
  app.post(`${root}/sessions`, bodyLimit({
    maxSize: 8 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 8 KiB."),
  }), async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    if (typeof body !== "object" || body === null || !("clientKind" in body)
      || typeof body.clientKind !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(body.clientKind)) {
      return error(c, 400, "SESSION_CLIENT_KIND_REQUIRED", "A valid clientKind is required.");
    }
    return respond(c, { caller: c.get("projectCaller"), kind: "session.register", clientKind: body.clientKind });
  });
  app.post(`${root}/sessions/:sessionId/heartbeat`, (c) => {
    const sessionId = c.req.param("sessionId");
    if (!uuid.test(sessionId)) return error(c, 400, "INVALID_SESSION_ID", "A session UUID is required.");
    return respond(c, { caller: c.get("projectCaller"), kind: "session.heartbeat", sessionId });
  });
  app.delete(`${root}/sessions/:sessionId`, (c) => {
    const sessionId = c.req.param("sessionId");
    if (!uuid.test(sessionId)) return error(c, 400, "INVALID_SESSION_ID", "A session UUID is required.");
    return respond(c, { caller: c.get("projectCaller"), kind: "session.end", sessionId });
  });
  app.post(`${root}/context/load`, bodyLimit({
    maxSize: 8 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 8 KiB."),
  }), async (c) => {
    const sessionId = c.req.header(PLANNER_SESSION_HEADER);
    if (!sessionId || !uuid.test(sessionId)) return error(c, 401, "SESSION_REQUIRED", "A registered session ID is required.");
    const body = await c.req.json<unknown>().catch(() => null);
    if (typeof body !== "object" || body === null) return error(c, 400, "INVALID_BODY", "A JSON body is required.");
    const maxChars = "maxChars" in body ? body.maxChars : DEFAULT_PROJECT_CONTEXT_CHUNK_CHARS;
    if (typeof maxChars !== "number" || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 1_000_000) {
      return error(c, 400, "INVALID_CONTEXT_LIMIT", "maxChars must be an integer from 1 to 1000000.");
    }
    return respond(c, { caller: c.get("projectCaller"), kind: "context.load", sessionId, maxChars });
  });
  app.post(`${root}/entities/create`, bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 64 KiB."),
  }), async (c) => {
    const sessionId = c.req.header(PLANNER_SESSION_HEADER);
    if (!sessionId || !uuid.test(sessionId)) return error(c, 401, "SESSION_REQUIRED", "A registered session ID is required.");
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || !("kind" in body)
      || (body.kind !== "feature" && body.kind !== "phase" && body.kind !== "task")
      || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)
      || !("title" in body) || typeof body.title !== "string") {
      return error(c, 400, "INVALID_ENTITY_CREATE", "A planner entity kind, title, and request ID are required.");
    }
    const optionalString = (key: string) => {
      const value = (body as Record<string, unknown>)[key];
      return typeof value === "string" ? value : undefined;
    };
    const checklist = "checklist" in body ? body.checklist : undefined;
    if (checklist !== undefined && (!Array.isArray(checklist) || !checklist.every((entry) => typeof entry === "string"))) {
      return error(c, 400, "INVALID_CHECKLIST", "The checklist must contain strings.");
    }
    return respond(c, {
      caller: c.get("projectCaller"), kind: "entity.create", requestId: body.requestId,
      input: {
        kind: body.kind, requestId: body.requestId, sessionId, title: body.title,
        description: optionalString("description") ?? "", summary: optionalString("summary"),
        featureRef: optionalString("featureRef"), phaseRef: optionalString("phaseRef"), status: optionalString("status"),
        ...(checklist ? { checklist } : {}), supervisor: c.get("principal")?.kind === "web-ui",
      },
    });
  });
  app.post(`${root}/entities/reorder`, bodyLimit({
    maxSize: 8 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 8 KiB."),
  }), async (c) => {
    const sessionId = c.req.header(PLANNER_SESSION_HEADER);
    if (!sessionId || !uuid.test(sessionId)) return error(c, 401, "SESSION_REQUIRED", "A registered session ID is required.");
    const body = await c.req.json<Record<string, unknown> | null>().catch(() => null);
    if (!body || (body.kind !== "feature" && body.kind !== "phase" && body.kind !== "task")
      || typeof body.requestId !== "string" || !uuid.test(body.requestId)
      || typeof body.movedId !== "string" || !uuid.test(body.movedId)
      || (body.beforeId !== null && (typeof body.beforeId !== "string" || !uuid.test(body.beforeId)))
      || (body.afterId !== null && (typeof body.afterId !== "string" || !uuid.test(body.afterId)))) {
      return error(c, 400, "INVALID_ENTITY_REORDER", "An entity kind, request ID, moved UUID, and nullable neighbor UUIDs are required.");
    }
    const { kind, requestId, movedId, beforeId, afterId } = body;
    return respond(c, {
      caller: c.get("projectCaller"), kind: "entity.reorder", requestId,
      input: { kind, requestId, sessionId, movedId, beforeId, afterId },
    });
  });
  app.post(`${root}/entities/delete`, bodyLimit({
    maxSize: 8 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 8 KiB."),
  }), async (c) => {
    const sessionId = c.req.header(PLANNER_SESSION_HEADER);
    if (!sessionId || !uuid.test(sessionId)) return error(c, 401, "SESSION_REQUIRED", "A registered session ID is required.");
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || !("kind" in body)
      || (body.kind !== "feature" && body.kind !== "phase" && body.kind !== "task")
      || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)
      || !("ref" in body) || typeof body.ref !== "string" || !body.ref.trim()) {
      return error(c, 400, "INVALID_ENTITY_DELETE", "A planner entity kind, reference, and request ID are required.");
    }
    return respond(c, {
      caller: c.get("projectCaller"), kind: "entity.delete", requestId: body.requestId,
      input: { kind: body.kind, ref: body.ref.trim(), requestId: body.requestId, sessionId,
        cascade: "cascade" in body && body.cascade === true, confirmed: "confirmed" in body && body.confirmed === true },
    });
  });
  app.post(`${root}/entities/:action{update|discuss}`, bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 64 KiB."),
  }), async (c) => {
    const sessionId = c.req.header(PLANNER_SESSION_HEADER);
    if (!sessionId || !uuid.test(sessionId)) return error(c, 401, "SESSION_REQUIRED", "A registered session ID is required.");
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object" || !("kind" in body)
      || (body.kind !== "feature" && body.kind !== "phase" && body.kind !== "task")
      || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)
      || !("ref" in body) || typeof body.ref !== "string" || !body.ref.trim()
      || !("updates" in body) || !body.updates || typeof body.updates !== "object" || Array.isArray(body.updates)) {
      return error(c, 400, "INVALID_ENTITY_UPDATE", "A planner entity kind, reference, request ID, and updates are required.");
    }
    return respond(c, {
      caller: c.get("projectCaller"), kind: "entity.update", requestId: body.requestId,
      input: { kind: body.kind, requestId: body.requestId, sessionId, ref: body.ref.trim(),
        updates: body.updates as Record<string, unknown>, supervisor: c.get("principal")?.kind === "web-ui",
        ...(c.req.param("action") === "discuss" ? { discuss: true } : {}) },
    });
  });
  for (const action of ["context", "start", "complete", "pause", "switch", "deviation", "reopen", "recover", "release", "checklist/toggle", "checklist/add", "checklist/remove"] as const) {
    app.post(`${root}/tasks/${action}`, bodyLimit({
      maxSize: 8 * 1024,
      onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 8 KiB."),
    }), async (c) => {
      const sessionId = c.req.header(PLANNER_SESSION_HEADER);
      if (!sessionId || !uuid.test(sessionId)) return error(c, 401, "SESSION_REQUIRED", "A registered session ID is required.");
      const body = await c.req.json<unknown>().catch(() => null);
      if (!body || typeof body !== "object" || !("ref" in body) || typeof body.ref !== "string" || !body.ref.trim()) {
        return error(c, 400, "TASK_REF_REQUIRED", "A task reference is required.");
      }
      const base = { caller: c.get("projectCaller"), ref: body.ref.trim(), sessionId };
      if (action !== "context") {
        if (!("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)) {
          return error(c, 400, "COMMAND_ID_REQUIRED", "A request ID is required.");
        }
        const requestId = body.requestId;
        if (action === "start") return respond(c, {
          ...base, kind: "task.start", requestId, confirmedTakeover: "confirmedTakeover" in body && body.confirmedTakeover === true,
        });
        if (action === "deviation") {
          const { reason, resumeTask } = body as { reason?: unknown; resumeTask?: unknown };
          if (typeof reason !== "string" || !reason.trim() ||
            (resumeTask !== undefined && (typeof resumeTask !== "string" || !resumeTask.trim()))) {
            return error(c, 400, "INVALID_TASK_DEVIATION", "A reason and a valid optional resume task reference are required.");
          }
          return respond(c, { ...base, kind: "task.deviation", requestId, temporaryTask: base.ref, resumeTask: resumeTask?.trim(), reason });
        }
        if (action === "reopen" || action === "recover") {
          const kind = action === "reopen" ? "task.reopen" : "task.session.recover";
          return respond(c, { ...base, kind, requestId, confirmed: "confirmed" in body && body.confirmed === true });
        }
        if (action === "release") {
          if (c.get("principal")?.kind !== "web-ui") {
            return error(c, 403, "TASK_RELEASE_FORBIDDEN", "The dashboard user must confirm release.");
          }
          return respond(c, { ...base, kind: "task.release", requestId, confirmed: "confirmed" in body && body.confirmed === true });
        }
        if (action === "checklist/toggle" || action === "checklist/add" || action === "checklist/remove") {
          if (!("item" in body) || typeof body.item !== "string" || !body.item.trim()) {
            return error(c, 400, "CHECKLIST_ITEM_REQUIRED", "A checklist item reference is required.");
          }
          return respond(c, {
            ...base, kind: "task.checklist.mutate", requestId, item: body.item.trim(),
            action: action === "checklist/add" ? "add" : action === "checklist/remove" ? "remove" : undefined,
            checked: "checked" in body && typeof body.checked === "boolean" ? body.checked : undefined,
          });
        }
        if (action === "pause" || action === "switch") {
          const reason = "reason" in body && typeof body.reason === "string" ? body.reason.trim() : "";
          const whatWasBeingDone = "whatWasBeingDone" in body && typeof body.whatWasBeingDone === "string" ? body.whatWasBeingDone.trim() : "";
          const resumeLocation = "resumeLocation" in body && typeof body.resumeLocation === "string" ? body.resumeLocation.trim() : "";
          const howToResume = "howToResume" in body && typeof body.howToResume === "string" ? body.howToResume.trim() : "";
          if (!reason || !whatWasBeingDone || !resumeLocation || !howToResume) {
            return error(c, 400, "PAUSE_CHECKPOINT_REQUIRED", "Provide the reason, current work, resume location, and how to resume.");
          }
          const checkpoint = { reason, whatWasBeingDone, resumeLocation, howToResume };
          if (action === "pause") return respond(c, { ...base, kind: "task.pause", requestId, checkpoint });
          if (!("toRef" in body) || typeof body.toRef !== "string" || !body.toRef.trim()) {
            return error(c, 400, "TASK_REF_REQUIRED", "A target task reference is required.");
          }
          return respond(c, { ...base, kind: "task.switch", requestId, checkpoint, toRef: body.toRef.trim() });
        }
        if (!("descriptionUpdate" in body) || typeof body.descriptionUpdate !== "string") {
          return error(c, 400, "COMPLETION_EVIDENCE_REQUIRED", "Completion and verification evidence is required.");
        }
        return respond(c, {
          ...base, kind: "task.complete", requestId, descriptionUpdate: body.descriptionUpdate,
          force: "force" in body && body.force === true,
          motivation: "motivation" in body && typeof body.motivation === "string" ? body.motivation : undefined,
        });
      }
      const maxChars = "maxChars" in body ? body.maxChars : DEFAULT_PROJECT_CONTEXT_CHUNK_CHARS;
      if (typeof maxChars !== "number" || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 1_000_000) {
        return error(c, 400, "INVALID_CONTEXT_LIMIT", "maxChars must be an integer from 1 to 1000000.");
      }
      return respond(c, { ...base, kind: "task.context", maxChars });
    });
  }
  app.get(`${root}/documents`, (c) => {
    return respond(c, { caller: c.get("projectCaller"), kind: "document.path", path: c.req.query("path") ?? "" });
  });
  app.get(`${root}/documents/:documentId`, (c) => {
    return respond(c, { caller: c.get("projectCaller"), kind: "document.get", documentId: c.req.param("documentId") });
  });
  app.put(`${root}/documents/:documentId`, bodyLimit({
    maxSize: 512 * 1024,
    onError: (c) => error(c, 413, "PROJECT_COMMAND_TOO_LARGE", "The request body exceeds 512 KiB."),
  }), async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    if (typeof body !== "object" || body === null || !("content" in body) || typeof body.content !== "string"
      || !("requestId" in body) || typeof body.requestId !== "string" || !uuid.test(body.requestId)) {
      return error(c, 400, "INVALID_DOCUMENT_COMMAND", "A requestId UUID, positive expectedRevision and document content are required.");
    }
    const projectRevision = "expectedRevision" in body ? body.expectedRevision : undefined;
    const documentRevision = "expectedDocumentRevision" in body ? body.expectedDocumentRevision : undefined;
    const validRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    if ((projectRevision !== undefined && !validRevision(projectRevision))
      || (documentRevision !== undefined && !validRevision(documentRevision))
      || (projectRevision === undefined && documentRevision === undefined)) {
      return error(c, 400, "INVALID_DOCUMENT_REVISION", "A positive project or document revision is required.");
    }
    return respond(c, {
      caller: c.get("projectCaller"), kind: "document.update", documentId: c.req.param("documentId"),
      requestId: body.requestId, expectedRevision: projectRevision, expectedDocumentRevision: documentRevision, content: body.content,
    });
  });

  return {
    app,
    async close() {
      closed = true;
      for (const entry of waiting.splice(0)) entry.resolve(unavailable);
      // Admitted commands finish within their normal worker deadline.
      await Promise.all([...workers].map((worker) => new Promise<void>((resolve) => {
        worker.once("exit", () => resolve());
      })));
    },
  };
}
