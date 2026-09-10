import { watch, existsSync, readFileSync, statSync } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createAdaptorServer } from "@hono/node-server";
import type http from "node:http";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { ExportService, PlanStore, PlanStoreError, PlanStaleWriteError, PlanWriterBusyError, createFeatureId, createPhaseId, createChecklistItemId, createRequirementId, createShortId, createTaskId, findPhaseByRef, normalizeSlug, withFeatureLock, needsMotivation, checkExplicitTaskStart, recommendNextTask, recommendNextWork, reconcileRequirementMacroTasks, RequirementMacroTaskError, packageVersionFromModule, type MacroTaskMutationInput } from "@agent-plan/core"
import type { Feature, Phase, Project, Requirement, Task, Subtask, StatusLogEntry } from "@agent-plan/core/schema";
import { WsHub } from "./ws-hub.js";

// ─── Watcher ────────────────────────────────────────────────────────────

let watcherAbort: AbortController | null = null;
let watcherHubRef: { current: WsHub | null } = { current: null };

const SERVER_PACKAGE = packageVersionFromModule(import.meta.url, "@agent-plan/server");

function nowISO(): string {
  return new Date().toISOString();
}

/** Resolve requirement phase refs before persistence so requirements never dangle. */
async function resolveRequirementPhaseIds(
  store: PlanStore,
  linkedPhaseIds: unknown,
): Promise<{ linkedPhaseIds: string[] } | { error: string }> {
  if (!Array.isArray(linkedPhaseIds) || linkedPhaseIds.length === 0) {
    return { error: "linkedPhaseIds must contain at least one phase" };
  }

  const refs = linkedPhaseIds.map((entry) => typeof entry === "string" ? entry.trim() : "");
  if (refs.some((ref) => !ref)) {
    return { error: "linkedPhaseIds must contain non-empty phase references" };
  }

  const [phases, featuresDocument] = await Promise.all([store.loadAllPhases(), store.loadFeatures()]);
  const resolved = refs.map((ref) => findPhaseByRef(phases, featuresDocument.features, ref));
  const missing = resolved.findIndex((phase) => !phase);
  if (missing !== -1) return { error: `linked phase not found: ${refs[missing]}` };

  return { linkedPhaseIds: [...new Set(resolved.map((phase) => phase!.id))] };
}

type RequirementMutationBody = Partial<Requirement> & { macroTasks?: MacroTaskMutationInput[]; status?: unknown };

function macroTaskInputs(value: unknown): MacroTaskMutationInput[] | null {
  return Array.isArray(value) ? value as MacroTaskMutationInput[] : null;
}

function hasDefinedField(body: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.some((field) => body[field] !== undefined);
}

function noMutableFieldsResponse(fields: readonly string[]) {
  return {
    error: "NO_MUTABLE_FIELDS_RECEIVED",
    updated: false,
    reason: "no-mutable-fields",
    mutableFields: [...fields],
  };
}

type AcceptedDecisionTargetType = "project" | "feature" | "phase" | "task";
type AcceptedDecisionTargetResolution =
  | { ok: true; owner: { kind: "project" } | { kind: "feature"; featureId: string } | { kind: "phase"; phaseId: string } | { kind: "task"; phaseId: string; taskId: string }; targetRef: string; event: { type: "project" } | { type: "feature"; featureId: string } | { type: "phase"; phaseId: string; featureId: string } | { type: "task"; phaseId: string; taskId: string; featureId: string } }
  | { ok: false; error: string };

async function resolveAcceptedDecisionTarget(store: PlanStore, targetType: AcceptedDecisionTargetType, rawTargetRef?: string): Promise<AcceptedDecisionTargetResolution> {
  if (targetType === "project") return { ok: true, owner: { kind: "project" }, targetRef: "project", event: { type: "project" } };
  const targetRef = rawTargetRef?.trim();
  if (!targetRef) return { ok: false, error: `targetRef is required for ${targetType} accepted decisions` };
  const [featuresDocument, phases] = await Promise.all([store.loadFeatures(), store.loadAllPhases()]);
  const features = featuresDocument.features;
  if (targetType === "feature") {
    const feature = features.find((entry) => entry.id === targetRef || `F${String(entry.number).padStart(3, "0")}`.toLowerCase() === targetRef.toLowerCase() || entry.shortId?.toLowerCase() === targetRef.toLowerCase());
    if (!feature) return { ok: false, error: `feature not found: ${targetRef}` };
    return { ok: true, owner: { kind: "feature", featureId: feature.id }, targetRef: `F${String(feature.number).padStart(3, "0")}`, event: { type: "feature", featureId: feature.id } };
  }
  if (targetType === "phase") {
    const phase = findPhaseByRef(phases, features, targetRef);
    if (!phase) return { ok: false, error: `phase not found: ${targetRef}` };
    return { ok: true, owner: { kind: "phase", phaseId: phase.id }, targetRef: `P${String(phase.number).padStart(3, "0")}`, event: { type: "phase", phaseId: phase.id, featureId: phase.featureId ?? "" } };
  }
  const found = phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task }))).find(({ task }) => task.id === targetRef)
    ?? (() => {
      const taskNumberMatch = targetRef.match(/^T(\d+)$/i);
      return taskNumberMatch
        ? phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task }))).find(({ task }) => task.number === Number(taskNumberMatch[1]))
        : undefined;
    })();
  if (!found) return { ok: false, error: `task not found: ${targetRef}` };
  return { ok: true, owner: { kind: "task", phaseId: found.phase.id, taskId: found.task.id }, targetRef: `P${String(found.phase.number).padStart(3, "0")}/T${String(found.task.number).padStart(3, "0")}`, event: { type: "task", phaseId: found.phase.id, taskId: found.task.id, featureId: found.phase.featureId ?? "" } };
}

function nextTaskNumber(phase: Phase): number {
  const numbers = phase.tasks.map((task) => task.number || 0).filter((n) => Number.isFinite(n));
  return (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
}

function isPrivateIpv4(address: string): boolean {
  return /^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

function detectLanIp(): string | undefined {
  const nets = networkInterfaces();
  let fallback: string | undefined;
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isPrivateIpv4(entry.address)) return entry.address;
      fallback ??= entry.address;
    }
  }
  return fallback;
}

function buildServerUrls(port: number, host: string): { mode: "local" | "lan"; bindHost: string; localUrl: string; lanUrl: string | undefined } {
  const localUrl = `http://127.0.0.1:${port}`;
  if (host === "0.0.0.0") {
    const lanIp = detectLanIp();
    return {
      mode: "lan",
      bindHost: host,
      localUrl,
      lanUrl: lanIp ? `http://${lanIp}:${port}` : undefined,
    };
  }
  return { mode: "local", bindHost: host, localUrl, lanUrl: undefined };
}

function requiresGovernance(status: string | undefined): boolean {
  return status === "in-progress" || status === "done" || status === "blocked";
}

function entersGovernedState(previousStatus: string | undefined, nextStatus: string | undefined): boolean {
  return requiresGovernance(nextStatus) && !requiresGovernance(previousStatus);
}

function featureGovernanceReady(feature: Feature): boolean {
  return Boolean(feature.discussedAt || (feature.contextReady && feature.contextReadyReason.trim()));
}

function phaseGovernanceReady(phase: Phase): boolean {
  return Boolean(phase.discussedAt || (phase.contextReady && phase.contextReadyReason.trim()));
}

// Web UI calls are the human supervisor and are exempt from agent-only
// governance gates (e.g. feature/phase discuss-before-work). Identified by the
// X-Planner-Source: web-ui header the browser client always sends.
function fromWebUi(c: Context): boolean {
  return c.req.header("X-Planner-Source") === "web-ui";
}

function applyTaskLifecycleDates(task: Task, nextStatus: Task["status"], now: string): Task {
  const previousStatus = task.status;
  if (nextStatus === "in-progress" && !task.startedAt) {
    task.startedAt = now;
  }
  if (nextStatus === "done") {
    if (!task.startedAt) task.startedAt = now;
    task.completedAt = now;
  } else if (previousStatus === "done") {
    task.completedAt = "";
  }
  task.status = nextStatus;
  return task;
}

function startWatcher(planRoot: string, hubRef: { current: WsHub | null }): void {
  stopWatcher();
  if (!existsSync(planRoot)) return;

  const ac = new AbortController();
  watcherAbort = ac;
  watcherHubRef = hubRef;

  try {
    watch(planRoot, { recursive: true, signal: ac.signal }, (_event: string, filename: string | null) => {
      if (filename && !filename.includes(".tmp.")) {
        hubRef.current?.broadcast({ type: "file-changed", data: { filename } });
      }
    });
  } catch {
    // recursive watch may fail on some systems
  }
}

function stopWatcher() {
  watcherAbort?.abort();
  watcherAbort = null;
}

  // ── Helpers ─────────────────────────────────────────────────────────

  async function propagateTaskStatus(phaseId: string) {
    // This is now handled by PlanStore.syncStatuses()
  }

  async function propagatePhaseStatus(featureId: string | undefined) {
    // This is now handled by PlanStore.syncStatuses()
  }


