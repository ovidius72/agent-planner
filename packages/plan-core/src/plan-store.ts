import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import {
  CodebaseProfileSchema,
  FeatureSchema,
  type Feature,
  type FeaturesDocument,
  FeaturesDocumentSchema,
  ManifestSchema,
  type Manifest,
  PhaseSchema,
  type Phase,
  type Task,
  type PlanWorkspace,
  PlanWorkspaceSchema,
  type Project,
  ProjectSchema,
  type RequirementsDocument,
  type Requirement,
  RequirementsDocumentSchema,
  ResumeFocusSchema,
  ActivityLogSchema,
  type ActivityEntry,
  type ActivityLog,
  type CodebaseProfile,
  type ResumeFocus,
} from "./schema.js";
import { createFeatureId, createPhaseId, createRequirementId, createShortId, createStatusLogEntryId, createTaskId, formatPhaseRef, isLegacyPhaseId } from "./naming.js";
import { deriveParentDisplay, fromCanonicalStatus, type ParentDisplay, type WorkflowStatus } from "./display-status.js";

function nowISO(): string {
  return new Date().toISOString();
}

function resolveStoredFeatureId(
  features: Array<Pick<Feature, "id" | "number" | "shortId" | "name">>,
  ref?: string,
): string | undefined {
  const raw = ref?.trim();
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();

  const byId = features.find((feature) => feature.id.toLowerCase() === normalized);
  if (byId) return byId.id;

  const byNumber = normalized.match(/^f(\d+)$/)
    ? features.find((feature) => feature.number === parseInt(normalized.slice(1), 10))
    : undefined;
  if (byNumber) return byNumber.id;

  const byShortId = features.find((feature) => feature.shortId?.toLowerCase() === normalized);
  if (byShortId) return byShortId.id;

  const byExactName = features.find((feature) => feature.name.toLowerCase() === normalized);
  if (byExactName) return byExactName.id;

  return undefined;
}

export interface PlanStoreErrorDetails {
  path?: string;
  operation?: string;
  backupTried?: boolean;
  backupFailed?: boolean;
  jsonParseError?: { message: string; line?: number; column?: number };
  validationErrors?: { path: string; message: string }[];
  rawPreview?: string;
  [key: string]: unknown;
}

export class PlanStoreError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly details?: PlanStoreErrorDetails,
  ) {
    super(message);
    this.name = "PlanStoreError";
  }
}

// ── Atomic file helpers ────────────────────────────────────────────────

// Per-path write mutex: serializes concurrent writes to the SAME file so that
// parallel tool calls (feature_create/phase_create/...) don't truncate JSON.
const writeLocks = new Map<string, Promise<void>>();

// Per-feature mutex: serializes concurrent phase_create calls that target the
// same feature, so auto-numbering can read/assign the next phase number safely.
const featureLocks = new Map<string, Promise<void>>();

// Optional global hook fired around every atomic write so adapters can mark the
// plan as "busy" (e.g. to make the web server return 503 during mutations).
let writeBusyHook: ((busy: boolean) => void) | undefined;
export function setWriteBusyHook(hook: ((busy: boolean) => void) | undefined): void {
  writeBusyHook = hook;
}

// Optional global hook fired AFTER every successful atomic write, so adapters
// can broadcast a live-update event (e.g. WebSocket plan-rendered) to the web UI.
let writeNotifyHook: (() => void) | undefined;
export function setWriteNotifyHook(hook: (() => void) | undefined): void {
  writeNotifyHook = hook;
}

const CROSS_PROCESS_LOCK_STALE_MS = 30_000;
const CROSS_PROCESS_LOCK_RETRY_MS = 10;

async function acquireCrossProcessLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;

  for (;;) {
    try {
      await mkdir(lockPath);
      return async () => {
        await rm(lockPath, { recursive: true, force: true }).catch(() => {});
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== "EEXIST") throw err;

      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > CROSS_PROCESS_LOCK_STALE_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, CROSS_PROCESS_LOCK_RETRY_MS));
    }
  }
}

function withWriteLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const tail = prev.then(() => next);
  writeLocks.set(path, tail);
  return prev.then(async () => {
    const releaseCrossProcess = await acquireCrossProcessLock(path);
    try {
      return await fn();
    } finally {
      await releaseCrossProcess();
    }
  }).finally(() => {
    release();
    if (writeLocks.get(path) === tail) writeLocks.delete(path);
  });
}

export function withFeatureLock<T>(featureId: string, fn: () => Promise<T>): Promise<T> {
  const prev = featureLocks.get(featureId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const tail = prev.then(() => next);
  featureLocks.set(featureId, tail);
  return prev.then(fn).finally(() => {
    release();
    if (featureLocks.get(featureId) === tail) featureLocks.delete(featureId);
  });
}

async function atomicWriteText(path: string, raw: string): Promise<void> {
  return withWriteLock(path, async () => {
    writeBusyHook?.(true);
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    try {
      await writeFile(tmp, raw, "utf-8");
      try {
        await copyFile(path, `${path}.bak`);
      } catch {}
      await rename(tmp, path);
      writeNotifyHook?.();
    } catch (cause) {
      await unlink(tmp).catch(() => {});
      throw new PlanStoreError(`atomic write failed: ${path}`, cause);
    } finally {
      writeBusyHook?.(false);
    }
  });
}

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  return atomicWriteText(path, JSON.stringify(data, null, 2));
}

async function atomicUpdateJson<T>(path: string, schema: { parse(v: unknown): T }, updater: (data: T) => T): Promise<T> {
  // NOTE: write the file INLINE here, do NOT call atomicWriteJson/atomicWriteText,
  // because those re-acquire withWriteLock(path) — and we already hold it (below).
  // Re-entrant locking is not supported, so calling them would deadlock.
  return withWriteLock(path, async () => {
    const current = await readJson(path, schema);
    const updated = updater(current);
    const parsed = schema.parse(updated);
    writeBusyHook?.(true);
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    try {
      await writeFile(tmp, JSON.stringify(parsed, null, 2), "utf-8");
      try { await copyFile(path, `${path}.bak`); } catch {}
      await rename(tmp, path);
      writeNotifyHook?.();
    } catch (cause) {
      await unlink(tmp).catch(() => {});
      throw new PlanStoreError(`atomic write failed: ${path}`, cause);
    } finally {
      writeBusyHook?.(false);
    }
    return parsed;
  });
}

/** Summary of a phase that has a non-empty handoff, for the listHandoffs() API. */
export interface PhaseHandoffSummary {
  phaseId: string;
  /** Owning feature id (for deep-linking to the phase-detail route). */
  featureId?: string | undefined;
  /** Human-readable composite ref, e.g. `P003` or `P003(F002)`. */
  compositeRef: string;
  /** handoffUpdatedAt (falls back to phase.updatedAt if unset). */
  updatedAt: string;
  /** First non-empty line of the handoff, leading markdown headers stripped, ~80 chars. */
  firstLine: string;
  /** Full handoff content (phase.handoff) — lets the /handoff viewer render
   *  inline without a per-phase fetch. */
  content: string;
}

/** Summary of a phase file that exists on disk but no longer resolves to a
 *  valid owning feature. Missing back-links alone do NOT make a phase orphan:
 *  if `phase.featureId` still resolves to a known feature, repair can relink
 *  it. */
export interface OrphanPhaseSummary {
  phaseId: string;
  featureId?: string | undefined;
  shortId?: string | undefined;
  compositeRef: string;
  title: string;
  reason: string;
}

/** Extract the first meaningful line of a handoff: skip blank lines, strip a
 *  leading markdown header (#), trim, and truncate to ~80 chars. */
