/**
 * Read-only API v1 for programs outside Agent Plan (docs/api-v1.md).
 *
 * This is deliberately separate from the web UI's own routes in serve.ts: those
 * change whenever the UI does, these are promised not to. Every reply is built
 * from the plan-core contract mappers (never from raw stored objects) and is
 * wrapped in `{ apiVersion, data }` or `{ apiVersion, error }`.
 */

import { Hono, type Context } from "hono";
import {
  API_V1_VERSION,
  PlanStoreError,
  PlanWriterBusyError,
  apiV1Envelope,
  apiV1Error,
  buildApiV1Model,
  type ApiV1Model,
  type PlanStore,
} from "@agent-plan/core";

/** Mount point, fixed: the version is part of the URL so a future v2 can live beside it. */
export const API_V1_BASE_PATH = "/api/v1";

/** Fields dropped by `?compact=true` so long lists stay small. */
const COMPACT_FIELDS = ["description", "content", "guidelines", "decision", "rationale", "implementationNotes"] as const;

interface Identified {
  id: string;
  ref: string;
  shortId?: string;
}

async function loadModel(store: PlanStore): Promise<ApiV1Model> {
  const [project, features, phases, ideas] = await Promise.all([
    store.loadProject(),
    store.loadFeatures(),
    store.loadAllPhases(),
    store.loadIdeas(),
  ]);
  return buildApiV1Model({ project, features: features.features, phases, ideas: ideas.ideas });
}

/** `P002(F001)` -> `P002`; `P002(F001)/T005` -> `P002/T005`. */
function withoutFeature(ref: string): string {
  return ref.replace(/\(F\d+\)/i, "");
}

/** Exact lookup by id, composite ref, short id, or the ref without its feature. No fuzzy title matching: a stable API never guesses. */
function findByRef<T extends Identified>(items: readonly T[], rawRef: string): T | undefined {
  const ref = rawRef.trim().toLowerCase();
  if (!ref) return undefined;
  const isTaskSuffix = /^t\d+$/.test(ref);
  return items.find((item) => {
    const itemRef = item.ref.toLowerCase();
    return item.id.toLowerCase() === ref
      || itemRef === ref
      || withoutFeature(itemRef) === ref
      || (item.shortId ? item.shortId.toLowerCase() === ref : false)
      // A task number is unique across the project, so `T005` alone is unambiguous.
      || (isTaskSuffix && itemRef.endsWith(`/${ref}`));
  });
}

function compact<T>(view: T): T {
  const copy: Record<string, unknown> = { ...(view as Record<string, unknown>) };
  for (const field of COMPACT_FIELDS) if (field in copy) delete copy[field];
  return copy as T;
}

function maybeCompact<T>(c: Context, items: T[]): T[] {
  return c.req.query("compact") === "true" ? items.map(compact) : items;
}