export interface ShortcutConfigSpec {
  key: string;
  primary?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ServerUiConfig {
  mode: "local" | "lan";
  bindHost: string;
  port: number;
  localUrl: string;
  lanUrl?: string | undefined;
}

export interface UiConfig {
  shortcuts?: Partial<Record<"create" | "edit" | "delete" | "submit", ShortcutConfigSpec>>;
  server?: ServerUiConfig | undefined;
}

function createApiApp(store: PlanStore, hubRef: { current: WsHub | null }, apiPrefix = "", uiConfig?: UiConfig, isBusy?: () => boolean) {
  const hub = () => hubRef.current;
  const route = (path: string) => `${apiPrefix}${path}`;

  const app = new Hono();

  // Global error handler: never let an unhandled exception (e.g. a missing
  // phase file -> PlanStoreError/ENOENT) bubble up to the host process console
  // (the agent session). Convert it to a clean HTTP response instead.
  app.onError((err, c) => {
    if (err instanceof PlanWriterBusyError) {
      return c.json({ error: err.code, message: err.message, details: err.details }, 423);
    }
    if (err instanceof PlanStaleWriteError) {
      return c.json({ error: err.code, message: err.message, details: err.details }, 409);
    }
    if (err instanceof PlanStoreError && (err.details?.errorCode === "PLAN_UNSUPPORTED_ALLOCATION_KIND" || err.details?.errorCode === "PLAN_RUNTIME_SCHEMA_INCOMPATIBLE")) {
      return c.json({ error: err.details.errorCode, message: err.message, details: err.details }, 409);
    }
    if (err instanceof PlanStoreError && typeof err.details?.errorCode === "string" && err.details.errorCode.startsWith("ACCEPTED_DECISION_")) {
      return c.json({ error: err.details.errorCode, message: err.message, details: err.details }, err.details.errorCode === "ACCEPTED_DECISION_NOT_FOUND" ? 404 : 400);
    }
    const isStoreRead = err instanceof PlanStoreError || /ENOENT|read failed/i.test(err.message);
    if (isStoreRead) {
      return c.json({ error: "not found", message: err.message }, 404);
    }
    return c.json({ error: "internal", message: err instanceof Error ? err.message : String(err) }, 500);
  });

  app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type"] }));

  // Internal notify endpoint: lets adapter tools running in ANOTHER process
  // (where they don't have the WsHub reference) force a live-update broadcast.
  // Registered BEFORE the busy middleware so it always responds (a notify ping
  // must never be blocked by a busy window, otherwise live updates are lost).
  app.post(route("/internal/notify"), (c) => {
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    hub()?.broadcast({ type: "file-changed", data: { filename: "external-notify" } });
    return c.json({ ok: true });
  });

  // While the agent is mutating .planner/ files, avoid serving possibly-inconsistent data.
  // GET requests get a 503 busy signal the UI retries; mutations are rejected.
  app.use("*", async (c, next) => {
    if (isBusy?.()) {
      const isRead = c.req.method === "GET" || c.req.method === "HEAD";
      return c.json(
        { error: "plan-busy", busy: true, message: "Plan files are being updated by the agent. Please retry shortly." },
        isRead ? 503 : 409,
      );
    }
    await next();
  });

  // ── Project ──────────────────────────────────────────────────────
  app.get(route("/export"), async (c) => {
    const full = c.req.query("full") === "true";
    const exportService = new ExportService();
    const markdown = await store.runBatch(async () => {
      const plan = await store.loadAll();
      const rendered = exportService.exportToMarkdown(plan, full);
      await writeFile(join(store.root, "EXPORT.md"), rendered, "utf-8");
      return rendered;
    });

    return c.json({ markdown, filePath: "EXPORT.md" });
  });

  app.get(route("/project"), async (c) => {
    const project = await store.loadProject();
    return c.json({
      ...project,
      planRoot: store.root,
      projectRoot: dirname(store.root),
      agentPlanVersion: SERVER_PACKAGE.version,
    });
  });

  app.put(route("/project"), async (c) => {
    const body = await c.req.json<Partial<Project> & { expectedGuidelinesUpdatedAt?: string }>();
    const existingProject = await store.loadProject();
    if (body.acceptedDecisions !== undefined && JSON.stringify(body.acceptedDecisions) !== JSON.stringify(existingProject.acceptedDecisions)) return c.json({ updated: false, errorCode: "ACCEPTED_DECISION_SEMANTIC_MUTATION_REQUIRED", message: "Raw acceptedDecisions replacement is disabled. Use the accepted-decisions semantic create, update, or delete endpoints so IDs and acceptedAt are preserved." }, 400);
    const mutableFields = ["name", "goal", "description", "descriptionRef", "webPort", "scope", "outOfScope", "decisions", "globalRules", "technologies", "tools", "contentLanguage", "chatLanguage", "workflowRules", "projectGuidelines"];
    if (!hasDefinedField(body, mutableFields)) return c.json(noMutableFieldsResponse(mutableFields), 400);
    const persisted = await store.updateProject((current) => ({
      ...current,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.goal !== undefined ? { goal: body.goal } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.descriptionRef !== undefined ? { descriptionRef: body.descriptionRef.trim() || undefined } : {}),
      ...(body.webPort !== undefined ? { webPort: body.webPort } : {}),
      ...(body.scope !== undefined ? { scope: body.scope } : {}),
      ...(body.outOfScope !== undefined ? { outOfScope: body.outOfScope } : {}),
      ...(body.decisions !== undefined ? { decisions: body.decisions } : {}),
      ...(body.globalRules !== undefined ? { globalRules: body.globalRules } : {}),
      ...(body.technologies !== undefined ? { technologies: body.technologies } : {}),
      ...(body.tools !== undefined ? { tools: body.tools } : {}),
      ...(body.contentLanguage !== undefined ? { contentLanguage: body.contentLanguage } : {}),
      ...(body.chatLanguage !== undefined ? { chatLanguage: body.chatLanguage } : {}),
      ...(body.workflowRules !== undefined ? { workflowRules: body.workflowRules } : {}),
      ...(body.projectGuidelines !== undefined
        ? { projectGuidelines: { ...current.projectGuidelines, content: body.projectGuidelines.content } }
        : {}),
    }), body.projectGuidelines !== undefined && body.expectedGuidelinesUpdatedAt !== undefined
      ? { expectedGuidelinesUpdatedAt: body.expectedGuidelinesUpdatedAt }
      : {});
    await store.writeGenerated();
    hub()?.broadcast({ type: "project-updated", data: persisted });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json(persisted);
  });

  app.get(route("/project/context-migration"), async (c) => {
    return c.json(await store.previewLegacyProjectContextMigration());
  });

  app.post(route("/project/context-migration"), async (c) => {
    const body = await c.req.json<{ confirm?: unknown }>().catch((): { confirm?: unknown } => ({}));
    if (body.confirm !== true) {
      return c.json({
        error: "PROJECT_CONTEXT_MIGRATION_CONFIRMATION_REQUIRED",
        message: "Preview the legacy project-context migration, then retry with confirm=true to apply it.",
      }, 400);
    }
    const result = await store.migrateLegacyProjectContext();
    await store.writeGenerated();
    hub()?.broadcast({ type: "project-updated", data: result.project });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json(result);
  });

  const broadcastAcceptedDecisionMutation = (event: Extract<AcceptedDecisionTargetResolution, { ok: true }>["event"], action: "created" | "updated" | "deleted") => {
    if (event.type === "project") hub()?.broadcast({ type: "project-updated", data: { action } });
    if (event.type === "feature") hub()?.broadcast({ type: "features-updated", data: { action, id: event.featureId, featureId: event.featureId } });
    if (event.type === "phase") hub()?.broadcast({ type: "phases-updated", data: { action, id: event.phaseId, phaseId: event.phaseId, featureId: event.featureId } });
    if (event.type === "task") hub()?.broadcast({ type: "phases-updated", data: { action: `task-${action}`, id: event.phaseId, phaseId: event.phaseId, featureId: event.featureId, taskId: event.taskId } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
  };

  app.post(route("/accepted-decisions"), async (c) => {
    const body = await c.req.json<{ targetType?: AcceptedDecisionTargetType; targetRef?: string; title?: string; decision?: string; rationale?: string; implementationNotes?: string }>();
    if (!body.targetType) return c.json({ error: "targetType required" }, 400);
    const target = await resolveAcceptedDecisionTarget(store, body.targetType, body.targetRef);
    if (!target.ok) return c.json({ error: target.error, created: false }, 404);
    const createInput = {
      title: body.title ?? "",
      ...(body.decision !== undefined ? { decision: body.decision } : {}),
      ...(body.rationale !== undefined ? { rationale: body.rationale } : {}),
      ...(body.implementationNotes !== undefined ? { implementationNotes: body.implementationNotes } : {}),
    };
    const acceptedDecision = await store.createAcceptedDecision(target.owner, createInput);
    await store.writeGenerated();
    broadcastAcceptedDecisionMutation(target.event, "created");
    return c.json({ acceptedDecision, created: true, targetRef: target.targetRef }, 201);
  });

  app.put(route("/accepted-decisions/:decisionId"), async (c) => {
    const decisionId = c.req.param("decisionId") ?? "";
    const body = await c.req.json<{ targetType?: AcceptedDecisionTargetType; targetRef?: string; title?: string; decision?: string; rationale?: string; implementationNotes?: string }>();
    if (!body.targetType) return c.json({ error: "targetType required", updated: false }, 400);
    const mutableFields = ["title", "decision", "rationale", "implementationNotes"];
    if (!hasDefinedField(body, mutableFields)) return c.json(noMutableFieldsResponse(mutableFields), 400);
    const target = await resolveAcceptedDecisionTarget(store, body.targetType, body.targetRef);
    if (!target.ok) return c.json({ error: target.error, updated: false }, 404);
    const updateInput = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.decision !== undefined ? { decision: body.decision } : {}),
      ...(body.rationale !== undefined ? { rationale: body.rationale } : {}),
      ...(body.implementationNotes !== undefined ? { implementationNotes: body.implementationNotes } : {}),
    };
    const acceptedDecision = await store.updateAcceptedDecision(target.owner, decisionId, updateInput);
    await store.writeGenerated();
    broadcastAcceptedDecisionMutation(target.event, "updated");
    return c.json({ acceptedDecision, updated: true, targetRef: target.targetRef });
  });

  app.delete(route("/accepted-decisions/:decisionId"), async (c) => {
    const decisionId = c.req.param("decisionId") ?? "";
    const body = await c.req.json<{ targetType?: AcceptedDecisionTargetType; targetRef?: string; confirmed?: boolean }>().catch((): { targetType?: AcceptedDecisionTargetType; targetRef?: string; confirmed?: boolean } => ({}));
    if (!body.targetType) return c.json({ error: "targetType required", deleted: false }, 400);
    const target = await resolveAcceptedDecisionTarget(store, body.targetType, body.targetRef);
    if (!target.ok) return c.json({ error: target.error, deleted: false }, 404);
    if (body.confirmed !== true) return c.json({ error: "confirmation required", deleted: false, confirmRequired: true }, 400);
    const acceptedDecision = await store.deleteAcceptedDecision(target.owner, decisionId);
    await store.writeGenerated();
    broadcastAcceptedDecisionMutation(target.event, "deleted");
    return c.json({ acceptedDecision, deleted: true, decisionId, targetRef: target.targetRef });
  });

  // ── Requirements ─────────────────────────────────────────────────
  app.get(route("/requirements"), async (c) => c.json(await store.loadRequirements()));

