import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";

/** Canonical `.planner/.gitignore` content (P042 spec): ignore the `.local/`
 *  transient root, legacy `*.bak` crash backups, `*.tmp.*` atomic-write temp
 *  files, and the legacy root-level `generated/` dir (now under `.local/`).
 *  Shared by `init()` and `ensureGitignore()` so the two never drift. */
const PLANNER_GITIGNORE = [
  "# Agent Plan transient/derived/session-local files — do not track",
  ".local/",
  "*.bak",
  "*.tmp.*",
  "generated/",
  "",
].join("\n");
import {
  CodebaseProfileSchema,
  FeatureSchema,
  type Feature,
  type FeaturesDocument,
  type HandoffSupportingDocument,
  FeaturesDocumentSchema,
  ManifestSchema,
  type Manifest,
  PhaseSchema,
  type Phase,
  type Task,
  type TaskPauseSnapshot,
  TaskPauseSnapshotSchema,
  type PlanWorkspace,
  PlanWorkspaceSchema,
  type Project,
  ProjectSchema,
  type RequirementsDocument,
  type Requirement,
  RequirementsDocumentSchema,
  type Idea,
  type IdeasDocument,
  type IdeaPromotion,
  type IdeaPromotionTargetType,
  IdeaSchema,
  IdeasDocumentSchema,
  ResumeFocusSchema,
  ActivityLogSchema,
  TimestampSchema,
  type ActivityEntry,
  type ActivityLog,
  type CodebaseProfile,
  type ResumeFocus,
  type WorkDeviation,
  WorkDeviationSchema,
} from "./schema.js";
import { createFeatureId, createIdeaId, createPhaseId, createRequirementId, createShortId, createStatusLogEntryId, createTaskId, formatFeatureRef, formatIdeaRef, formatPhaseRef, formatThreeDigitNumber, isLegacyPhaseId } from "./naming.js";
import { deriveParentDisplay, fromCanonicalStatus, type ParentDisplay, type WorkflowStatus } from "./display-status.js";
import { loadExtensionRules, PLANNER_EXTENSION_RULES } from "./planner-rules.js";
import { loadProjectGrillMeSkill, syncProjectGrillMeSkill, syncProjectPlannerSkill, type PlannerSkillSyncResult } from "./planner-skill.js";
import {
  applyLegacyProjectContextMigration,
  plannerSessionPreparationResult,
  previewLegacyProjectContextMigration,
  type LegacyProjectContextMigrationPreview,
  type LegacyProjectContextMigrationResult,
  type PlannerSessionPreparationResult,
} from "./project-context-migration.js";
import {
  applyHandoffContextSync,
  auditPhaseHandoff,
  handoffContentHash,
  HandoffContractError,
  type HandoffSupportingDocumentInput,
  type PhaseHandoffAudit,
  type RefreshPhaseHandoffInput,
  type RefreshPhaseHandoffResult,
} from "./handoff-context.js";

function nowISO(): string {
  return new Date().toISOString();
}

const MAX_SESSION_INFO_ENTRIES = 16;

export interface RecordContextReadInput {
  sessionId: string;
  phaseId: string;
  taskId: string;
  featureId?: string;
  requirementIds?: string[];
  createdAt?: string;
}

export interface RecordContextReadResult {
  phase: Phase;
  feature?: Feature;
  requirements: Requirement[];
  createdAt: string;
}

export interface IdeaCreateInput {
  title: string;
  description?: string;
}

export interface IdeaUpdateInput {
  title?: string;
  description?: string;
}

export interface IdeaPromotionTargetInput {
  targetType: IdeaPromotionTargetType;
  targetId: string;
  promotedAt?: string;
}

function upsertSessionInfo<T extends { sessionInfo: Array<{ sessionId: string; createdAt: string }> }>(
  entity: T,
  sessionId: string,
  createdAt: string,
): { entity: T; changed: boolean } {
  const nextInfo = [
    ...entity.sessionInfo.filter((entry) => entry.sessionId !== sessionId),
    { sessionId, createdAt },
  ]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_SESSION_INFO_ENTRIES);
  const changed = nextInfo.length !== entity.sessionInfo.length
    || nextInfo.some((entry, index) => entry.sessionId !== entity.sessionInfo[index]?.sessionId || entry.createdAt !== entity.sessionInfo[index]?.createdAt);
  return changed ? { entity: { ...entity, sessionInfo: nextInfo }, changed: true } : { entity, changed: false };
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

/** Allocation registry is deliberately outside the versioned plan. Git worktrees
 * share their common git dir, so reservations are serialized across branches
 * without rewriting project.json or unrelated planner entities. */
const AllocationKindSchema = z.enum(["feature", "phase", "task", "idea"]);
const AllocationRegistrySchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  allocations: z.array(z.object({
    kind: AllocationKindSchema,
    entityId: z.string().min(1),
    number: z.number().int().positive(),
    shortId: z.string().regex(/^[A-Z2-9]{5}$/),
  })).default([]),
});
type AllocationKind = z.infer<typeof AllocationKindSchema>;
type Allocation = z.infer<typeof AllocationRegistrySchema>["allocations"][number];

async function gitCommonDirFor(planRoot: string): Promise<string | undefined> {
  let current = resolve(planRoot);
  for (;;) {
    const dotGit = join(current, ".git");
    try {
      const info = await stat(dotGit);
      if (info.isDirectory()) return dotGit;
      const pointer = await readFile(dotGit, "utf8");
      const match = pointer.match(/^gitdir:\s*(.+)\s*$/m);
      if (!match?.[1]) return undefined;
      const worktreeGitDir = resolve(current, match[1]);
      const commonDirRef = await readFile(join(worktreeGitDir, "commondir"), "utf8").catch(() => "");
      return commonDirRef.trim() ? resolve(worktreeGitDir, commonDirRef.trim()) : worktreeGitDir;
    } catch {
      const parent = dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

async function writeRegistry(path: string, registry: z.infer<typeof AllocationRegistrySchema>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(registry, null, 2), "utf8");
  await rename(tmp, path);
}

async function acquireCrossProcessLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });

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