/** The path after the mount point, decoded, so refs like `P002(F001)/T005` (which contain `/`) work. */
function refFromPath(c: Context, collection: string): string {
  const path = c.req.path;
  const start = path.indexOf(`${API_V1_BASE_PATH}/${collection}/`);
  const raw = start === -1 ? "" : path.slice(start + API_V1_BASE_PATH.length + collection.length + 2);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Routes are relative: mount the result at API_V1_BASE_PATH. */
export function createApiV1App(store: PlanStore, isBusy?: () => boolean): Hono {
  const app = new Hono();
  const notFound = (c: Context, what: string, ref: string) =>
    c.json(apiV1Error("NOT_FOUND", `${what} not found: ${ref}`), 404);

  app.onError((err, c) => {
    if (err instanceof PlanWriterBusyError) return c.json(apiV1Error("PLAN_BUSY", err.message), 503);
    if (err instanceof PlanStoreError || /ENOENT|read failed/i.test(err.message)) {
      return c.json(apiV1Error("NOT_FOUND", err.message), 404);
    }
    return c.json(apiV1Error("INTERNAL", err instanceof Error ? err.message : String(err)), 500);
  });

  app.use("*", async (c, next) => {
    if (c.req.method !== "GET") {
      c.header("Allow", "GET");
      return c.json(apiV1Error("METHOD_NOT_ALLOWED", "API v1 is read-only. Use GET."), 405);
    }
    // While an agent is writing .planner/ files, a read could see a half-written state.
    if (isBusy?.()) return c.json(apiV1Error("PLAN_BUSY", "Plan files are being updated. Retry shortly."), 503);
    await next();
  });

  app.get("/", (c) => c.json(apiV1Envelope({
    apiVersion: API_V1_VERSION,
    links: {
      project: `${API_V1_BASE_PATH}/project`,
      features: `${API_V1_BASE_PATH}/features`,
      phases: `${API_V1_BASE_PATH}/phases`,
      tasks: `${API_V1_BASE_PATH}/tasks`,
      decisions: `${API_V1_BASE_PATH}/decisions`,
      handoffs: `${API_V1_BASE_PATH}/handoffs`,
      ideas: `${API_V1_BASE_PATH}/ideas`,
    },
  })));

  app.get(`/project`, async (c) => c.json(apiV1Envelope((await loadModel(store)).project)));

  app.get(`/features`, async (c) => {
    const { features } = await loadModel(store);
    const status = c.req.query("status");
    return c.json(apiV1Envelope(maybeCompact(c, status ? features.filter((feature) => feature.status === status) : features)));
  });
  app.get(`/features/*`, async (c) => {
    const ref = refFromPath(c, "features");
    const feature = findByRef((await loadModel(store)).features, ref);
    return feature ? c.json(apiV1Envelope(feature)) : notFound(c, "Feature", ref);
  });

  app.get(`/phases`, async (c) => {
    const model = await loadModel(store);
    let phases = model.phases;
    const featureRef = c.req.query("feature");
    if (featureRef) {
      const feature = findByRef(model.features, featureRef);
      if (!feature) return notFound(c, "Feature", featureRef);
      phases = phases.filter((phase) => phase.featureRef === feature.ref);
    }
    const status = c.req.query("status");
    if (status) phases = phases.filter((phase) => phase.status === status);
    return c.json(apiV1Envelope(maybeCompact(c, phases)));
  });
  app.get(`/phases/*`, async (c) => {
    const ref = refFromPath(c, "phases");
    const phase = findByRef((await loadModel(store)).phases, ref);
    return phase ? c.json(apiV1Envelope(phase)) : notFound(c, "Phase", ref);
  });

  app.get(`/tasks`, async (c) => {
    const model = await loadModel(store);
    let tasks = model.tasks;
    const phaseRef = c.req.query("phase");
    if (phaseRef) {
      const phase = findByRef(model.phases, phaseRef);
      if (!phase) return notFound(c, "Phase", phaseRef);
      tasks = tasks.filter((task) => task.phaseRef === phase.ref);
    }
    const status = c.req.query("status");
    if (status) tasks = tasks.filter((task) => task.status === status);
    return c.json(apiV1Envelope(maybeCompact(c, tasks)));
  });
  app.get(`/tasks/*`, async (c) => {
    const ref = refFromPath(c, "tasks");
    const task = findByRef((await loadModel(store)).tasks, ref);
    return task ? c.json(apiV1Envelope(task)) : notFound(c, "Task", ref);
  });

  app.get(`/decisions`, async (c) => {
    const { decisions } = await loadModel(store);
    const owner = c.req.query("owner");
    const filtered = !owner
      ? decisions
      : decisions.filter((decision) => owner.toLowerCase() === "project"
        ? decision.owner.kind === "project"
        : decision.owner.ref !== null && (decision.owner.ref.toLowerCase() === owner.toLowerCase()
          || withoutFeature(decision.owner.ref).toLowerCase() === owner.toLowerCase()));
    return c.json(apiV1Envelope(maybeCompact(c, filtered)));
  });

  app.get(`/handoffs`, async (c) => {
    const { handoffs } = await loadModel(store);
    return c.json(apiV1Envelope(maybeCompact(c, handoffs)));
  });
  app.get(`/handoffs/*`, async (c) => {
    const ref = refFromPath(c, "handoffs");
    const { handoffs, phases } = await loadModel(store);
    const phase = findByRef(phases, ref);
    const handoff = phase ? handoffs.find((entry) => entry.phaseRef === phase.ref) : undefined;
    return handoff ? c.json(apiV1Envelope(handoff)) : notFound(c, "Handoff", ref);
  });

  app.get(`/ideas`, async (c) => c.json(apiV1Envelope(maybeCompact(c, (await loadModel(store)).ideas))));
  app.get(`/ideas/*`, async (c) => {
    const ref = refFromPath(c, "ideas");
    const idea = findByRef((await loadModel(store)).ideas, ref);
    return idea ? c.json(apiV1Envelope(idea)) : notFound(c, "Idea", ref);
  });

  app.all("*", (c) => c.json(apiV1Error("NOT_FOUND", `No such API v1 route: ${c.req.path}`), 404));

  return app;
}