  app.post(route("/requirements"), async (c) => {
    const body = await c.req.json<RequirementMutationBody>();
    if (body.status !== undefined) return c.json({ error: "Requirements are declarative product outcomes and have no lifecycle status.", errorCode: "REQUIREMENT_STATUS_REMOVED" }, 400);
    const title = body.title?.trim();
    if (!title) return c.json({ error: "title required" }, 400);
    const links = await resolveRequirementPhaseIds(store, body.linkedPhaseIds);
    if ("error" in links) return c.json({ error: links.error }, 400);
    const inputs = macroTaskInputs(body.macroTasks ?? []);
    if (!inputs) return c.json({ error: "macroTasks must be an array" }, 400);
    const now = nowISO();
    let macroTasks;
    try {
      macroTasks = reconcileRequirementMacroTasks([], inputs, now);
    } catch (error) {
      const message = error instanceof RequirementMacroTaskError ? error.message : "Invalid macro tasks.";
      return c.json({ error: message }, 400);
    }
    const requirement: Requirement = {
      id: createRequirementId(),
      title,
      description: body.description?.trim() ?? "",
      macroTasks,
      linkedPhaseIds: links.linkedPhaseIds,
      createdAt: now,
      updatedAt: now,
      sessionInfo: [],
    };
    const reqs = await store.updateRequirements((doc) => ({ requirements: [...doc.requirements, requirement] }));
    await store.writeGenerated();
    hub()?.broadcast({ type: "requirements-updated", data: reqs });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json(requirement, 201);
  });