async function atomicWriteText(path: string, raw: string, root?: string): Promise<void> {
  return withWriteLock(path, async () => {
    writeBusyHook?.(true);
    const localRoot = root ? join(root, ".local") : undefined;
    const tmpDir = localRoot ? join(localRoot, "tmp") : dirname(path);
    const backupsRoot = localRoot ? join(localRoot, "backups") : dirname(path);
    const rel = localRoot && path.startsWith(localRoot)
      ? path.slice(localRoot.length).replace(/^\//, "")
      : root && path.startsWith(root)
        ? path.slice(root.length).replace(/^\//, "")
        : basename(path);
    const backupRel = rel ? rel + ".bak" : basename(path) + ".bak";
    const backupPath = join(backupsRoot, backupRel);
    const tmpName = rel ? rel.replace(/[/\\]/g, "--") + `.tmp.${process.pid}.${Date.now()}` : `${basename(path)}.tmp.${process.pid}.${Date.now()}`;
    const tmp = join(tmpDir, tmpName);
    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(tmp, raw, "utf-8");
      try {
        await mkdir(dirname(backupPath), { recursive: true });
        await copyFile(path, backupPath);
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

async function atomicWriteJson(path: string, data: unknown, root?: string): Promise<void> {
  return atomicWriteText(path, JSON.stringify(data, null, 2), root);
}

async function atomicUpdateJson<T>(path: string, schema: { parse(v: unknown): T }, updater: (data: T) => T, root?: string): Promise<T> {
  // NOTE: write the file INLINE here, do NOT call atomicWriteJson/atomicWriteText,
  // because those re-acquire withWriteLock(path) — and we already hold it (below).
  // Re-entrant locking is not supported, so calling them would deadlock.
  return withWriteLock(path, async () => {
    const current = await readJson(path, schema);
    const updated = updater(current);
    const parsed = schema.parse(updated);
    writeBusyHook?.(true);
    const localRoot = root ? join(root, ".local") : undefined;
    const tmpDir = localRoot ? join(localRoot, "tmp") : dirname(path);
    const backupsRoot = localRoot ? join(localRoot, "backups") : dirname(path);
    const rel = localRoot && path.startsWith(localRoot)
      ? path.slice(localRoot.length).replace(/^\//, "")
      : root && path.startsWith(root)
        ? path.slice(root.length).replace(/^\//, "")
        : basename(path);
    const backupPath = join(backupsRoot, rel + ".bak");
    const tmpName = rel ? rel.replace(/[/\\]/g, "--") + `.tmp.${process.pid}.${Date.now()}` : `${basename(path)}.tmp.${process.pid}.${Date.now()}`;
    const tmp = join(tmpDir, tmpName);
    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(tmp, JSON.stringify(parsed, null, 2), "utf-8");
      try {
        await mkdir(dirname(backupPath), { recursive: true });
        await copyFile(path, backupPath);
      } catch {}
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

/** Summary of a phase that has a non-empty pending handoff, for the
 * listHandoffs() API. Completed/canceled phases are never returned here. */
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
  /** Full content is omitted by default so agent list transports stay bounded.
   * Request includeContent only for trusted UI/API consumers. */
  content?: string | undefined;
  auditVersion: number | null;
  contentLength: number;
  contentHash: string;
  verifiedAt: string;
}

/** Summary of an archived handoff. The content remains recoverable under
 * `.planner/.local/handoff-archive/` but is not part of the active handoff
 * list. */
export interface ArchivedPhaseHandoffSummary {
  phaseId: string;
  featureId?: string | undefined;
  compositeRef: string;
  file: string;
  archivedAt: string;
  reason: string;
  firstLine: string;
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

/** Map legacy/removed status strings to their canonical replacements before
 * schema validation. Canonical task status "paused" was removed from the
 * domain; persisted entities (tasks, statusLog entries) may still carry it.
 * Rewriting on read keeps legacy data loadable without a one-time migration
 * pass, and the normalized value is persisted on the next save. Scoped to
 * status-bearing fields so unrelated string values are never touched. */
function migrateLegacyStatuses(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateLegacyStatuses);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === "status" || key === "fromStatus" || key === "toStatus") && child === "paused") {
        out[key] = "planned";
      } else {
        out[key] = migrateLegacyStatuses(child);
      }
    }
    return out;
  }
  return value;
}

/** Walk up from `path` to find the owning `.planner` root, so crash-recovery
 *  can locate `.local/backups/<rel>.bak` without every readJson caller threading
 *  `root`. Returns undefined if no `.planner` ancestor exists. */
function findPlannerRoot(path: string): string | undefined {
  let dir = dirname(path);
  while (dir !== dirname(dir)) {
    if (basename(dir) === ".planner") return dir;
    dir = dirname(dir);
  }
  return undefined;
}

async function readJson<T>(path: string, schema: { parse(v: unknown): T }): Promise<T> {
  let backupTried = false;
  let backupFailed = false;
  let rawPreview: string | undefined;

  try {
    const raw = await readFile(path, "utf-8");
    rawPreview = raw.slice(0, 240);
    return schema.parse(migrateLegacyStatuses(JSON.parse(raw)));
  } catch (cause) {
    // Recover from the previous-version backup before giving up:
    //  1) legacy inline `<file>.bak` (next to the source), then
    //  2) the relocated `.planner/.local/backups/<rel>.bak` (P043).
    backupTried = true;
    const tryBackup = async (bakPath: string): Promise<T | undefined> => {
      try {
        const bak = await readFile(bakPath, "utf-8");
        rawPreview = bak.slice(0, 240);
        return schema.parse(migrateLegacyStatuses(JSON.parse(bak)));
      } catch {
        return undefined;
      }
    };
    const inline = await tryBackup(`${path}.bak`);
    if (inline !== undefined) return inline;
    let local: T | undefined;
    const plannerRoot = findPlannerRoot(path);
    if (plannerRoot) {
      const rel = path.slice(plannerRoot.length).replace(/^\//, "");
      local = await tryBackup(join(plannerRoot, ".local", "backups", rel + ".bak"));
    }
    if (local !== undefined) return local;
    backupFailed = true;
    // fall through to original error

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
    const normalized = tasks.map((task) => {
      const descriptionUpdatedAt = (task.description || task.descriptionRef) && !task.descriptionUpdatedAt
        ? task.createdAt
        : task.descriptionUpdatedAt;
      const normalizedStatus = (task.status as string) === "paused" ? "planned" : task.status;
      const pauseSnapshot = this.isTerminalTaskStatus(normalizedStatus) ? null : task.pauseSnapshot;
      const statusLog = (task.statusLog ?? []).map((entry) => ({
        ...entry,
        fromStatus: (entry.fromStatus as string) === "paused" ? "planned" : entry.fromStatus,
        toStatus: (entry.toStatus as string) === "paused" ? "planned" : entry.toStatus,
      }));
      if (
        descriptionUpdatedAt !== task.descriptionUpdatedAt
        || normalizedStatus !== task.status
        || pauseSnapshot !== task.pauseSnapshot
        || statusLog.some((entry, index) => entry !== task.statusLog[index])
      ) {
        return { ...task, descriptionUpdatedAt, status: normalizedStatus, pauseSnapshot, statusLog };
      }
      return task;
    });
    return { tasks: normalized, changed: normalized.some((task, index) => task !== tasks[index]) };
  }

  private isTerminalTaskStatus(status: Task["status"] | undefined): boolean {
    return status === "done" || status === "canceled" || status === "rejected";
  }

  private async pruneObsoleteWorkDeviations(): Promise<void> {
    const phases = await this.loadAllPhases();
    const taskStatusById = new Map(phases.flatMap((phase) => phase.tasks.map((task) => [task.id, task.status] as const)));
    const current = await this.loadWorkDeviations();
    const next = current.filter((deviation) => {
      const resumeStatus = taskStatusById.get(deviation.resumeTaskId);
      return Boolean(resumeStatus) && !this.isTerminalTaskStatus(resumeStatus);
    });
    if (next.length === current.length) return;
    await this.saveWorkDeviations(next);
    await this.refreshResume();
  }

  /** Stamp description edits independently from generic entity mutations.
   * Legacy entities cannot reveal their historical description-edit time, so
   * their creation time is the earliest truthful fallback. */
  private stampDescriptionUpdatedAt<T extends { description: string; descriptionUpdatedAt: string; createdAt: string } & { descriptionRef?: string | undefined }>(
    entity: T,
    previousDescription: string | undefined,
    previousDescriptionRef: string | undefined,
    timestamp: string,
  ): T {
    if (!entity.description && !entity.descriptionRef) return { ...entity, descriptionUpdatedAt: "" } as T;
    if (
      previousDescription === undefined
      || previousDescription !== entity.description
      || previousDescriptionRef !== entity.descriptionRef
    ) {
      return { ...entity, descriptionUpdatedAt: timestamp } as T;
    }
    return entity.descriptionUpdatedAt ? entity : { ...entity, descriptionUpdatedAt: entity.createdAt } as T;
  }

  private stampProjectGuidelinesUpdatedAt(
    project: Project,
    previousContent: string | undefined,
    timestamp: string,
  ): Project {
    const nextContent = project.projectGuidelines.content.trim();
    const nextGuidelines = {
      content: nextContent,
      updatedAt: project.projectGuidelines.updatedAt,
      sessionInfo: project.projectGuidelines.sessionInfo,
    };
    if (!nextContent) {
      return {
        ...project,
        projectGuidelines: {
          ...nextGuidelines,
          updatedAt: "",
          sessionInfo: [],
        },
      };
    }
    if (previousContent === undefined || previousContent !== nextContent) {
      return {
        ...project,
        projectGuidelines: {
          ...nextGuidelines,
          updatedAt: timestamp,
        },
      };
    }
    if (nextGuidelines.updatedAt) {
      return { ...project, projectGuidelines: nextGuidelines };
    }
    return {
      ...project,
      projectGuidelines: {
        ...nextGuidelines,
        updatedAt: timestamp,
      },
    };
  }

  private normalizeFeaturesDocument(doc: FeaturesDocument): { doc: FeaturesDocument; changed: boolean } {
    // Numbers are a STABLE global sequence (assigned once at create from project.nextFeatureNumber).
    const features = doc.features.map((feature) => (feature.description || feature.descriptionRef) && !feature.descriptionUpdatedAt
      ? { ...feature, descriptionUpdatedAt: feature.createdAt }
      : feature);
    return { doc: { ...doc, features }, changed: features.some((feature, index) => feature !== doc.features[index]) };
  }

  private normalizePhaseDocument(phase: RawPhase): { phase: RawPhase; changed: boolean } {
    const { tasks, changed } = this.normalizeTasks(phase.tasks);
    const nextTaskIds = tasks.map((task) => task.id);
    const taskIdsChanged = nextTaskIds.length !== phase.taskIds.length || nextTaskIds.some((id, index) => id !== phase.taskIds[index]);
    const descriptionUpdatedAt = (phase.description || phase.descriptionRef) && !phase.descriptionUpdatedAt ? phase.createdAt : phase.descriptionUpdatedAt;
    const descriptionTimestampChanged = descriptionUpdatedAt !== phase.descriptionUpdatedAt;
    return {
      phase: {
        ...phase,
        descriptionUpdatedAt,
        tasks,
        taskIds: nextTaskIds,
      },
      changed: changed || taskIdsChanged || descriptionTimestampChanged,
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
  private ideasPath(): string {
    return join(this.root, "ideas.json");
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
      await atomicWriteJson(this.featurePath(feat.id), feat, this.root);
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
    return join(this.localRoot(), "generated");
  }
  private codebasePath(): string {
    return join(this.root, "codebase.json");
  }
  private resumePath(): string {
    return join(this.localRoot(), "resume.json");
  }
  private activityPath(): string {
    return join(this.localRoot(), "activity.json");
  }
  private localRoot(): string {
    // Worktree-local, git-ignored runtime state. The shared-vs-local boundary
    // and the invariants every harness relies on are documented in
    // packages/plan-core/docs/runtime-boundaries.md.
    return join(this.root, ".local");
  }
  private deviationsPath(): string {
    return join(this.localRoot(), "deviations.json");
  }

  /** Runtime work deviations, persisted in worktree-local `.local/deviations.json`
   *  (never in shared `project.json`). Falls back to `[]` on a missing/corrupt file. */
  private async loadWorkDeviations(): Promise<WorkDeviation[]> {
    try {
      return await readJson(this.deviationsPath(), WorkDeviationSchema.array());
    } catch {
      return [];
    }
  }

  private async saveWorkDeviations(deviations: WorkDeviation[]): Promise<void> {
    await atomicWriteJson(this.deviationsPath(), deviations, this.root);
    await this.maybeAutoSync();
  }
  private timestampPath(): string {
    return join(this.localRoot(), "timestamp.json");
  }
  private backupsDir(): string {
    return join(this.localRoot(), "backups");
  }
  private tmpDir(): string {
    return join(this.localRoot(), "tmp");
  }
  private handoffArchiveDir(): string {
    return join(this.localRoot(), "handoff-archive");
  }

  /** One-time migration for plans created before .planner/.local/ existed.
   *  Moves a legacy root-level file into .local/ if the legacy file exists and
   *  the .local/ counterpart does not. Safe to call on every load. */
  private async migrateLegacyLocalFile(oldPath: string, newPath: string): Promise<void> {
    try {
      await access(oldPath);
    } catch {
      return;
    }
    try {
      await access(newPath);
      return;
    } catch {}
    await mkdir(dirname(newPath), { recursive: true });
    await rename(oldPath, newPath);
  }

  private async migrateLegacyGeneratedDir(): Promise<void> {
    const oldDir = join(this.root, "generated");
    const newDir = this.generatedDir();
    try {
      await access(oldDir);
    } catch {
      return;
    }
    try {
      await access(newDir);
      return;
    } catch {}
    await rename(oldDir, newDir);
  }

  private async migrateLegacyHandoffArchive(): Promise<void> {
    const oldDir = join(this.root, "handoff-archive");
    const newDir = this.handoffArchiveDir();
    try {
      await access(oldDir);
    } catch {
      return;
    }
    try {
      await access(newDir);
      return;
    } catch {}
    await rename(oldDir, newDir);
  }

  // ── Init ─────────────────────────────────────────────────────────────

  async init(projectName: string): Promise<void> {
    if (await this.exists()) {
      throw new PlanStoreError(".planner/ already exists");
    }

    await mkdir(this.root, { recursive: true });
    await mkdir(this.phasesDir(), { recursive: true });
    await mkdir(this.featuresDir(), { recursive: true });
    await mkdir(this.localRoot(), { recursive: true });
    await mkdir(this.backupsDir(), { recursive: true });
    await mkdir(this.tmpDir(), { recursive: true });
    await mkdir(join(this.generatedDir(), "phases"), { recursive: true });
    await mkdir(this.handoffArchiveDir(), { recursive: true });
    await mkdir(join(this.root, "schema"), { recursive: true });
    await mkdir(join(this.root, "adapters"), { recursive: true });

    const manifest: Manifest = {
      schemaVersion: 1,
      projectId: crypto.randomUUID(),
      projectName,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    await atomicWriteJson(this.manifestPath(), manifest, this.root);
    await atomicWriteJson(this.timestampPath(), { updatedAt: manifest.updatedAt }, this.root);
    // Seed the worktree-local runtime-deviation store (T299). Empty for new
    // projects; migrateWorkDeviations (loadProject) backfills legacy data.
    await atomicWriteJson(this.deviationsPath(), [], this.root);
    await this.saveProject({
      name: projectName,
      goal: "",
      description: "",
      projectGuidelines: {
        content: "",
        updatedAt: "",
        sessionInfo: [],
      },
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
      workDeviations: [],
    });
    await this.saveRequirements({ requirements: [] });
    await this.saveIdeas({ nextIdeaNumber: 1, ideas: [] });
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

    // Write the STATIC planner extension rules. Content is fixed (no timestamps,
    // no dynamic data) so the file is identical across worktrees/branches and
    // never causes git conflicts. The canonical source is plan-core; this file
    // is the per-project copy / override point, loaded at planner startup.
    await writeFile(
      join(this.root, "rules.json"),
      JSON.stringify({ extensionRules: PLANNER_EXTENSION_RULES }, null, 2),
      "utf-8",
    );
    await this.syncPlannerSkill();
    await this.syncGrillMeSkill();

    // Write a README stub
    const readme = [
      "# Project Plan",
      "",
      `This is the project plan for **${projectName}** — managed by Agent Plan Platform.`,
      "",
      "## Structure",
      "",
      "- `manifest.json` — metadata",
      "- `SKILL.md` — managed cross-harness planner operating guide",
      "- `skills/grill-me/SKILL.md` — managed idea-discussion interview skill",
      "- `project.json` — scope, rules, stack, tools",
      "- `requirements.json` — requirements and macro-tasks",
      "- `ideas.json` — top-level Ideas Inbox (excluded from work status derivation)",
      "- `phases/` — one JSON file per phase",
      "- `generated/` — auto-generated markdown views (under `.local/`)",
      "- `schema/plan.schema.json` — JSON Schema for tooling",
    ].join("\n");
    await writeFile(join(this.root, "README.md"), readme, "utf-8");

    // Write a .gitignore inside .planner/ so transient/derived files are
    // not tracked by the host project's git. Git respects nested .gitignore.
    // - *.bak/*.tmp.*: crash backups from atomic writes
    // - resume.json: per-session resume focus + the machine-local guard-bypass
    //   timestamp (guardBypassUntil must NOT leak into git/other clones)
    // - generated/: auto-regenerated markdown views (derived from JSON; churn)
    await writeFile(join(this.root, ".gitignore"), PLANNER_GITIGNORE, "utf-8");
  }

  /**
   * Planner extension rules — the agent-behavior contract for every project
   * using the extension. Loaded from the static .planner/rules.json if present,
   * otherwise the canonical code set. Static (no timestamps), safe across
   * worktrees/branches.
   */
  async extensionRules(): Promise<string[]> {
    return loadExtensionRules(this.root);
  }

  /**
   * Create or safely refresh the project-local planner usage skill. Explicit
   * planner-load surfaces call this so unmodified managed copies follow the
   * installed Agent Plan version while project customizations are preserved.
   */
  async syncPlannerSkill(): Promise<PlannerSkillSyncResult> {
    return syncProjectPlannerSkill(this.root);
  }

  /** Safely create or refresh the project-local grill-me skill for Ideas. */
  async syncGrillMeSkill(): Promise<PlannerSkillSyncResult> {
    return syncProjectGrillMeSkill(this.root);
  }

  /** Load grill-me instructions only when an Ideas discussion requests them. */
  async ideaDiscussionSkill(): Promise<string> {
    return loadProjectGrillMeSkill(this.root);
  }

  /** Idempotently ensure `.planner/.gitignore` ignores `.local/` (and the
   *  canonical transient/derived patterns). Projects initialized before the
   *  `.local/` move either have no `.planner/.gitignore` or one with stale
   *  root-level patterns. This upgrades them safely on load and on repair.
   *  Returns true if the file was (re)written. Safe to call on every load. */
  async ensureGitignore(): Promise<boolean> {
    const gi = join(this.root, ".gitignore");
    try {
      const existing = await readFile(gi, "utf8").catch(() => null);
      // Up to date iff it contains all canonical patterns (P042 spec):
      // .local/ (transients), *.bak (crash backups), *.tmp.* (atomic-write
      // temp files), generated/ (legacy dir).
      if (existing != null && existing.includes(".local/") && existing.includes("*.bak") && existing.includes("*.tmp.*") && existing.includes("generated/")) {
        return false;
      }
      await writeFile(gi, PLANNER_GITIGNORE, "utf-8");
      return true;
    } catch {
      return false;
    }
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

  /** Read-only manifest load. Upgrading legacy `.local` state is explicit
   * maintenance (`repair`), never an incidental side effect of opening a plan. */
  async loadManifest(): Promise<Manifest> {
    const manifest = await readJson(this.manifestPath(), ManifestSchema);
    const timestamp = await readJson(this.timestampPath(), z.object({ updatedAt: TimestampSchema })).catch(() => undefined);
    return timestamp ? { ...manifest, updatedAt: timestamp.updatedAt } : manifest;
  }

  async loadProject(): Promise<Project> {
    const project = await readJson(this.projectPath(), ProjectSchema);
    // One-time migration (T299): move runtime workDeviations from the shared
    // project.json into worktree-local .local/deviations.json, then clear them
    // in project.json so runtime state never churns shared metadata.
    // Idempotent: a non-empty .local file is never overwritten.
    if (project.workDeviations.length > 0 && (await this.loadWorkDeviations()).length === 0) {
      await this.saveWorkDeviations(project.workDeviations);
      await atomicUpdateJson(this.projectPath(), ProjectSchema, (p) => ({ ...p, workDeviations: [] }), this.root);
    }
    // Read-view merge: readers keep using `project.workDeviations`, but the
    // values now come from worktree-local storage.
    const deviations = await this.loadWorkDeviations();
    return { ...project, workDeviations: deviations };
  }

  /**
   * Reserve immutable human identifiers without touching tracked `project.json`.
   * Worktrees in the same clone share `.git/agent-plan/allocations`, guarded by
   * the same cross-process lock used for atomic writes. The registry reserves
   * numbers/short IDs before an entity file is written, so parallel branches
   * cannot allocate the same F/P/T/I or shortId. Existing entities are never
   * rewritten; cross-clone coordination requires a shared allocator service.
   */
  async allocateEntityIdentity(kind: AllocationKind, entityId: string): Promise<{ number: number; shortId: string }> {
    const project = await this.loadProject();
    const manifest = await this.loadManifest();
    const commonGitDir = await gitCommonDirFor(this.root);
    const registryPath = commonGitDir
      ? join(commonGitDir, "agent-plan", "allocations", `${manifest.projectId}.json`)
      : join(this.localRoot(), "allocations", `${manifest.projectId}.json`);

    return withWriteLock(registryPath, async () => {
      const registry = AllocationRegistrySchema.parse(await readFile(registryPath, "utf8")
        .then(JSON.parse)
        .catch(() => ({ version: 1, projectId: manifest.projectId, allocations: [] })));
      if (registry.projectId !== manifest.projectId) throw new PlanStoreError(`allocation registry project mismatch: ${registryPath}`);
      const prior = registry.allocations.find((entry) => entry.kind === kind && entry.entityId === entityId);
      if (prior) return { number: prior.number, shortId: prior.shortId };

      const phases = await this.loadAllPhases();
      const features = (await this.loadFeatures()).features;
      const ideasDocument = await this.loadIdeas();
      const ideas = ideasDocument.ideas;
      const canonical = kind === "feature"
        ? features.map((feature) => ({ number: feature.number, shortId: feature.shortId }))
        : kind === "phase"
          ? phases.map((phase) => ({ number: phase.number, shortId: phase.shortId }))
          : kind === "task"
            ? phases.flatMap((phase) => phase.tasks.map((task) => ({ number: task.number, shortId: task.shortId })))
            : ideas.map((idea) => ({ number: idea.number, shortId: idea.shortId }));
      const usedNumbers = new Set([...canonical.map((entry) => entry.number), ...registry.allocations.filter((entry) => entry.kind === kind).map((entry) => entry.number)]);
      const counter = kind === "feature"
        ? project.nextFeatureNumber
        : kind === "phase"
          ? project.nextPhaseNumber
          : kind === "task"
            ? project.nextTaskNumber
            : ideasDocument.nextIdeaNumber;
      let number = Math.max(1, counter);
      while (usedNumbers.has(number)) number += 1;

      const allShortIds = new Set<string>([
        ...features.map((feature) => feature.shortId),
        ...phases.flatMap((phase) => [phase.shortId, ...phase.tasks.map((task) => task.shortId)]),
        ...ideas.map((idea) => idea.shortId),
        ...registry.allocations.map((entry) => entry.shortId),
      ].filter(Boolean));
      const allocation: Allocation = { kind, entityId, number, shortId: createShortId(allShortIds, `${kind}:${entityId}`) };
      registry.allocations.push(allocation);
      await writeRegistry(registryPath, registry);
      return { number: allocation.number, shortId: allocation.shortId };
    });
  }

  /** Compatibility helpers. New callers should allocate the number and shortId
   * together with allocateEntityIdentity so reservation cannot be split. */
  async allocFeatureNumber(): Promise<number> { return this.allocateLegacyNumber("feature"); }
  async allocPhaseNumber(): Promise<number> { return this.allocateLegacyNumber("phase"); }
  async allocTaskNumber(): Promise<number> { return this.allocateLegacyNumber("task"); }
  async allocIdeaNumber(): Promise<number> { return this.allocateLegacyNumber("idea"); }
  private async allocateLegacyNumber(kind: AllocationKind): Promise<number> {
    const id = `legacy-${kind}-${randomUUID()}`;
    return (await this.allocateEntityIdentity(kind, id)).number;
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
    // Keep legacy feature descriptions displayable without rewriting on read.
    // Phase/task reads already apply the equivalent creation-date fallback.
    const normalizedFeatures = this.normalizeFeaturesDocument({ features }).doc.features;
    return this.normalizeStructureSnapshot({ features: normalizedFeatures }, phases).features;
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
    await atomicWriteJson(this.codebasePath(), parsed, this.root);
    await this.touchTimestamp();
  }

  async loadResume(): Promise<ResumeFocus | null> {
    await this.migrateLegacyLocalFile(join(this.root, "resume.json"), this.resumePath());
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
    await atomicWriteJson(this.resumePath(), parsed, this.root);
    await this.touchTimestamp();
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
    await this.migrateLegacyLocalFile(join(this.root, "activity.json"), this.activityPath());
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
    await atomicWriteJson(this.activityPath(), { entries: log.entries }, this.root);
    await this.touchTimestamp();
    return entry;
  }


  /** Derive an up-to-date resume focus from the current workspace state. */
  async refreshResume(notes?: string, lastSessionSummary?: string): Promise<ResumeFocus> {
    const workspace = await this.loadAll();
    const inProgressPhases = workspace.phases.filter((p) => p.status === "in-progress");
    const activePhase = workspace.phases.find((phase) => phase.tasks.some((task) => task.status === "in-progress"));
    const inProgressTasks = workspace.phases.flatMap((p) => p.tasks.filter((t) => t.status === "in-progress"));
    const blockedTasks = workspace.phases.flatMap((p) => p.tasks.filter((t) => t.status === "blocked"));
    const existing = await this.loadResume();
    const resume: ResumeFocus = {
      updatedAt: nowISO(),
      currentPhaseId: activePhase?.id ?? (existing?.currentPhaseId || inProgressPhases[0]?.id || ""),
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

  async loadIdeas(): Promise<IdeasDocument> {
    try {
      const document = await readJson(this.ideasPath(), IdeasDocumentSchema);
      return {
        ...document,
        ideas: [...document.ideas].sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt)),
      };
    } catch {
      return { nextIdeaNumber: 1, ideas: [] };
    }
  }

  async linkedRequirementsForPhase(phaseId: string): Promise<Requirement[]> {
    const requirements = await this.loadRequirements();
    return requirements.requirements.filter((requirement) => requirement.linkedPhaseIds.includes(phaseId));
  }

  /** Requirements linked to any phase belonging to a feature, deduplicated by ID. */
  async linkedRequirementsForFeature(featureId: string): Promise<Requirement[]> {
    const [phases, requirements] = await Promise.all([this.loadAllPhases(), this.loadRequirements()]);
    const phaseIds = new Set(phases.filter((phase) => phase.featureId === featureId).map((phase) => phase.id));
    return requirements.requirements.filter((requirement) => requirement.linkedPhaseIds.some((phaseId) => phaseIds.has(phaseId)));
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
    const [manifest, project, requirements, ideas, phases] = await Promise.all([
      this.loadManifest(),
      this.loadProject(),
      this.loadRequirements(),
      this.loadIdeas(),
      this.loadAllPhases(),
    ]);
    const rawFeatures = await this.loadRawFeatures();
    const features: Feature[] = rawFeatures.map((f) => ({ ...f, status: this.deriveFeatureStatus(f.id, phases) }));
    const normalized = this.normalizeStructureSnapshot({ features }, phases);
    return { manifest, project, requirements, ideas, phases: normalized.phases, features: normalized.features };
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
      await this.unlinkPhaseFiles(oldId);
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
      const backupsRoot = join(this.root, ".local", "backups");
      const walkBackups = async (dir: string): Promise<void> => {
        let entries: string[] = [];
        try { entries = await readdir(dir); } catch { return; }
        for (const name of entries) {
          const full = join(dir, name);
          let st;
          try { st = await stat(full); } catch { continue; }
          if (st.isDirectory()) { await walkBackups(full); continue; }
          if (!name.endsWith(".json.bak")) continue;
          const rel = full.slice(backupsRoot.length).replace(/^\//, "");
          const mainPath = join(this.root, rel.slice(0, -".bak".length));
          try { await stat(mainPath); } catch { try { await unlink(full); removed += 1; } catch { /* ignore */ } }
        }
      };
      await walkBackups(backupsRoot);
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
          f.shortId = createShortId(existing, `feature:${f.number}:${f.id}`);
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
          phase.shortId = createShortId(existing, `phase:${phase.number}:${phase.id}`);
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
            t.shortId = createShortId(existing, `task:${t.number}:${t.id}`);
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
    handoffs: { archived: number };
    integrity: { duplicatePhaseIds: string[]; danglingPhaseIds: string[]; duplicateShortIds: string[] };
  }> {
    return this.runAsBatch(async () => {
      // Ensure the .planner/.gitignore ignores transients (P042). Idempotent;
      // upgrades plans initialized before the .local/ move.
      await this.ensureGitignore().catch(() => {});
      const migrated = await this.migratePhaseIds();
      await this.repairPhaseFeatureRefs();
      const backfill = await this.ensureShortIdsAndPriority();
      // Rebuild phase containment from each task's own phaseId. Heals plans
      // corrupted by the migrateToGlobalSequence index-mismatch bug (core
      // <0.2.19-next.7). Lossless + idempotent — safe to run every repair.
      const containment = await this.rebuildContainment();
      const handoffs = { archived: await this.archiveStaleHandoffs() };
      const integrity = await this.validateIntegrity();
      await this.writeGenerated();
      return { migrated, backfill, containment, handoffs, integrity };
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

  /** A handoff remains active while any task needs work. Its automatic end-of-
   * phase lifecycle is deliberately narrower than canonical display status:
   * every task must be done or canceled (not merely derived "rejected"). */
  private hasCompletedHandoffLifecycle(tasks: Task[]): boolean {
    return tasks.length > 0 && tasks.every((task) => task.status === "done" || task.status === "canceled");
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
    if (hasDone && !hasPlanned && !hasBlocked && !hasWaiting && hasDeferred) return "deferred";
    // Partial completion with remaining planned/blocked/waiting work still means
    // the phase has genuinely started and is not terminal yet.
    if (hasDone) return "in-progress";
    // No progress at all ⇒ surface the stall / not-started state.
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

  /** Auto-clear a phase's handoff only when every task is terminal as done or
   *  canceled. This covers an all-canceled phase too, whose legacy canonical
   *  derived status is "rejected". Returns the composite ref when cleared. */
  async syncTaskStatusRollup(phaseId: string): Promise<string | null> {
    const phase = await this.loadPhase(phaseId);
    let cleared: string | null = null;
    if (this.hasCompletedHandoffLifecycle(phase.tasks) && phase.handoff !== "") {
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
    const timestamp = nowISO();
    const updated = await atomicUpdateJson(this.projectPath(), ProjectSchema, (current) => {
      const previousGuidelines = current.projectGuidelines.content;
      const candidate = updater(current);
      return this.stampProjectGuidelinesUpdatedAt(candidate, previousGuidelines, timestamp);
    }, this.root);
    await this.maybeAutoSync();
    return updated;
  }

  /** Preview the explicit, lossless migration from legacy project rule and
   * decision fields into Project Guidelines and structured accepted decisions. */
  async previewLegacyProjectContextMigration(): Promise<LegacyProjectContextMigrationPreview> {
    return previewLegacyProjectContextMigration(await readJson(this.projectPath(), ProjectSchema));
  }

  /** Prepare an explicit planner session before recap/context delivery.
   * Ordinary entity reads remain non-mutating. */
  async preparePlannerSession(): Promise<PlannerSessionPreparationResult> {
    return plannerSessionPreparationResult(await this.migrateLegacyProjectContext());
  }

  /** Apply and verify the legacy project-context migration. Callers must invoke
   * this only from an explicit preparation or compatibility-recovery flow. */
  async migrateLegacyProjectContext(): Promise<LegacyProjectContextMigrationResult> {
    const original = await readJson(this.projectPath(), ProjectSchema);
    const acceptedAt = nowISO();
    const expected = applyLegacyProjectContextMigration(original, acceptedAt);
    if (!expected.applied) return expected;

    await this.updateProject(() => expected.project);
    const persisted = await readJson(this.projectPath(), ProjectSchema);
    const migratedDecisionIds = new Set(expected.preview.acceptedDecisionAdditions.map((decision) => decision.id));
    const persistedDecisionIds = new Set(persisted.acceptedDecisions.map((decision) => decision.id));
    const verified = persisted.projectGuidelines.content === expected.preview.resultingGuidelinesContent
      && persisted.globalRules.length === 0
      && persisted.workflowRules.beforePhaseStart.length === 0
      && persisted.workflowRules.beforeTaskStart.length === 0
      && persisted.workflowRules.afterPhaseComplete.length === 0
      && persisted.decisions.length === 0
      && [...migratedDecisionIds].every((id) => persistedDecisionIds.has(id));
    if (!verified) {
      await atomicWriteJson(this.projectPath(), ProjectSchema.parse(original), this.root);
      throw new PlanStoreError("Legacy project-context migration failed persisted read-back verification; the original project was restored.");
    }
    return { applied: true, preview: expected.preview, project: persisted };
  }

  /** Persist an explicitly approved work deviation without coupling it to a harness. */
  async addWorkDeviation(deviation: WorkDeviation): Promise<Project> {
    const deviations = [...(await this.loadWorkDeviations()), deviation];
    await this.saveWorkDeviations(deviations);
    return this.loadProject();
  }

  /** Advance a deviation while retaining its complete audit and return stack. */
  async setWorkDeviationState(
    id: string,
    state: "active" | "resume-required" | "resolved" | "resumed" | "canceled",
    timestamp = nowISO(),
  ): Promise<Project> {
    const deviations = await this.loadWorkDeviations();
    const next = deviations.map((deviation) => deviation.id !== id ? deviation : {
      ...deviation,
      state,
      activatedAt: state === "active" ? timestamp : deviation.activatedAt,
      resumeRequiredAt: state === "resume-required" ? timestamp : deviation.resumeRequiredAt,
      resolvedAt: state === "resolved" || state === "canceled" ? timestamp : deviation.resolvedAt,
      resumedAt: state === "resumed" ? timestamp : deviation.resumedAt,
    });
    await this.saveWorkDeviations(next);
    return this.loadProject();
  }

  async updateFeatures(updater: (f: FeaturesDocument) => FeaturesDocument): Promise<FeaturesDocument> {
    const updated = await this.withFeaturesLock(async () => {
      await this.migrateLegacy();
      const current = await this.loadFeatures();
      // Updaters commonly mutate `current` in place, so snapshot descriptions
      // before invoking them rather than comparing object references afterward.
      const previousDescriptions = new Map(current.features.map((feature) => [feature.id, feature.description]));
      const previousDescriptionRefs = new Map(current.features.map((feature) => [feature.id, feature.descriptionRef]));
      const timestamp = nowISO();
      const candidate = updater(current);
      const stamped: FeaturesDocument = {
        features: candidate.features.map((feature) => this.stampDescriptionUpdatedAt(feature, previousDescriptions.get(feature.id), previousDescriptionRefs.get(feature.id), timestamp)),
      };
      const upd = this.normalizeFeaturesDocument(stamped).doc;
      await this.saveFeaturesRaw(upd);
      return upd;
    });
    await this.maybeAutoSync();
    return updated;
  }

  async updateRequirements(updater: (r: RequirementsDocument) => RequirementsDocument): Promise<RequirementsDocument> {
    const updated = await atomicUpdateJson(this.requirementsPath(), RequirementsDocumentSchema, updater, this.root);
    await this.maybeAutoSync();
    return updated;
  }

  private async ensureIdeasFileForWrite(): Promise<void> {
    try {
      await access(this.ideasPath());
    } catch {
      await atomicWriteJson(this.ideasPath(), IdeasDocumentSchema.parse({ nextIdeaNumber: 1, ideas: [] }), this.root);
    }
  }

  async updateIdeas(updater: (ideas: IdeasDocument) => IdeasDocument): Promise<IdeasDocument> {
    await this.ensureIdeasFileForWrite();
    const updated = await atomicUpdateJson(this.ideasPath(), IdeasDocumentSchema, (current) => {
      const candidate = IdeasDocumentSchema.parse(updater(current));
      const maxNumber = candidate.ideas.reduce((max, idea) => Math.max(max, idea.number), 0);
      return {
        ...candidate,
        nextIdeaNumber: Math.max(candidate.nextIdeaNumber, maxNumber + 1),
        ideas: [...candidate.ideas].sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt)),
      };
    }, this.root);
    await this.touchTimestamp();
    await this.maybeAutoSync();
    return updated;
  }

  async createIdea(input: IdeaCreateInput, timestamp = nowISO()): Promise<Idea> {
    const id = createIdeaId();
    const { number, shortId } = await this.allocateEntityIdentity("idea", id);
    const idea = IdeaSchema.parse({
      id,
      number,
      shortId,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      promotion: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.updateIdeas((document) => ({
      nextIdeaNumber: Math.max(document.nextIdeaNumber, number + 1),
      ideas: [...document.ideas, idea],
    }));
    return idea;
  }

  async updateIdea(ideaId: string, input: IdeaUpdateInput, timestamp = nowISO()): Promise<Idea> {
    let updated: Idea | undefined;
    await this.updateIdeas((document) => {
      const existing = document.ideas.find((idea) => idea.id === ideaId);
      if (!existing) throw new PlanStoreError(`Idea ${ideaId} not found.`);
      updated = IdeaSchema.parse({
        ...existing,
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        updatedAt: timestamp,
      });
      return {
        ...document,
        ideas: document.ideas.map((idea) => idea.id === ideaId ? updated! : idea),
      };
    });
    return updated!;
  }

  async deleteIdea(ideaId: string): Promise<boolean> {
    let deleted = false;
    await this.updateIdeas((document) => {
      deleted = document.ideas.some((idea) => idea.id === ideaId);
      return deleted
        ? { ...document, ideas: document.ideas.filter((idea) => idea.id !== ideaId) }
        : document;
    });
    return deleted;
  }

  private async resolveIdeaPromotionTarget(targetType: IdeaPromotionTargetType, targetId: string): Promise<string> {
    const phases = await this.loadAllPhases();
    const features = (await this.loadFeatures()).features;
    if (targetType === "feature") {
      const feature = features.find((candidate) => candidate.id === targetId);
      if (!feature) throw new PlanStoreError(`Idea promotion target feature ${targetId} not found.`);
      return formatFeatureRef(feature.number);
    }
    if (targetType === "phase") {
      const phase = phases.find((candidate) => candidate.id === targetId);
      if (!phase) throw new PlanStoreError(`Idea promotion target phase ${targetId} not found.`);
      const feature = features.find((candidate) => candidate.id === phase.featureId);
      return formatPhaseRef(phase.number, feature?.number);
    }
    for (const phase of phases) {
      const task = phase.tasks.find((candidate) => candidate.id === targetId);
      if (!task) continue;
      const feature = features.find((candidate) => candidate.id === phase.featureId);
      return `${formatPhaseRef(phase.number, feature?.number)}/T${formatThreeDigitNumber(task.number)}`;
    }
    throw new PlanStoreError(`Idea promotion target task ${targetId} not found.`);
  }

  async promoteIdea(ideaId: string, input: IdeaPromotionTargetInput): Promise<Idea> {
    const targetRef = await this.resolveIdeaPromotionTarget(input.targetType, input.targetId);
    const promotedAt = input.promotedAt ?? nowISO();
    let promoted: Idea | undefined;
    await this.updateIdeas((document) => {
      const existing = document.ideas.find((idea) => idea.id === ideaId);
      if (!existing) throw new PlanStoreError(`Idea ${ideaId} not found.`);
      if (existing.promotion) {
        if (existing.promotion.targetType === input.targetType && existing.promotion.targetId === input.targetId) {
          promoted = existing;
          return document;
        }
        throw new PlanStoreError(`Idea ${formatIdeaRef(existing.number)} is already promoted to ${existing.promotion.targetRef}.`);
      }
      const promotion: IdeaPromotion = {
        targetType: input.targetType,
        targetId: input.targetId,
        targetRef,
        promotedAt,
      };
      promoted = IdeaSchema.parse({
        ...existing,
        promotion,
        updatedAt: promotedAt,
      });
      return {
        ...document,
        ideas: document.ideas.map((idea) => idea.id === ideaId ? promoted! : idea),
      };
    });
    return promoted!;
  }

  /**
   * Persist completion of one full task → phase → feature → requirements read
   * sequence. Session metadata is deliberately the only changed entity field:
   * semantic updatedAt/descriptionUpdatedAt values are preserved exactly.
   */
  async recordContextRead(input: RecordContextReadInput): Promise<RecordContextReadResult> {
    const sessionId = input.sessionId.trim();
    if (!sessionId) throw new PlanStoreError("Context-read attestation requires a non-empty sessionId.");
    const createdAt = TimestampSchema.parse(input.createdAt ?? nowISO());
    const requirementIds = [...new Set((input.requirementIds ?? []).map((id) => id.trim()).filter(Boolean))];

    return this.runAsBatch(async () => {
      const originalPhase = await this.loadPhase(input.phaseId);
      const taskIndex = originalPhase.tasks.findIndex((task) => task.id === input.taskId);
      if (taskIndex < 0) throw new PlanStoreError(`Task ${input.taskId} does not belong to phase ${input.phaseId}.`);

      const originalFeatures = await this.loadFeatures();
      const featureId = input.featureId?.trim() || originalPhase.featureId;
      const featureIndex = featureId
        ? originalFeatures.features.findIndex((feature) => feature.id === featureId)
        : -1;
      if (featureId && featureIndex < 0) throw new PlanStoreError(`Feature ${featureId} was not found for context-read attestation.`);

      const originalRequirements = await this.loadRequirements();
      const missingRequirement = requirementIds.find((id) => !originalRequirements.requirements.some((requirement) => requirement.id === id));
      if (missingRequirement) throw new PlanStoreError(`Requirement ${missingRequirement} was not found for context-read attestation.`);

      const nextPhase = structuredClone(originalPhase);
      const nextTask = upsertSessionInfo(nextPhase.tasks[taskIndex]!, sessionId, createdAt);
      nextPhase.tasks[taskIndex] = nextTask.entity;
      const nextPhaseInfo = upsertSessionInfo(nextPhase, sessionId, createdAt);
      const phaseChanged = nextTask.changed || nextPhaseInfo.changed;

      let nextFeature: Feature | undefined;
      let featureChanged = false;
      if (featureIndex >= 0) {
        const featureResult = upsertSessionInfo(structuredClone(originalFeatures.features[featureIndex]!), sessionId, createdAt);
        nextFeature = featureResult.entity;
        featureChanged = featureResult.changed;
      }

      const nextRequirements = structuredClone(originalRequirements);
      let requirementsChanged = false;
      for (const requirement of nextRequirements.requirements) {
        if (!requirementIds.includes(requirement.id)) continue;
        const result = upsertSessionInfo(requirement, sessionId, createdAt);
        if (result.changed) {
          Object.assign(requirement, result.entity);
          requirementsChanged = true;
        }
      }

      if (!phaseChanged && !featureChanged && !requirementsChanged) {
        return {
          phase: originalPhase,
          ...(featureIndex >= 0 ? { feature: originalFeatures.features[featureIndex] } : {}),
          requirements: originalRequirements.requirements.filter((requirement) => requirementIds.includes(requirement.id)),
          createdAt,
        };
      }

      try {
        if (featureChanged && nextFeature) await this.saveFeature(nextFeature);
        if (phaseChanged) await this.savePhase(nextPhaseInfo.entity);
        if (requirementsChanged) await this.saveRequirements(nextRequirements);
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        if (featureChanged && nextFeature) await this.saveFeature(originalFeatures.features[featureIndex]!).catch((rollbackError) => rollbackErrors.push(rollbackError));
        if (phaseChanged) await this.savePhase(originalPhase).catch((rollbackError) => rollbackErrors.push(rollbackError));
        if (requirementsChanged) await this.saveRequirements(originalRequirements).catch((rollbackError) => rollbackErrors.push(rollbackError));
        if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], "Context-read attestation failed and rollback was incomplete.");
        throw error;
      }

      const phase = await this.loadPhase(input.phaseId);
      const feature = featureIndex >= 0 ? (await this.loadFeatures()).features.find((candidate) => candidate.id === featureId) : undefined;
      const requirements = (await this.loadRequirements()).requirements.filter((requirement) => requirementIds.includes(requirement.id));
      return { phase, ...(feature ? { feature } : {}), requirements, createdAt };
    });
  }

  async recordProjectGuidelinesRead(input: { sessionId: string; createdAt?: string }): Promise<Project> {
    const sessionId = input.sessionId.trim();
    if (!sessionId) throw new PlanStoreError("Project-guidelines attestation requires a non-empty sessionId.");
    const createdAt = TimestampSchema.parse(input.createdAt ?? nowISO());
    const updated = await atomicUpdateJson(this.projectPath(), ProjectSchema, (project) => {
      if (!project.projectGuidelines.content.trim()) return project;
      const result = upsertSessionInfo(project.projectGuidelines, sessionId, createdAt);
      return result.changed ? { ...project, projectGuidelines: result.entity } : project;
    }, this.root);
    await this.maybeAutoSync();
    return updated;
  }

  async saveProject(project: Project): Promise<void> {
    // Runtime workDeviations live in .local/deviations.json (T299); never
    // persist them here so shared project.json stays stable across worktrees.
    const previous = await readJson(this.projectPath(), ProjectSchema).catch(() => null);
    const stamped = this.stampProjectGuidelinesUpdatedAt(project, previous?.projectGuidelines.content, nowISO());
    const parsed = ProjectSchema.parse({ ...stamped, workDeviations: [] });
    await atomicWriteJson(this.projectPath(), parsed, this.root);
    await this.touchTimestamp();
    await this.maybeAutoSync();
  }

  async saveFeatures(features: FeaturesDocument): Promise<void> {
    await this.withFeaturesLock(async () => {
      await this.migrateLegacy();
      const previousDescriptions = new Map((await this.loadRawFeatures()).map((feature) => [feature.id, feature.description]));
      const previousDescriptionRefs = new Map((await this.loadRawFeatures()).map((feature) => [feature.id, feature.descriptionRef]));
      const timestamp = nowISO();
      await this.saveFeaturesRaw({
        features: features.features.map((feature) => this.stampDescriptionUpdatedAt(feature, previousDescriptions.get(feature.id), previousDescriptionRefs.get(feature.id), timestamp)),
      });
    });
    await this.touchTimestamp();
    await this.maybeAutoSync();
  }

  /** Per-file write of all features + orphan reconcile. No lock (caller holds withFeaturesLock). */
  private async saveFeaturesRaw(features: FeaturesDocument): Promise<void> {
    const parsed = FeaturesDocumentSchema.parse(this.normalizeFeaturesDocument(features).doc);
    await mkdir(this.featuresDir(), { recursive: true });
    const wantIds = new Set(parsed.features.map((f) => f.id));
    for (const feat of parsed.features) {
      await atomicWriteJson(this.featurePath(feat.id), feat, this.root);
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
      const previous = await readJson(this.featurePath(feature.id), FeatureSchema).catch(() => null);
      await mkdir(this.featuresDir(), { recursive: true });
      const parsed = FeatureSchema.parse(this.stampDescriptionUpdatedAt(feature, previous?.description, previous?.descriptionRef, nowISO()));
      await atomicWriteJson(this.featurePath(parsed.id), parsed, this.root);
    });
    await this.touchTimestamp();
    await this.maybeAutoSync();
  }

  async saveRequirements(reqs: RequirementsDocument): Promise<void> {
    const parsed = RequirementsDocumentSchema.parse(reqs);
    await atomicWriteJson(this.requirementsPath(), parsed, this.root);
    await this.touchTimestamp();
  }

  async saveIdeas(ideas: IdeasDocument): Promise<void> {
    const parsed = IdeasDocumentSchema.parse(ideas);
    const maxNumber = parsed.ideas.reduce((max, idea) => Math.max(max, idea.number), 0);
    await atomicWriteJson(this.ideasPath(), {
      ...parsed,
      nextIdeaNumber: Math.max(parsed.nextIdeaNumber, maxNumber + 1),
      ideas: [...parsed.ideas].sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt)),
    }, this.root);
    await this.touchTimestamp();
  }

  async savePhase(phase: Phase): Promise<void> {
    const previous = await this.loadPhase(phase.id).catch(() => null);
    const timestamp = nowISO();
    const features = await this.loadRawFeatures();
    const resolvedFeatureId = resolveStoredFeatureId(features, phase.featureId);
    // Referential integrity: if a featureId is present but cannot be resolved
    // to a known feature, REJECT — never persist an orphan featureId.
    // NOTE: a missing/empty featureId is intentionally ALLOWED here so that
    // legacy migrations, repair, and feature-delete (unlink) can persist phases
    // without a feature yet. The hard "featureId required" gate lives at the
    // adapter boundary (Pi phase_create/task_create and MCP planner-phase-add/
    // planner-task-add), which is where user-facing creation happens.
    if (phase.featureId && phase.featureId.trim() && !resolvedFeatureId) {
      throw new PlanStoreError(
        `Cannot save phase "${phase.title}": featureId "${phase.featureId}" does not match any existing feature. Use a valid feature UUID, F00x ref, or shortId.`,
      );
    }
    const normalizedInput = resolvedFeatureId && resolvedFeatureId !== phase.featureId
      ? { ...phase, featureId: resolvedFeatureId }
      : phase;
    const previousTaskDescriptions = new Map((previous?.tasks ?? []).map((task) => [task.id, task.description]));
    const previousTaskDescriptionRefs = new Map((previous?.tasks ?? []).map((task) => [task.id, task.descriptionRef]));
    const timestamped = this.stampDescriptionUpdatedAt(normalizedInput, previous?.description, previous?.descriptionRef, timestamp);
    timestamped.tasks = timestamped.tasks.map((task) => this.stampDescriptionUpdatedAt(task, previousTaskDescriptions.get(task.id), previousTaskDescriptionRefs.get(task.id), timestamp));
    const parsed = PhaseSchema.parse(this.normalizePhaseDocument(timestamped).phase);
    await mkdir(this.phasesDir(), { recursive: true });
    await atomicWriteJson(this.phasePath(parsed.id), parsed, this.root);
    await this.touchTimestamp();
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
      // The updater may mutate `current`, therefore snapshot descriptions first.
      const previousDescription = current.description;
      const previousDescriptionRef = current.descriptionRef;
      const previousTaskDescriptions = new Map(current.tasks.map((task) => [task.id, task.description]));
      const previousTaskDescriptionRefs = new Map(current.tasks.map((task) => [task.id, task.descriptionRef]));
      const timestamp = nowISO();
      const next = updater(current);
      const timestamped = this.stampDescriptionUpdatedAt(next, previousDescription, previousDescriptionRef, timestamp);
      timestamped.tasks = timestamped.tasks.map((task) => this.stampDescriptionUpdatedAt(task, previousTaskDescriptions.get(task.id), previousTaskDescriptionRefs.get(task.id), timestamp));
      const resolvedFeatureId = resolveStoredFeatureId(features, timestamped.featureId);
      // Referential integrity: reject orphan featureId.
      if (timestamped.featureId && timestamped.featureId.trim() && !resolvedFeatureId) {
        throw new PlanStoreError(
          `Cannot update phase: featureId "${timestamped.featureId}" does not match any existing feature.`,
        );
      }
      const normalizedInput = resolvedFeatureId && resolvedFeatureId !== timestamped.featureId
        ? { ...timestamped, featureId: resolvedFeatureId }
        : timestamped;
      return this.normalizePhaseDocument(normalizedInput).phase;
    }, this.root);
    await this.pruneObsoleteWorkDeviations();
    await this.maybeAutoSync();
    return { ...raw, status: this.derivePhaseStatus(raw.tasks) };
  }

  /** Save a durable resume checkpoint without introducing a separate canonical task status. */
  async pauseTask(phaseId: string, taskId: string, input: TaskPauseSnapshot): Promise<Task> {
    const snapshot = TaskPauseSnapshotSchema.parse(input);
    let paused: Task | undefined;
    await this.updatePhase(phaseId, (phase) => {
      const task = phase.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new PlanStoreError(`Task ${taskId} does not belong to phase ${phaseId}.`);
      if (task.status !== "in-progress") {
        throw new PlanStoreError(`Task ${taskId} cannot be checkpointed from ${task.status}; only in-progress work can capture a pause snapshot.`);
      }
      const description = [
        `Reason: ${snapshot.reason}`,
        `What was being done: ${snapshot.whatWasBeingDone}`,
        `Resume location: ${snapshot.resumeLocation}`,
        `How to resume: ${snapshot.howToResume}`,
      ].join("\n");
      paused = {
        ...task,
        status: "planned",
        pauseSnapshot: snapshot,
        pauseHistory: [...task.pauseHistory, snapshot],
        statusLog: [...task.statusLog, {
          id: createStatusLogEntryId(),
          date: snapshot.pausedAt,
          fromStatus: "in-progress",
          toStatus: "planned",
          title: "in-progress → planned (checkpoint saved)",
          description,
        }],
        updatedAt: snapshot.pausedAt,
      };
      phase.tasks = phase.tasks.map((candidate) => candidate.id === taskId ? paused! : candidate);
      return phase;
    });
    return paused!;
  }

  /** Resume a checkpointed task without resetting its original startedAt. */
  async resumeTask(phaseId: string, taskId: string, timestamp = nowISO()): Promise<Task> {
    let resumed: Task | undefined;
    await this.updatePhase(phaseId, (phase) => {
      const task = phase.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new PlanStoreError(`Task ${taskId} does not belong to phase ${phaseId}.`);
      if (!task.pauseSnapshot) {
        throw new PlanStoreError(`Task ${taskId} has no saved checkpoint to resume.`);
      }
      if (task.status === "done" || task.status === "canceled" || task.status === "rejected") {
        throw new PlanStoreError(`Task ${taskId} cannot be resumed from ${task.status}.`);
      }
      const snapshot = task.pauseSnapshot;
      resumed = {
        ...task,
        status: "in-progress",
        pauseSnapshot: null,
        startedAt: task.startedAt || timestamp,
        statusLog: [...task.statusLog, {
          id: createStatusLogEntryId(),
          date: timestamp,
          fromStatus: task.status,
          toStatus: "in-progress",
          title: `${task.status} → in-progress (resume checkpoint)`,
          description: `Resumed from ${snapshot.resumeLocation}. ${snapshot.howToResume}`,
        }],
        updatedAt: timestamp,
      };
      phase.tasks = phase.tasks.map((candidate) => candidate.id === taskId ? resumed! : candidate);
      return phase;
    });
    return resumed!;
  }

  // ── Phase-scoped handoff (entity field, harness-agnostic) ────────────

  /** Get the handoff text for a phase ("" if none). Throws if phase missing. */
  async getPhaseHandoff(phaseId: string): Promise<string> {
    return (await this.loadPhase(phaseId)).handoff;
  }

  private async validateHandoffSupportingDocuments(
    documents: HandoffSupportingDocumentInput[],
  ): Promise<HandoffSupportingDocument[]> {
    const docsRoot = resolve(this.root, "docs");
    const verified: HandoffSupportingDocument[] = [];
    const seen = new Set<string>();
    for (const document of documents) {
      const normalizedPath = document.path.trim().replace(/\\/g, "/");
      if (!/^\.planner\/docs\/.+\.md$/i.test(normalizedPath) || normalizedPath.includes("/../")) {
        throw new HandoffContractError(
          "HANDOFF_SUPPORTING_DOCUMENT_INVALID",
          `Supporting document path must be a Markdown file under .planner/docs/: ${document.path}`,
          { path: document.path },
        );
      }
      if (seen.has(normalizedPath)) {
        throw new HandoffContractError(
          "HANDOFF_SUPPORTING_DOCUMENT_INVALID",
          `Supporting document appears more than once: ${normalizedPath}`,
          { path: normalizedPath },
        );
      }
      seen.add(normalizedPath);
      const target = resolve(this.root, normalizedPath.slice(".planner/".length));
      if (!target.startsWith(`${docsRoot}${sep}`)) {
        throw new HandoffContractError(
          "HANDOFF_SUPPORTING_DOCUMENT_INVALID",
          `Supporting document escapes .planner/docs/: ${normalizedPath}`,
          { path: normalizedPath },
        );
      }
      const content = await readFile(target, "utf8").catch(() => null);
      if (content === null || !content.trim()) {
        throw new HandoffContractError(
          "HANDOFF_SUPPORTING_DOCUMENT_INVALID",
          `Supporting document is missing or empty: ${normalizedPath}`,
          { path: normalizedPath },
        );
      }
      verified.push({
        path: normalizedPath,
        description: document.description.trim(),
        contentHash: handoffContentHash(content),
        contentLength: content.length,
      });
    }
    return verified;
  }

  /** Audit one exact phase before preparing a handoff refresh. */
  async preparePhaseHandoff(phaseId: string): Promise<PhaseHandoffAudit> {
    const phase = await this.loadPhase(phaseId);
    if (!phase.featureId) throw new PlanStoreError(`Phase ${phaseId} has no parent feature; durable handoff context cannot be synchronized.`);
    const feature = (await this.loadFeatures()).features.find((candidate) => candidate.id === phase.featureId);
    if (!feature) throw new PlanStoreError(`Parent feature ${phase.featureId} not found for phase ${phaseId}.`);
    return auditPhaseHandoff(phase, feature);
  }

  /** Refresh the single active handoff and synchronize durable task/phase/feature
   * context. Unlike setPhaseHandoff(), this deliberately does not archive the
   * previous active body: callers must reconcile it using the optimistic
   * handoffUpdatedAt token returned by preparePhaseHandoff(). */
  async refreshPhaseHandoff(
    phaseId: string,
    input: RefreshPhaseHandoffInput,
  ): Promise<RefreshPhaseHandoffResult> {
    return this.runAsBatch(async () => {
      const originalPhase = await this.loadPhase(phaseId);
      if (!originalPhase.featureId) throw new PlanStoreError(`Phase ${phaseId} has no parent feature; durable handoff context cannot be synchronized.`);
      const originalFeatures = await this.loadFeatures();
      const featureIndex = originalFeatures.features.findIndex((candidate) => candidate.id === originalPhase.featureId);
      if (featureIndex < 0) throw new PlanStoreError(`Parent feature ${originalPhase.featureId} not found for phase ${phaseId}.`);
      const timestamp = nowISO();
      const verifiedSupportingDocuments = await this.validateHandoffSupportingDocuments(input.supportingDocuments ?? []);
      const verifiedInput: RefreshPhaseHandoffInput = { ...input, verifiedSupportingDocuments };
      const originalFeature = originalFeatures.features[featureIndex]!;
      const applied = applyHandoffContextSync(originalPhase, originalFeature, verifiedInput, timestamp);

      try {
        // Keep the transaction granular: only the parent feature and target phase
        // belong to this handoff refresh. Rewriting the whole feature document can
        // disturb unrelated feature containment metadata.
        await this.saveFeature(applied.feature);
        await this.savePhase(applied.phase);
        const phase = await this.loadPhase(phaseId);
        const feature = (await this.loadFeatures()).features.find((candidate) => candidate.id === originalPhase.featureId)!;
        const persistedHash = handoffContentHash(phase.handoff);
        if (
          phase.handoff !== applied.phase.handoff
          || !phase.handoffAudit
          || phase.handoffAudit.contentHash !== persistedHash
          || phase.handoffAudit.contentLength !== phase.handoff.length
        ) {
          throw new HandoffContractError(
            "HANDOFF_PERSISTENCE_VERIFICATION_FAILED",
            "The persisted handoff did not match the verified content. The write was rolled back.",
            { expectedHash: applied.phase.handoffAudit?.contentHash ?? "", actualHash: persistedHash },
          );
        }
        return {
          phase,
          feature,
          updatedTaskIds: applied.updatedTaskIds,
          handoffUpdatedAt: phase.handoffUpdatedAt,
          handoffAudit: phase.handoffAudit,
        };
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        // Restore the exact parsed snapshots directly. Going through saveFeature /
        // savePhase would restamp description freshness against the failed write.
        await atomicWriteJson(this.featurePath(originalFeature.id), FeatureSchema.parse(originalFeature), this.root)
          .catch((rollbackError) => rollbackErrors.push(rollbackError));
        await atomicWriteJson(this.phasePath(originalPhase.id), PhaseSchema.parse(originalPhase), this.root)
          .catch((rollbackError) => rollbackErrors.push(rollbackError));
        if (rollbackErrors.length > 0) {
          throw new AggregateError([error, ...rollbackErrors], "Handoff refresh failed and rollback was incomplete.");
        }
        throw error;
      }
    });
  }

  /** Set the handoff text for a phase + stamp handoffUpdatedAt. A completed or
   * canceled phase cannot receive a new operational handoff. Replacing an
   * existing handoff archives the previous content as `superseded` first. */
  async setPhaseHandoff(phaseId: string, text: string): Promise<void> {
    const phase = await this.loadPhase(phaseId);
    const normalized = text.trim();
    if (phase.status === "done" || phase.status === "canceled") {
      throw new PlanStoreError(`Cannot write a handoff on ${phase.status} phase ${phaseId}; completed phases have no pending handoff.`);
    }
    if (phase.handoff && normalized && phase.handoff !== normalized) {
      await this.clearPhaseHandoff(phaseId, "superseded");
    }
    const now = new Date().toISOString();
    await this.updatePhase(phaseId, (current) => ({ ...current, handoff: normalized, handoffUpdatedAt: now, handoffAudit: null }));
  }


  /** Mark the phase handoff as read/acknowledged on recap (sets handoffReadAt).
   *  Does NOT clear it: read/load/show are non-mutating resume operations. */
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
    const target = phases.find((p) => p.status === "in-progress")
      ?? phases.find((p) => p.status !== "done" && p.status !== "canceled")
      ?? null;
    if (!target) return { imported: false }; // no non-completed phase — leave file for a later run
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
   *  reason: "phase-done" | "manual" | "superseded" | "imported". */
  async clearPhaseHandoff(phaseId: string, reason = "manual"): Promise<void> {
    await this.migrateLegacyHandoffArchive();
    const phase = await this.loadPhase(phaseId).catch(() => null);
    if (!phase || phase.handoff === "") return; // nothing to archive
    const clearedAt = nowISO();
    const safeTs = clearedAt.replace(/[:.]/g, "-");
    const archiveDir = this.handoffArchiveDir();
    await mkdir(archiveDir, { recursive: true }).catch(() => {});
    const fileName = `${phaseId}-${safeTs}.md`;
    const filePath = join(archiveDir, fileName);
    await atomicWriteText(filePath, phase.handoff, this.root);
    const entry = { file: `handoff-archive/${fileName}`, clearedAt, reason };
    // Cap history at 5: prepend new entry, drop oldest (and delete its file).
    const trimmed = [entry, ...(phase.handoffHistory ?? [])].slice(0, 5);
    const dropped = (phase.handoffHistory ?? []).slice(4); // entries beyond index 4 after prepend
    for (const d of dropped) {
      if (!d?.file) continue;
      // Legacy entries used `.planner/handoff-archive/...`; new entries use `.planner/.local/handoff-archive/...`.
      await unlink(join(this.handoffArchiveDir(), basename(d.file))).catch(() => {});
      await unlink(join(this.root, d.file)).catch(() => {});
    }
    await this.updatePhase(phaseId, (p) => ({ ...p, handoff: "", handoffHistory: trimmed }));
  }

  /** Archive stale handoffs only after every task in their phase is done or
   * canceled. Idempotent: only non-empty phase.handoff values are moved. */
  private async archiveStaleHandoffs(): Promise<number> {
    const phases = await this.loadAllPhases();
    let archived = 0;
    for (const phase of phases) {
      if (this.hasCompletedHandoffLifecycle(phase.tasks) && phase.handoff) {
        await this.clearPhaseHandoff(phase.id, "phase-done");
        archived += 1;
      }
    }
    return archived;
  }

  /** Public maintenance operation for retroactively archiving stale handoffs. */
  async cleanupStaleHandoffs(): Promise<number> {
    return this.runAsBatch(() => this.archiveStaleHandoffs());
  }

  /** List only active/pending phase handoffs, newest first. Handoffs from
   * phases where every task is done/canceled are archived before returning. */
  async listHandoffs(options: { includeContent?: boolean } = {}): Promise<PhaseHandoffSummary[]> {
    await this.archiveStaleHandoffs();
    const phases = await this.loadAllPhases();
    const features = await this.loadFeatures();
    const featureIds = new Set(features.features.map((f) => f.id));
    const featureNumber = new Map<string, number>();
    for (const f of features.features) featureNumber.set(f.id, f.number);
    const out: PhaseHandoffSummary[] = [];
    for (const p of phases) {
      if (!p.handoff || p.status === "done" || p.status === "canceled") continue;
      if (p.featureId && !featureIds.has(p.featureId)) continue;
      const fnum = p.featureId ? featureNumber.get(p.featureId) : undefined;
      out.push({
        phaseId: p.id,
        featureId: p.featureId,
        compositeRef: formatPhaseRef(p.number, fnum),
        updatedAt: p.handoffUpdatedAt || p.updatedAt,
        firstLine: handoffFirstLine(p.handoff),
        ...(options.includeContent ? { content: p.handoff } : {}),
        auditVersion: p.handoffAudit?.version ?? null,
        contentLength: p.handoff.length,
        contentHash: p.handoffAudit?.contentHash ?? handoffContentHash(p.handoff),
        verifiedAt: p.handoffAudit?.verifiedAt ?? "",
      });
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }

  /** List recoverable archived handoffs from phase.handoffHistory. Archived
   * entries are never returned by listHandoffs() and are safe to show on a
   * dedicated history page. */
  async listArchivedHandoffs(): Promise<ArchivedPhaseHandoffSummary[]> {
    const phases = await this.loadAllPhases();
    const features = await this.loadFeatures();
    const featureNumber = new Map<string, number>();
    for (const f of features.features) featureNumber.set(f.id, f.number);
    const out: ArchivedPhaseHandoffSummary[] = [];
    for (const phase of phases) {
      const fnum = phase.featureId ? featureNumber.get(phase.featureId) : undefined;
      for (const entry of phase.handoffHistory ?? []) {
        if (!entry.file) continue;
        const localPath = join(this.localRoot(), entry.file);
        const legacyPath = join(this.root, entry.file);
        const content = await readFile(localPath, "utf-8").catch(() => readFile(legacyPath, "utf-8").catch(() => ""));
        out.push({
          phaseId: phase.id,
          featureId: phase.featureId,
          compositeRef: formatPhaseRef(phase.number, fnum),
          file: entry.file,
          archivedAt: entry.clearedAt,
          reason: entry.reason,
          firstLine: handoffFirstLine(content),
          content,
        });
      }
    }
    out.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
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
        await this.unlinkPhaseFiles(orphan.phaseId);
      }
      await this.updateFeatures((doc) => {
        for (const feature of doc.features) {
          feature.phaseIds = feature.phaseIds.filter((id) => !orphanIds.has(id));
        }
        return doc;
      });
      await this.touchTimestamp();
      await this.writeGenerated();
      return { found, removed: found };
    });
  }

  async deletePhase(phaseId: string): Promise<void> {
    await this.unlinkPhaseFiles(phaseId);
    await this.touchTimestamp();
  }

  /** Remove a phase file and BOTH of its previous-version backups: the legacy
   *  inline `phases/<id>.json.bak` (kept for backward compat) and the relocated
   *  `.local/backups/phases/<id>.json.bak` (written once updatePhase passes root,
   *  per P043). Leaving either behind would RESURRECT the deleted phase on the
   *  next read, since readJson falls back to both locations. */
  private async unlinkPhaseFiles(phaseId: string): Promise<void> {
    const phaseFile = this.phasePath(phaseId);
    await unlink(phaseFile).catch(() => {});
    await unlink(`${phaseFile}.bak`).catch(() => {});
    await unlink(join(this.root, ".local", "backups", "phases", `${phaseId}.json.bak`)).catch(() => {});
  }

  // ── Workspace-level operations ─────────────────────────────────────

  /** Load the full workspace, including the rollup-independent Ideas Inbox. */
  async loadWorkspace(): Promise<PlanWorkspace> {
    const manifest = await this.loadManifest();
    const phases = await this.loadAllPhases();
    const project = await this.loadProject();
    const features = await this.loadFeatures();
    const requirements = await this.loadRequirements();
    const ideas = await this.loadIdeas();
    return { manifest, phases, project, features, requirements, ideas };
  }

  // ── Markdown generation ────────────────────────────────────────────

  /** Load all data, render markdown, and write into generated/. Skips files
   *  whose content is unchanged to avoid unnecessary backup churn. */
  async writeGenerated(): Promise<string[]> {
    await this.migrateLegacyGeneratedDir();
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
      try {
        const existing = await readFile(fullPath, "utf-8");
        if (existing === content) continue;
      } catch {
        // file does not exist yet — write it
      }
      await writeFile(fullPath, content, "utf-8");
      written.push(relPath);
    }

    return written;
  }

  // ── Touch ────────────────────────────────────────────────────────────

  /** Update .local/timestamp.json to reflect a change. */
  private async touchTimestamp(): Promise<void> {
    try {
      await atomicWriteJson(this.timestampPath(), { updatedAt: nowISO() }, this.root);
    } catch {
      // if .local/ doesn't exist yet, skip
    }
  }
}
