import { watch, existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { createAdaptorServer } from "@hono/node-server";
import type http from "node:http";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ExportService, PlanStore, PlanStoreError, createFeatureId, createPhaseId, createShortId, createTaskId, normalizeSlug, withFeatureLock, needsMotivation } from "@agent-plan/core";
import type { Feature, Phase, Project, Requirement, Task, StatusLogEntry } from "@agent-plan/core/schema";
import { WsHub } from "./ws-hub.js";

// ─── Watcher ────────────────────────────────────────────────────────────

let watcherAbort: AbortController | null = null;
let watcherHubRef: { current: WsHub | null } = { current: null };

function nowISO(): string {
  return new Date().toISOString();
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
    const plan = await store.loadAll();
    const markdown = exportService.exportToMarkdown(plan, full);

    // Save to disk
    await writeFile(join(store.root, "EXPORT.md"), markdown, "utf-8");

    return c.json({ markdown, filePath: "EXPORT.md" });
  });

  app.get(route("/project"), async (c) => {
    const project = await store.loadProject();
    return c.json({
      ...project,
      planRoot: store.root,
      projectRoot: dirname(store.root),
    });
  });

  app.put(route("/project"), async (c) => {
    const body = await c.req.json<Project>();
    await store.updateProject(() => body);
    await store.writeGenerated();
    hub()?.broadcast({ type: "project-updated", data: body });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json(body);
  });

  // ── Requirements ─────────────────────────────────────────────────
  app.get(route("/requirements"), async (c) => c.json(await store.loadRequirements()));

  app.post(route("/requirements"), async (c) => {
    const body = await c.req.json<Requirement>();
    const reqs = await store.updateRequirements((doc) => { doc.requirements.push(body); return doc; });
    await store.writeGenerated();
    hub()?.broadcast({ type: "requirements-updated", data: reqs });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json(body, 201);
  });

  app.put(route("/requirements/:id"), async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<Requirement>();
    let found = false;
    const reqs = await store.updateRequirements((doc) => {
      const idx = doc.requirements.findIndex((r) => r.id === id);
      if (idx === -1) return doc;
      doc.requirements[idx] = body;
      found = true;
      return doc;
    });
    if (!found) return c.json({ error: "not found" }, 404);
    await store.writeGenerated();
    hub()?.broadcast({ type: "requirements-updated", data: reqs });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json(body);
  });

  // ── Features ─────────────────────────────────────────────────────
  app.get(route("/features"), async (c) => c.json((await store.loadFeatures()).features));

  app.post(route("/features"), async (c) => {
    const body = await c.req.json<{ name?: string; description?: string }>();
    const name = body.name?.trim();
    if (!name) return c.json({ error: "name required" }, 400);

    const features = await store.loadFeatures();
    const number = features.features.length + 1;
    const shortId = createShortId(await store.assignedShortIds());
    const priority = await store.nextPriority("feature");
    const now = nowISO();
    const feature: Feature = {
      id: createFeatureId(),
      number,
      shortId,
      priority,
      name,
      description: body.description ?? "",
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
  });

  app.get(route("/features/:id"), async (c) => {
    const id = c.req.param("id");
    const features = await store.loadFeatures();
    const feature = features.features.find((f) => f.id === id);
    if (!feature) return c.json({ error: "not found" }, 404);
    return c.json(feature);
  });

  app.put(route("/features/:id"), async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<Feature>();
    if (body.id !== id) return c.json({ error: "id mismatch" }, 400);

    const features = await store.loadFeatures();
    const idx = features.features.findIndex((f) => f.id === id);
    if (idx === -1) return c.json({ error: "not found" }, 404);

    if (entersGovernedState(features.features[idx]?.status, body.status) && !featureGovernanceReady(body)) {
      return c.json({ error: "feature governance required: discuss the feature first, or set contextReady=true with a reason before starting work." }, 400);
    }

    await store.updateFeatures((doc) => {
      const i = doc.features.findIndex((f) => f.id === id);
      if (i !== -1) doc.features[i] = body;
      return doc;
    });
    await store.writeGenerated();
    hub()?.broadcast({ type: "features-updated", data: { action: "updated", id, featureId: id } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.syncStatuses();
    return c.json(body);
  });

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
    const allPhases = await store.loadAllPhases();
    const featureId = c.req.query("featureId");
    if (featureId) return c.json(allPhases.filter((p) => p.featureId === featureId));
    return c.json(allPhases);
  });

  app.post(route("/phases"), async (c) => {
    const body = await c.req.json<Partial<Phase> & { title?: string; summary?: string; description?: string }>();

    // Backward-compatible: accept a full Phase object, or generate one from title.
    if (body.id && body.slug && body.number && body.tasks && body.taskIds) {
      const full = body as Phase;
      if (requiresGovernance(full.status) && !phaseGovernanceReady(full)) {
        return c.json({ error: "phase governance required: discuss the phase first, or set contextReady=true with a reason before starting work." }, 400);
      }
      await store.updatePhase(full.id, () => full);
      await store.writeGenerated();
      hub()?.broadcast({ type: "phases-updated", data: { action: "created", id: full.id, phaseId: full.id, featureId: full.featureId ?? "" } });
      hub()?.broadcast({ type: "plan-rendered", data: {} });
      return c.json(full, 201);
    }

    const title = body.title?.trim();
    if (!title) return c.json({ error: "title required" }, 400);
    const featureId = body.featureId?.trim();
    if (!featureId) return c.json({ error: "featureId required: a phase must belong to a feature" }, 400);

    let phase: Phase | undefined;
    await withFeatureLock(featureId, async () => {
      const allPhases = await store.loadAllPhases();
      const number = allPhases.filter((p) => p.featureId === featureId).length + 1;
      const slug = normalizeSlug(title);
      const shortId = createShortId(await store.assignedShortIds());
      const priority = await store.nextPriority("phase", featureId);
      const now = nowISO();
      phase = {
        id: createPhaseId(),
        featureId,
        number,
        shortId,
        priority,
        slug,
        title,
        status: "draft",
        discussedAt: "",
        contextReady: false,
        contextReadyReason: "",
        summary: body.summary ?? "",
        description: body.description ?? "",
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
    });

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
      return c.json(await store.loadPhase(id));
    } catch {
      return c.json({ error: "phase not found" }, 404);
    }
  });

  app.put(route("/phases/:id"), async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<Phase>();
    if (body.id !== id) return c.json({ error: "id mismatch" }, 400);
    const existingPhase = await store.loadPhase(id).catch(() => null);
    if (!existingPhase) return c.json({ error: "phase not found" }, 404);
    if (entersGovernedState(existingPhase.status, body.status) && !phaseGovernanceReady(body)) {
      return c.json({ error: "phase governance required: discuss the phase first, or set contextReady=true with a reason before starting work." }, 400);
    }
    await store.updatePhase(id, () => body);
    await store.writeGenerated();
    hub()?.broadcast({ type: "phases-updated", data: { action: "updated", id, phaseId: id, featureId: body.featureId ?? "" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });

    // Propagate status up
    await store.syncStatuses();
    await store.appendActivity("phase_updated", id, `Phase updated: ${body.title} (${body.status})`);

    return c.json(body);
  });


  app.delete(route("/phases/:id"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const existing = await store.loadPhase(id).catch(() => null);
    if (!existing) return c.json({ error: "phase not found" }, 404);
    await store.deletePhase(id);
    if (existing.featureId) {
      await store.updateFeatures((features) => {
        const feature = features.features.find((f) => f.id === existing.featureId);
        if (feature) feature.phaseIds = feature.phaseIds.filter((pid) => pid !== id);
        return features;
      });
    }
    await store.writeGenerated();
    hub()?.broadcast({ type: "phases-updated", data: { action: "deleted", id, phaseId: id, featureId: existing.featureId ?? "" } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    await store.syncStatuses();
    await store.appendActivity("phase_deleted", id ?? "", `Phase deleted: ${id}`);
    return c.json({ deleted: id });
  });

  app.post(route("/phases/:phaseId/tasks"), async (c) => {
    const phaseId = c.req.param("phaseId");
    if (!phaseId) return c.json({ error: "phaseId required" }, 400);
    const body = await c.req.json<{ title?: string; description?: string; status?: Task["status"] }>();
    const title = body.title?.trim();
    if (!title) return c.json({ error: "title required" }, 400);

    const phase = await store.loadPhase(phaseId).catch(() => null);
    if (!phase) return c.json({ error: "phase not found" }, 404);
    if (requiresGovernance(body.status) && phase.featureId) {
      const features = await store.loadFeatures();
      const feature = features.features.find((entry) => entry.id === phase.featureId);
      if (feature && !featureGovernanceReady(feature)) {
        return c.json({ error: "feature governance required before starting task work: discuss the feature first, or set contextReady=true with a reason." }, 400);
      }
    }
    const now = nowISO();
    const taskNumber = nextTaskNumber(phase);
    const shortName = normalizeSlug(title).trim() || `task-${Date.now().toString(36)}`;
    const initialStatus = body.status ?? "planned";
    const shortId = createShortId(await store.assignedShortIds());
    const priority = await store.nextPriority("task", phase.id);
    const task: Task = {
      id: createTaskId(),
      phaseId: phase.id,
      number: taskNumber,
      shortId,
      priority,
      shortName,
      title,
      status: initialStatus,
      description: body.description ?? "",
      notes: "",
      statusLog: [],
      decisions: [],
      acceptedDecisions: [],
      checklist: [],
      subtasks: [],
      dependsOn: [],
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
  });

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
    const activeTasksMap = new Map<string, { id: string; number: number; title: string; phaseId: string; phaseNumber: number; featureId: string; featureNumber: number; status: string }>();
    for (const phase of phases) {
      for (const task of phase.tasks) {
        if (task.status === "in-progress") {
          const featureId = phase.featureId ?? phaseToFeature.get(phase.id);
          if (!featureId) continue; // Skip tasks without a valid feature link to avoid 404s
          activeTasksMap.set(task.id, {
            id: task.id,
            number: task.number,
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

  app.get(route("/tasks/:id"), async (c) => {
    const taskId = c.req.param("id");
    const phases = await store.loadAllPhases();
    for (const phase of phases) {
      const task = phase.tasks.find((t) => t.id === taskId);
      if (task) return c.json(task);
    }
    return c.json({ error: "task not found" }, 404);
  });

  app.put(route("/tasks/:id"), async (c) => {
    const taskId = c.req.param("id");
    const body = await c.req.json<{ phaseId: string; motivation?: string } & Partial<Task>>();
    if (!body.phaseId) return c.json({ error: "phaseId required" }, 400);

    const phase = await store.loadPhase(body.phaseId).catch(() => null);
    if (!phase) return c.json({ error: "phase not found" }, 404);
    const existing = phase.tasks.find((t) => t.id === taskId);
    if (!existing) return c.json({ error: "task not found" }, 404);

    // Validate motivation requirement for status transitions.
    if (body.status && body.status !== existing.status && needsMotivation(existing.status, body.status)) {
      if (!body.motivation || !body.motivation.trim()) {
        return c.json({ error: `Status transition "${existing.status} → ${body.status}" requires a motivation. Provide the "motivation" field with a detailed explanation.` }, 400);
      }
    }

    if (entersGovernedState(existing.status, body.status) && phase.featureId) {
      const features = await store.loadFeatures();
      const feature = features.features.find((entry) => entry.id === phase.featureId);
      if (feature && !featureGovernanceReady(feature)) {
        return c.json({ error: "feature governance required before starting task work: discuss the feature first, or set contextReady=true with a reason." }, 400);
      }
    }

    // NOTE: checklist completeness is advisory for the AI agent (enforced via
    // prompt rules), not a hard API gate. The web UI is for the human
    // supervisor, who may close a task regardless of checklist state.
    const now = nowISO();
    const updated: Task = {
      ...existing,
      ...body,
      id: taskId as string,
      phaseId: existing.phaseId,
      shortName: existing.shortName,
      createdAt: existing.createdAt,
      startedAt: existing.startedAt,
      completedAt: existing.completedAt,
      updatedAt: now,
    };

    if (body.status) {
      applyTaskLifecycleDates(updated, body.status, now);
    }

    // Record status change in the incremental statusLog.
    if (body.status && body.status !== existing.status) {
      const entry: StatusLogEntry = {
        id: createTaskId(),
        date: now,
        fromStatus: existing.status,
        toStatus: body.status,
        title: body.motivation?.split("\n")[0]?.trim() || `${existing.status} → ${body.status}`,
        description: body.motivation?.trim() || "",
      };
      updated.statusLog = [...(existing.statusLog ?? []), entry];
    }

    const tIdx = phase.tasks.findIndex((t) => t.id === taskId);
    phase.tasks[tIdx] = updated;
    phase.updatedAt = updated.updatedAt;
    // Atomic: serialize concurrent task updates on the same phase.
    await store.updatePhase(phase.id, (p) => {
      const i = p.tasks.findIndex((t) => t.id === taskId);
      if (i !== -1) p.tasks[i] = updated;
      p.updatedAt = updated.updatedAt;
      return p;
    });
    await store.writeGenerated();
    await store.syncTaskStatusRollup(phase.id);
    hub()?.broadcast({ type: "phases-updated", data: { action: "task-updated", id: body.phaseId, phaseId: body.phaseId, featureId: phase.featureId ?? "", taskId } });
    hub()?.broadcast({ type: "plan-rendered", data: {} });

    // Propagate status up
    if (body.status && body.status !== existing.status) {
      await store.appendActivity("task_status", taskId ?? "", `Task ${taskId} → ${body.status}`);
    } else {
      await store.appendActivity("task_updated", taskId ?? "", `Task updated: ${updated.title}`);
    }

    return c.json(updated);
  });


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
    const body = await c.req.json<{ kind: "feature" | "phase" | "task"; ids: string[] }>();
    const { kind, ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "ids required" }, 400);
    const gap = 10;
    if (kind === "feature") {
      await store.updateFeatures((doc) => {
        for (const [i, id] of ids.entries()) {
          const f = doc.features.find((x) => x.id === id);
          if (f) f.priority = (i + 1) * gap;
        }
        doc.features.sort((a, b) => a.priority - b.priority || a.number - b.number);
        return doc;
      });
      hub()?.broadcast({ type: "features-updated", data: { action: "reordered" } });
    } else if (kind === "phase") {
      const phases = await store.loadAllPhases();
      for (const [i, id] of ids.entries()) {
        if (phases.some((x) => x.id === id)) {
          await store.updatePhase(id, (entry) => { entry.priority = (i + 1) * gap; return entry; });
        }
      }
      hub()?.broadcast({ type: "phases-updated", data: { action: "reordered" } });
    } else if (kind === "task") {
      const allPhases = await store.loadAllPhases();
      const host = allPhases.find((p) => p.tasks.some((t) => ids.includes(t.id)));
      if (host) {
        await store.updatePhase(host.id, (phase) => {
          for (const [i, id] of ids.entries()) {
            const t = phase.tasks.find((x) => x.id === id);
            if (t) t.priority = (i + 1) * gap;
          }
          phase.tasks.sort((a, b) => a.priority - b.priority || a.number - b.number);
          phase.taskIds = phase.tasks.map((t) => t.id);
          return phase;
        });
        hub()?.broadcast({ type: "phases-updated", data: { action: "reordered", phaseId: host.id, featureId: host.featureId } });
      }
    } else {
      return c.json({ error: "invalid kind" }, 400);
    }
    await store.writeGenerated();
    hub()?.broadcast({ type: "plan-rendered", data: {} });
    return c.json({ ok: true, kind, count: ids.length });
  });

  // ── Render ───────────────────────────────────────────────────────
  app.post(route("/render"), async (c) => {
    const files = await store.writeGenerated();
    hub()?.broadcast({ type: "plan-rendered", data: { files } });
    return c.json({ files });
  });

  // ── Handoff (entity-scoped, phase.handoff) ────────────────────
  app.get(route("/handoffs"), async (c) => {
    const list = await store.listHandoffs();
    return c.json({ handoffs: list });
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
 * Callers can pass staticDir: "" to force API-only even when the bundle exists. */
function resolveBundledStaticDir(): string | undefined {
  try {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "web-ui-dist");
    return existsSync(join(dir, "index.html")) ? dir : undefined;
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

  // Self-heal stale/legacy persisted statuses before the UI reads them.
  await store.syncStatuses();

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