  app.put(route("/requirements/:id"), async (c) => store.runBatch(async () => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const body = await c.req.json<RequirementMutationBody & { expectedUpdatedAt?: string }>();
    if (body.status !== undefined) return c.json({ error: "Requirements are declarative product outcomes and have no lifecycle status.", errorCode: "REQUIREMENT_STATUS_REMOVED" }, 400);
    const existing = (await store.loadRequirements()).requirements.find((requirement) => requirement.id === id);
    if (!existing) return c.json({ error: "not found" }, 404);
    const mutableFields = ["title", "description", "linkedPhaseIds", "macroTasks"];
    if (!hasDefinedField(body, mutableFields)) return c.json(noMutableFieldsResponse(mutableFields), 400);
    const title = body.title?.trim();
    if (body.title !== undefined && !title) return c.json({ error: "title required" }, 400);
    const links = await resolveRequirementPhaseIds(store, body.linkedPhaseIds ?? existing.linkedPhaseIds);
    if ("error" in links) return c.json({ error: links.error }, 400);
    const inputs = macroTaskInputs(body.macroTasks ?? existing.macroTasks);
    if (!inputs) return c.json({ error: "macroTasks must be an array" }, 400);
    const now = nowISO();
    let macroTasks;
    try {
      macroTasks = reconcileRequirementMacroTasks(existing.macroTasks, inputs, now);
    } catch (error) {
      const message = error instanceof RequirementMacroTaskError ? error.message : "Invalid macro tasks.";
      return c.json({ error: message }, 400);
    }
    const requirement = await store.updateRequirement(id, (current) => ({
      ...current,
      ...(title !== undefined ? { title } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() } : {}),
      ...(body.macroTasks !== undefined ? { macroTasks } : {}),
      ...(body.linkedPhaseIds !== undefined ? { linkedPhaseIds: links.linkedPhaseIds } : {}),
      updatedAt: now,
    }), body.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: body.expectedUpdatedAt } : {});
    await store.writeGenerated();
    hub()?.broadcast({ type: "requirements-updated", data: { action: "updated", id, requirement } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json(requirement);
  }));

  app.delete(route("/requirements/:id"), async (c) => {
    const id = c.req.param("id");
    let found = false;
    const reqs = await store.updateRequirements((doc) => {
      const next = doc.requirements.filter((requirement) => requirement.id !== id);
      found = next.length !== doc.requirements.length;
      return found ? { requirements: next } : doc;
    });
    if (!found) return c.json({ error: "not found" }, 404);
    await store.writeGenerated();
    hub()?.broadcast({ type: "requirements-updated", data: reqs });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json({ deleted: id });
  });

  // ── Ideas Inbox ──────────────────────────────────────────────────
  app.get(route("/ideas"), async (c) => c.json(await store.loadIdeas()));

  app.post(route("/ideas"), async (c) => {
    const body = await c.req.json<{ title?: string; description?: string }>();
    const title = body.title?.trim();
    if (!title) return c.json({ error: "title required" }, 400);
    const idea = await store.createIdea({ title, ...(body.description !== undefined ? { description: body.description.trim() } : {}) });
    await store.writeGenerated();
    hub()?.broadcast({ type: "file-changed", data: { filename: "ideas.json" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json(idea, 201);
  });

  app.put(route("/ideas/:id"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const body = await c.req.json<{ title?: string; description?: string }>();
    const mutableFields = ["title", "description"];
    if (!hasDefinedField(body, mutableFields)) return c.json(noMutableFieldsResponse(mutableFields), 400);
    const title = body.title?.trim();
    if (body.title !== undefined && !title) return c.json({ error: "title required", updated: false }, 400);
    const current = (await store.loadIdeas()).ideas.find((idea) => idea.id === id);
    if (!current) return c.json({ error: "not found" }, 404);
    const idea = await store.updateIdea(id, { ...(title !== undefined ? { title } : {}), ...(body.description !== undefined ? { description: body.description.trim() } : {}) });
    await store.writeGenerated();
    hub()?.broadcast({ type: "file-changed", data: { filename: "ideas.json" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json(idea);
  });

  app.delete(route("/ideas/:id"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const current = (await store.loadIdeas()).ideas.find((idea) => idea.id === id);
    if (!current) return c.json({ error: "not found" }, 404);
    await store.deleteIdea(id);
    await store.writeGenerated();
    hub()?.broadcast({ type: "file-changed", data: { filename: "ideas.json" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json({ deleted: id });
  });

  // ── Hierarchical description freshness ──────────────────────────
  app.get(route("/description-freshness"), async (c) => c.json(await store.previewDescriptionReconciliation()));

// ── Planner Markdown docs (path-safe viewer/editor) ─────────────
// Reads/writes are restricted to <planRoot>/docs/*.md. Traversal and
// symlink escapes are rejected. The Web UI opens viewer links in a new
// tab; saves require explicit confirmed=true. Editor baseline is a
// dependency-free textarea plus existing Markdown preview (no external
// editor dependency; see docs decision in T385: @uiw/react-md-editor
// and CodeMirror 6 were evaluated and rejected to avoid bundle cost).
function resolvePlannerDocPath(planRoot: string, rawPath: string): string {
  const normalized = rawPath.trim().replace(/\\/g, "/");
  if (!/^\.planner\/docs\/.+\.md$/i.test(normalized) || normalized.includes("/../")) {
    throw new Error(`Document path must be a Markdown file under .planner/docs/: ${rawPath}`);
  }
  const docsRoot = resolve(planRoot, "docs");
  const target = resolve(planRoot, normalized.slice(".planner/".length));
  if (!target.startsWith(`${docsRoot}${sep}`)) {
    throw new Error(`Document escapes .planner/docs/: ${normalized}`);
  }
  return target;
}

app.get(route("/docs/view"), async (c) => {
  const rawPath = c.req.query("path") ?? "";
  let target: string;
  try {
    target = resolvePlannerDocPath(store.root, rawPath);
  } catch (error) {
    return c.json({ error: (error as Error).message, path: rawPath }, 400);
  }
  const fileStat = await lstat(target).catch(() => null);
  if (!fileStat || fileStat.isSymbolicLink() || !fileStat.isFile()) {
    return c.json({ error: "Document must be a regular file under .planner/docs/ (symlinks rejected).", path: rawPath }, 404);
  }
  const content = await readFile(target, "utf8").catch(() => null);
  if (content === null) return c.json({ error: "Document not found.", path: rawPath }, 404);
  return c.json({ path: rawPath, content });
});

app.put(route("/docs/save"), async (c) => {
  const body = await c.req.json<{ path?: string; content?: string; confirmed?: boolean }>().catch(() => ({ path: "", content: "", confirmed: false }));
  const rawPath = typeof body.path === "string" ? body.path : "";
  if (body.confirmed !== true) {
    return c.json({ error: "Saving a planner document requires explicit confirmed=true.", path: rawPath, confirmRequired: true, saved: false }, 400);
  }
  let target: string;
  try {
    target = resolvePlannerDocPath(store.root, rawPath);
  } catch (error) {
    return c.json({ error: (error as Error).message, path: rawPath }, 400);
  }
  const fileStat = await lstat(target).catch(() => null);
  if (fileStat && (fileStat.isSymbolicLink() || !fileStat.isFile())) {
    return c.json({ error: "Document must be a regular file under .planner/docs/ (symlinks rejected).", path: rawPath }, 400);
  }
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) return c.json({ error: "Document content must be non-empty Markdown.", path: rawPath }, 400);
  const { mkdir: mkdirDoc } = await import("node:fs/promises");
  await mkdirDoc(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return c.json({ path: rawPath, saved: true });
});

  // ── Features ─────────────────────────────────────────────────────
  app.get(route("/features"), async (c) => c.json((await store.loadFeatures()).features));

  app.post(route("/features"), async (c) => store.runBatch(async () => {
    const body = await c.req.json<{ name?: string; description?: string }>();
    const name = body.name?.trim();
    if (!name) return c.json({ error: "name required" }, 400);

    const features = await store.loadFeatures();
    const id = createFeatureId();
    const identity = await store.allocateEntityIdentity("feature", id);
    const priority = await store.nextPriority("feature");
    const now = nowISO();
    const feature: Feature = {
      id,
      number: identity.number,
      shortId: identity.shortId,
      priority,
      name,
      description: body.description ?? "",
      descriptionUpdatedAt: now,
      status: "planned",
      discussedAt: "",
      contextReady: false,
      contextReadyReason: "",
      startDate: "",
      endDate: "",
      workDone: "",
      workRemaining: "",
      acceptedDecisions: [],
      phaseIds: [], dependsOn: [],
      statusLog: [],
      sessionInfo: [],
      createdAt: now,
      updatedAt: now,
    };

    features.features.push(feature);
    await store.updateFeatures((doc) => { doc.features.push(feature); return doc; });
    await store.writeGenerated();
    hub()?.broadcast({ type: "features-updated", data: { action: "created", id: feature.id, featureId: feature.id } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.syncStatuses();
    await store.appendActivity("feature_created", feature.id, `Feature created: ${feature.name}`);
    return c.json(feature, 201);
  }));

  app.get(route("/features/:id"), async (c) => {
    const id = c.req.param("id");
    const features = await store.loadFeatures();
    const feature = features.features.find((f) => f.id === id);
    if (!feature) return c.json({ error: "not found" }, 404);
    return c.json(feature);
  });

  app.put(route("/features/:id"), async (c) => store.runBatch(async () => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const body = await c.req.json<Partial<Feature> & { expectedUpdatedAt?: string }>();
    if (body.id !== undefined && body.id !== id) return c.json({ error: "id mismatch" }, 400);
    const name = body.name?.trim();
    if (body.name !== undefined && !name) return c.json({ error: "name required" }, 400);

    const existing = (await store.loadFeatures()).features.find((feature) => feature.id === id);
    if (!existing) return c.json({ error: "not found" }, 404);
    if (body.status !== undefined && body.status !== existing.status) return c.json({ updated: false, errorCode: "DERIVED_STATUS_READ_ONLY", message: "Feature status is derived from child phases and tasks and cannot be updated directly." }, 400);
    if (body.acceptedDecisions !== undefined && JSON.stringify(body.acceptedDecisions) !== JSON.stringify(existing.acceptedDecisions)) return c.json({ updated: false, errorCode: "ACCEPTED_DECISION_SEMANTIC_MUTATION_REQUIRED", message: "Raw acceptedDecisions replacement is disabled. Use the accepted-decisions semantic create, update, or delete endpoints so IDs and acceptedAt are preserved." }, 400);
    const mutableFields = ["name", "description", "descriptionRef", "discussedAt", "contextReady", "contextReadyReason", "startDate", "endDate", "workDone", "workRemaining", "priority", "dependsOn"];
    if (!hasDefinedField(body, mutableFields)) return c.json(noMutableFieldsResponse(mutableFields), 400);
    const timestamp = nowISO();
    const persisted = await store.updateFeature(id, (current) => ({
      ...current,
      ...(name !== undefined ? { name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.descriptionRef !== undefined ? { descriptionRef: body.descriptionRef.trim() || undefined } : {}),
      ...(body.discussedAt !== undefined ? { discussedAt: body.discussedAt } : {}),
      ...(body.contextReady !== undefined ? { contextReady: body.contextReady } : {}),
      ...(body.contextReadyReason !== undefined ? { contextReadyReason: body.contextReadyReason } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
      ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
      ...(body.workDone !== undefined ? { workDone: body.workDone } : {}),
      ...(body.workRemaining !== undefined ? { workRemaining: body.workRemaining } : {}),
      ...(body.dependsOn !== undefined ? { dependsOn: body.dependsOn } : {}),
      updatedAt: timestamp,
    }), body.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: body.expectedUpdatedAt } : {});
    await store.writeGenerated();
    hub()?.broadcast({ type: "features-updated", data: { action: "updated", id, featureId: id } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.syncStatuses();
    return c.json((await store.loadFeatures()).features.find((feature) => feature.id === persisted.id) ?? persisted);
  }));

  app.delete(route("/features/:id"), async (c) => {
    const id = c.req.param("id");
    await store.updateFeatures((doc) => {
      doc.features = doc.features.filter((f) => f.id !== id);
      return doc;
    });
    await store.writeGenerated();
    hub()?.broadcast({ type: "features-updated", data: { action: "deleted", id, featureId: id } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.syncStatuses();
    return c.json({ deleted: id });
  });

  // ── Phases ───────────────────────────────────────────────────────
  app.get(route("/phases"), async (c) => {
    const allPhases = await store.loadAllPhasesWithRequirements();
    const featureId = c.req.query("featureId");
    if (featureId) return c.json(allPhases.filter((p) => p.featureId === featureId));
    return c.json(allPhases);
  });

  app.post(route("/phases"), async (c) => {
    const body = await c.req.json<Partial<Phase> & { title?: string; summary?: string; description?: string }>();

    // Backward-compatible: accept a full Phase object, or generate one from title.
    if (body.id && body.slug && body.number && body.tasks && body.taskIds) {
      const full = body as Phase;
      if (requiresGovernance(full.status) && !fromWebUi(c) && !phaseGovernanceReady(full)) {
        return c.json({ error: "phase governance required: discuss the phase first, or set contextReady=true with a reason before starting work." }, 400);
      }
      let alreadyExists = false;
      await store.runBatch(async () => {
        alreadyExists = Boolean(await store.loadPhase(full.id).catch(() => null));
        if (alreadyExists) return;
        await store.savePhase(full);
        if (full.featureId) {
          await store.updateFeatures((document) => {
            const feature = document.features.find((entry) => entry.id === full.featureId);
            if (feature && !feature.phaseIds.includes(full.id)) feature.phaseIds.push(full.id);
            return document;
          });
        }
        await store.writeGenerated();
      });
      if (alreadyExists) {
        return c.json({ error: "phase already exists; use PUT with expectedUpdatedAt for updates" }, 409);
      }
      hub()?.broadcast({ type: "phases-updated", data: { action: "created", id: full.id, phaseId: full.id, featureId: full.featureId ?? "" } });
      hub()?.broadcast({ type: "plan-rendered", data: {} });
      return c.json(await store.loadPhaseWithRequirements(full.id), 201);
    }

    const title = body.title?.trim();
    if (!title) return c.json({ error: "title required" }, 400);
    const featureId = body.featureId?.trim();
    if (!featureId) return c.json({ error: "featureId required: a phase must belong to a feature" }, 400);

    let phase: Phase | undefined;
    await store.runBatch(() => withFeatureLock(featureId, async () => {
      const allPhases = await store.loadAllPhases();
      const slug = normalizeSlug(title);
      const id = createPhaseId();
      const identity = await store.allocateEntityIdentity("phase", id);
      const priority = await store.nextPriority("phase", featureId);
      const now = nowISO();
      phase = {
        id,
        featureId,
        number: identity.number,
        shortId: identity.shortId,
        priority,
        slug,
        title,
        status: "draft",
        discussedAt: "",
        contextReady: false,
        contextReadyReason: "",
        summary: body.summary ?? "",
        description: body.description ?? "",
        descriptionUpdatedAt: now,
        notes: "",
        goals: [],
        nonGoals: [],
        dependencies: [],
        risks: [],
        openQuestions: [],
        completionCriteria: [],
        decisions: [],
        acceptedDecisions: [],
        taskIds: [],
        tasks: [],
        dependsOn: [],
        createdAt: now,
        updatedAt: now,
        handoff: "",
        handoffUpdatedAt: "",
        handoffAudit: null,
        handoffReadAt: "",
          handoffHistory: [],
          statusLog: [],
          sessionInfo: [],
      };

      await store.savePhase(phase);

      // Link to feature if featureId provided
      if (body.featureId) {
        await store.updateFeatures((features) => {
          const feature = features.features.find((f) => f.id === body.featureId);
          if (feature && !feature.phaseIds.includes(phase!.id)) {
            feature.phaseIds.push(phase!.id);
          }
          return features;
        });
        hub()?.broadcast({ type: "features-updated", data: { action: "updated", id: body.featureId, featureId: body.featureId } });
      }

      await store.writeGenerated();
    }));

    if (!phase) return c.json({ error: "phase creation failed" }, 500);
    hub()?.broadcast({ type: "phases-updated", data: { action: "created", id: phase.id, phaseId: phase.id, featureId: phase.featureId ?? "" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.syncStatuses();
    return c.json(phase, 201);
  });

  app.get(route("/phases/:id"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    try {
      return c.json(await store.loadPhaseWithRequirements(id));
    } catch {
      return c.json({ error: "phase not found" }, 404);
    }
  });

  app.put(route("/phases/:id"), async (c) => store.runBatch(async () => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const body = await c.req.json<Partial<Phase> & { expectedUpdatedAt?: string }>();
    if (body.id !== undefined && body.id !== id) return c.json({ error: "id mismatch" }, 400);
    const title = body.title?.trim();
    if (body.title !== undefined && !title) return c.json({ error: "title required" }, 400);
    const existingPhase = await store.loadPhase(id).catch(() => null);
    if (!existingPhase) return c.json({ error: "phase not found" }, 404);
    if (body.status !== undefined && body.status !== existingPhase.status) return c.json({ updated: false, errorCode: "DERIVED_STATUS_READ_ONLY", message: "Phase status is derived from child tasks and cannot be updated directly." }, 400);
    if (body.acceptedDecisions !== undefined && JSON.stringify(body.acceptedDecisions) !== JSON.stringify(existingPhase.acceptedDecisions)) return c.json({ updated: false, errorCode: "ACCEPTED_DECISION_SEMANTIC_MUTATION_REQUIRED", message: "Raw acceptedDecisions replacement is disabled. Use the accepted-decisions semantic create, update, or delete endpoints so IDs and acceptedAt are preserved." }, 400);
    let nextFeatureId = existingPhase.featureId;
    if (body.featureId !== undefined) {
      nextFeatureId = body.featureId.trim() || undefined;
      if (nextFeatureId && !(await store.loadFeatures()).features.some((feature) => feature.id === nextFeatureId)) {
        return c.json({ updated: false, errorCode: "FEATURE_NOT_FOUND", message: `Feature not found: ${body.featureId}` }, 404);
      }
    }
    const mutableFields = ["title", "summary", "description", "descriptionRef", "featureId", "priority", "goals", "nonGoals", "dependencies", "risks", "openQuestions", "decisions", "completionCriteria", "notes", "discussedAt", "contextReady", "contextReadyReason"];
    if (!hasDefinedField(body, mutableFields)) return c.json(noMutableFieldsResponse(mutableFields), 400);
    const timestamp = nowISO();
    const persisted = await store.updatePhase(id, (current) => ({
      ...current,
      ...(title !== undefined ? { title } : {}),
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.featureId !== undefined ? { featureId: nextFeatureId } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.discussedAt !== undefined ? { discussedAt: body.discussedAt } : {}),
      ...(body.contextReady !== undefined ? { contextReady: body.contextReady } : {}),
      ...(body.contextReadyReason !== undefined ? { contextReadyReason: body.contextReadyReason } : {}),
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.descriptionRef !== undefined ? { descriptionRef: body.descriptionRef.trim() || undefined } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.goals !== undefined ? { goals: body.goals } : {}),
      ...(body.nonGoals !== undefined ? { nonGoals: body.nonGoals } : {}),
      ...(body.dependencies !== undefined ? { dependencies: body.dependencies } : {}),
      ...(body.dependsOn !== undefined ? { dependsOn: body.dependsOn } : {}),
      ...(body.risks !== undefined ? { risks: body.risks } : {}),
      ...(body.openQuestions !== undefined ? { openQuestions: body.openQuestions } : {}),
      ...(body.decisions !== undefined ? { decisions: body.decisions } : {}),
      ...(body.completionCriteria !== undefined ? { completionCriteria: body.completionCriteria } : {}),
      updatedAt: timestamp,
    }), body.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: body.expectedUpdatedAt } : {});
    const targetFeatureId = body.featureId !== undefined ? nextFeatureId : undefined;
    if (body.featureId !== undefined && targetFeatureId !== existingPhase.featureId) {
      await store.updateFeatures((document) => {
        for (const feature of document.features) {
          feature.phaseIds = feature.id === targetFeatureId
            ? [...new Set([...feature.phaseIds, id])]
            : feature.phaseIds.filter((phaseId) => phaseId !== id);
        }
        return document;
      });
    }
    await store.writeGenerated();
    hub()?.broadcast({ type: "phases-updated", data: { action: "updated", id, phaseId: id, featureId: persisted.featureId ?? "" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });

    await store.syncStatuses();
    await store.appendActivity("phase_updated", id, `Phase updated: ${persisted.title} (${persisted.status})`);

    return c.json(await store.loadPhaseWithRequirements(id));
  }));


  app.delete(route("/phases/:id"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const existing = await store.loadPhase(id).catch(() => null);
    if (!existing) return c.json({ error: "phase not found" }, 404);
    await store.runBatch(async () => {
      await store.deletePhase(id);
      if (existing.featureId) {
        await store.updateFeatures((features) => {
          const feature = features.features.find((f) => f.id === existing.featureId);
          if (feature) feature.phaseIds = feature.phaseIds.filter((pid) => pid !== id);
          return features;
        });
      }
      await store.writeGenerated();
    });
    hub()?.broadcast({ type: "phases-updated", data: { action: "deleted", id, phaseId: id, featureId: existing.featureId ?? "" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.syncStatuses();
    await store.appendActivity("phase_deleted", id ?? "", `Phase deleted: ${id}`);
    return c.json({ deleted: id });
  });

  app.post(route("/phases/:phaseId/tasks"), async (c) => store.runBatch(async () => {
    const phaseId = c.req.param("phaseId");
    if (!phaseId) return c.json({ error: "phaseId required" }, 400);
    const body = await c.req.json<{ title?: string; description?: string; status?: Task["status"]; checklist?: string[] }>();
    const title = body.title?.trim();
    if (!title) return c.json({ error: "title required" }, 400);
    if ((body.status as string | undefined) === "paused") return c.json({ error: "A task cannot be created paused without an in-progress checkpoint. Create it planned, then use task_pause/task_switch." }, 400);

    const phase = await store.loadPhase(phaseId).catch(() => null);
    if (!phase) return c.json({ error: "phase not found" }, 404);
    if (requiresGovernance(body.status) && phase.featureId && !fromWebUi(c)) {
      const features = await store.loadFeatures();
      const feature = features.features.find((entry) => entry.id === phase.featureId);
      if (feature && !featureGovernanceReady(feature)) {
        return c.json({ error: "feature governance required before starting task work: discuss the feature first, or set contextReady=true with a reason." }, 400);
      }
    }
    const now = nowISO();
    const shortName = normalizeSlug(title).trim() || `task-${Date.now().toString(36)}`;
    const initialStatus = body.status ?? "planned";
    const taskId = createTaskId();
    const identity = await store.allocateEntityIdentity("task", taskId);
    const priority = await store.nextPriority("task", phase.id);
    const checklistItems = (body.checklist ?? []).map((s) => s.trim()).filter((s) => s.length > 0)
      .map((item, index) => ({ id: createChecklistItemId(taskId, index + 1, item), number: index + 1, title: item, checked: false }));
    const task: Task = {
      id: taskId,
      phaseId: phase.id,
      number: identity.number,
      shortId: identity.shortId,
      priority,
      shortName,
      title,
      status: initialStatus,
      description: body.description ?? "",
      descriptionUpdatedAt: now,
      notes: "",
      statusLog: [],
      sessionInfo: [],
      decisions: [],
      acceptedDecisions: [],
      checklist: checklistItems,
      subtasks: [],
      dependsOn: [],
      pauseSnapshot: null,
      pauseHistory: [],
      activeOwnerSession: "",
      startedAt: initialStatus === "in-progress" || initialStatus === "done" ? now : "",
      completedAt: initialStatus === "done" ? now : "",
      createdAt: now,
      updatedAt: now,
    };

    // Atomic: serialize concurrent task-create on the same phase file.
    await store.updatePhase(phase.id, (p) => {
      p.tasks.push(task);
      p.taskIds.push(task.id);
      p.updatedAt = now;
      return p;
    });
    await store.writeGenerated();
    await store.syncTaskStatusRollup(phase.id);
    hub()?.broadcast({ type: "phases-updated", data: { action: "task-created", id: phase.id, phaseId: phase.id, featureId: phase.featureId ?? "", taskId: task.id } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.appendActivity("task_created", task.id, `Task created: ${task.title} (phase ${phaseId})`);
    // Build a human-readable composite label so agents echo this instead of the UUID.
    const featuresDoc = await store.loadFeatures();
    const featureNum = phase.featureId ? (featuresDoc.features.find((f) => f.id === phase.featureId)?.number ?? 0) : 0;
    const seq = (n: number) => String(n && n > 0 ? n : 0).padStart(3, "0");
    const label = `T${seq(task.number)}(P${seq(phase.number)}/F${seq(featureNum)}) - ${task.title}`;
    return c.json({ ...task, label }, 201);
  }));

  // ── Tasks ─────────────────────────────────────────────────────────
  app.get(route("/tasks/active"), async (c) => {
    const [phases, featuresDoc] = await Promise.all([store.loadAllPhases(), store.loadFeatures()]);
    // Build lookups for IDs and numbers
    const phaseToFeature = new Map<string, string>();
    const featureIdToNum = new Map<string, number>();
    for (const feature of featuresDoc.features) {
      featureIdToNum.set(feature.id, feature.number);
      for (const phaseId of feature.phaseIds) {
        if (!phaseToFeature.has(phaseId)) phaseToFeature.set(phaseId, feature.id);
      }
    }
    const activeTasksMap = new Map<string, { id: string; number: number; shortId?: string; title: string; phaseId: string; phaseNumber: number; featureId: string; featureNumber: number; status: string }>();
    for (const phase of phases) {
      for (const task of phase.tasks) {
        if (task.status === "in-progress") {
          const featureId = phase.featureId ?? phaseToFeature.get(phase.id);
          if (!featureId) continue; // Skip tasks without a valid feature link to avoid 404s
          activeTasksMap.set(task.id, {
            id: task.id,
            number: task.number,
            shortId: task.shortId,
            title: task.title,
            phaseId: phase.id,
            phaseNumber: phase.number,
            featureId,
            featureNumber: featureIdToNum.get(featureId) ?? 0,
            status: task.status,
          });
        }
      }
    }
    return c.json(Array.from(activeTasksMap.values()));
  });

  app.get(route("/tasks/focus"), async (c) => {
    const [phases, featuresDoc, project, resume] = await Promise.all([
      store.loadAllPhases(), store.loadFeatures(), store.loadProject(), store.loadResume(),
    ]);
    const featureIdToNum = new Map(featuresDoc.features.map((feature) => [feature.id, feature.number]));
    const openReturn = [...project.workDeviations]
      .filter((deviation) => deviation.state === "resume-required" || deviation.state === "resolved")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const pendingByTask = new Map<string, (typeof openReturn)[number]>();
    for (const deviation of openReturn) {
      if (!pendingByTask.has(deviation.resumeTaskId)) pendingByTask.set(deviation.resumeTaskId, deviation);
    }
    const pendingOrder = new Map(openReturn.map((deviation, index) => [deviation.id, index]));
    type FocusSummary = {
      id: string; number: number; shortId: string; title: string; phaseId: string; phaseNumber: number;
      featureId: string; featureNumber: number; status: Task["status"];
      pauseSnapshot: Task["pauseSnapshot"]; pendingResume: boolean; deviationId: string;
    };
    const summarizeFocusTask = (candidate: NonNullable<ReturnType<typeof recommendNextWork>["selection"]["candidate"]>, deviation?: ReturnType<typeof recommendNextWork>["selection"]["deviation"]): FocusSummary => ({
      id: candidate.task.id,
      number: candidate.task.number,
      shortId: candidate.task.shortId,
      title: candidate.task.title,
      phaseId: candidate.phase.id,
      phaseNumber: candidate.phase.number,
      featureId: candidate.feature?.id ?? "",
      featureNumber: candidate.feature?.number ?? 0,
      status: candidate.task.status,
      pauseSnapshot: candidate.task.pauseSnapshot ?? deviation?.snapshot ?? null,
      pendingResume: Boolean(candidate.task.pauseSnapshot ?? deviation),
      deviationId: deviation?.id ?? "",
    });
    const active: FocusSummary[] = [];
    const pendingResume: FocusSummary[] = [];
    for (const phase of phases) {
      if (!phase.featureId) continue;
      for (const task of phase.tasks) {
        if (task.status === "done" || task.status === "canceled" || task.status === "rejected") continue;
        const deviation = pendingByTask.get(task.id);
        const snapshot = task.pauseSnapshot ?? deviation?.snapshot ?? null;
        if (task.status !== "in-progress" && !snapshot && !deviation) continue;
        const summary: FocusSummary = {
          id: task.id,
          number: task.number,
          shortId: task.shortId,
          title: task.title,
          phaseId: phase.id,
          phaseNumber: phase.number,
          featureId: phase.featureId,
          featureNumber: featureIdToNum.get(phase.featureId) ?? 0,
          status: task.status,
          pauseSnapshot: snapshot,
          pendingResume: Boolean(snapshot || deviation),
          deviationId: deviation?.id ?? "",
        };
        if (task.status === "in-progress") active.push(summary);
        if (snapshot || deviation) pendingResume.push(summary);
      }
    }
    pendingResume.sort((left, right) => {
      const leftOrder = left.deviationId ? (pendingOrder.get(left.deviationId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      const rightOrder = right.deviationId ? (pendingOrder.get(right.deviationId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return (right.pauseSnapshot?.pausedAt ?? "").localeCompare(left.pauseSnapshot?.pausedAt ?? "");
    });
    const recommendation = recommendNextWork(featuresDoc.features, phases, project.workDeviations, resume?.currentPhaseId);
    const nextWork = recommendation.selection.candidate ? summarizeFocusTask(recommendation.selection.candidate, recommendation.selection.deviation) : null;
    return c.json({ active, pendingResume, nextWork, nextWorkReason: recommendation.selection.reason });
  });

  /** Canonical HTTP task-entry path. Generic task updates must never start work,
   * because start/resume is responsible for clearing checkpoints and closing
   * any matching return-stack deviation. */
  app.post(route("/tasks/:id/start"), async (c) => store.runBatch(async () => {
    const taskId = c.req.param("id");
    const [phases, featuresDoc, project] = await Promise.all([
      store.loadAllPhases(), store.loadFeatures(), store.loadProject(),
    ]);
    const phase = phases.find((entry) => entry.tasks.some((task) => task.id === taskId));
    const existing = phase?.tasks.find((task) => task.id === taskId);
    if (!phase || !existing) return c.json({ error: "task not found" }, 404);
    if (existing.status === "in-progress") return c.json({ error: "task is already in-progress" }, 400);

    const eligibility = checkExplicitTaskStart(featuresDoc.features, phases, existing.id, project.workDeviations);
    if (!eligibility.eligible) return c.json({ error: `Task start denied: ${eligibility.reason}` }, 400);
    const selection = recommendNextTask(featuresDoc.features, phases, project.workDeviations);
    if (selection.kind === "conflict") return c.json({ error: selection.reason }, 409);
    if (selection.kind === "active" && selection.candidate?.task.id !== existing.id) {
      return c.json({ error: `Task start denied: another task is active. Use task_switch to checkpoint it before starting this task.` }, 409);
    }

    const now = nowISO();
    let updated: Task | undefined;
    if (existing.pauseSnapshot) {
      updated = await store.resumeTask(phase.id, existing.id, now);
    } else {
      await store.updatePhase(phase.id, (current) => {
        const task = current.tasks.find((entry) => entry.id === existing.id);
        if (!task) return current;
        const previousStatus = task.status;
        applyTaskLifecycleDates(task, "in-progress", now);
        task.statusLog = [...(task.statusLog ?? []), {
          id: createTaskId(),
          date: now,
          fromStatus: previousStatus,
          toStatus: "in-progress",
          title: `${previousStatus} → in-progress`,
          description: "",
        }];
        task.updatedAt = now;
        current.updatedAt = now;
        updated = task;
        return current;
      });
    }

    const approvedDeviation = project.workDeviations.find((deviation) =>
      deviation.temporaryTaskId === existing.id && deviation.state === "approved",
    );
    if (approvedDeviation) await store.setWorkDeviationState(approvedDeviation.id, "active", now);
    const resumedDeviation = project.workDeviations
      .filter((deviation) => deviation.resumeTaskId === existing.id
        && (deviation.state === "resume-required" || deviation.state === "resolved"))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (resumedDeviation) await store.setWorkDeviationState(resumedDeviation.id, "resumed", now);

    await store.syncTaskStatusRollup(phase.id);
    await store.writeGenerated();
    hub()?.broadcast({ type: "phases-updated", data: { action: "task-started", id: phase.id, phaseId: phase.id, featureId: phase.featureId ?? "", taskId } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.appendActivity("task_status", existing.id, `Task ${existing.id} → in-progress`);
    return c.json(updated ?? existing);
  }));

  app.post(route("/tasks/:id/reopen"), async (c) => store.runBatch(async () => {
    const taskId = c.req.param("id") ?? "";
    const body: { confirmed?: boolean } = await c.req.json<{ confirmed?: boolean }>().catch(() => ({}));
    const phase = (await store.loadAllPhases()).find((entry) => entry.tasks.some((task) => task.id === taskId));
    if (!phase) return c.json({ reopened: false, errorCode: "TASK_NOT_FOUND" }, 404);
    if (body.confirmed !== true) return c.json({ reopened: false, errorCode: "TASK_REOPEN_CONFIRMATION_REQUIRED", message: "Explicit confirmation is required to reopen a completed task." }, 400);
    try {
      const task = await store.reopenTask(phase.id, taskId, { confirmed: true });
      await store.syncTaskStatusRollup(phase.id);
      await store.writeGenerated();
      hub()?.broadcast({ type: "phases-updated", data: { action: "task-reopened", id: phase.id, phaseId: phase.id, featureId: phase.featureId ?? "", taskId } });
      hub()?.broadcast({ type: "plan-rendered", data: {} });
      await store.appendActivity("task_status", taskId, `Task ${taskId} reopened`);
      return c.json({ reopened: true, task });
    } catch (error) {
      const details = error instanceof PlanStoreError ? error.details : undefined;
      return c.json({ reopened: false, errorCode: details?.errorCode ?? "TASK_REOPEN_FAILED", message: error instanceof Error ? error.message : "Task reopen failed." }, 409);
    }
  }));

  app.post(route("/tasks/:id/dependencies"), async (c) => store.runBatch(async () => {
    const taskId = c.req.param("id") ?? ""; const body = await c.req.json<{ phaseId?: string; dependsOnId?: string }>();
    if (!body.phaseId || !body.dependsOnId) return c.json({ updated: false, errorCode: "DEPENDENCY_INPUT_REQUIRED" }, 400);
    try { const result = await store.addTaskDependency(body.phaseId, taskId, body.dependsOnId); await store.writeGenerated(); return c.json({ updated: true, task: result }); }
    catch (error) { const details = error instanceof PlanStoreError ? error.details as { errorCode?: string } | undefined : undefined; return c.json({ updated: false, errorCode: details?.errorCode ?? "DEPENDENCY_UPDATE_FAILED", message: error instanceof Error ? error.message : "Dependency update failed." }, 400); }
  }));

  app.delete(route("/tasks/:id/dependencies/:dependencyId"), async (c) => store.runBatch(async () => {
    const taskId = c.req.param("id") ?? ""; const dependencyId = c.req.param("dependencyId") ?? ""; const body = await c.req.json<{ phaseId?: string; confirmed?: boolean }>().catch(() => ({} as { phaseId?: string; confirmed?: boolean }));
    if (!body.phaseId || body.confirmed !== true) return c.json({ updated: false, errorCode: "CONFIRMATION_REQUIRED" }, 400);
    try { const result = await store.deleteTaskDependency(body.phaseId, taskId, dependencyId); await store.writeGenerated(); return c.json({ updated: true, task: result }); }
    catch (error) { const details = error instanceof PlanStoreError ? error.details as { errorCode?: string } | undefined : undefined; return c.json({ updated: false, errorCode: details?.errorCode ?? "DEPENDENCY_DELETE_FAILED", message: error instanceof Error ? error.message : "Dependency deletion failed." }, 400); }
  }));

  app.get(route("/tasks/:id"), async (c) => {
    const taskId = c.req.param("id");
    const phases = await store.loadAllPhases();
    for (const phase of phases) {
      const task = phase.tasks.find((t) => t.id === taskId);
      if (task) return c.json(task);
    }
    return c.json({ error: "task not found" }, 404);
  });

  app.post(route("/tasks/:id/subtasks"), async (c) => store.runBatch(async () => {
    const taskId = c.req.param("id") ?? "";
    const body = await c.req.json<{ phaseId?: string; title?: string; description?: string; status?: Subtask["status"] }>();
    if (!body.phaseId) return c.json({ errorCode: "PHASE_ID_REQUIRED", created: false }, 400);
    const task = (await store.loadPhase(body.phaseId).catch(() => null))?.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return c.json({ errorCode: "TASK_NOT_FOUND", created: false }, 404);
    try {
      const subtask = await store.createSubtask(body.phaseId, taskId, { title: body.title ?? "", ...(body.description !== undefined ? { description: body.description } : {}), ...(body.status !== undefined ? { status: body.status } : {}) });
      await store.writeGenerated();
      return c.json({ created: true, subtask, task: (await store.loadPhase(body.phaseId)).tasks.find((candidate) => candidate.id === taskId) }, 201);
    } catch (error) {
      const details = error instanceof PlanStoreError ? error.details as { errorCode?: string } | undefined : undefined;
      return c.json({ created: false, errorCode: details?.errorCode ?? "SUBTASK_CREATE_FAILED", message: error instanceof Error ? error.message : "Subtask creation failed." }, 400);
    }
  }));

  app.put(route("/tasks/:id/subtasks/:subtaskId"), async (c) => store.runBatch(async () => {
    const taskId = c.req.param("id") ?? ""; const subtaskId = c.req.param("subtaskId") ?? "";
    const body = await c.req.json<{ phaseId?: string; title?: string; description?: string; status?: Subtask["status"] }>();
    if (!body.phaseId) return c.json({ errorCode: "PHASE_ID_REQUIRED", updated: false }, 400);
    try {
      const subtask = await store.updateSubtask(body.phaseId, taskId, subtaskId, { ...(body.title !== undefined ? { title: body.title } : {}), ...(body.description !== undefined ? { description: body.description } : {}), ...(body.status !== undefined ? { status: body.status } : {}) });
      await store.writeGenerated(); return c.json({ updated: true, subtask });
    } catch (error) {
      const details = error instanceof PlanStoreError ? error.details as { errorCode?: string } | undefined : undefined;
      return c.json({ updated: false, errorCode: details?.errorCode ?? "SUBTASK_UPDATE_FAILED", message: error instanceof Error ? error.message : "Subtask update failed." }, 400);
    }
  }));

  app.delete(route("/tasks/:id/subtasks/:subtaskId"), async (c) => store.runBatch(async () => {
    const taskId = c.req.param("id") ?? ""; const subtaskId = c.req.param("subtaskId") ?? ""; const body = await c.req.json<{ phaseId?: string; confirmed?: boolean }>().catch(() => ({} as { phaseId?: string; confirmed?: boolean }));
    if (!body.phaseId || body.confirmed !== true) return c.json({ deleted: false, errorCode: body.confirmed === true ? "PHASE_ID_REQUIRED" : "CONFIRMATION_REQUIRED" }, 400);
    try { await store.deleteSubtask(body.phaseId, taskId, subtaskId); await store.writeGenerated(); return c.json({ deleted: true, subtaskId }); }
    catch (error) { const details = error instanceof PlanStoreError ? error.details as { errorCode?: string } | undefined : undefined; return c.json({ deleted: false, errorCode: details?.errorCode ?? "SUBTASK_DELETE_FAILED", message: error instanceof Error ? error.message : "Subtask deletion failed." }, 400); }
  }));

  app.put(route("/tasks/:id/subtasks/order"), async (c) => store.runBatch(async () => {
    const taskId = c.req.param("id") ?? ""; const body = await c.req.json<{ phaseId?: string; orderedIds?: string[] }>();
    if (!body.phaseId || !Array.isArray(body.orderedIds)) return c.json({ updated: false, errorCode: "SUBTASK_ORDER_INVALID" }, 400);
    try { const subtasks = await store.reorderSubtasks(body.phaseId, taskId, body.orderedIds); await store.writeGenerated(); return c.json({ updated: true, subtasks }); }
    catch (error) { const details = error instanceof PlanStoreError ? error.details as { errorCode?: string } | undefined : undefined; return c.json({ updated: false, errorCode: details?.errorCode ?? "SUBTASK_ORDER_INVALID", message: error instanceof Error ? error.message : "Subtask reorder failed." }, 400); }
  }));

  app.put(route("/tasks/:id"), async (c) => store.runBatch(async () => {
    const taskId = c.req.param("id");
    const body = await c.req.json<{ phaseId: string; motivation?: string; expectedUpdatedAt?: string } & Partial<Task>>();
    if (!body.phaseId) return c.json({ error: "phaseId required" }, 400);

    const phase = await store.loadPhase(body.phaseId).catch(() => null);
    if (!phase) return c.json({ error: "phase not found" }, 404);
    const existing = phase.tasks.find((task) => task.id === taskId);
    if (!existing) return c.json({ error: "task not found" }, 404);
    if (body.acceptedDecisions !== undefined && JSON.stringify(body.acceptedDecisions) !== JSON.stringify(existing.acceptedDecisions)) return c.json({ updated: false, errorCode: "ACCEPTED_DECISION_SEMANTIC_MUTATION_REQUIRED", message: "Raw acceptedDecisions replacement is disabled. Use the accepted-decisions semantic create, update, or delete endpoints so IDs and acceptedAt are preserved." }, 400);
    const mutableFields = ["title", "description", "descriptionRef", "status", "notes", "decisions", "priority", "checklist", "subtasks"];
    if (!hasDefinedField(body, mutableFields)) return c.json(noMutableFieldsResponse(mutableFields), 400);

    if (body.status && body.status !== existing.status && (body.status === "in-progress" || (body.status as string) === "paused" || (existing.status as string) === "paused")) {
      return c.json({ error: "Task start/resume transitions require POST /tasks/:id/start so lifecycle state, checkpoints, and return stacks remain consistent." }, 400);
    }

    if (body.status && body.status !== existing.status && needsMotivation(existing.status, body.status) && !fromWebUi(c)) {
      if (!body.motivation || !body.motivation.trim()) {
        return c.json({ error: `Status transition "${existing.status} → ${body.status}" requires a motivation. Provide the "motivation" field with a detailed explanation.` }, 400);
      }
    }

    if (entersGovernedState(existing.status, body.status) && phase.featureId && !fromWebUi(c)) {
      const features = await store.loadFeatures();
      const feature = features.features.find((entry) => entry.id === phase.featureId);
      if (feature && !featureGovernanceReady(feature)) {
        return c.json({ error: "feature governance required before starting task work: discuss the feature first, or set contextReady=true with a reason." }, 400);
      }
    }

    if (body.subtasks !== undefined) {
      const existingSubtaskIds = new Set(existing.subtasks.map((subtask) => subtask.id));
      if (body.subtasks.some((subtask) => subtask.id !== undefined && !existingSubtaskIds.has(subtask.id))) return c.json({ updated: false, errorCode: "SUBTASK_ID_INVALID", message: "Subtask IDs must belong to the target task." }, 400);
    }
    const now = nowISO();
    const expectedUpdatedAt = body.expectedUpdatedAt ?? body.updatedAt;
    const result = await store.updateTask(phase.id, existing.id, (current) => {
      const previousStatus = current.status;
      const next: Task = {
        ...current,
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.descriptionRef !== undefined ? { descriptionRef: body.descriptionRef.trim() || undefined } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.decisions !== undefined ? { decisions: body.decisions } : {}),
        ...(body.checklist !== undefined ? { checklist: body.checklist } : {}),
        ...(body.subtasks !== undefined ? { subtasks: body.subtasks.map((subtask) => ({ ...subtask, id: subtask.id || randomUUID(), title: subtask.title.trim(), description: subtask.description ?? "", status: subtask.status ?? "planned", createdAt: subtask.createdAt || now, updatedAt: now })) } : {}),
        updatedAt: now,
      };
      if (body.status !== undefined) applyTaskLifecycleDates(next, body.status, now);
      if (body.status !== undefined && body.status !== previousStatus) {
        const entry: StatusLogEntry = {
          id: createTaskId(),
          date: now,
          fromStatus: previousStatus,
          toStatus: body.status,
          title: body.motivation?.split("\n")[0]?.trim() || `${previousStatus} → ${body.status}`,
          description: body.motivation?.trim() || "",
        };
        next.statusLog = [...current.statusLog, entry];
      }
      return next;
    }, expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {});
    await store.writeGenerated();
    await store.syncTaskStatusRollup(phase.id);
    hub()?.broadcast({ type: "phases-updated", data: { action: "task-updated", id: phase.id, phaseId: phase.id, featureId: phase.featureId ?? "", taskId } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });

    if (body.status && body.status !== existing.status) {
      await store.appendActivity("task_status", taskId ?? "", `Task ${taskId} → ${body.status}`);
    } else {
      await store.appendActivity("task_updated", taskId ?? "", `Task updated: ${result.task.title}`);
    }

    return c.json((await store.loadPhase(phase.id)).tasks.find((task) => task.id === taskId) ?? result.task);
  }));


  app.delete(route("/tasks/:id"), async (c) => {
    const taskId = c.req.param("id");
    const phases = await store.loadAllPhases();
    const hostPhase = phases.find((entry) => entry.tasks.some((task) => task.id === taskId));
    if (!hostPhase) return c.json({ error: "task not found" }, 404);
    const existingTask = hostPhase.tasks.find((task) => task.id === taskId);

    await store.updatePhase(hostPhase.id, (p) => {
      p.tasks = p.tasks.filter((task) => task.id !== taskId);
      p.taskIds = p.taskIds.filter((id) => id !== taskId);
      p.updatedAt = nowISO();
      return p;
    });
    await store.writeGenerated();
    hub()?.broadcast({ type: "phases-updated", data: { action: "task-deleted", id: hostPhase.id, phaseId: hostPhase.id, featureId: hostPhase.featureId ?? "", taskId: existingTask?.id ?? taskId } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.syncStatuses();
    await store.appendActivity("task_deleted", taskId ?? "", `Task deleted: ${taskId}`);
    return c.json({ deleted: taskId });
  });

  // ── Integrity / Repair ────────────────────────────────────────
  app.get(route("/integrity"), async (c) => {
    const integrity = await store.validateIntegrity();
    return c.json(integrity);
  });

  app.post(route("/repair"), async (c) => {
    const report = await store.repair();
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    hub()?.broadcast({ type: "features-updated", data: { action: "repaired" } });
    hub()?.broadcast({ type: "phases-updated", data: { action: "repaired" } });
    return c.json(report);
  });

  // ── Reorder (priority) ───────────────────────────────────────────
  app.post(route("/reorder"), async (c) => {
    // Midpoint-insert reorder: only the moved item's priority changes (when
    // the gap between its new neighbours allows it). When the gap is exhausted
    // (≤1, e.g. all-zero defaults or tight spacing), the segment is reindexed
    // with GAP. Keeps priority as int (no schema migration) and minimises the
    // set of changed items per drag.
    const body = await c.req.json<{ kind: "feature" | "phase" | "task"; movedId: string; beforeId: string | null; afterId: string | null }>();
    const { kind, movedId, beforeId, afterId } = body;
    if (!movedId) return c.json({ error: "movedId required" }, 400);
    const GAP = 10;

    // Reindex a list in-place: reconstruct the desired order (moved removed +
    // reinserted between beforeId and afterId) then assign (i+1)*GAP.
    const reindexList = (all: { id: string; priority: number; number: number }[]) => {
      const sorted = [...all].sort((a, b) => a.priority - b.priority || a.number - b.number);
      const moved = sorted.find((x) => x.id === movedId);
      const withoutMoved = sorted.filter((x) => x.id !== movedId);
      let insertIdx: number;
      if (beforeId) {
        const bi = withoutMoved.findIndex((x) => x.id === beforeId);
        insertIdx = bi === -1 ? withoutMoved.length : bi + 1;
      } else {
        insertIdx = 0;
      }
      if (moved) withoutMoved.splice(insertIdx, 0, moved);
      withoutMoved.forEach((item, i) => { item.priority = (i + 1) * GAP; });
    };

    if (kind === "feature") {
      // Priority-only: suspend status rollup so reordering never flips a
      // partially-done feature to in-progress (priority ≠ status).
      await store.runBatch(async () => {
        await store.updateFeatures((doc) => {
          const moved = doc.features.find((x) => x.id === movedId);
          if (!moved) return doc;
          const before = beforeId ? doc.features.find((x) => x.id === beforeId) : null;
          const after = afterId ? doc.features.find((x) => x.id === afterId) : null;
          const beforeP = before ? before.priority : 0;
          const maxP = doc.features.reduce((m, f) => Math.max(m, f.priority), 0);
          const afterP = after ? after.priority : (maxP + GAP);
          if (afterP - beforeP > 1) {
            moved.priority = Math.floor((beforeP + afterP) / 2);
          } else {
            reindexList(doc.features);
          }
          doc.features.sort((a, b) => a.priority - b.priority || a.number - b.number);
          return doc;
        });
      });
      hub()?.broadcast({ type: "features-updated", data: { action: "reordered" } });
    } else if (kind === "phase") {
      const phases = await store.loadAllPhases();
      const moved = phases.find((p) => p.id === movedId);
      if (!moved) return c.json({ error: "moved phase not found" }, 404);
      const siblings = phases.filter((p) => p.featureId === moved.featureId);
      const before = beforeId ? siblings.find((p) => p.id === beforeId) : null;
      const after = afterId ? siblings.find((p) => p.id === afterId) : null;
      const beforeP = before ? before.priority : 0;
      const maxP = siblings.reduce((m, p) => Math.max(m, p.priority), 0);
      const afterP = after ? after.priority : (maxP + GAP);
      await store.runBatch(async () => {
        if (afterP - beforeP > 1) {
          await store.updatePhase(movedId, (entry) => { entry.priority = Math.floor((beforeP + afterP) / 2); return entry; });
        } else {
          // Reindex all siblings (each phase is a separate file)
          const sorted = [...siblings].sort((a, b) => a.priority - b.priority || a.number - b.number);
          const withoutMoved = sorted.filter((x) => x.id !== movedId);
          let insertIdx: number;
          if (beforeId) {
            const bi = withoutMoved.findIndex((x) => x.id === beforeId);
            insertIdx = bi === -1 ? withoutMoved.length : bi + 1;
          } else {
            insertIdx = 0;
          }
          const movedEntry = sorted.find((x) => x.id === movedId);
          if (movedEntry) withoutMoved.splice(insertIdx, 0, movedEntry);
          for (const [i, p] of withoutMoved.entries()) {
            await store.updatePhase(p.id, (entry) => { entry.priority = (i + 1) * GAP; return entry; });
          }
        }
      });
      hub()?.broadcast({ type: "phases-updated", data: { action: "reordered" } });
    } else if (kind === "task") {
      const allPhases = await store.loadAllPhases();
      const host = allPhases.find((p) => p.tasks.some((t) => t.id === movedId));
      if (host) {
        await store.runBatch(async () => {
          await store.updatePhase(host.id, (phase) => {
            const moved = phase.tasks.find((x) => x.id === movedId);
            if (!moved) return phase;
            const before = beforeId ? phase.tasks.find((x) => x.id === beforeId) : null;
            const after = afterId ? phase.tasks.find((x) => x.id === afterId) : null;
            const beforeP = before ? before.priority : 0;
            const maxP = phase.tasks.reduce((m, t) => Math.max(m, t.priority), 0);
            const afterP = after ? after.priority : (maxP + GAP);
            if (afterP - beforeP > 1) {
              moved.priority = Math.floor((beforeP + afterP) / 2);
            } else {
              reindexList(phase.tasks);
            }
            phase.tasks.sort((a, b) => a.priority - b.priority || a.number - b.number);
            phase.taskIds = phase.tasks.map((t) => t.id);
            return phase;
          });
        });
        hub()?.broadcast({ type: "phases-updated", data: { action: "reordered", phaseId: host.id, featureId: host.featureId } });
      }
    } else {
      return c.json({ error: "invalid kind" }, 400);
    }
    await store.writeGenerated();
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json({ ok: true, kind, movedId });
  });

  // ── Render ───────────────────────────────────────────────────────
  app.post(route("/render"), async (c) => {
    const files = await store.writeGenerated();
    hub()?.broadcast({ type: "plan-rendered", data: { files } });
    return c.json({ files });
  });

  // ── Handoff (entity-scoped, phase.handoff) ────────────────────
  app.get(route("/handoffs"), async (c) => {
    // The browser renders expanded bodies; agent list tools use the compact
    // default and never transport all handoff content at once.
    const list = await store.listHandoffs({ includeContent: true });
    return c.json({ handoffs: list });
  });

  app.get(route("/handoffs/archive"), async (c) => {
    const archived = await store.listArchivedHandoffs();
    return c.json({ archived });
  });

  app.get(route("/phases/:id/handoff/preflight"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const phase = await store.loadPhase(id).catch(() => null);
    if (!phase) return c.json({ error: "phase not found" }, 404);
    const audit = await store.preparePhaseHandoff(id);
    return c.json({
      handoffUpdatedAt: audit.handoffUpdatedAt,
      targetContentChars: audit.targetContentChars,
      maxContentChars: audit.maxContentChars,
      canonicalSections: audit.canonicalSections,
      requiredHumanInputs: audit.requiredHumanInputs,
      generatedMetadata: ["Created at", "Updated at", "Reason"],
      draftTemplate: audit.draftTemplate,
    });
  });

  app.get(route("/phases/:id/handoff"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const phase = await store.loadPhase(id).catch(() => null);
    if (!phase) return c.json({ error: "phase not found" }, 404);
    const content = await store.getPhaseHandoff(id);
    return c.json({ content, updatedAt: phase.handoffUpdatedAt ?? "" });
  });

  app.put(route("/phases/:id/handoff"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const phase = await store.loadPhase(id).catch(() => null);
    if (!phase) return c.json({ error: "phase not found" }, 404);
    const body = await c.req.json<{ content: string }>().catch(() => ({ content: "" }));
    const content = (body?.content ?? "").trim();
    if (!content) {
      // empty PUT = clear equivalent
      await store.clearPhaseHandoff(id);
      hub()?.broadcast({ type: "handoffCleared", data: { phaseId: id } });
      hub()?.broadcast({ type: "phases-updated", data: { action: "updated", id, phaseId: id, featureId: phase.featureId ?? "" } });
      hub()?.broadcast({ type: "plan-rendered", data: {} });
      return c.json({ cleared: true });
    }
    await store.setPhaseHandoff(id, content);
    hub()?.broadcast({ type: "handoffUpdated", data: { phaseId: id } });
    hub()?.broadcast({ type: "phases-updated", data: { action: "updated", id, phaseId: id, featureId: phase.featureId ?? "" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json({ content, updatedAt: (await store.loadPhase(id)).handoffUpdatedAt ?? "" });
  });

  app.delete(route("/phases/:id/handoff"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const phase = await store.loadPhase(id).catch(() => null);
    if (!phase) return c.json({ error: "phase not found" }, 404);
    await store.clearPhaseHandoff(id);
    hub()?.broadcast({ type: "handoffCleared", data: { phaseId: id } });
    hub()?.broadcast({ type: "phases-updated", data: { action: "updated", id, phaseId: id, featureId: phase.featureId ?? "" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json({ cleared: true });
  });

  // ── Health ───────────────────────────────────────────────────────
  app.get(route("/health"), (c) => c.json({ status: "ok", root: store.root }));
  app.get(route("/ui-config"), (c) => c.json(uiConfig ?? {}));

  return app;
}

// ─── Serve static files (SPA) ────────────────────────────────────────────

function createSpaApp(store: PlanStore, hubRef: { current: WsHub | null }, staticDir?: string, uiConfig?: UiConfig, isBusy?: () => boolean) {
  const app = createApiApp(store, hubRef, staticDir ? "/api" : "", uiConfig, isBusy);

  if (!staticDir) {
    return app;
  }

  // Serve the built React app for all unmatched GET routes
  app.all("*", async (c) => {
    if (c.req.method !== "GET") return c.json({ error: "not found" }, 404);

    // Try exact file first
    const filePath = join(staticDir, c.req.path === "/" ? "index.html" : c.req.path.slice(1));
    try {
      const content = readFileSync(filePath);
      const ext = filePath.split(".").pop() ?? "";
      const mime: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        png: "image/png",
        svg: "image/svg+xml",
        json: "application/json",
      };
      return new Response(content, { status: 200, headers: { "Content-Type": mime[ext] ?? "application/octet-stream" } });
    } catch {
      // SPA fallback: serve index.html for any unmatched path
      try {
        const indexContent = readFileSync(join(staticDir, "index.html"));
        return new Response(indexContent, { status: 200, headers: { "Content-Type": "text/html" } });
      } catch {
        return c.json({ error: "not found" }, 404);
      }
    }
  });

  return app;
}

// ─── Serve ──────────────────────────────────────────────────────────────

/** Resolve the web UI bundle shipped alongside this package (../web-ui-dist
 * relative to dist/serve.js). Returns undefined when not bundled (dev/API-only).
 * Callers can pass staticDir: "" to force API-only even when the bundle exists.
 *
 * In a monorepo dev checkout both the vendored snapshot (web-ui-dist) and the
 * freshly built packages/plan-web-ui/dist may exist; prefer the most recently
 * built one so a fresh `pnpm build:web-ui` (or copy-web-ui.sh) takes effect
 * instead of a stale vendored bundle. Deterministic: compare index.html mtimes. */
function resolveBundledStaticDir(): string | undefined {
  try {
    const base = dirname(fileURLToPath(import.meta.url));
    const vendored = join(base, "..", "web-ui-dist");
    const devUi = join(base, "..", "..", "plan-web-ui", "dist");
    const candidates = [vendored, devUi].filter((d) => {
      try {
        return existsSync(join(d, "index.html"));
      } catch {
        return false;
      }
    });
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    const mtime = (d: string): number => {
      try {
        return statSync(join(d, "index.html")).mtimeMs;
      } catch {
        return 0;
      }
    };
    return [...candidates].sort((a, b) => mtime(b) - mtime(a))[0];
  } catch {
    return undefined;
  }
}

export interface ServeOptions {
  port?: number;
  planRoot: string;
  host?: string | undefined;
  staticDir?: string | undefined;
  quiet?: boolean;
  uiConfig?: UiConfig | undefined;
  isBusy?: (() => boolean) | undefined;
}

export interface ServeHandle {
  url: string;
  localUrl: string;
  lanUrl?: string | undefined;
  mode: "local" | "lan";
  bindHost: string;
  hub: WsHub;
  close: () => Promise<void>;
}

export async function serve(options: ServeOptions): Promise<ServeHandle> {
  const { port = 3030, planRoot, host = "127.0.0.1" } = options;

  const store = new PlanStore(planRoot);
  const runtimeUiConfig: UiConfig = { ...(options.uiConfig ?? {}) };

  if (!(await store.exists())) {
    throw new Error(`.planner/ not found at: ${planRoot}. Run plan-init first.`);
  }

  // Startup is deliberately read-only: automatic migration/backfill would
  // rewrite canonical entities outside the feature currently being worked on.

  // Shared mutable reference — routes see the hub after it's created
  const hubRef: { current: WsHub | null } = { current: null };
  // Default to the bundled web UI when the caller doesn't pass staticDir. Pass
  // an empty string ("") to force API-only even when the bundle is present.
  const staticDir = options.staticDir ?? resolveBundledStaticDir();
  const app = createSpaApp(store, hubRef, staticDir, runtimeUiConfig, options.isBusy);

  return new Promise((resolve, reject) => {
    // Create the Node HTTP server without listening yet
    const server = createAdaptorServer({ fetch: app.fetch, hostname: host });

    // Attach WebSocket hub to the underlying HTTP server
    const hub = new WsHub(server as unknown as http.Server, options.quiet, (err) => reject(err));
    hubRef.current = hub; // Now routes can use it

    // Critical: if listen() fails (e.g. EADDRINUSE), Node emits an 'error' event.
    // Without a listener this becomes an uncaughtException that crashes Pi.
    // Reject the promise so callers' .catch() can handle it.
    server.on("error", (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    server.listen(port, host, () => {
      // When port=0 (random), resolve the actually assigned port from the server address.
      const actualPort = (() => {
        try {
          const addr = server.address();
          if (addr && typeof addr === "object" && addr.port) return addr.port;
        } catch {}
        return port;
      })();
      const serverUrls = buildServerUrls(actualPort, host);
      runtimeUiConfig.server = { ...serverUrls, port: actualPort };
      const { localUrl, lanUrl } = serverUrls;
      if (!options.quiet) {
        console.log(`[plan-server] listening at ${localUrl}`);
        console.log(`[plan-server] ws endpoint: ws://127.0.0.1:${actualPort}/ws`);
        if (lanUrl) console.log(`[plan-server] lan url: ${lanUrl}`);
      }

      startWatcher(planRoot, hubRef);

      resolve({
        url: localUrl,
        localUrl,
        lanUrl,
        mode: serverUrls.mode,
        bindHost: serverUrls.bindHost,
        hub,
        close: async () => {
          stopWatcher();
          hub.close();
          // Force-close any lingering sockets (browser WebSocket / keep-alive),
          // otherwise server.close() hangs until the kernel times them out.
          const anyServer = server as unknown as {
            closeAllConnections?: () => void;
            close: (cb?: (err?: Error) => void) => void;
          };
          anyServer.closeAllConnections?.();
          await new Promise<void>((r) => anyServer.close(() => r()));
        },
      });
    });
  });
}
