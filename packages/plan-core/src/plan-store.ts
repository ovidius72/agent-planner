import { access, copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  RequirementsDocumentSchema,
  ResumeFocusSchema,
  ActivityLogSchema,
  type ActivityEntry,
  type ActivityLog,
  type CodebaseProfile,
  type ResumeFocus,
} from "./schema.js";
import { createFeatureId, createPhaseId, createRequirementId, createShortId, createTaskId, formatPhaseRef, isLegacyPhaseId } from "./naming.js";

function nowISO(): string {
  return new Date().toISOString();
}

export class PlanStoreError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
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

function withWriteLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  writeLocks.set(path, prev.then(() => next));
  return prev.then(fn).finally(() => {
    release();
    if (writeLocks.get(path) === prev.then(() => next)) writeLocks.delete(path);
  });
}

export function withFeatureLock<T>(featureId: string, fn: () => Promise<T>): Promise<T> {
  const prev = featureLocks.get(featureId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  featureLocks.set(featureId, prev.then(() => next));
  return prev.then(fn).finally(() => {
    release();
    if (featureLocks.get(featureId) === prev.then(() => next)) featureLocks.delete(featureId);
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
  /** Human-readable composite ref, e.g. `P003` or `P003(F002)`. */
  compositeRef: string;
  /** handoffUpdatedAt (falls back to phase.updatedAt if unset). */
  updatedAt: string;
  /** First non-empty line of the handoff, leading markdown headers stripped, ~80 chars. */
  firstLine: string;
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

async function readJson<T>(path: string, schema: { parse(v: unknown): T }): Promise<T> {
  try {
    const raw = await readFile(path, "utf-8");
    return schema.parse(JSON.parse(raw));
  } catch (cause) {
    // Try the .bak backup before giving up (recover from external-write corruption).
    try {
      const bak = await readFile(`${path}.bak`, "utf-8");
      return schema.parse(JSON.parse(bak));
    } catch {
      // fall through to original error
    }
    throw new PlanStoreError(`read failed: ${path}`, cause);
  }
}


// ─── PlanStore ──────────────────────────────────────────────────────────

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

  private async maybeAutoSync(): Promise<void> {
    if (!this.autoSync || this.syncGuard || this.batchInProgress) return;
    try {
      this.syncGuard = true;
      await this.syncStatuses();
    } finally {
      this.syncGuard = false;
    }
  }

  private normalizeTasks(tasks: Task[]): { tasks: Task[]; changed: boolean } {
    let changed = false;
    const normalized = tasks.map((task, index) => {
      const nextNumber = index + 1;
      if (task.number !== nextNumber) changed = true;
      return { ...task, number: nextNumber };
    });
    return { tasks: normalized, changed };
  }

  private normalizeFeaturesDocument(doc: FeaturesDocument): { doc: FeaturesDocument; changed: boolean } {
    let changed = false;
    const normalized = doc.features.map((feature, index) => {
      const nextNumber = index + 1;
      if (feature.number !== nextNumber) changed = true;
      return { ...feature, number: nextNumber };
    });
    return { doc: { features: normalized }, changed };
  }

  private normalizePhaseDocument(phase: Phase): { phase: Phase; changed: boolean } {
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
      if (phase.featureId) {
        const bucket = phasesByFeature.get(phase.featureId) ?? [];
        bucket.push(phase);
        phasesByFeature.set(phase.featureId, bucket);
      } else {
        orphanPhases.push(phase);
      }
    }

    const normalizedFeatures = featuresDoc.features.map((feature, featureIndex) => {
      const nextFeatureNumber = featureIndex + 1;
      if (feature.number !== nextFeatureNumber) changed = true;

      const linked = feature.phaseIds.map((id) => phaseById.get(id)).filter((phase): phase is Phase => Boolean(phase));
      const linkedIds = new Set(linked.map((phase) => phase.id));
      const inferred = (phasesByFeature.get(feature.id) ?? []).filter((phase) => !linkedIds.has(phase.id));
      const orderedPhases = [...linked, ...inferred];
      const normalizedPhaseIds = orderedPhases.map((phase) => phase.id);
      if (normalizedPhaseIds.length !== feature.phaseIds.length || normalizedPhaseIds.some((id, index) => id !== feature.phaseIds[index])) {
        changed = true;
      }

      orderedPhases.forEach((phase, index) => {
        const nextPhaseNumber = index + 1;
        if (phase.number !== nextPhaseNumber) {
          phase.number = nextPhaseNumber;
          changed = true;
        }
        const normalizedPhase = this.normalizePhaseDocument(phase);
        if (normalizedPhase.changed) {
          phase.tasks = normalizedPhase.phase.tasks;
          phase.taskIds = normalizedPhase.phase.taskIds;
          changed = true;
        }
      });

      return {
        ...feature,
        number: nextFeatureNumber,
        phaseIds: normalizedPhaseIds,
      };
    });

    orphanPhases.forEach((phase, index) => {
      const nextPhaseNumber = index + 1;
      if (phase.number !== nextPhaseNumber) {
        phase.number = nextPhaseNumber;
        changed = true;
      }
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
    return this.runAsBatch(async () => {
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
    let legacy: FeaturesDocument;
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
  private handoffPath(): string {
    return join(this.root, "HANDOFF.md");
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
    });
    await this.saveRequirements({ requirements: [] });
    await this.saveFeatures({ features: [] });
    await this.saveResume({
      updatedAt: nowISO(),
      currentPhaseId: "",
      inProgressTaskIds: [],
      nextSteps: ["Run /planner project discuss to bootstrap discovery"],
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

    // Write a .gitignore inside .planner/ so transient backup/tmp files are
    // not tracked by the host project's git. Git respects nested .gitignore.
    await writeFile(
      join(this.root, ".gitignore"),
      [
        "# Agent Plan transient files — do not track",
        "*.bak",
        "*.tmp.*",
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



  async loadPhase(phaseId: string): Promise<Phase> {
    const phase = await readJson(this.phasePath(phaseId), PhaseSchema);
    return this.normalizePhaseDocument(phase).phase;
  }

  async loadFeatures(): Promise<FeaturesDocument> {
    // Per-file layout: read features/<id>.json (one file per feature).
    let jsonFiles: string[] = [];
    try {
      const all = await readdir(this.featuresDir());
      jsonFiles = all.filter((f) => f.endsWith(".json"));
    } catch {
      // features/ absent → fall through to legacy single-file layout
    }
    if (jsonFiles.length > 0) {
      const features: Feature[] = [];
      for (const f of jsonFiles) {
        const id = f.replace(/\.json$/, "");
        try {
          features.push(await readJson(this.featurePath(id), FeatureSchema));
        } catch (err) {
          // Skip an invalid feature file rather than failing the whole load.
          console.warn(`[plan-store] skipping invalid feature file ${f}:`, err);
        }
      }
      return this.normalizeFeaturesDocument({ features }).doc;
    }
    // Legacy: single features.json (pre-migration read; migration writes on first write op).
    try {
      const legacy = await readJson(this.featuresPath(), FeaturesDocumentSchema);
      return this.normalizeFeaturesDocument(legacy).doc;
    } catch {
      return { features: [] };
    }
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
    const parsed = ResumeFocusSchema.parse(resume);
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

  async handoffExists(): Promise<boolean> {
    try {
      await access(this.handoffPath());
      return true;
    } catch {
      return false;
    }
  }

  async loadHandoff(): Promise<{ content: string; createdAt: string; updatedAt: string } | null> {
    try {
      const [content, info] = await Promise.all([
        readFile(this.handoffPath(), "utf-8"),
        stat(this.handoffPath()),
      ]);
      const createdAt = content.match(/^Created at:\s*(.+)$/m)?.[1]?.trim() ?? info.birthtime.toISOString();
      const updatedAt = content.match(/^Updated at:\s*(.+)$/m)?.[1]?.trim() ?? info.mtime.toISOString();
      return {
        content,
        createdAt,
        updatedAt,
      };
    } catch {
      return null;
    }
  }

  async saveHandoff(content: string): Promise<void> {
    await atomicWriteText(this.handoffPath(), content);
    await this.touchManifest();
  }

  async deleteHandoff(): Promise<void> {
    try {
      await unlink(this.handoffPath());
    } catch {}
    await this.touchManifest();
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

  async loadAll(): Promise<PlanWorkspace> {
    const [manifest, project, features, requirements, phases] = await Promise.all([
      this.loadManifest(),
      this.loadProject(),
      this.loadFeatures(),
      this.loadRequirements(),
      this.loadAllPhases(),
    ]);
    return PlanWorkspaceSchema.parse({ manifest, project, features, requirements, phases });
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

      const assignPriority = (current: number, index: number): number => {
        if (current === 0) { prioritiesAssigned += 1; return index + 1; }
        return current;
      };

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
    integrity: { duplicatePhaseIds: string[]; danglingPhaseIds: string[]; duplicateShortIds: string[] };
  }> {
    return this.runAsBatch(async () => {
      const migrated = await this.migratePhaseIds();
      const backfill = await this.ensureShortIdsAndPriority();
      const integrity = await this.validateIntegrity();
      await this.writeGenerated();
      return { migrated, backfill, integrity };
    });
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

  private derivePhaseStatus(phase: Phase): Phase["status"] {
    if (phase.tasks.length === 0) return phase.status;

    const taskStatuses = phase.tasks.map((task) => task.status);
    // Ignore rejected/canceled tasks (void) when deriving progress.
    const meaningful = taskStatuses.filter((s) => s !== "rejected" && s !== "canceled");
    if (meaningful.length === 0) return "rejected";
    if (meaningful.every((s) => s === "done")) return "done";
    // Lifecycle truth: any progress (active work OR partial completion) ⇒
    // in-progress, until fully done. This is what prevents a single
    // blocked/waiting/deferred task from poisoning the parent when there is
    // substantial done or in-progress work (the long-standing rollup bug).
    if (meaningful.some((s) => s === "in-progress") || meaningful.some((s) => s === "done")) return "in-progress";
    // No progress at all ⇒ surface the stall / not-started state (blocked > waiting > deferred > planned).
    if (meaningful.some((s) => s === "blocked")) return "blocked";
    if (meaningful.some((s) => s === "waiting")) return "waiting";
    if (meaningful.some((s) => s === "deferred")) return "deferred";
    return "planned";
  }

  private deriveFeatureStatus(featureId: string, currentStatus: Feature["status"], phases: Phase[]): Feature["status"] {
    const featurePhases = phases.filter((phase) => phase.featureId === featureId);
    if (featurePhases.length === 0) return currentStatus;

    const phaseStatuses = featurePhases.map((phase) => phase.status);
    // Ignore rejected/canceled phases when deriving progress.
    const meaningful = phaseStatuses.filter((s) => s !== "rejected" && s !== "canceled");
    if (meaningful.length === 0) return "rejected";
    if (meaningful.every((s) => s === "done")) return "done";
    // Any progress (an active phase, or a partially-complete done phase) ⇒
    // in-progress. Prevents a single stalled phase from poisoning the feature
    // when other phases have done/in-progress work.
    if (meaningful.some((s) => s === "discovery" || s === "in-progress") || meaningful.some((s) => s === "done")) return "in-progress";
    // No progress at all ⇒ surface the stall / not-started state.
    if (meaningful.some((s) => s === "blocked")) return "blocked";
    if (meaningful.some((s) => s === "waiting")) return "waiting";
    if (meaningful.some((s) => s === "deferred")) return "deferred";
    return "planned";
  }

  async syncStatuses(): Promise<string[]> {
    // Run as a batch so the internal saveFeatures + N savePhase calls do not
    // re-trigger syncStatuses on every write (O(N^2) on large planners).
    // Returns the composite refs of phases whose handoff was auto-cleared
    // (phase transitioned to done).
    const cleared: string[] = [];
    await this.runAsBatch(async () => {
      await this.migratePhaseIds();
      const workspace = await this.loadAll();
      const { phases, features } = workspace;
      const featNum = new Map(features.features.map((f) => [f.id, f.number]));

      // 1. Update Phase statuses based on tasks; auto-clear handoff when a
      //    phase transitions to done (completed phases don't keep stale
      //    handoffs). handoffUpdatedAt is kept as an audit trail.
      for (const phase of phases) {
        const was = phase.status;
        phase.status = this.derivePhaseStatus(phase);
        if (phase.status === "done" && was !== "done" && phase.handoff) {
          phase.handoff = "";
          cleared.push(formatPhaseRef(phase.number, featNum.get(phase.featureId ?? "")));
        }
      }

      // 2. Update Feature statuses based on phases
      for (const feature of features.features) {
        feature.status = this.deriveFeatureStatus(feature.id, feature.status, phases);
      }

      // 3. Save everything
      await this.saveFeatures(features);
      for (const phase of phases) {
        await this.savePhase(phase);
      }

      // 4. Refresh resume focus so a subentrating agent sees current state
      await this.refreshResume();
    });
    return cleared;
  }

  /** Optimized rollup: syncs only the affected phase and its parent feature.
   *  Drastically reduces write operations and 'busy' window for task updates.
   *  Returns the composite ref of the phase if its handoff was auto-cleared
   *  (phase transitioned to done), else null. */
  async syncTaskStatusRollup(phaseId: string): Promise<string | null> {
    const phase = await this.loadPhase(phaseId);
    const was = phase.status;
    phase.status = this.derivePhaseStatus(phase);
    // Auto-clear handoff when the phase transitions to done.
    const cleared = phase.status === "done" && was !== "done" && phase.handoff !== "";
    if (cleared) phase.handoff = "";
    await this.savePhase(phase);

    let feature: Feature | undefined;
    if (phase.featureId) {
      const featuresDoc = await this.loadFeatures();
      feature = featuresDoc.features.find((f) => f.id === phase.featureId);
      if (feature) {
        // To derive feature status, we still need the statuses of all its phases
        const allPhases = await this.loadAllPhases();
        feature.status = this.deriveFeatureStatus(feature.id, feature.status, allPhases);
        await this.saveFeatures(featuresDoc);
      }
    }
    await this.refreshResume();
    return cleared ? formatPhaseRef(phase.number, feature?.number) : null;
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
    const parsed = PhaseSchema.parse(this.normalizePhaseDocument(phase).phase);
    await mkdir(this.phasesDir(), { recursive: true });
    await atomicWriteJson(this.phasePath(parsed.id), parsed);
    await this.touchManifest();
    await this.maybeAutoSync();
  }

  /** Atomic read-modify-write on a single phase file. Serializes concurrent
   *  task_create / phase_update calls on the SAME phaseId so batch operations
   *  don't lose tasks (last-write-wins race condition). */
  async updatePhase(phaseId: string, updater: (phase: Phase) => Phase): Promise<Phase> {
    const updated = await atomicUpdateJson(this.phasePath(phaseId), PhaseSchema, (phase) => this.normalizePhaseDocument(updater(phase)).phase);
    await this.maybeAutoSync();
    return updated;
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

  /** Clear the handoff text for a phase (handoff=""). handoffUpdatedAt is left
   *  unchanged as an audit trail (when a handoff last existed). */
  async clearPhaseHandoff(phaseId: string): Promise<void> {
    await this.updatePhase(phaseId, (phase) => ({ ...phase, handoff: "" }));
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
        compositeRef: formatPhaseRef(p.number, fnum),
        updatedAt: p.handoffUpdatedAt || p.updatedAt,
        firstLine: handoffFirstLine(p.handoff),
      });
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
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
