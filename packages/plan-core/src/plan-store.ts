import { access, copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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
import { createFeatureId, createPhaseId, createRequirementId, createTaskId, isLegacyPhaseId } from "./naming.js";

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

export async function migrateToUuids(store: PlanStore): Promise<void> {
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

  constructor(root: string) {
    this.root = root;
  }

  /** When enabled, status rollup (syncStatuses) runs automatically after every
   *  phase/feature/project save. Used by the pi-adapter so the agent's tool
   *  mutations keep phase/feature statuses derived from task statuses. */
  enableAutoSync(value: boolean): void { this.autoSync = value; }

  private async maybeAutoSync(): Promise<void> {
    if (!this.autoSync || this.syncGuard) return;
    try {
      this.syncGuard = true;
      await this.syncStatuses();
    } finally {
      this.syncGuard = false;
    }
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
      plannerAutoEnable: false,
      plannerNeverAsk: false,
      plannerAutoStartWeb: false,
      plannerNeverStartWeb: false,
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
    return readJson(this.phasePath(phaseId), PhaseSchema);
  }

  async loadFeatures(): Promise<FeaturesDocument> {
    try {
      return await readJson(this.featuresPath(), FeaturesDocumentSchema);
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
    return results;
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

  /** Repair dangling references and report integrity. One-shot maintenance op. */
  async repair(): Promise<{
    migrated: { renamed: number; repaired: number; inferred: number };
    integrity: { duplicatePhaseIds: string[]; danglingPhaseIds: string[] };
  }> {
    const migrated = await this.migratePhaseIds();
    const integrity = await this.validateIntegrity();
    await this.writeGenerated();
    return { migrated, integrity };
  }

  /** Validate plan integrity: globally unique phase ids and resolvable feature.phaseIds. */
  async validateIntegrity(): Promise<{ duplicatePhaseIds: string[]; danglingPhaseIds: string[] }> {
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
    return { duplicatePhaseIds, danglingPhaseIds };
  }

  private derivePhaseStatus(phase: Phase): Phase["status"] {
    if (phase.tasks.length === 0) return phase.status;

    const taskStatuses = phase.tasks.map((task) => task.status);
    const allRejectedOrCanceled = taskStatuses.every((status) => status === "rejected" || status === "canceled");
    const anyBlocked = taskStatuses.some((status) => status === "blocked");
    const anyInProgress = taskStatuses.some((status) => status === "in-progress");
    const anyWaiting = taskStatuses.some((status) => status === "waiting");
    const anyDeferred = taskStatuses.some((status) => status === "deferred");
    const anyPlanned = taskStatuses.some((status) => status === "planned");
    const anyDone = taskStatuses.some((status) => status === "done");

    if (allRejectedOrCanceled) return "rejected";
    if (anyBlocked) return "blocked";
    if (anyInProgress) return "in-progress";
    if (anyWaiting) return "waiting";
    if (anyDeferred) return "deferred";
    if (anyPlanned) return "planned";
    if (anyDone) return "done";
    return "planned";
  }

  private deriveFeatureStatus(featureId: string, currentStatus: Feature["status"], phases: Phase[]): Feature["status"] {
    const featurePhases = phases.filter((phase) => phase.featureId === featureId);
    if (featurePhases.length === 0) return currentStatus;

    const phaseStatuses = featurePhases.map((phase) => phase.status);
    const allRejectedOrCanceled = phaseStatuses.every((status) => status === "rejected" || status === "canceled");
    const anyBlocked = phaseStatuses.some((status) => status === "blocked");
    const anyActive = phaseStatuses.some((status) => status === "discovery" || status === "in-progress");
    const anyWaiting = phaseStatuses.some((status) => status === "waiting");
    const anyDeferred = phaseStatuses.some((status) => status === "deferred");
    const anyPlannedLike = phaseStatuses.some((status) => status === "draft" || status === "planned");
    const anyDone = phaseStatuses.every((status) => status === "done");

    if (allRejectedOrCanceled) return "rejected";
    if (anyBlocked) return "blocked";
    if (anyActive) return "in-progress";
    if (anyWaiting) return "waiting";
    if (anyDeferred) return "deferred";
    if (anyPlannedLike) return "planned";
    if (anyDone) return "done";
    return "planned";
  }

  async syncStatuses(): Promise<void> {
    await this.migratePhaseIds();
    const workspace = await this.loadAll();
    const { phases, features } = workspace;

    // 1. Update Phase statuses based on tasks
    for (const phase of phases) {
      phase.status = this.derivePhaseStatus(phase);
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
  }

  /** Optimized rollup: syncs only the affected phase and its parent feature.
   *  Drastically reduces write operations and 'busy' window for task updates. */
  async syncTaskStatusRollup(phaseId: string): Promise<void> {
    const phase = await this.loadPhase(phaseId);
    phase.status = this.derivePhaseStatus(phase);
    await this.savePhase(phase);

    if (phase.featureId) {
      const featuresDoc = await this.loadFeatures();
      const feature = featuresDoc.features.find((f) => f.id === phase.featureId);
      if (feature) {
        // To derive feature status, we still need the statuses of all its phases
        const allPhases = await this.loadAllPhases();
        feature.status = this.deriveFeatureStatus(feature.id, feature.status, allPhases);
        await this.saveFeatures(featuresDoc);
      }
    }
    await this.refreshResume();
  }

  // ── Savers ───────────────────────────────────────────────────────────

  async updateProject(updater: (p: Project) => Project): Promise<Project> {
    return atomicUpdateJson(this.projectPath(), ProjectSchema, updater);
  }

  async updateFeatures(updater: (f: FeaturesDocument) => FeaturesDocument): Promise<FeaturesDocument> {
    return atomicUpdateJson(this.featuresPath(), FeaturesDocumentSchema, updater);
  }

  async updateRequirements(updater: (r: RequirementsDocument) => RequirementsDocument): Promise<RequirementsDocument> {
    return atomicUpdateJson(this.requirementsPath(), RequirementsDocumentSchema, updater);
  }

  async saveProject(project: Project): Promise<void> {
    const parsed = ProjectSchema.parse(project);
    await atomicWriteJson(this.projectPath(), parsed);
    await this.touchManifest();
    await this.maybeAutoSync();
  }

  async saveFeatures(features: FeaturesDocument): Promise<void> {
    const parsed = FeaturesDocumentSchema.parse(features);
    await atomicWriteJson(this.featuresPath(), parsed);
    await this.touchManifest();
    await this.maybeAutoSync();
  }

  async saveRequirements(reqs: RequirementsDocument): Promise<void> {
    const parsed = RequirementsDocumentSchema.parse(reqs);
    await atomicWriteJson(this.requirementsPath(), parsed);
    await this.touchManifest();
  }

    async savePhase(phase: Phase): Promise<void> {
    const parsed = PhaseSchema.parse(phase);
    await mkdir(this.phasesDir(), { recursive: true });
    await atomicWriteJson(this.phasePath(parsed.id), parsed);
    await this.touchManifest();
    await this.maybeAutoSync();
  }

  /** Atomic read-modify-write on a single phase file. Serializes concurrent
   *  task_create / phase_update calls on the SAME phaseId so batch operations
   *  don't lose tasks (last-write-wins race condition). */
  async updatePhase(phaseId: string, updater: (phase: Phase) => Phase): Promise<Phase> {
    return atomicUpdateJson(this.phasePath(phaseId), PhaseSchema, updater);
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