function handoffFirstLine(text: string): string {
  const line = text.trim().split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return line.replace(/^#+\s*/, "").trim().slice(0, 80);
}

export async function migrateToUuids(store: PlanStore): Promise<void> {
  // Run as a batch so internal saveFeatures/savePhase calls do not
  // re-trigger syncStatuses (O(N^2) on large planners). Idempotent: if there
  // is nothing to migrate, no writes happen at all.
  await store.runBatchForMigration(async () => {
    const workspace = await store.loadAll();
    const { features, requirements, phases } = workspace;

  const featureIdMap = new Map<string, string>();
  const phaseIdMap = new Map<string, string>();
  const taskIdMap = new Map<string, string>();
  const reqIdMap = new Map<string, string>();

  const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  // 1. Map Features
  const updatedFeatures = features.features.map((f) => {
    const newId = isUuid(f.id) ? f.id : createFeatureId();
    featureIdMap.set(f.id, newId);
    return { ...f, id: newId };
  });

  // 2. Map Requirements
  const updatedRequirements = requirements.requirements.map((r) => {
    const newId = isUuid(r.id) ? r.id : createRequirementId();
    reqIdMap.set(r.id, newId);
    return { ...r, id: newId };
  });

  // 3. Map Phases
  const updatedPhases = phases.map((p) => {
    const newId = isUuid(p.id) ? p.id : createPhaseId();
    phaseIdMap.set(p.id, newId);
    return {
      ...p,
      id: newId,
      featureId: p.featureId ? (featureIdMap.get(p.featureId) ?? p.featureId) : undefined,
    };
  });

  // 4. Map Tasks
  for (const phase of updatedPhases) {
    phase.tasks = phase.tasks.map((t) => {
      const newId = isUuid(t.id) ? t.id : createTaskId();
      taskIdMap.set(t.id, newId);
      return { ...t, id: newId, phaseId: phase.id };
    });
    // Update taskIds array to match new task IDs
    phase.taskIds = phase.tasks.map(t => t.id);
  }

  // 5. Update Feature -> Phase links
  for (const feature of updatedFeatures) {
    feature.phaseIds = feature.phaseIds.map(id => phaseIdMap.get(id) ?? id);
  }

  // 6. Update Requirement -> Phase links
  const finalRequirements = updatedRequirements.map((r) => ({
    ...r,
    linkedPhaseIds: r.linkedPhaseIds.map((id) => phaseIdMap.get(id) ?? id),
  }));

  // Save everything
  await store.saveFeatures({ features: updatedFeatures });
  await store.saveRequirements({ requirements: finalRequirements });
  for (const p of updatedPhases) {
    await store.savePhase(p);
  }
  await store.writeGenerated();
  });
}

/**
 * One-time idempotent migration to GLOBAL F/P/T numbering.
 *
 * Legacy plans assign Phase.number per-feature and Task.number per-phase, so
 * every feature has a P001 and every phase has a T001 (ambiguous in chat/handoffs).
 * This renumbers ALL features/phases/tasks by `createdAt` asc (stable tiebreak by
 * id) into a single project-wide 1..N sequence and sets the monotonic project
 * counters (nextFeatureNumber/nextPhaseNumber/nextTaskNumber).
 *
 * Idempotent: if no duplicate phase/task/feature numbers exist across the
 * project, the plan is already global → no renumber writes happen (only the
 * counters are ensured, in case project.json predates them). MUST run before
 * ensureStructureOrdering (which no longer renumbers — numbers are stable).
 */
export async function migrateToGlobalSequence(store: PlanStore): Promise<{ migrated: boolean; phases: number; tasks: number; features: number }> {
  return store.runBatchForMigration(async () => {
    const ws = await store.loadAll();
    const phases = ws.phases;
    const features = ws.features.features;
    const project = ws.project;

    const allTasks: { phase: Phase; task: Task }[] = [];
    for (const phase of phases) for (const task of phase.tasks) allTasks.push({ phase, task });

    const hasDupes = (nums: number[]) => new Set(nums).size !== nums.length;
    const phaseDupes = hasDupes(phases.map((p) => p.number));
    const taskDupes = hasDupes(allTasks.map((x) => x.task.number));
    const featureDupes = hasDupes(features.map((f) => f.number));

    const maxP = phases.reduce((m, p) => Math.max(m, p.number), 0);
    const maxT = allTasks.reduce((m, x) => Math.max(m, x.task.number), 0);
    const maxF = features.reduce((m, f) => Math.max(m, f.number), 0);

    if (!phaseDupes && !taskDupes && !featureDupes) {
      // Already global. Ensure counters are set (project.json may predate them).
      let changed = false;
      if (project.nextPhaseNumber <= maxP) { project.nextPhaseNumber = maxP + 1; changed = true; }
      if (project.nextTaskNumber <= maxT) { project.nextTaskNumber = maxT + 1; changed = true; }
      if (project.nextFeatureNumber <= maxF) { project.nextFeatureNumber = maxF + 1; changed = true; }
      if (changed) await store.saveProject(project);
      return { migrated: false, phases: phases.length, tasks: allTasks.length, features: features.length };
    }

    const renumber = <T extends { number: number; createdAt: string; id: string }>(arr: T[]): T[] =>
      arr
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map((x, i) => ({ ...x, number: i + 1 }));

    const newFeatures = renumber(features);
    const newPhases = renumber(phases);
    const numberedTasks = renumber(allTasks.map((x) => x.task));

    // Reassemble renumbered tasks into their phases, keyed by the task's OWN
    // phaseId (source of truth). NOTE: do NOT pair `numberedTasks[i]` with
    // `allTasks[i]!.phase.id` — the two arrays are in DIFFERENT orders
    // (numberedTasks is sorted by createdAt, allTasks is in phase-iteration
    // order), so a positional index would file each task under the wrong phase.
    const phaseIdByTaskId = new Map(allTasks.map((x) => [x.task.id, x.phase.id]));
    const newPhaseIds = new Set(newPhases.map((p) => p.id));
    const tasksByPhase = new Map<string, Task[]>();
    for (const t of numberedTasks) {
      // Prefer the task's own phaseId when it points to a real phase; otherwise
      // fall back to the phase the task was loaded from (handles legacy tasks
      // with empty/stale phaseId without losing them).
      const pid = (t.phaseId && newPhaseIds.has(t.phaseId)) ? t.phaseId : (phaseIdByTaskId.get(t.id) ?? "");
      const bucket = tasksByPhase.get(pid) ?? [];
      bucket.push(t);
      tasksByPhase.set(pid, bucket);
    }
    const finalPhases = newPhases.map((p) => {
      const tasks = tasksByPhase.get(p.id) ?? [];
      const order = new Map(tasks.map((t) => [t.id, t]));
      const ordered: Task[] = p.taskIds.map((id) => order.get(id)).filter((t): t is Task => Boolean(t));
      for (const t of tasks.sort((a, b) => a.number - b.number)) if (!ordered.includes(t)) ordered.push(t);
      return { ...p, tasks: ordered, taskIds: ordered.map((t) => t.id) };
    });

    await store.saveFeatures({ features: newFeatures });
    for (const p of finalPhases) await store.savePhase(p);
    project.nextFeatureNumber = newFeatures.length + 1;
    project.nextPhaseNumber = newPhases.length + 1;
    project.nextTaskNumber = numberedTasks.length + 1;
    await store.saveProject(project);
    await store.writeGenerated();
    return { migrated: true, phases: newPhases.length, tasks: numberedTasks.length, features: newFeatures.length };
  });
}

async function readJson<T>(path: string, schema: { parse(v: unknown): T }): Promise<T> {
  let backupTried = false;
  let backupFailed = false;
  let rawPreview: string | undefined;

  try {
    const raw = await readFile(path, "utf-8");
    rawPreview = raw.slice(0, 240);
    return schema.parse(JSON.parse(raw));
  } catch (cause) {
    // Try the .bak backup before giving up (recover from external-write corruption).
    backupTried = true;
    try {
      const bak = await readFile(`${path}.bak`, "utf-8");
      rawPreview = bak.slice(0, 240);
      return schema.parse(JSON.parse(bak));
    } catch {
      backupFailed = true;
      // fall through to original error
    }

    const details: PlanStoreErrorDetails = {
      path,
      operation: "readJson",
      backupTried,
      backupFailed,
    };
    if (rawPreview != null) details.rawPreview = rawPreview;

    if (cause instanceof SyntaxError) {
      const match = cause.message.match(/position\s+(\d+)/i);
      const position = match && match[1] ? Number.parseInt(match[1], 10) : undefined;
      if (rawPreview != null && position != null && position >= 0) {
        const upTo = rawPreview.slice(0, position);
        const line = upTo.split("\n").length;
        const lastNL = upTo.lastIndexOf("\n");
        const column = position - (lastNL >= 0 ? lastNL : 0);
        details.jsonParseError = { message: cause.message, line, column };
      } else {
        details.jsonParseError = { message: cause.message };
      }
    } else if (cause instanceof ZodError) {
      details.validationErrors = cause.issues.slice(0, 8).map((issue) => ({
        path: issue.path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join("."),
        message: issue.message,
      }));
    }

    throw new PlanStoreError(`read failed: ${path}`, cause, details);
  }
}


// ─── PlanStore ──────────────────────────────────────────────────────────

// Raw (on-disk) shapes: the schema-inferred objects WITHOUT the derived `status`
// field. `Phase`/`Feature` (runtime) re-add `status` (derived from children at
// read time). The schema parse strips any persisted `status`, so the file never
// stores it — status is always recomputed on load.
type RawPhase = Omit<Phase, "status">;
type RawFeature = Omit<Feature, "status">;

export class PlanStore {
  public readonly root: string;
  private autoSync = false;
  private syncGuard = false;
  // While true, maybeAutoSync() is a no-op. Used by batch operations
  // (migrateToUuids, ensureStructureOrdering, syncStatuses, repair) so that
  // their internal savePhase/saveFeatures calls do NOT re-trigger a full
  // syncStatuses on every write. Without this, a batch over N phases becomes
  // O(N^2) atomic writes (each save -> syncStatuses -> N saves), which hangs
  // Pi on planners with hundreds of phases.
  private batchInProgress = false;

  constructor(root: string) {
    this.root = root;
  }

  /** When enabled, status rollup (syncStatuses) runs automatically after every
   *  phase/feature/project save. Used by the pi-adapter so the agent's tool
   *  mutations keep phase/feature statuses derived from task statuses. */
  enableAutoSync(value: boolean): void { this.autoSync = value; }

  /** Run a batch operation with autoSync suspended. Internal saves inside the
   *  batch will NOT re-trigger syncStatuses (which would be O(N^2) on large
   *  planners). The caller is responsible for triggering any needed final
   *  sync explicitly. */
  private async runAsBatch<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.batchInProgress;
    this.batchInProgress = true;
    try {
      return await fn();
    } finally {
      this.batchInProgress = prev;
    }
  }

  /** Public batch wrapper used by the module-level migrateToUuids helper. */
  async runBatchForMigration<T>(fn: () => Promise<T>): Promise<T> {
    return this.runAsBatch(fn);
  }

  /** Public batch wrapper: suspend autoSync (status rollup) for a sequence of
   *  writes. Use for priority-only reorders so they don't recompute phase/feature
   *  status (a reorder must not flip a partially-done feature to in-progress). */
  async runBatch<T>(fn: () => Promise<T>): Promise<T> {
    return this.runAsBatch(fn);
  }

  private async maybeAutoSync(): Promise<void> {
    // No-op: status is derived on read, so there is nothing to sync after a
    // save. Kept so existing save* call sites compile unchanged.
  }

  private normalizeTasks(tasks: Task[]): { tasks: Task[]; changed: boolean } {
    // Numbers are a STABLE global sequence (assigned once at create from project.nextTaskNumber).
    // Do NOT renumber here — renumbering would break references after deletions.
    return { tasks, changed: false };
  }

  private normalizeFeaturesDocument(doc: FeaturesDocument): { doc: FeaturesDocument; changed: boolean } {
    // Numbers are a STABLE global sequence (assigned once at create from project.nextFeatureNumber).
    return { doc, changed: false };
  }

  private normalizePhaseDocument(phase: RawPhase): { phase: RawPhase; changed: boolean } {
    const { tasks, changed } = this.normalizeTasks(phase.tasks);
    const nextTaskIds = tasks.map((task) => task.id);
    const taskIdsChanged = nextTaskIds.length !== phase.taskIds.length || nextTaskIds.some((id, index) => id !== phase.taskIds[index]);
    return {
      phase: {
        ...phase,
        tasks,
        taskIds: nextTaskIds,
      },
      changed: changed || taskIdsChanged,
    };
  }

  private normalizeStructureSnapshot(featuresDoc: FeaturesDocument, phases: Phase[]): { features: FeaturesDocument; phases: Phase[]; changed: boolean } {
    let changed = false;
    const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
    const phasesByFeature = new Map<string, Phase[]>();
    const orphanPhases: Phase[] = [];

    for (const phase of phases) {
      const resolvedFeatureId = resolveStoredFeatureId(featuresDoc.features, phase.featureId);
      if (resolvedFeatureId && resolvedFeatureId !== phase.featureId) {
        phase.featureId = resolvedFeatureId;
        changed = true;
      }

      if (phase.featureId && featuresDoc.features.some((feature) => feature.id === phase.featureId)) {
        const bucket = phasesByFeature.get(phase.featureId) ?? [];
        bucket.push(phase);
        phasesByFeature.set(phase.featureId, bucket);
      } else {
        orphanPhases.push(phase);
      }
    }

    const normalizedFeatures = featuresDoc.features.map((feature) => {
      const linked = feature.phaseIds.map((id) => phaseById.get(id)).filter((phase): phase is Phase => Boolean(phase));
      const linkedIds = new Set(linked.map((phase) => phase.id));
      const inferred = (phasesByFeature.get(feature.id) ?? []).filter((phase) => !linkedIds.has(phase.id));
      const orderedPhases = [...linked, ...inferred];
      const normalizedPhaseIds = orderedPhases.map((phase) => phase.id);
      if (normalizedPhaseIds.length !== feature.phaseIds.length || normalizedPhaseIds.some((id, index) => id !== feature.phaseIds[index])) {
        changed = true;
      }

      orderedPhases.forEach((phase) => {
        const normalizedPhase = this.normalizePhaseDocument(phase);
        if (normalizedPhase.changed) {
          phase.tasks = normalizedPhase.phase.tasks;
          phase.taskIds = normalizedPhase.phase.taskIds;
          changed = true;
        }
      });

      return {
        ...feature,
        phaseIds: normalizedPhaseIds,
      };
    });

    orphanPhases.forEach((phase) => {
      const normalizedPhase = this.normalizePhaseDocument(phase);
      if (normalizedPhase.changed) {
        phase.tasks = normalizedPhase.phase.tasks;
        phase.taskIds = normalizedPhase.phase.taskIds;
        changed = true;
      }
    });

    return {
      features: { features: normalizedFeatures },
      phases,
      changed,
    };
  }

  async ensureStructureOrdering(): Promise<{ changed: boolean }> {
    const result = await this.runAsBatch(async () => {
      const featuresDoc = await this.loadFeatures();
      const phases = await this.loadAllPhases();
      const normalized = this.normalizeStructureSnapshot(featuresDoc, phases);
      if (!normalized.changed) return { changed: false };
      await this.saveFeatures(normalized.features);
      for (const phase of normalized.phases) {
        await this.savePhase(phase);
      }
      return { changed: true };
    });
    // One-time import of a legacy file-based HANDOFF.md (pre-F004) into the
    // entity-scoped phase.handoff. Idempotent — renames the file to .bak.
    await this.importLegacyHandoffFile().catch(() => {});
    return result;
  }

  /** Rebuild each phase's `tasks` + `taskIds` from the task's OWN `phaseId`
   *  (source of truth). Heals plans where tasks got filed into the wrong phase
   *  file (e.g. the migrateToGlobalSequence index-mismatch bug, @agent-plan/core
   *  <0.2.19-next.7). Deterministic, lossless, idempotent: groups every task by
   *  its phaseId, preserves each phase's existing taskIds order, appends orphan
   *  tasks (whose phaseId dangles or is empty) by number. Writes a phase file
   *  only when its task set actually changed. */
  async rebuildContainment(): Promise<{ changed: number; tasks: number; orphan: number }> {
    return this.runAsBatch(async () => {
      const phases = await this.loadAllPhases();
      const phaseById = new Map(phases.map((p) => [p.id, p]));
      const allTasks: { task: Task; fromPhaseId: string }[] = [];
      for (const p of phases) for (const t of p.tasks) allTasks.push({ task: t, fromPhaseId: p.id });
      const grouped = new Map<string, Task[]>();
      let orphan = 0;
      for (const { task, fromPhaseId } of allTasks) {
        const pid = (task.phaseId && phaseById.has(task.phaseId)) ? task.phaseId : fromPhaseId;
        if (!phaseById.has(pid)) orphan++;
        const bucket = grouped.get(pid) ?? [];
        bucket.push(task);
        grouped.set(pid, bucket);
      }
      let changed = 0;
      for (const p of phases) {
        const tasks = grouped.get(p.id) ?? [];
        const byId = new Map(tasks.map((t) => [t.id, t]));
        const ordered: Task[] = p.taskIds.map((id) => byId.get(id)).filter((t): t is Task => Boolean(t));
        for (const t of tasks.slice().sort((a, b) => a.number - b.number)) if (!ordered.some((o) => o.id === t.id)) ordered.push(t);
        const same = ordered.length === p.tasks.length && ordered.every((t, i) => t.id === p.tasks[i]?.id);
        if (same) continue;
        await this.savePhase({ ...p, tasks: ordered, taskIds: ordered.map((t) => t.id) });
        changed++;
      }
      return { changed, tasks: allTasks.length, orphan };
    });
  }

  // ── Path helpers ─────────────────────────────────────────────────────

  private manifestPath(): string {
    return join(this.root, "manifest.json");
  }
  private projectPath(): string {
    return join(this.root, "project.json");
  }
  private requirementsPath(): string {
    return join(this.root, "requirements.json");
  }
  private featuresPath(): string {
    return join(this.root, "features.json");
  }
  private featuresDir(): string {
    return join(this.root, "features");
  }
  private featurePath(featureId: string): string {
    return join(this.featuresDir(), `${featureId}.json`);
  }
  private withFeaturesLock<T>(fn: () => Promise<T>): Promise<T> {
    // Sentinel-keyed mutex (the features dir path) serializing all feature
    // mutations so read-modify-write via updateFeatures is race-free and the
    // one-time legacy→per-file migration never interleaves with a writer.
    return withWriteLock(this.featuresDir(), fn);
  }
  /** Idempotent one-time migration: if a legacy features.json exists, split it
   *  into features/<id>.json (one per feature) and remove the legacy file.
   *  Must be called under withFeaturesLock. Crash-safe: re-run overwrites. */
  private async migrateLegacy(): Promise<void> {
    let legacy: { features: RawFeature[] };
    try {
      legacy = await readJson(this.featuresPath(), FeaturesDocumentSchema);
    } catch {
      return; // no legacy features.json (already migrated or fresh project)
    }
    await mkdir(this.featuresDir(), { recursive: true });
    for (const feat of legacy.features) {
      await atomicWriteJson(this.featurePath(feat.id), feat);
    }
    await unlink(this.featuresPath()).catch(() => {});
  }
  private phasesDir(): string {
    return join(this.root, "phases");
  }
  private phasePath(phaseId: string): string {
    return join(this.phasesDir(), `${phaseId}.json`);
  }
  private generatedDir(): string {
    return join(this.root, "generated");
  }
  private codebasePath(): string {
    return join(this.root, "codebase.json");
  }
  private resumePath(): string {
    return join(this.root, "resume.json");
  }
  private activityPath(): string {
    return join(this.root, "activity.json");
  }
  // ── Init ─────────────────────────────────────────────────────────────

  async init(projectName: string): Promise<void> {
    if (await this.exists()) {
      throw new PlanStoreError(".planner/ already exists");
    }

    await mkdir(this.root, { recursive: true });
    await mkdir(this.phasesDir(), { recursive: true });
    await mkdir(this.featuresDir(), { recursive: true });
    await mkdir(join(this.generatedDir(), "phases"), { recursive: true });
    await mkdir(join(this.root, "schema"), { recursive: true });
    await mkdir(join(this.root, "adapters"), { recursive: true });

    const manifest: Manifest = {
      schemaVersion: 1,
      projectId: crypto.randomUUID(),
      projectName,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    await atomicWriteJson(this.manifestPath(), manifest);
    await this.saveProject({
      name: projectName,
      goal: "",
      description: "",
      webPort: 0,
      scope: [],
      outOfScope: [],
      decisions: [],
      globalRules: [],
      technologies: [],
      tools: [],
      contentLanguage: "",
      chatLanguage: "",
      acceptedDecisions: [],
      workflowRules: {
        beforePhaseStart: [],
        beforeTaskStart: [],
        afterPhaseComplete: [],
      },
      nextFeatureNumber: 1,
      nextPhaseNumber: 1,
      nextTaskNumber: 1,
    });
    await this.saveRequirements({ requirements: [] });
    await this.saveFeatures({ features: [] });
    await this.saveResume({
      updatedAt: nowISO(),
      currentPhaseId: "",
      inProgressTaskIds: [],
      nextSteps: ["Run /planner project discuss to bootstrap discovery"],
      nextStepsUpdatedAt: nowISO(),
      blockers: [],
      notes: "Project initialized. Awaiting discovery.",
      lastSessionSummary: "",
      guardBypassUntil: "",
    });
    await this.writeGenerated();

    // Write a README stub
    const readme = [
      "# Project Plan",
      "",
      `This is the project plan for **${projectName}** — managed by Agent Plan Platform.`,
      "",
      "## Structure",
      "",
      "- `manifest.json` — metadata",
      "- `project.json` — scope, rules, stack, tools",
      "- `requirements.json` — requirements and macro-tasks",
      "- `phases/` — one JSON file per phase",
      "- `generated/` — auto-generated markdown views",
      "- `schema/plan.schema.json` — JSON Schema for tooling",
    ].join("\n");
    await writeFile(join(this.root, "README.md"), readme, "utf-8");

    // Write a .gitignore inside .planner/ so transient/derived files are
    // not tracked by the host project's git. Git respects nested .gitignore.
    // - *.bak/*.tmp.*: crash backups from atomic writes
    // - resume.json: per-session resume focus + the machine-local guard-bypass
    //   timestamp (guardBypassUntil must NOT leak into git/other clones)
    // - generated/: auto-regenerated markdown views (derived from JSON; churn)
    await writeFile(
      join(this.root, ".gitignore"),
      [
        "# Agent Plan transient/derived files — do not track",
        "*.bak",
        "*.tmp.*",
        "resume.json",
        "resume.*.json",
        "generated/",
        "handoff-archive/",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.manifestPath());
      return true;
    } catch {
      return false;
    }
  }

  // ── Loaders ──────────────────────────────────────────────────────────

  async loadManifest(): Promise<Manifest> {
    return readJson(this.manifestPath(), ManifestSchema);
  }

  async loadProject(): Promise<Project> {
    return readJson(this.projectPath(), ProjectSchema);
  }

  /**
   * Allocate the next global sequence number for a feature/phase/task.
   * Reads the monotonic counter from project.json, increments it, persists,
   * and returns the allocated number. MUST be called within withFeatureLock
   * (adapters create entities inside a lock) so the counter is race-free.
   * The counter never reuses a number — deletions leave gaps (by design:
   * stable references survive deletion).
   */
  async allocFeatureNumber(): Promise<number> { return this.allocSeqNumber("nextFeatureNumber", "feature"); }
  async allocPhaseNumber(): Promise<number> { return this.allocSeqNumber("nextPhaseNumber", "phase"); }
  async allocTaskNumber(): Promise<number> { return this.allocSeqNumber("nextTaskNumber", "task"); }
  /** Allocate a globally-unique sequence number. `atomicUpdateJson` already
   *  serializes concurrent calls via `withWriteLock` on the project file, so
   *  the read-modify-write is race-free in-process. The collision guard
   *  additionally skips any candidate that already exists in the data (safety
   *  net for cross-process races or manual edits) and persists the corrected
   *  counter. */
  private async allocSeqNumber(
    key: "nextFeatureNumber" | "nextPhaseNumber" | "nextTaskNumber",
    kind: "feature" | "phase" | "task",
  ): Promise<number> {
    // Load already-used numbers for this kind (best-effort read; the
    // atomicUpdateJson below is the authoritative write).
    const used = new Set<number>();
    if (kind === "task") {
      const phases = await this.loadAllPhases();
      for (const p of phases) for (const t of p.tasks) used.add(t.number);
    } else if (kind === "phase") {
      const phases = await this.loadAllPhases();
      for (const p of phases) used.add(p.number);
    } else {
      const feats = await this.loadRawFeatures();
      for (const f of feats) used.add(f.number);
    }

    let allocated = 0;
    await this.updateProject((project) => {
      let candidate = project[key];
      // Collision guard: skip any candidate that already exists.
      while (used.has(candidate)) candidate++;
      allocated = candidate;
      project[key] = candidate + 1;
      return project;
    });
    return allocated;
  }



  async loadPhase(phaseId: string): Promise<Phase> {
    const raw = await readJson(this.phasePath(phaseId), PhaseSchema);
    const normalized = this.normalizePhaseDocument(raw).phase;
    return { ...normalized, status: this.derivePhaseStatus(normalized.tasks) };
  }

  /** Read raw feature files WITHOUT the derived `status` field. Used
   *  internally so loadFeatures/loadAll can derive status from phases without
   *  double-loading. */
  private async loadRawFeatures(): Promise<RawFeature[]> {
    let jsonFiles: string[] = [];
    try {
      const all = await readdir(this.featuresDir());
      jsonFiles = all.filter((f) => f.endsWith(".json"));
    } catch {
      // features/ absent → fall through to legacy single-file layout
    }
    if (jsonFiles.length > 0) {
      const out: RawFeature[] = [];
      for (const f of jsonFiles) {
        const id = f.replace(/\.json$/, "");
        try {
          out.push(await readJson(this.featurePath(id), FeatureSchema));
        } catch (err) {
          // Skip an invalid feature file rather than failing the whole load.
          console.warn(`[plan-store] skipping invalid feature file ${f}:`, err);
        }
      }
      // Deterministic order: sort by the persisted `number` (creation order)
      // so callers that renumber by index (normalizeFeaturesDocument) and
      // callers that keep persisted numbers (loadAll) agree, regardless of the
      // filesystem readdir order. Tiebreak by id for full determinism.
      out.sort((a, b) => (a.number - b.number) || a.id.localeCompare(b.id));
      return out;
    }
    // Legacy: single features.json (pre-migration read; migration writes on first write op).
    try {
      const legacy = await readJson(this.featuresPath(), FeaturesDocumentSchema);
      const legacyFeatures = legacy.features;
      legacyFeatures.sort((a, b) => (a.number - b.number) || a.id.localeCompare(b.id));
      return legacyFeatures;
    } catch {
      return [];
    }
  }

  async loadFeatures(): Promise<FeaturesDocument> {
    const raws = await this.loadRawFeatures();
    const phases = await this.loadAllPhases();
    const features: Feature[] = raws.map((f) => ({ ...f, status: this.deriveFeatureStatus(f.id, phases) }));
    return this.normalizeStructureSnapshot({ features }, phases).features;
  }

  async loadCodebaseProfile(): Promise<CodebaseProfile | null> {
    try {
      return await readJson(this.codebasePath(), CodebaseProfileSchema);
    } catch {
      return null;
    }
  }

  async saveCodebaseProfile(profile: CodebaseProfile): Promise<void> {
    const parsed = CodebaseProfileSchema.parse(profile);
    await atomicWriteJson(this.codebasePath(), parsed);
    await this.touchManifest();
  }

  async loadResume(): Promise<ResumeFocus | null> {
    try {
      return await readJson(this.resumePath(), ResumeFocusSchema);
    } catch {
      return null;
    }
  }

  async saveResume(resume: ResumeFocus): Promise<void> {
    // Track when `nextSteps` actually change (free-text can go stale; the recap
    // surfaces nextStepsUpdatedAt so staleness is visible). Preserved when
    // refreshResume keeps existing nextSteps; bumped only on a real change.
    const existing = await this.loadResume().catch(() => null);
    const nextStepsChanged = JSON.stringify(existing?.nextSteps ?? []) !== JSON.stringify(resume.nextSteps ?? []);
    const withTs: ResumeFocus = {
      ...resume,
      nextStepsUpdatedAt: nextStepsChanged
        ? nowISO()
        : (resume.nextStepsUpdatedAt || existing?.nextStepsUpdatedAt || nowISO()),
    };
    const parsed = ResumeFocusSchema.parse(withTs);
    await atomicWriteJson(this.resumePath(), parsed);
    await this.touchManifest();
  }

  /**
   * Authorize a temporary guard bypass so edit/write tools may proceed even
   * when no task is in-progress. Harness-agnostic: stored in resume.json so
   * every adapter (Pi, Claude Code, Codex, ...) reads the same source.
   * Time-scoped; auto-expires after `durationMinutes` (default 15).
   */
  async authorizeGuardBypass(durationMinutes = 15): Promise<string> {
    const resume = await this.loadResume() ?? {
      updatedAt: nowISO(),
      currentPhaseId: "",
      inProgressTaskIds: [],
      nextSteps: [],
      nextStepsUpdatedAt: "",
      blockers: [],
      notes: "",
      lastSessionSummary: "",
      guardBypassUntil: "",
    };
    const until = new Date(Date.now() + durationMinutes * 60_000).toISOString();
    resume.guardBypassUntil = until;
    resume.updatedAt = nowISO();
    await this.saveResume(resume);
    return until;
  }

  /** Clear any active guard bypass. */
  async clearGuardBypass(): Promise<void> {
    const resume = await this.loadResume();
    if (!resume || !resume.guardBypassUntil) return;
    resume.guardBypassUntil = "";
    resume.updatedAt = nowISO();
    await this.saveResume(resume);
  }

  /** True when a guard bypass is currently active (not expired). */
  async isGuardBypassed(): Promise<boolean> {
    const resume = await this.loadResume();
    if (!resume?.guardBypassUntil) return false;
    const until = Date.parse(resume.guardBypassUntil);
    if (!Number.isFinite(until)) return false;
    return until > Date.now();
  }

  async loadActivityLog(): Promise<ActivityLog> {
    try {
      return await readJson(this.activityPath(), ActivityLogSchema);
    } catch {
      return { entries: [] };
    }
  }

  async appendActivity(type: string, ref: string, summary: string): Promise<ActivityEntry> {
    const log = await this.loadActivityLog();
    const id = `act-${log.entries.length + 1}-${type}`;
    const entry: ActivityEntry = { id, at: nowISO(), type, ref, summary };
    log.entries.push(entry);
    // Cap to last 200 entries
    if (log.entries.length > 200) log.entries = log.entries.slice(-200);
    await atomicWriteJson(this.activityPath(), { entries: log.entries });
    await this.touchManifest();
    return entry;
  }


  /** Derive an up-to-date resume focus from the current workspace state. */
  async refreshResume(notes?: string, lastSessionSummary?: string): Promise<ResumeFocus> {
    const workspace = await this.loadAll();
    const inProgressPhases = workspace.phases.filter((p) => p.status === "in-progress");
    const inProgressTasks = workspace.phases.flatMap((p) => p.tasks.filter((t) => t.status === "in-progress"));
    const blockedTasks = workspace.phases.flatMap((p) => p.tasks.filter((t) => t.status === "blocked"));
    const existing = await this.loadResume();
    const resume: ResumeFocus = {
      updatedAt: nowISO(),
      currentPhaseId: inProgressPhases[0]?.id ?? existing?.currentPhaseId ?? "",
      inProgressTaskIds: inProgressTasks.map((t) => t.id),
      nextSteps: existing?.nextSteps ?? [],
      nextStepsUpdatedAt: existing?.nextStepsUpdatedAt ?? "",
      blockers: blockedTasks.map((t) => `${t.id}: ${t.title}`),
      notes: notes ?? existing?.notes ?? "",
      lastSessionSummary: lastSessionSummary ?? existing?.lastSessionSummary ?? "",
      guardBypassUntil: existing?.guardBypassUntil ?? "",
    };
    await this.saveResume(resume);
    return resume;
  }

  async loadRequirements(): Promise<RequirementsDocument> {
    try {
      return await readJson(this.requirementsPath(), RequirementsDocumentSchema);
    } catch {
      return { requirements: [] };
    }
  }

  async linkedRequirementsForPhase(phaseId: string): Promise<Requirement[]> {
    const requirements = await this.loadRequirements();
    return requirements.requirements.filter((requirement) => requirement.linkedPhaseIds.includes(phaseId));
  }

  async loadPhaseWithRequirements(phaseId: string): Promise<Phase & { linkedRequirements: Requirement[] }> {
    const [phase, linkedRequirements] = await Promise.all([
      this.loadPhase(phaseId),
      this.linkedRequirementsForPhase(phaseId),
    ]);
    return { ...phase, linkedRequirements };
  }

  async loadAllPhasesWithRequirements(): Promise<Array<Phase & { linkedRequirements: Requirement[] }>> {
    const [phases, requirements] = await Promise.all([
      this.loadAllPhases(),
      this.loadRequirements(),
    ]);
    return phases.map((phase) => ({
      ...phase,
      linkedRequirements: requirements.requirements.filter((requirement) => requirement.linkedPhaseIds.includes(phase.id)),
    }));
  }

  async loadAllPhases(): Promise<Phase[]> {
    const { readdir } = await import("node:fs/promises");
    let files: string[];
    try {
      files = await readdir(this.phasesDir());
    } catch {
      return [];
    }
    const results: Phase[] = [];
    for (const f of files.sort()) {
      if (!f.endsWith(".json")) continue;
      try {
        results.push(await this.loadPhase(f.replace(/\.json$/, "")));
      } catch {
        // skip corrupted files
      }
    }
    return results.sort((left, right) => {
      const leftFeature = left.featureId ?? "~orphan";
      const rightFeature = right.featureId ?? "~orphan";
      if (leftFeature !== rightFeature) return leftFeature.localeCompare(rightFeature);
      if (left.number !== right.number) return left.number - right.number;
      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  /** Derive the parent display snapshot for a phase from its tasks' canonical
   *  statuses. Pure, non-persisting. */
  async loadPhaseDisplay(phaseId: string): Promise<ParentDisplay> {
    const phase = await this.loadPhase(phaseId);
    const childStatuses: WorkflowStatus[] = phase.tasks.map((t) => fromCanonicalStatus(t.status));
    return deriveParentDisplay(childStatuses);
  }

  /** Derive the parent display snapshot for a feature from its phases' DERIVED
   *  canonical statuses (each phase status is derived from its tasks at read
   *  time, then mapped via fromCanonicalStatus). Pure, non-persisting. */
  async loadFeatureDisplay(featureId: string): Promise<ParentDisplay> {
    const phases = await this.loadAllPhases();
    const featurePhases = phases.filter((p) => p.featureId === featureId);
    const childStatuses: WorkflowStatus[] = featurePhases.map((p) => fromCanonicalStatus(p.status));
    return deriveParentDisplay(childStatuses);
  }


  async loadAll(): Promise<PlanWorkspace> {
    const [manifest, project, requirements, phases] = await Promise.all([
      this.loadManifest(),
      this.loadProject(),
      this.loadRequirements(),
      this.loadAllPhases(),
    ]);
    const rawFeatures = await this.loadRawFeatures();
    const features: Feature[] = rawFeatures.map((f) => ({ ...f, status: this.deriveFeatureStatus(f.id, phases) }));
    const normalized = this.normalizeStructureSnapshot({ features }, phases);
    return { manifest, project, requirements, phases: normalized.phases, features: normalized.features };
  }

  /** Migrate legacy non-feature-scoped phase ids to feature-scoped ids and repair
   *  dangling feature.phaseIds references. Idempotent. */
  async migratePhaseIds(): Promise<{ renamed: number; repaired: number; inferred: number }> {
    const { readdir, unlink } = await import("node:fs/promises");
    const phases = await this.loadAllPhases();
    const features = await this.loadFeatures();

    // Infer missing featureId from feature.phaseIds references (legacy back-link).
    const legacyIdToFeatureId = new Map<string, string>();
    for (const feature of features.features) {
      for (const ref of feature.phaseIds) {
        if (isLegacyPhaseId(ref) && !legacyIdToFeatureId.has(ref)) {
          legacyIdToFeatureId.set(ref, feature.id);
        }
      }
    }

    const phaseIdByLegacy = new Map<string, string>();
    let renamed = 0;
    let inferred = 0;

    for (const phase of phases) {
      if (!isLegacyPhaseId(phase.id)) continue;
      let featureId = phase.featureId ?? legacyIdToFeatureId.get(phase.id);
      if (!featureId) continue;
      if (!phase.featureId) {
        phase.featureId = featureId;
        inferred += 1;
      }
      const newId = createPhaseId();
      if (newId === phase.id) continue;
      phaseIdByLegacy.set(phase.id, newId);
      const oldId = phase.id;
      phase.id = newId;
      for (const task of phase.tasks) {
        task.phaseId = newId;
      }
      await this.savePhase(phase);
      try {
        await unlink(this.phasePath(oldId));
      } catch {}
      renamed += 1;
    }

    // Repair feature.phaseIds: replace legacy refs with new ids, drop dangling ones.
    const knownPhaseIds = new Set(phases.map((p) => p.id));
    let repaired = 0;
    let dirty = false;
    for (const feature of features.features) {
      const next: string[] = [];
      for (const ref of feature.phaseIds) {
        const resolved = phaseIdByLegacy.get(ref) ?? ref;
        if (knownPhaseIds.has(resolved)) {
          next.push(resolved);
        } else {
          repaired += 1;
        }
      }
      if (next.length !== feature.phaseIds.length || next.some((id, i) => id !== feature.phaseIds[i])) {
        feature.phaseIds = next;
        feature.updatedAt = nowISO();
        dirty = true;
      }
    }
    if (dirty) await this.saveFeatures(features);

    return { renamed, repaired, inferred };
  }

  /**
   * Remove orphan backup/temp files from .planner/:
   *  - `*.json.bak` whose main `.json` no longer exists (e.g. deleted phases)
   *  - `*.tmp.*` leftover from interrupted atomic writes
   * Harness-agnostic; safe to run in background at startup.
   */
  async cleanupOrphanBackups(): Promise<{ removed: number }> {
    let removed = 0;
    try {
      const { readdir, unlink, stat } = await import("node:fs/promises");
      const phasesDir = this.phasesDir();
      const dirs = [this.root, phasesDir];
      for (const dir of dirs) {
        let entries: string[] = [];
        try { entries = await readdir(dir); } catch { continue; }
        for (const name of entries) {
          const isBak = name.endsWith(".json.bak");
          const isTmp = name.includes(".tmp.");
          if (!isBak && !isTmp) continue;
          const full = join(dir, name);
          if (isBak) {
            // Orphan = the main json file no longer exists
            const mainPath = full.slice(0, -".bak".length);
            try { await stat(mainPath); continue; } catch { /* main gone → orphan */ }
          }
          try { await unlink(full); removed += 1; } catch { /* ignore */ }
        }
      }
    } catch { /* best-effort */ }
    return { removed };
  }

  /** All non-empty shortIds currently assigned in the project (features + phases + tasks).
   *  Read-only; used by createShortId collision guard during entity creation. */
  async assignedShortIds(): Promise<Set<string>> {
    const features = await this.loadFeatures();
    const phases = await this.loadAllPhases();
    const ids = new Set<string>();
    for (const f of features.features) if (f.shortId) ids.add(f.shortId);
    for (const p of phases) {
      if (p.shortId) ids.add(p.shortId);
      for (const t of p.tasks) if (t.shortId) ids.add(t.shortId);
    }
    return ids;
  }

  /** Next priority (>=1) for a new entity within its scope.
   *  - feature: max priority among features + 1
   *  - phase: max priority among phases of parentId (featureId) + 1
   *  - task: max priority among tasks of parentId (phaseId) + 1 */
  async nextPriority(kind: "feature" | "phase" | "task", parentId?: string): Promise<number> {
    if (kind === "feature") {
      const features = await this.loadFeatures();
      const max = features.features.reduce((m, f) => Math.max(m, f.priority ?? 0), 0);
      return max + 1;
    }
    if (kind === "phase") {
      const phases = await this.loadAllPhases();
      const siblings = phases.filter((p) => p.featureId === parentId);
      const max = siblings.reduce((m, p) => Math.max(m, p.priority ?? 0), 0);
      return max + 1;
    }
    // task
    const phase = parentId ? await this.loadPhase(parentId).catch(() => undefined) : undefined;
    const tasks = phase?.tasks ?? [];
    const max = tasks.reduce((m, t) => Math.max(m, t.priority ?? 0), 0);
    return max + 1;
  }

  /** Idempotent backfill of shortId (globally-unique 5-char Crockford) and priority
   *  (per-scope display order). Assigns missing shortIds and priorities; never overwrites
   *  existing non-empty shortIds or non-zero priorities. Safe to run at startup. */
  async ensureShortIdsAndPriority(): Promise<{
    shortIdsAssigned: number;
    prioritiesAssigned: number;
    duplicateShortIds: string[];
  }> {
    return this.runAsBatch(async () => {
      const featuresDoc = await this.loadFeatures();
      const phases = await this.loadAllPhases();
      const existing = new Set<string>();
      for (const f of featuresDoc.features) if (f.shortId) existing.add(f.shortId);
      for (const p of phases) {
        if (p.shortId) existing.add(p.shortId);
        for (const t of p.tasks) if (t.shortId) existing.add(t.shortId);
      }

      let shortIdsAssigned = 0;
      let prioritiesAssigned = 0;
      let featuresDirty = false;

      // Priority is left to reorder (midpoint-insert); ensureShortIds only
      // backfills shortIds. New items keep priority 0 until first drag reindex.
      const assignPriority = (current: number, _index: number): number => current;

      // Features: shortId + priority (project scope)
      const sortedFeatures = [...featuresDoc.features].sort(
        (a, b) => a.number - b.number || a.createdAt.localeCompare(b.createdAt),
      );
      sortedFeatures.forEach((f, index) => {
        if (!f.shortId) {
          f.shortId = createShortId(existing);
          existing.add(f.shortId);
          shortIdsAssigned += 1;
          featuresDirty = true;
        }
        const nextP = assignPriority(f.priority ?? 0, index);
        if (nextP !== f.priority) { f.priority = nextP; featuresDirty = true; }
      });
      if (featuresDirty) {
        featuresDoc.features.sort((a, b) => a.priority - b.priority || a.number - b.number);
        await this.saveFeatures(featuresDoc);
      }

      // Phases + tasks
      for (const phase of phases) {
        let phaseDirty = false;
        if (!phase.shortId) {
          phase.shortId = createShortId(existing);
          existing.add(phase.shortId);
          shortIdsAssigned += 1;
          phaseDirty = true;
        }
        const phaseIndex = phase.number - 1; // stable pre-migration order
        const nextPP = assignPriority(phase.priority ?? 0, phaseIndex < 0 ? 0 : phaseIndex);
        if (nextPP !== phase.priority) { phase.priority = nextPP; phaseDirty = true; }

        const sortedTasks = [...phase.tasks].sort(
          (a, b) => a.number - b.number || a.createdAt.localeCompare(b.createdAt),
        );
        sortedTasks.forEach((t, index) => {
          if (!t.shortId) {
            t.shortId = createShortId(existing);
            existing.add(t.shortId);
            shortIdsAssigned += 1;
            phaseDirty = true;
          }
          const nextTP = assignPriority(t.priority ?? 0, index);
          if (nextTP !== t.priority) { t.priority = nextTP; phaseDirty = true; }
        });
        if (phaseDirty) {
          phase.tasks.sort((a, b) => a.priority - b.priority || a.number - b.number);
          phase.taskIds = phase.tasks.map((t) => t.id);
          phase.updatedAt = nowISO();
          await this.savePhase(phase);
        }
      }

      // Duplicate shortId report (across all entities)
      const allShortIds: string[] = [];
      for (const f of featuresDoc.features) if (f.shortId) allShortIds.push(f.shortId);
      for (const ph of phases) {
        if (ph.shortId) allShortIds.push(ph.shortId);
        for (const t of ph.tasks) if (t.shortId) allShortIds.push(t.shortId);
      }
      const counts = new Map<string, number>();
      for (const id of allShortIds) counts.set(id, (counts.get(id) ?? 0) + 1);
      const duplicateShortIds = [...counts.entries()].filter(([, c]) => c > 1).map(([id]) => id);

      return { shortIdsAssigned, prioritiesAssigned, duplicateShortIds };
    });
  }

  /** Repair dangling references and report integrity. One-shot maintenance op. */
  async repair(): Promise<{
    migrated: { renamed: number; repaired: number; inferred: number };
    backfill: { shortIdsAssigned: number; prioritiesAssigned: number; duplicateShortIds: string[] };
    containment: { changed: number; tasks: number; orphan: number };
    integrity: { duplicatePhaseIds: string[]; danglingPhaseIds: string[]; duplicateShortIds: string[] };
  }> {
    return this.runAsBatch(async () => {
      const migrated = await this.migratePhaseIds();
      await this.repairPhaseFeatureRefs();
      const backfill = await this.ensureShortIdsAndPriority();
      // Rebuild phase containment from each task's own phaseId. Heals plans
      // corrupted by the migrateToGlobalSequence index-mismatch bug (core
      // <0.2.19-next.7). Lossless + idempotent — safe to run every repair.
      const containment = await this.rebuildContainment();
      const integrity = await this.validateIntegrity();
      await this.writeGenerated();
      return { migrated, backfill, containment, integrity };
    });
  }

  private async repairPhaseFeatureRefs(): Promise<number> {
    const features = await this.loadRawFeatures();
    const phases = await this.loadAllPhases();
    let changed = 0;

    for (const phase of phases) {
      const resolvedFeatureId = resolveStoredFeatureId(features, phase.featureId);
      if (resolvedFeatureId && resolvedFeatureId !== phase.featureId) {
        await this.savePhase({ ...phase, featureId: resolvedFeatureId });
        changed += 1;
      }
    }

    if (changed > 0) {
      await this.updateFeatures((doc) => doc);
    }

    return changed;
  }

  /** Validate plan integrity: globally unique phase ids and resolvable feature.phaseIds. */
  async validateIntegrity(): Promise<{ duplicatePhaseIds: string[]; danglingPhaseIds: string[]; duplicateShortIds: string[] }> {
    const phases = await this.loadAllPhases();
    const features = await this.loadFeatures();
    const seen = new Map<string, number>();
    for (const phase of phases) {
      seen.set(phase.id, (seen.get(phase.id) ?? 0) + 1);
    }
    const duplicatePhaseIds = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    const knownPhaseIds = new Set(phases.map((p) => p.id));
    const danglingPhaseIds: string[] = [];
    for (const feature of features.features) {
      for (const ref of feature.phaseIds) {
        if (!knownPhaseIds.has(ref)) danglingPhaseIds.push(`${feature.id} -> ${ref}`);
      }
    }
    // Duplicate shortIds across all entities
    const allShortIds: string[] = [];
    for (const f of features.features) if (f.shortId) allShortIds.push(f.shortId);
    for (const ph of phases) {
      if (ph.shortId) allShortIds.push(ph.shortId);
      for (const t of ph.tasks) if (t.shortId) allShortIds.push(t.shortId);
    }
    const sidCounts = new Map<string, number>();
    for (const id of allShortIds) sidCounts.set(id, (sidCounts.get(id) ?? 0) + 1);
    const duplicateShortIds = [...sidCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id);
    return { duplicatePhaseIds, danglingPhaseIds, duplicateShortIds };
  }

  private derivePhaseStatus(tasks: Task[]): Phase["status"] {
    if (tasks.length === 0) return "draft";

    const taskStatuses = tasks.map((task) => task.status);
    // Ignore rejected/canceled tasks (void) when deriving progress.
    const meaningful = taskStatuses.filter((s) => s !== "rejected" && s !== "canceled");
    if (meaningful.length === 0) return "rejected";
    if (meaningful.every((s) => s === "done")) return "done";

    const hasDone = meaningful.some((s) => s === "done");
    const hasActive = meaningful.some((s) => s === "in-progress");
    const hasPlanned = meaningful.some((s) => s === "planned");
    const hasBlocked = meaningful.some((s) => s === "blocked");
    const hasWaiting = meaningful.some((s) => s === "waiting");
    const hasDeferred = meaningful.some((s) => s === "deferred");

    if (hasActive) return "in-progress";
    // If completed work exists and the ONLY remaining meaningful work is deferred,
    // surface deferred instead of implying active execution.
    if (hasDone && !hasPlanned && !hasBlocked && !hasWaiting && hasDeferred) return "deferred";
    // Partial completion with remaining planned/blocked/waiting work still means
    // the phase has genuinely started and is not terminal yet.
    if (hasDone) return "in-progress";
    // No progress at all ⇒ surface the stall / not-started state (blocked > waiting > deferred > planned).
    if (hasBlocked) return "blocked";
    if (hasWaiting) return "waiting";
    if (hasDeferred) return "deferred";
    return "planned";
  }

  private deriveFeatureStatus(featureId: string, phases: Phase[]): Feature["status"] {
    const featurePhases = phases.filter((phase) => phase.featureId === featureId);
    if (featurePhases.length === 0) return "planned";

    const phaseStatuses = featurePhases.map((phase) => phase.status);
    // Ignore rejected/canceled phases when deriving progress.
    const meaningful = phaseStatuses.filter((s) => s !== "rejected" && s !== "canceled");
    if (meaningful.length === 0) return "rejected";
    if (meaningful.every((s) => s === "done")) return "done";

    const hasDone = meaningful.some((s) => s === "done");
    const hasActive = meaningful.some((s) => s === "discovery" || s === "in-progress");
    const hasPlanned = meaningful.some((s) => s === "planned");
    const hasBlocked = meaningful.some((s) => s === "blocked");
    const hasWaiting = meaningful.some((s) => s === "waiting");
    const hasDeferred = meaningful.some((s) => s === "deferred");

    if (hasActive) return "in-progress";
    // Same rule as phases: done + deferred-only remainder is deferred, not active.
    if (hasDone && !hasPlanned && !hasBlocked && !hasWaiting && hasDeferred) return "deferred";
    if (hasDone) return "in-progress";
    // No progress at all ⇒ surface the stall / not-started state.
    if (hasBlocked) return "blocked";
    if (hasWaiting) return "waiting";
    if (hasDeferred) return "deferred";
    return "planned";
  }

  async syncStatuses(): Promise<string[]> {
    // No-op: phase/feature status is now DERIVED at read time (never persisted),
    // so there is nothing to sync. Kept for backward compatibility with callers
    // (serve.ts, adapters) that invoke it after mutations.
    return [];
  }

  /** Auto-clear a phase's handoff when its DERIVED status is done. Status itself
   *  is no longer persisted (derived on read), so the only remaining side effect
   *  of a task→done transition is clearing a stale handoff on a completed phase.
   *  Returns the composite ref of the phase if its handoff was cleared, else null. */
  async syncTaskStatusRollup(phaseId: string): Promise<string | null> {
    const phase = await this.loadPhase(phaseId);
    let cleared: string | null = null;
    if (phase.status === "done" && phase.handoff !== "") {
      await this.clearPhaseHandoff(phaseId, "phase-done");
      const features = await this.loadFeatures();
      const feature = features.features.find((f) => f.id === phase.featureId);
      cleared = formatPhaseRef(phase.number, feature?.number);
    }
    // Append a statusLog entry to the phase when its DERIVED status changed
    // (audit trail; status itself is NOT persisted). Idempotent: only appends
    // when the new derived status differs from the last recorded toStatus.
    await this.#appendPhaseStatusLog(phaseId);
    // Roll up to the parent feature's statusLog too.
    if (phase.featureId) await this.#appendFeatureStatusLog(phase.featureId);
    await this.refreshResume();
    return cleared;
  }

  /** Append a PhaseStatusLogEntry to the phase when its derived status changed
   *  vs. the last recorded toStatus (baseline "draft" when empty, matching the
   *  phase-creation literal). Idempotent across repeated reads of the same state. */
  async #appendPhaseStatusLog(phaseId: string): Promise<void> {
    await this.updatePhase(phaseId, (p) => {
      const last = p.statusLog.at(-1)?.toStatus ?? "draft";
      if (p.status !== last) {
        p.statusLog = [...p.statusLog, {
          id: createStatusLogEntryId(),
          date: nowISO(),
          fromStatus: last as Phase["status"],
          toStatus: p.status,
          title: `${last} → ${p.status}`,
          description: "",
        }];
      }
      return p;
    });
  }

  /** Append a StatusLogEntry to the feature when its derived status changed
   *  vs. the last recorded toStatus (baseline "planned" when empty, matching
   *  the feature-creation/empty-phases derivation). Idempotent. */
  async #appendFeatureStatusLog(featureId: string): Promise<void> {
    const features = await this.loadFeatures();
    const feature = features.features.find((f) => f.id === featureId);
    if (!feature) return;
    const last = feature.statusLog.at(-1)?.toStatus ?? "planned";
    if (feature.status !== last) {
      await this.updateFeatures((doc) => {
        const target = doc.features.find((f) => f.id === featureId);
        if (target && target.statusLog.at(-1)?.toStatus !== feature.status) {
          const baseline = target.statusLog.at(-1)?.toStatus ?? "planned";
          target.statusLog = [...target.statusLog, {
            id: createStatusLogEntryId(),
            date: nowISO(),
            fromStatus: baseline as Task["status"],
            toStatus: feature.status as Task["status"],
            title: `${baseline} → ${feature.status}`,
            description: "",
          }];
        }
        return doc;
      });
    }
  }

  // ── Savers ───────────────────────────────────────────────────────────

  async updateProject(updater: (p: Project) => Project): Promise<Project> {
    const updated = await atomicUpdateJson(this.projectPath(), ProjectSchema, updater);
    await this.maybeAutoSync();
    return updated;
  }

  async updateFeatures(updater: (f: FeaturesDocument) => FeaturesDocument): Promise<FeaturesDocument> {
    const updated = await this.withFeaturesLock(async () => {
      await this.migrateLegacy();
      const current = await this.loadFeatures();
      const upd = this.normalizeFeaturesDocument(updater(current)).doc;
      await this.saveFeaturesRaw(upd);
      return upd;
    });
    await this.maybeAutoSync();
    return updated;
  }

  async updateRequirements(updater: (r: RequirementsDocument) => RequirementsDocument): Promise<RequirementsDocument> {
    const updated = await atomicUpdateJson(this.requirementsPath(), RequirementsDocumentSchema, updater);
    await this.maybeAutoSync();
    return updated;
  }

  async saveProject(project: Project): Promise<void> {
    const parsed = ProjectSchema.parse(project);
    await atomicWriteJson(this.projectPath(), parsed);
    await this.touchManifest();
    await this.maybeAutoSync();
  }

  async saveFeatures(features: FeaturesDocument): Promise<void> {
    await this.withFeaturesLock(async () => {
      await this.migrateLegacy();
      await this.saveFeaturesRaw(features);
    });
    await this.touchManifest();
    await this.maybeAutoSync();
  }

  /** Per-file write of all features + orphan reconcile. No lock (caller holds withFeaturesLock). */
  private async saveFeaturesRaw(features: FeaturesDocument): Promise<void> {
    const parsed = FeaturesDocumentSchema.parse(this.normalizeFeaturesDocument(features).doc);
    await mkdir(this.featuresDir(), { recursive: true });
    const wantIds = new Set(parsed.features.map((f) => f.id));
    for (const feat of parsed.features) {
      await atomicWriteJson(this.featurePath(feat.id), feat);
    }
    // Orphan reconcile: remove feature files no longer in the document.
    try {
      const files = await readdir(this.featuresDir());
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const id = f.replace(/\.json$/, "");
        if (!wantIds.has(id)) {
          await unlink(this.featurePath(id)).catch(() => {});
        }
      }
    } catch {
      // dir absent — nothing to reconcile
    }
  }

  /** Granular single-feature write (per-file lock; parallel-safe across features). */
  async saveFeature(feature: Feature): Promise<void> {
    await this.withFeaturesLock(async () => {
      await this.migrateLegacy();
      await mkdir(this.featuresDir(), { recursive: true });
      const parsed = FeatureSchema.parse(feature);
      await atomicWriteJson(this.featurePath(parsed.id), parsed);
    });
    await this.touchManifest();
    await this.maybeAutoSync();
  }

  async saveRequirements(reqs: RequirementsDocument): Promise<void> {
    const parsed = RequirementsDocumentSchema.parse(reqs);
    await atomicWriteJson(this.requirementsPath(), parsed);
    await this.touchManifest();
  }

    async savePhase(phase: Phase): Promise<void> {
    const features = await this.loadRawFeatures();
    const resolvedFeatureId = resolveStoredFeatureId(features, phase.featureId);
    // Referential integrity: if a featureId is present but cannot be resolved
    // to a known feature, REJECT — never persist an orphan phase.
    if (phase.featureId && phase.featureId.trim() && !resolvedFeatureId) {
      throw new PlanStoreError(
        `Cannot save phase "${phase.title}": featureId "${phase.featureId}" does not match any existing feature. Use a valid feature UUID, F00x ref, or shortId.`,
      );
    }
    const normalizedInput = resolvedFeatureId && resolvedFeatureId !== phase.featureId
      ? { ...phase, featureId: resolvedFeatureId }
      : phase;
    const parsed = PhaseSchema.parse(this.normalizePhaseDocument(normalizedInput).phase);
    await mkdir(this.phasesDir(), { recursive: true });
    await atomicWriteJson(this.phasePath(parsed.id), parsed);
    await this.touchManifest();
    await this.maybeAutoSync();
  }

  /** Atomic read-modify-write on a single phase file. Serializes concurrent
   *  task_create / phase_update calls on the SAME phaseId so batch operations
   *  don't lose tasks (last-write-wins race condition). */
  async updatePhase(phaseId: string, updater: (phase: Phase) => Phase): Promise<Phase> {
    const features = await this.loadRawFeatures();
    // Augment the raw (on-disk) phase with its DERIVED status before handing it
    // to the updater, so updaters that read 'phase.status' see the truth. The
    // returned object's 'status' is stripped by PhaseSchema.parse (status is
    // not persisted); the return value is re-derived for the caller.
    const raw = await atomicUpdateJson(this.phasePath(phaseId), PhaseSchema, (rawPhase) => {
      const current: Phase = { ...rawPhase, status: this.derivePhaseStatus(rawPhase.tasks) };
      const next = updater(current);
      const resolvedFeatureId = resolveStoredFeatureId(features, next.featureId);
      // Referential integrity: reject orphan featureId.
      if (next.featureId && next.featureId.trim() && !resolvedFeatureId) {
        throw new PlanStoreError(
          `Cannot update phase: featureId "${next.featureId}" does not match any existing feature.`,
        );
      }
      const normalizedInput = resolvedFeatureId && resolvedFeatureId !== next.featureId
        ? { ...next, featureId: resolvedFeatureId }
        : next;
      return this.normalizePhaseDocument(normalizedInput).phase;
    });
    await this.maybeAutoSync();
    return { ...raw, status: this.derivePhaseStatus(raw.tasks) };
  }

  // ── Phase-scoped handoff (entity field, harness-agnostic) ────────────

  /** Get the handoff text for a phase ("" if none). Throws if phase missing. */
  async getPhaseHandoff(phaseId: string): Promise<string> {
    return (await this.loadPhase(phaseId)).handoff;
  }

  /** Set the handoff text for a phase + stamp handoffUpdatedAt. Atomic per-file
   *  update via updatePhase (so the web UI refreshes via maybeAutoSync). */
  async setPhaseHandoff(phaseId: string, text: string): Promise<void> {
    const now = new Date().toISOString();
    await this.updatePhase(phaseId, (phase) => ({ ...phase, handoff: text, handoffUpdatedAt: now }));
  }

  /** Directory where cleared handoff content is archived as .md files
   *  (gitignored). Keeps the phase JSON lean while making past handoffs
   *  recoverable + human-readable. */
  private handoffArchiveDir(): string {
    return join(this.root, "handoff-archive");
  }

  /** Mark the phase handoff as read/acknowledged on recap (sets handoffReadAt).
   *  Does NOT clear the handoff — content is kept until a task starts or the
   *  phase completes, so a restart between read and resume does not lose it. */
  async markHandoffRead(phaseId: string): Promise<void> {
    await this.updatePhase(phaseId, (phase) => ({ ...phase, handoffReadAt: nowISO() }));
  }

  /** One-time import of a legacy .planner/HANDOFF.md file (file-based handoff
   *  from before F004) into the entity-scoped phase.handoff. Idempotent: if the
   *  file is absent or empty, no-op. If it exists + non-empty + the target phase
   *  has no handoff, writes the content onto the current in-progress phase (or
   *  the first phase if none in-progress) with an "imported" handoffHistory entry,
   *  then renames the file to HANDOFF.md.bak so it won't re-import. If the target
   *  already has a handoff, the entity-scoped one wins and the file is just .bak'd. */
  async importLegacyHandoffFile(): Promise<{ imported: boolean; phaseRef?: string }> {
    const filePath = join(this.root, "HANDOFF.md");
    const content = await readFile(filePath, "utf-8").catch(() => null);
    if (content === null) return { imported: false };
    if (content.trim() === "") {
      await rename(filePath, filePath + ".bak").catch(() => {});
      return { imported: false };
    }
    const phases = await this.loadAllPhases();
    const target = phases.find((p) => p.status === "in-progress") ?? phases[0] ?? null;
    if (!target) return { imported: false }; // no phases yet — leave file for a later run
    if ((target.handoff ?? "") === "") {
      await this.setPhaseHandoff(target.id, content + "\n\n<!-- imported from legacy .planner/HANDOFF.md -->\n");
      await this.updatePhase(target.id, (p) => ({
        ...p,
        handoffHistory: [{ file: "(legacy HANDOFF.md)", clearedAt: nowISO(), reason: "imported" }, ...(p.handoffHistory ?? [])].slice(0, 5),
      }));
    }
    await rename(filePath, filePath + ".bak").catch(() => {});
    const features = await this.loadFeatures();
    const feat = features.features.find((f) => f.id === target.featureId);
    return { imported: true, phaseRef: formatPhaseRef(target.number, feat?.number) };
  }


  /** Clear the handoff for a phase, archiving its content first. The handoff
   *  markdown is written to .planner/handoff-archive/<phaseId>-<ISO>.md and a
   *  metadata entry { file, clearedAt, reason } is prepended to handoffHistory
   *  (capped at 5; oldest file is deleted when trimmed). handoffUpdatedAt is
   *  left unchanged as an audit trail. If the handoff is empty, this is a no-op.
   *  reason: "task-started" | "phase-done" | "manual" | "superseded" | "imported". */
  async clearPhaseHandoff(phaseId: string, reason = "manual"): Promise<void> {
    const phase = await this.loadPhase(phaseId).catch(() => null);
    if (!phase || phase.handoff === "") return; // nothing to archive
    const clearedAt = nowISO();
    const safeTs = clearedAt.replace(/[:.]/g, "-");
    const archiveDir = this.handoffArchiveDir();
    await mkdir(archiveDir, { recursive: true }).catch(() => {});
    const fileName = `${phaseId}-${safeTs}.md`;
    const filePath = join(archiveDir, fileName);
    await atomicWriteText(filePath, phase.handoff);
    const entry = { file: `handoff-archive/${fileName}`, clearedAt, reason };
    // Cap history at 5: prepend new entry, drop oldest (and delete its file).
    const trimmed = [entry, ...(phase.handoffHistory ?? [])].slice(0, 5);
    const dropped = (phase.handoffHistory ?? []).slice(4); // entries beyond index 4 after prepend
    for (const d of dropped) {
      if (d?.file) await unlink(join(this.root, d.file)).catch(() => {});
    }
    await this.updatePhase(phaseId, (p) => ({ ...p, handoff: "", handoffHistory: trimmed }));
  }

  /** List all phases that have a non-empty handoff, newest first, with a
   *  human-readable composite ref (P00x or P00x(F00x)) and a first-line excerpt. */
  async listHandoffs(): Promise<PhaseHandoffSummary[]> {
    const phases = await this.loadAllPhases();
    const features = await this.loadFeatures();
    const featureNumber = new Map<string, number>();
    for (const f of features.features) featureNumber.set(f.id, f.number);
    const out: PhaseHandoffSummary[] = [];
    for (const p of phases) {
      if (!p.handoff) continue;
      const fnum = p.featureId ? featureNumber.get(p.featureId) : undefined;
      out.push({
        phaseId: p.id,
        featureId: p.featureId,
        compositeRef: formatPhaseRef(p.number, fnum),
        updatedAt: p.handoffUpdatedAt || p.updatedAt,
        firstLine: handoffFirstLine(p.handoff),
        content: p.handoff,
      });
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }

  async listOrphanPhases(): Promise<OrphanPhaseSummary[]> {
    const phases = await this.loadAllPhases();
    const featuresDoc = await this.loadFeatures();
    const out: OrphanPhaseSummary[] = [];
    for (const phase of phases) {
      const resolvedFeatureId = resolveStoredFeatureId(featuresDoc.features, phase.featureId);
      if (resolvedFeatureId) continue;
      const reason = phase.featureId?.trim()
        ? `feature not found: ${phase.featureId}`
        : "missing featureId";
      out.push({
        phaseId: phase.id,
        featureId: phase.featureId,
        shortId: phase.shortId,
        compositeRef: formatPhaseRef(phase.number),
        title: phase.title,
        reason,
      });
    }
    out.sort((a, b) => a.compositeRef.localeCompare(b.compositeRef));
    return out;
  }

  async cleanupOrphanPhases(): Promise<{ found: OrphanPhaseSummary[]; removed: OrphanPhaseSummary[] }> {
    return this.runAsBatch(async () => {
      const found = await this.listOrphanPhases();
      if (found.length === 0) return { found, removed: [] };
      const orphanIds = new Set(found.map((phase) => phase.phaseId));
      for (const orphan of found) {
        try {
          await unlink(this.phasePath(orphan.phaseId));
        } catch {
          // already gone
        }
      }
      await this.updateFeatures((doc) => {
        for (const feature of doc.features) {
          feature.phaseIds = feature.phaseIds.filter((id) => !orphanIds.has(id));
        }
        return doc;
      });
      await this.touchManifest();
      await this.writeGenerated();
      return { found, removed: found };
    });
  }

  async deletePhase(phaseId: string): Promise<void> {
    try {
      await unlink(this.phasePath(phaseId));
    } catch {
      // already gone
    }
    await this.touchManifest();
  }

  // ── Workspace-level operations ─────────────────────────────────────

  /** Load the full workspace (manifest + phases + project + requirements + features) */
  async loadWorkspace(): Promise<PlanWorkspace> {
    const manifest = await this.loadManifest();
    const phases = await this.loadAllPhases();
    const project = await this.loadProject();
    const features = await this.loadFeatures();
    const requirements = await this.loadRequirements();
    return { manifest, phases, project, features, requirements };
  }

  // ── Markdown generation ────────────────────────────────────────────

  /** Load all data, render markdown, and write into generated/. */
  async writeGenerated(): Promise<string[]> {
    const { PlanRenderer } = await import("./renderer.js");
    const plan = await this.loadAll();
    const renderer = new PlanRenderer();
    const files = renderer.render(plan);
    const written: string[] = [];
    const genDir = this.generatedDir();
    const phasesDir = join(genDir, "phases");
    await mkdir(phasesDir, { recursive: true });

    for (const [relPath, content] of files) {
      const fullPath = join(genDir, relPath);
      // Ensure subdirectory exists
      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      if (dir !== genDir) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(fullPath, content, "utf-8");
      written.push(relPath);
    }

    return written;
  }

  // ── Touch ────────────────────────────────────────────────────────────

  /** Update manifest.updatedAt to reflect a change. */
  private async touchManifest(): Promise<void> {
    try {
      const m = await this.loadManifest();
      m.updatedAt = nowISO();
      await atomicWriteJson(this.manifestPath(), m);
    } catch {
      // if manifest doesn't exist yet, skip
    }
  }
}
