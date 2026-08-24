/**
 * Agent Plan — Pi adapter extension.
 *
 * Integrates the Agent Plan Platform with Pi as an orchestrator:
 *  - initialize .planner/ if missing
 *  - create & discuss phases
 *  - manage tasks and subtasks
 *  - start/stop local web server
 *  - inject context into prompts
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { paginatedSelect, paginatedNotify } from "./ui/paginate.js";
import { ExportService, PlanStore, setWriteBusyHook, setWriteNotifyHook, withFeatureLock, needsMotivation, findPhaseByRef, findTaskByRef, buildRecap, addChecklistItem, removeChecklistItem, toggleChecklistItem, buildPhaseContextBlock, checkExplicitTaskStart, recommendNextTask, buildResumeRequiredProposal, packageVersionFromModule, resolvedPackageVersion, markFeatureRead, markPhaseRead, markTaskRead, hasReadParents, parentReadAdvisory, hasReadRequirements, requirementReadAdvisory, markRequirementRead, invalidateReads } from "@agent-plan/core";
import { createChecklistItemId, createFeatureId, createPhaseId, createTaskId, clampSlug, normalizeSlug, formatPhaseRef, formatFeatureRef, featureNumberOfPhase, isUuid, validateResolvedTarget } from "@agent-plan/core/naming";
import type { ChecklistItem, AcceptedDecision, CodebaseProfile, Feature, FeaturesDocument, Phase, Project, Requirement, ResumeFocus, StatusLogEntry, Task } from "@agent-plan/core/schema";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { serve } from "@agent-plan/server/serve";
import type { ServeHandle, UiConfig, ShortcutConfigSpec } from "@agent-plan/server/serve";

// ─── State (module-level) ───────────────────────────────────────────────

const PI_CONFIG_DIR_NAME = ".pi";
const PLAN_DIR_NAME = ".planner";
const PI_ADAPTER_PACKAGE = packageVersionFromModule(import.meta.url, "@agent-plan/pi-adapter");
const CORE_PACKAGE = resolvedPackageVersion("@agent-plan/core", import.meta.url);
const SERVER_PACKAGE = resolvedPackageVersion("@agent-plan/server", import.meta.url);

let capturedPi: ExtensionAPI | null = null;

let store: PlanStore | null = null;
let server: ServeHandle | null = null;
let lastKnownWebPort: number | null = null;

// True while the agent is mutating .planner/ files. The web server returns 503-busy
// during this window so the UI doesn't render inconsistent data.
let planBusy = false;
function setPlanBusy(value: boolean): void { planBusy = value; }
function withPlanBusy<T>(fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve()
    .then(() => { planBusy = true; })
    .then(() => fn())
    .finally(() => { planBusy = false; });
}

// Helper to notify a running server in another process via HTTP.
async function notifyExternalServer() {
  try {
    const port = lastKnownWebPort;
    if (!port) return;
    await fetch(`http://127.0.0.1:${port}/internal/notify`, { method: "POST" }).catch(() => {});
  } catch {}
}

// Wire the plan-core write hook to our planBusy flag so every atomic write
// (from any tool, command, or the server) marks the plan busy for the web UI.
setWriteBusyHook((busy) => { planBusy = busy; });
// After every successful atomic write, broadcast a live-update event to the
// web UI via the running server's WebSocket hub. This makes the dashboard
// refresh in real time even when mutations happen through adapter tools
// (feature_create/task_create/...) rather than HTTP routes, without relying
// solely on the filesystem watcher (which can miss atomic renames).
setWriteNotifyHook(() => {
  contextBlockDirty = true; // invalidate cached context so next turn rebuilds
  try {
    if (server?.hub) {
      server.hub.broadcast({ type: "plan-rendered", data: {} });
    } else {
      void notifyExternalServer();
    }
  } catch {}
});
let previousContextPercent = 0;
let autoHandoffTriggered = false;
let plannerSessionEnabled = false;

// In-process guard bypass (per session, NOT persisted/shared). The edit/write
// guard is advisory in Pi (warns "NO ACTIVE TASK" but does not block). When a
// bypass is active the warning is silenced for the window. Lives in memory only:
// not on disk, not in git, not shared across agents/sessions on the same folder.
let guardBypassUntil = "";
function authorizeGuardBypass(durationMinutes = 15): string {
  const until = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  guardBypassUntil = until;
  return until;
}
function clearGuardBypass(): void { guardBypassUntil = ""; }
function isGuardBypassed(): boolean {
  if (!guardBypassUntil) return false;
  const until = Date.parse(guardBypassUntil);
  if (!Number.isFinite(until)) return false;
  if (until <= Date.now()) { guardBypassUntil = ""; return false; }
  return true;
}
let startupResumePromptPending = false;
let startupResumeSummaryPending = false;
let plannerHeavyInitDone = false; // runs migrate/heal/refreshResume once per session, not every turn
let startupResumeSummaryText = "";
let startupResumeSummaryTimer: ReturnType<typeof setTimeout> | null = null;
let contextBlockCache = ""; // cached before_agent_start context; rebuilt only when plan changes
let contextBlockDirty = true; // build on first turn; invalidated by write notify hook
let editedThisTurn = false; // tracks edit/write activity for the task_complete reminder
let taskCompleteReminderSaidThisTurn = false;
const healedStatusRoots = new Set<string>();

const PLANNER_COMMAND_COMPLETIONS = [
  { value: "init", label: "init", description: "Initialize planner in this project" },
  { value: "show", label: "show", description: "Show planner overview" },
  { value: "version", label: "version", description: "Show loaded Agent Plan package versions" },
  { value: "repair", label: "repair", description: "Repair planner integrity" },
  { value: "cleanup-orphans", label: "cleanup-orphans", description: "List and remove orphan phase files" },
  { value: "project discuss", label: "project discuss", description: "Run project discovery" },
  { value: "project language", label: "project language", description: "Set persistent language preferences" },
  { value: "feature list", label: "feature list", description: "List features" },
  { value: "feature add", label: "feature add", description: "Create a feature" },
  { value: "feature show", label: "feature show", description: "Show a feature" },
  { value: "feature discuss", label: "feature discuss", description: "Discuss a feature" },
  { value: "feature update", label: "feature update", description: "Update a feature" },
  { value: "feature delete", label: "feature delete", description: "Delete a feature" },
  { value: "phase add", label: "phase add", description: "Add a phase" },
  { value: "phase show", label: "phase show", description: "Show a phase" },
  { value: "phase discuss", label: "phase discuss", description: "Discuss a phase" },
  { value: "phase update", label: "phase update", description: "Update a phase" },
  { value: "phase delete", label: "phase delete", description: "Delete a phase" },
  { value: "task add", label: "task add", description: "Add a task" },
  { value: "task show", label: "task show", description: "Show a task" },
  { value: "task discuss", label: "task discuss", description: "Discuss a task" },
  { value: "task update", label: "task update", description: "Update a task" },
  { value: "task delete", label: "task delete", description: "Delete a task" },
  { value: "task start", label: "task start", description: "Mark a task in-progress" },
  { value: "task complete", label: "task complete", description: "Mark a task done" },
  { value: "task checklist-add", label: "task checklist-add", description: "Add a checklist step: /planner task checklist-add <T00x> <title>" },
  { value: "task checklist-remove", label: "task checklist-remove", description: "Remove a step: /planner task checklist-remove <T00x> <C{n}|title>" },
  { value: "task checklist-toggle", label: "task checklist-toggle", description: "Tick/untick a step: /planner task checklist-toggle <T00x> <C{n}|title> [on|off]" },
  { value: "handoff list", label: "handoff list", description: "List phases with a handoff" },
  { value: "handoff prepare", label: "handoff prepare", description: "Tell the agent to write the handoff (legacy file-based)" },
  { value: "handoff show", label: "handoff show [P00x]", description: "Show a phase handoff (phase ref required)" },
  { value: "handoff write", label: "handoff write [P00x]", description: "Write a phase handoff after confirmation (phase ref required)" },
  { value: "handoff clear", label: "handoff clear [P00x]", description: "Archive a phase handoff (phase ref required)" },
  { value: "web start", label: "web start", description: "Start the web UI" },
  { value: "web stop", label: "web stop", description: "Stop the web UI" },
  { value: "web status", label: "web status", description: "Show web UI status" },
  { value: "export", label: "export", description: "Export plan summary as Markdown" },
  { value: "export-full", label: "export-full", description: "Export full detailed plan as Markdown" },
  { value: "bypass", label: "bypass", description: "Authorize edit/write without a task in-progress (15 min)" },
  { value: "clear-bypass", label: "clear-bypass", description: "Revoke the guard bypass" },
  { value: "load", label: "load", description: "Enable planner + start web UI (LAN) and show resume summary" },
  { value: "stop", label: "stop", description: "Disable planner and shut down the web UI" },
];

/** A completed nested command followed by a space is now receiving free-form
 * arguments (entity refs, titles, etc.), not another command completion. */
function hasPlannerCommandArgument(prefix: string): boolean {
  const normalized = prefix.trimStart().toLowerCase();
  return PLANNER_COMMAND_COMPLETIONS.some((item) =>
    normalized.startsWith(`${item.value.toLowerCase()} `),
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function manifestPathFor(root: string): string {
  return join(root, "manifest.json");
}

function createRequirementId(): string {
  return crypto.randomUUID();
}

function planRootForCwd(cwd: string): string {
  return join(cwd, PLAN_DIR_NAME);
}

function rootHasPlan(root: string): boolean {
  return existsSync(manifestPathFor(root));
}

function resolvePlanRoot(cwd: string): string {
  const plannerRoot = planRootForCwd(cwd);
  if (rootHasPlan(plannerRoot)) return plannerRoot;
  return plannerRoot;
}

function ensureStore(ctx: ExtensionContext): PlanStore {
  const root = resolvePlanRoot(ctx.cwd);
  if (!store || store.root !== root) {
    store = new PlanStore(root);
    store.enableAutoSync(true);
  }
  return store;
}

function resetState(): void {
  store = null;
  plannerSessionEnabled = false;
  startupResumePromptPending = false;
  startupResumeSummaryPending = false;
  startupResumeSummaryText = "";
  plannerHeavyInitDone = false;
  contextBlockCache = "";
  contextBlockDirty = true;
  editedThisTurn = false;
  taskCompleteReminderSaidThisTurn = false;
}

async function maybeHealStatuses(st: PlanStore, ctx?: any): Promise<void> {
  if (healedStatusRoots.has(st.root)) return;
  const cleared = await st.syncStatuses();
  healedStatusRoots.add(st.root);
  if (cleared.length > 0 && ctx?.ui?.notify) {
    try { ctx.ui.notify(`ℹ️  Handoff auto-cleared (phase completed): ${cleared.join(", ")}`, "info"); } catch {}
  }
}

function normalizeLanguagePref(value: string | undefined): string {
  return value?.trim() ?? "";
}


async function ensureProjectLanguagePreferences(st: PlanStore, persist = true): Promise<Project> {
  const project = await st.loadProject();
  const contentLanguage = normalizeLanguagePref(project.contentLanguage);
  const chatLanguage = normalizeLanguagePref(project.chatLanguage);

  if (contentLanguage && chatLanguage) {
    if (project.contentLanguage !== contentLanguage || project.chatLanguage !== chatLanguage) {
      project.contentLanguage = contentLanguage;
      project.chatLanguage = chatLanguage;
      if (persist) await st.saveProject(project);
    }
    return project;
  }

  if (contentLanguage || chatLanguage) {
    const fallback = contentLanguage || chatLanguage;
    project.contentLanguage = contentLanguage || fallback;
    project.chatLanguage = chatLanguage || fallback;
    if (persist) await st.saveProject(project);
    return project;
  }

  return project;
}

async function getPlannerExecutionGuard(st: PlanStore): Promise<{
  totalTasks: number;
  inProgressTaskIds: string[];
  focusTaskId: string;
  focusTaskTitle: string;
}> {
  const [workspace, resume] = await Promise.all([st.loadAll(), st.loadResume()]);
  const allTasks = workspace.phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));
  const inProgress = allTasks.filter(({ task }) => task.status === "in-progress");
  const totalTasks = allTasks.length;

  const focusFromResume = resume?.inProgressTaskIds?.[0]
    ? allTasks.find(({ task }) => task.id === resume.inProgressTaskIds[0])
    : undefined;
  const focusFromCurrentPhase = resume?.currentPhaseId
    ? allTasks.find(({ phase, task }) => phase.id === resume.currentPhaseId && task.status !== "done" && task.status !== "canceled" && task.status !== "rejected")
    : undefined;
  const fallbackFocus = allTasks.find(({ task }) => task.pauseSnapshot)
    ?? allTasks.find(({ task }) => task.status === "planned" || task.status === "blocked" || task.status === "waiting")
    ?? allTasks.find(({ task }) => task.status !== "done" && task.status !== "canceled" && task.status !== "rejected");
  const focus = focusFromResume ?? focusFromCurrentPhase ?? fallbackFocus;

  return {
    totalTasks,
    inProgressTaskIds: inProgress.map(({ task }) => task.id),
    focusTaskId: focus?.task.id ?? "",
    focusTaskTitle: focus?.task.title ?? "",
  };
}

function formatSequence(value: number | undefined): string {
  return String(value && value > 0 ? value : 0).padStart(3, "0");
}

function featureLabel(feature: Feature): string {
  return `F${formatSequence(feature.number)} — ${feature.name}`;
}

function phaseLabel(phase: Phase): string {
  return `P${formatSequence(phase.number)} — ${phase.title}`;
}

function taskLabel(task: Task): string {
  return `T${formatSequence(task.number)} — ${task.title}`;
}

function resolveFeatureRefStrict(features: Feature[], ref: string):
  | { ok: true; feature: Feature }
  | { ok: false; error: string } {
  const raw = ref.trim();
  if (!raw) return { ok: false, error: "Feature ref is required." };
  const normalized = raw.toLowerCase();
  const byNumber = normalized.match(/^f(\d+)$/)
    ? features.find((feature) => feature.number === parseInt(normalized.slice(1), 10))
    : undefined;
  if (byNumber) return { ok: true, feature: byNumber };

  const byShortId = features.find((feature) => feature.shortId?.toLowerCase() === normalized);
  if (byShortId) return { ok: true, feature: byShortId };

  const byId = features.find((feature) => feature.id.toLowerCase() === normalized);
  if (byId) return { ok: true, feature: byId };

  const exactName = features.filter((feature) => feature.name.toLowerCase() === normalized);
  if (exactName.length === 1) return { ok: true, feature: exactName[0]! };
  if (exactName.length > 1) return { ok: false, error: `Ambiguous feature ref: ${raw}. Multiple features have that exact name; use F00x, shortId, or UUID.` };

  const partialName = features.filter((feature) => feature.name.toLowerCase().includes(normalized));
  if (partialName.length === 1) return { ok: true, feature: partialName[0]! };
  if (partialName.length > 1) return { ok: false, error: `Ambiguous feature ref: ${raw}. Matches: ${partialName.map((feature) => formatFeatureRef(feature.number)).join(", ")}. Use a specific F00x, shortId, or UUID.` };

  return { ok: false, error: `Feature not found: ${raw}` };
}

async function buildHandoffMarkdown(
  st: PlanStore,
  reason: string,
  overrides?: {
    whatWasBeingDone?: string;
    howToResume?: string;
    nextSteps?: string[];
    blockers?: string[];
    extraSections?: Array<{ heading: string; body: string }>;
    title?: string;
    /** Explicit phase selected for this handoff; never infer it from resume state. */
    phaseId?: string;
  },
): Promise<string> {
  const [plan, resume, activity] = await Promise.all([
    st.loadAll(),
 st.refreshResume(),
    st.loadActivityLog(),
  ]);

  const createdAt = nowISO();
  const updatedAt = nowISO();
  const allTasks = plan.phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));
  const nonTerminalTasks = allTasks.filter(({ task }) => task.status !== "done" && task.status !== "canceled");
  const latestTaskUpdate = [...allTasks].sort((left, right) => right.task.updatedAt.localeCompare(left.task.updatedAt))[0] ?? null;
  const latestPhaseUpdate = [...plan.phases].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const latestFeatureUpdate = [...plan.features.features].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const currentPhase = (overrides?.phaseId ? plan.phases.find((phase) => phase.id === overrides.phaseId) : undefined)
    ?? plan.phases.find((phase) => phase.id === resume.currentPhaseId)
    ?? plan.phases.find((phase) => phase.tasks.some((task) => resume.inProgressTaskIds.includes(task.id)))
    ?? plan.phases.find((phase) => phase.status === "in-progress")
    ?? nonTerminalTasks[0]?.phase
    ?? latestPhaseUpdate
    ?? null;
  const currentTask = currentPhase?.tasks.find((task) => resume.inProgressTaskIds.includes(task.id))
    ?? currentPhase?.tasks.find((task) => task.status === "in-progress")
    ?? currentPhase?.tasks.find((task) => task.pauseSnapshot)
    ?? [...(currentPhase?.tasks ?? [])].filter((task) => task.status !== "done" && task.status !== "canceled" && task.status !== "rejected").sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    ?? latestTaskUpdate?.task
    ?? null;
  const currentFeature = currentPhase?.featureId
    ? plan.features.features.find((feature) => feature.id === currentPhase.featureId) ?? null
    : latestFeatureUpdate ?? null;
  const recentActivity = activity.entries.slice(-8).reverse();

  const defaultBootstrapStep = "Run /planner project discuss to bootstrap discovery";
  const hasStructuredWork = plan.features.features.length > 0 || plan.phases.length > 0 || allTasks.length > 0;
  const normalizedResumeNextSteps = (resume.nextSteps ?? []).filter((step) => !(hasStructuredWork && step === defaultBootstrapStep));

  const totalFeatures = plan.features.features.length;
  const doneFeatures = plan.features.features.filter((feature) => feature.status === "done").length;
  const activeFeatures = plan.features.features.filter((feature) => feature.status === "in-progress").length;
  const totalPhases = plan.phases.length;
  const donePhases = plan.phases.filter((phase) => phase.status === "done").length;
  const activePhases = plan.phases.filter((phase) => phase.status === "in-progress" || phase.status === "discovery").length;
  const totalTasks = allTasks.length;
  const doneTasks = allTasks.filter(({ task }) => task.status === "done").length;
  const activeTasks = allTasks.filter(({ task }) => task.status === "in-progress").length;

  const inferredRecentChanges = [
    latestFeatureUpdate ? `Latest feature update: ${latestFeatureUpdate.name} (${latestFeatureUpdate.status}) at ${latestFeatureUpdate.updatedAt}` : "",
    latestPhaseUpdate ? `Latest phase update: ${latestPhaseUpdate.title} (${latestPhaseUpdate.status}) at ${latestPhaseUpdate.updatedAt}` : "",
    latestTaskUpdate ? `Latest task update: ${latestTaskUpdate.task.title} (${latestTaskUpdate.task.status}) at ${latestTaskUpdate.task.updatedAt}` : "",
  ].filter(Boolean);

  const whatWasBeingDone = (
    overrides?.whatWasBeingDone
    ?? currentTask?.notes
    ?? currentTask?.description
    ?? currentPhase?.notes
    ?? resume.notes
    ?? [
      currentFeature ? `Work appears to have been centered on feature ${currentFeature.id} — ${currentFeature.name} (${currentFeature.status}).` : "",
      currentPhase ? `The most relevant phase is ${currentPhase.id} — ${currentPhase.title} (${currentPhase.status}).` : "",
      currentTask ? `The most relevant task is ${currentTask.id} — ${currentTask.title} (${currentTask.status}).` : "",
      inferredRecentChanges.length > 0 ? `Recent planner changes:\n${inferredRecentChanges.map((line) => `- ${line}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n")
  ) || "No additional execution notes were captured.";

  const inferredNextSteps = overrides?.nextSteps
    ?? normalizedResumeNextSteps.length > 0
      ? normalizedResumeNextSteps
      : currentTask && currentTask.status === "in-progress"
        ? [
            `Resume task ${currentTask.id} — ${currentTask.title}.`,
            `Review the task details and continue implementation in phase ${currentPhase?.id ?? currentTask.phaseId}.`,
            "When the work is complete, call task_complete so the derived phase/feature statuses stay correct.",
          ]
        : currentTask
          ? [
              `Start task ${currentTask.id} — ${currentTask.title} with /planner task start (or task_start) before doing implementation work.`,
              `Then continue work in phase ${currentPhase?.id ?? currentTask.phaseId}.`,
            ]
          : currentPhase && currentPhase.status !== "done"
            ? [
                `Review phase ${currentPhase.id} — ${currentPhase.title}.`,
                "Pick the next actionable task in that phase and start it with /planner task start before editing code.",
              ]
            : plan.phases.find((phase) => phase.status === "planned" || phase.status === "draft" || phase.status === "discovery")
              ? [
                  `Review the next non-complete phase: ${(plan.phases.find((phase) => phase.status === "planned" || phase.status === "draft" || phase.status === "discovery") as Phase).id}.`,
                  "Create or start the next task in that phase.",
                ]
              : hasStructuredWork
                ? ["Review the latest updated feature/phase/task and choose the next concrete task to start."]
                : [defaultBootstrapStep];

  const blockers = overrides?.blockers ?? resume.blockers;
  const howToResume = overrides?.howToResume
    ?? [
      currentTask
        ? `1. Open task ${currentTask.id} (${currentTask.title}).`
        : currentPhase
          ? `1. Open phase ${currentPhase.id} (${currentPhase.title}).`
          : "1. Open the planner dashboard and inspect the latest feature/phase state.",
      "2. Run handoff show <ref> (or /planner handoff show <ref>) to read the phase handoff and compare it with the latest planner data.",
      currentTask && currentTask.status !== "in-progress"
        ? `3. Before implementation work, run /planner task start ${currentTask.id} (or call task_start).`
        : "3. Confirm whether the current task is already in-progress before doing implementation work.",
      `4. Continue with the next activity: ${inferredNextSteps[0] ?? "choose the next concrete task"}`,
    ].join("\n");

  const filesTouched = [
    ".planner/project.json",
    ".planner/features/",
    currentPhase ? `.planner/phases/${currentPhase.id}.json` : "",
    latestPhaseUpdate && latestPhaseUpdate.id !== currentPhase?.id ? `.planner/phases/${latestPhaseUpdate.id}.json` : "",
    ".planner/.local/resume.json",
    ".planner/.local/generated/PLAN.md",
  ].filter(Boolean);

  const recentActivityLines = recentActivity.length > 0
    ? recentActivity.map((entry) => `- ${entry.at} [${entry.type}] ${entry.ref}: ${entry.summary}`)
    : inferredRecentChanges.length > 0
      ? inferredRecentChanges.map((entry) => `- ${entry}`)
      : ["- No recent activity recorded"];

  // Auto-derived: all task statuses for the current phase, so a resuming agent
  // sees the full picture (not just the single in-progress task).
  const currentPhaseTaskLines = currentPhase && currentPhase.tasks.length > 0
    ? [...currentPhase.tasks]
      .sort((a, b) => a.number - b.number || a.createdAt.localeCompare(b.createdAt))
      .map((task) => `- ${statusIcon(task.status)} \`${task.id}\` — ${task.title} (${task.status})`)
    : [];
  // Caller-supplied rich context sections (locked design decisions,
  // architecture, mode/state flows, plugin/API contracts, data mappings,
  // known gaps, ...) injected between "What was being done" and "How to resume".
  const extraSectionLines = (overrides?.extraSections ?? []).flatMap((section) => [
    "",
    `## ${section.heading}`,
    section.body,
  ]);
  const autoCurrentTaskSection = currentPhaseTaskLines.length > 0
    ? ["", `## Current Task Statuses (phase ${currentPhase!.id})`, ...currentPhaseTaskLines]
    : [];

  return [
    `# ${overrides?.title?.trim() || `Handoff — ${reason}`}`,
    "",
    `Created at: ${createdAt}`,
    `Updated at: ${updatedAt}`,
    `Reason: ${reason}`,
    "",
    "## Progress snapshot",
    `- Features: ${doneFeatures}/${totalFeatures} done, ${activeFeatures} active`,
    `- Phases: ${donePhases}/${totalPhases} done, ${activePhases} active/discovery`,
    `- Tasks: ${doneTasks}/${totalTasks} done, ${activeTasks} active`,
    "",
    "## Current focus",
    currentFeature ? `- Feature: \`${currentFeature.id}\` — ${currentFeature.name} (${currentFeature.status})` : "- Feature: (none)",
    currentPhase ? `- Phase: \`${currentPhase.id}\` — ${currentPhase.title} (${currentPhase.status})` : "- Phase: (none)",
    currentTask ? `- Task: \`${currentTask.id}\` — ${currentTask.title} (${currentTask.status})` : "- Task: (none)",
    "",
    "## What was being done",
    whatWasBeingDone || "No additional execution notes were captured.",
    ...extraSectionLines,
    ...autoCurrentTaskSection,
    "",
    "## How to resume",
    howToResume,
    "",
    "## Files to inspect first",
    ...filesTouched.map((entry) => `- ${entry}`),
    "",
    "## Blockers",
    ...(blockers.length > 0 ? blockers.map((entry) => `- ${entry}`) : ["- None recorded"]),
    "",
    "## Next steps",
    ...(inferredNextSteps.length > 0 ? inferredNextSteps.map((entry) => `- ${entry}`) : ["- None recorded"]),
    "",
    "## Recent activity",
    ...recentActivityLines,
    "",
    "## Reminder",
    "- This handoff remains active until every task in this phase is done/canceled, a newer handoff replaces it, or the user explicitly clears it. Reading or starting a task never clears it.",
  ].join("\n");
}

async function writeProjectHandoff(
  st: PlanStore,
  reason: string,
  overrides?: {
    whatWasBeingDone?: string;
    howToResume?: string;
    nextSteps?: string[];
    blockers?: string[];
    extraSections?: Array<{ heading: string; body: string }>;
  },
): Promise<void> {
  // Entity-scoped: write the auto-handoff on the current in-progress phase
  // (not the deprecated .planner/HANDOFF.md file). If no in-progress phase,
  // skip silently — the resume flow falls back to resume.json.
  const phases = await st.loadAllPhases();
  const phase = phases.find((p) => p.status === "in-progress") ?? null;
  if (!phase) return;
  const markdown = await buildHandoffMarkdown(st, reason, overrides);
  await st.setPhaseHandoff(phase.id, markdown);
}

function compactShortcut(spec: ShortcutConfigSpec): ShortcutConfigSpec {
  return {
    key: spec.key,
    ...(spec.primary ? { primary: true } : {}),
    ...(spec.meta ? { meta: true } : {}),
    ...(spec.ctrl ? { ctrl: true } : {}),
    ...(spec.shift ? { shift: true } : {}),
    ...(spec.alt ? { alt: true } : {}),
  };
}

function parseShortcut(value: unknown): ShortcutConfigSpec | undefined {
  if (typeof value === "object" && value && "key" in value) {
    const input = value as Partial<ShortcutConfigSpec>;
    if (typeof input.key !== "string" || !input.key) return undefined;
    return compactShortcut({
      key: input.key,
      primary: input.primary || false,
      meta: input.meta || false,
      ctrl: input.ctrl || false,
      shift: input.shift || false,
      alt: input.alt || false,
    });
  }

  if (typeof value !== "string") return undefined;
  const parts = value.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return undefined;

  const key = parts[parts.length - 1] ?? "";
  return compactShortcut({
    key: key === "enter" ? "Enter" : key.length === 1 ? key : key,
    meta: parts.includes("meta") || parts.includes("cmd"),
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt") || parts.includes("option"),
  });
}

function readShortcutSettingsFile(path: string): UiConfig | undefined {
  if (!existsSync(path)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      agentPlan?: {
        shortcuts?: Partial<Record<"create" | "edit" | "delete" | "submit", unknown>>;
      };
    };

    const shortcuts = parsed.agentPlan?.shortcuts;
    if (!shortcuts) return undefined;

    const resolved = {
      create: parseShortcut(shortcuts.create),
      edit: parseShortcut(shortcuts.edit),
      delete: parseShortcut(shortcuts.delete),
      submit: parseShortcut(shortcuts.submit),
    };

    return {
      shortcuts: {
        ...(resolved.create ? { create: resolved.create } : {}),
        ...(resolved.edit ? { edit: resolved.edit } : {}),
        ...(resolved.delete ? { delete: resolved.delete } : {}),
        ...(resolved.submit ? { submit: resolved.submit } : {}),
      },
    };
  } catch {
    return undefined;
  }
}

function readUiConfig(ctx: ExtensionContext): UiConfig | undefined {
  const globalSettings = readShortcutSettingsFile(join(homedir(), ".pi", "agent", "settings.json"));
  const projectSettings = readShortcutSettingsFile(join(ctx.cwd, PI_CONFIG_DIR_NAME, "settings.json"));

  return {
    shortcuts: {
      ...globalSettings?.shortcuts,
      ...projectSettings?.shortcuts,
    },
  };
}

function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    draft: "📄", discovery: "🔍", planned: "📋",
    "in-progress": "🚧", done: "✅", blocked: "🚫", canceled: "❌",
    rejected: "❌", deferred: "⏳", waiting: "⏱️",
  };
  return icons[status] ?? "❓";
}

function pad(n: number): string {
  return String(n).padStart(3, "0");
}
function applyTaskLifecycleDates(task: Task, nextStatus: Task["status"], now: string): void {
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
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, "127.0.0.1");
  });
}

async function pickProjectPort(ctx: ExtensionContext, explicitPort?: number): Promise<number> {
  const st = ensureStore(ctx);
  const project = await st.loadProject();

  if (explicitPort && explicitPort > 0) {
    if (!(await isPortAvailable(explicitPort)) && project.webPort !== explicitPort) {
      throw new Error(`Port ${explicitPort} is already in use`);
    }
    project.webPort = explicitPort;
    await st.saveProject(project);
    return explicitPort;
  }

  // Reuse the persisted port if it's still free (stable port across restarts,
  // lets subagents notify the server via HTTP).
  if (project.webPort > 0 && (await isPortAvailable(project.webPort))) {
    return project.webPort;
  }

  // Persisted port busy (another planner instance on this project) or first run:
  // scan for a free port. Persist ONLY on first run (canonical); when falling
  // back from a busy persisted port, return transient so we don't hijack the
  // primary session's canonical port (prevents port thrashing).
  for (let port = 3030; port <= 3999; port += 1) {
    if (port === project.webPort) continue;
    if (await isPortAvailable(port)) {
      if (project.webPort <= 0) {
        project.webPort = port;
        await st.saveProject(project);
      }
      return port;
    }
  }

  throw new Error("No free port found in range 3030-3999");
}

// ─── Server lifecycle (uses capturedPi) ─────────────────────────────────

function resolveStaticDir(): string | undefined {
  try {
    const adapterFile = fileURLToPath(import.meta.url);
    const adapterDir = dirname(adapterFile);
    // When installed as Pi package: node_modules/@agent-plan/pi-adapter/web-ui-dist/
    const pkgWebUi = join(adapterDir, "..", "web-ui-dist");
    // Monorepo dev: packages/plan-web-ui/dist/ (rebuilt by `pnpm build:web-ui`)
    const devWebUi = join(adapterDir, "..", "..", "plan-web-ui", "dist");
    const candidates = [pkgWebUi, devWebUi].filter((d) => {
      try {
        return existsSync(join(d, "index.html"));
      } catch {
        return false;
      }
    });
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    // Prefer the most recently built bundle so a fresh `pnpm build:web-ui`
    // (or copy-web-ui.sh) is picked up in dev instead of a stale vendored
    // snapshot. Deterministic: compare index.html mtimes, newest wins.
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

async function maybeStartWeb(ctx: ExtensionContext): Promise<void> {
  if (server) return;
  ctx.ui.notify("Starting web server (LAN)…", "info");
  try {
    await startServer(ctx, undefined, "lan");
    const srv = server as ServeHandle | null;
    ctx.ui.notify(srv?.lanUrl ? `Web UI ready. Local: ${srv.localUrl} — LAN: ${srv.lanUrl}` : `Web UI ready. Open: ${srv?.url ?? "?"}`, "info");
  } catch (err) {
    ctx.ui.notify(`Failed to start web server: ${String(err)}`, "error");
  }
}

function normalizeVisibility(input: string | undefined): "local" | "lan" | undefined {
  const v = (input ?? "").trim().toLowerCase();
  if (!v) return undefined;
  if (v === "lan" || v === "network" || v === "0.0.0.0") return "lan";
  if (v === "local" || v === "localhost" || v === "127.0.0.1") return "local";
  return undefined;
}

async function startServer(ctx: ExtensionContext, requestedPort?: number, visibility: "local" | "lan" = "lan"): Promise<void> {
  if (server) return;
  const host = visibility === "lan" ? "0.0.0.0" : "127.0.0.1";
  const port = await pickProjectPort(ctx, requestedPort);
  // A started server must be reflected in the next context block; the cache
  // may hold a stale "Web UI: not running" block from a stop+prompt pair.
  contextBlockDirty = true;
  try {
    server = await serve({
      port,
      host,
      planRoot: resolvePlanRoot(ctx.cwd),
      staticDir: resolveStaticDir(),
      quiet: true,
      uiConfig: readUiConfig(ctx),
      isBusy: () => planBusy,
    });
  } catch (e) {
    // Any listen failure at startup is potentially transient — EADDRINUSE from
    // a racy port scan (another process grabbed the port between our check and
    // bind), EMFILE/ENFILE under heavy load, EAGAIN, etc. Retry ONCE on a random
    // free port (port 0) so a planner load never silently ends up with no server.
    // serve() throws here only during startup binding/serving setup; if the retry
    // also fails, surface the error to the user.
    try {
      server = await serve({
        port: 0,
        host,
        planRoot: resolvePlanRoot(ctx.cwd),
        staticDir: resolveStaticDir(),
        quiet: true,
        uiConfig: readUiConfig(ctx),
        isBusy: () => planBusy,
      });
      ctx.ui.notify(`Planner web server: port ${port} unavailable (${e instanceof Error ? e.message : String(e)}), started on ${server?.url ?? "?"} instead.`, "info");
    } catch (e2) {
      ctx.ui.notify(`Failed to start web server (also retry failed): ${e2 instanceof Error ? e2.message : String(e2)}`, "error");
    }
  }
  if (server) {
    // Extract the REAL listening port from server.url (especially after a
    // retry on port 0, where the `port` variable still holds the requested 0).
    let realPort = port;
    try { const p = Number(new URL(server.url).port); if (p) realPort = p; } catch {}
    capturedPi?.appendEntry("plan-web-state", { running: true, port: realPort, mode: server.mode });
    lastKnownWebPort = realPort;

    // Persist the actual listening port in project data so other processes
    // (e.g. subagents) can notify the server via HTTP.
    try {
      const st = ensureStore(ctx);
      const project = await st.loadProject().catch(() => null);
      if (project) {
        // Persist only the canonical port (first run, or realPort matches the
        // existing canonical). Never persist a transient fallback port — that
        // hijacks the primary session's port when two instances share a .planner.
        if (project.webPort <= 0 || project.webPort === realPort) {
          project.webPort = realPort;
          await st.saveProject(project);
        }
      }
    } catch {}
  }
}

function enablePlannerSession(): void {
  plannerSessionEnabled = true;
  contextBlockDirty = true;
}

function disablePlannerSession(): void {
  plannerSessionEnabled = false;
  startupResumePromptPending = false;
  startupResumeSummaryPending = false;
  startupResumeSummaryText = "";
  if (startupResumeSummaryTimer) clearTimeout(startupResumeSummaryTimer);
  startupResumeSummaryTimer = null;
  contextBlockCache = "";
  contextBlockDirty = true;
}

async function stopServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
  }
  capturedPi?.appendEntry("plan-web-state", { running: false });
  // The cached context block embeds the web UI address; after stop it must
  // not keep claiming the dashboard is running (T241 — context invalidation).
  contextBlockDirty = true;
}

// ─── Extension factory ──────────────────────────────────────────────────

export default function planPiExtension(pi: ExtensionAPI): void {
  capturedPi = pi;

  // ── Restore on session start/reload ─────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    try {
    ctx.ui.addAutocompleteProvider((current) => ({
      triggerCharacters: ["/", " "],
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const line = lines[cursorLine] ?? "";
        const beforeCursor = line.slice(0, cursorCol);
        const match = beforeCursor.match(/(?:^|\s)(\/planner)(?:\s+(.*))?$/);
        if (!match) {
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        }

        const argPrefix = match[2];
        const prefix = argPrefix === undefined ? match[1]! : argPrefix;
        if (argPrefix !== undefined && hasPlannerCommandArgument(argPrefix)) {
          return null;
        }
        const normalized = (argPrefix ?? "").trimStart().toLowerCase();
        const items = PLANNER_COMMAND_COMPLETIONS
          .filter((item) => !normalized || item.value.startsWith(normalized))
          .map((item) => ({
            ...item,
            value: argPrefix === undefined ? `/planner ${item.value}` : item.value,
          }));

        return {
          prefix,
          items: items.length > 0 ? items : PLANNER_COMMAND_COMPLETIONS,
        };
      },
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      },
      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      },
    }));

    resetState();
    autoHandoffTriggered = false;
    previousContextPercent = 0;
    const st = ensureStore(ctx);
    st.enableAutoSync(true);

    // Read any persisted web port (for reuse), but do NOT auto-start here.
    // The two-step gating below decides whether to start the server.
    let preferredPort: number | undefined;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && (entry as { customType?: string }).customType === "plan-web-state") {
        const data = (entry as { data?: { running?: boolean; port?: number } }).data;
        if (data?.port) preferredPort = data.port;
      }
    }

    const exists = await st.exists().catch(() => false);
    let project = exists ? await st.loadProject().catch(() => null) : null;

    // ── Step 1: Enable gating ───────────────────────────────────────
    // No blocking prompt in session_start: ctx.ui.input()/select() do not
    // render for NPM-loaded ESM extensions during session_start (they hang
    // until the safety-net timeout). Tracked upstream via planner task
    // T151 · EBRST. The planner is always DISABLED at startup; the user
    // enables it with '/planner load' (which also starts the web UI on LAN
    // and triggers the resume summary showing the URL).
    let enablePlanner = false;
    if (exists) {
      ctx.ui.notify("Planner detected in this project. Run '/planner load' to enable the planner and start the web UI (LAN).", "info");
    }
    plannerSessionEnabled = enablePlanner;

    // Proactive review hint: surface pending phase handoffs (entity-scoped).
    if (plannerSessionEnabled) {
      const handoffs = await st.listHandoffs().catch(() => []);
      if (handoffs.length > 0) {
        ctx.ui.notify(`ℹ️  ${handoffs.length} phase handoff(s) pending — review with /planner handoff list.`, "info");
        // Mark each handoff as read (recap presented). Do NOT clear — reading/load
        // is non-mutating; only phase completion, replacement, or explicit clear archives it.
        for (const h of handoffs) await st.markHandoffRead(h.phaseId).catch(() => {});
      }
    }

    // If the user declined enablement, skip EVERYTHING (no web prompt, no migration, no summary).
    if (exists && !enablePlanner) {
      startupResumePromptPending = false;
      startupResumeSummaryPending = false;
      return;
    }

    } catch (e) {
      // Defensive: never let session_start throw crash Pi silently.
      try { ctx.ui.notify(`Planner session_start error: ${e instanceof Error ? e.message : String(e)}`, "error"); } catch {}
    }
  });

  pi.on("session_before_switch", async (event, ctx) => {
    try {
      const st = ensureStore(ctx);
      if (await st.exists().catch(() => false)) {
        await writeProjectHandoff(st, `before session ${event.reason}`).catch(() => {});
      }
    } catch {}
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    try {
      const st = ensureStore(ctx);
      if (await st.exists().catch(() => false)) {
        await writeProjectHandoff(st, "before compact").catch(() => {});
        autoHandoffTriggered = true;
      }
    } catch {}
  });

  pi.on("session_shutdown", async (event, ctx) => {
    try {
      const st = store;
      if (st && await st.exists().catch(() => false)) {
        await writeProjectHandoff(st, `session shutdown (${event.reason})`).catch(() => {});
      }
    } catch {}
    await stopServer().catch(() => {});
    resetState();
    capturedPi = null;
  });

  pi.on("message_end", async (event, _ctx) => {
    if (!plannerSessionEnabled) return;
    if (!startupResumeSummaryPending) return;
    if (event.message.role !== "assistant") return;
    const visibleText = event.message.content
      .filter((item) => item.type === "text")
      .map((item) => (item as { text?: string }).text ?? "")
      .join("");
    if (!visibleText.trim()) return;
    // Dedupe: if the agent already printed the address, don't double-append.
    if (visibleText.includes("🌐 Web UI:")) return;

    // Append the web address to EVERY assistant text message during the recap
    // turn (template: "{agent_summary}\n\n{web_address}"). We intentionally do
    // NOT consume the flag here: the recap turn can span several assistant
    // messages (tool calls + final summary), and we must guarantee the address
    // lands on the final summary the user actually reads. The flag is cleared
    // at the start of the next turn (before_agent_start) plus a safety timeout.
    const webServer = server as ServeHandle | null;
    const localUrl = webServer?.localUrl ?? webServer?.url ?? "";
    if (!localUrl) return;
    const lanUrl = webServer?.lanUrl ?? "";
    const urlLine = `\n\n🌐 Web UI: ${localUrl}${lanUrl ? ` — LAN: ${lanUrl}` : ""}`;

    return {
      message: {
        ...event.message,
        content: [...event.message.content, { type: "text" as const, text: urlLine }],
      },
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!plannerSessionEnabled) return;

    if (event.toolName === "task_update") {
      const nextStatus = (event.input as { status?: string } | undefined)?.status;
      const motivation = (event.input as { motivation?: string } | undefined)?.motivation;
      if (nextStatus) {
        const st = ensureStore(ctx);
        const tasks = await st.loadAllPhases().then(phases => phases.flatMap(p => p.tasks));
        const task = tasks.find(t => t.id === (event.input as any).taskId);
        if (task) {
          // Allow legal reopen: done → in-progress via task_update.
          if (nextStatus === "in-progress" && task.status === "done") {
            // Legal reopen — no motivation needed.
          } else if (needsMotivation(task.status, nextStatus)) {
            if (!motivation || !motivation.trim()) {
              return {
                block: true,
                reason: `Status transition "${task.status} → ${nextStatus}" requires a motivation. Add a "motivation" parameter with a detailed explanation of why this change is needed.`,
              };
            }
          }
        }
      }
    }

    // Guard the code-writing tools (edit/write). bash stays free so that
    // git pull, build, test, ls, etc. always work.
    if (event.toolName !== "edit" && event.toolName !== "write") return;

    // Planner-internal writes (.planner/HANDOFF.md, resume.json, generated plan
    // files, etc.) are planner operations, NOT code edits. They never require a
    // task in-progress — skip the guard so the handoff can always be written.
    const targetPath = String((event.input as any)?.path ?? (event.input as any)?.filePath ?? "");
    if (targetPath && (targetPath.includes("/.planner/") || targetPath.includes("\\.planner\\") || targetPath.startsWith(".planner/"))) return;

    const st = loadStore(ctx);
    if (!(await st.exists().catch(() => false))) return;
    await maybeHealStatuses(st, ctx).catch(() => {});

    const guard = await getPlannerExecutionGuard(st).catch(() => null);
    if (!guard || guard.totalTasks === 0) return; // nothing to enforce yet
    if (guard.inProgressTaskIds.length > 0) return; // a task is open → we're good
    if (isGuardBypassed()) return; // user authorized proceeding without a task

    const focusHint = guard.focusTaskId
      ? `Il task più probabile è ${guard.focusTaskId} — ${guard.focusTaskTitle}. Avvialo con: \`/planner task start ${guard.focusTaskId}\``
      : `Scegli un task dal piano e avvialo con \`/planner task start <taskId>\`.`;
    
    ctx.ui.notify(`⚠️  NO ACTIVE TASK: You are editing files without an in-progress task. Remember to update the plan to maintain dashboard integrity. ${focusHint}`, "warning");
    return; // Allow the tool to proceed

  });

  // Reset per-turn flags at the start of each turn.
  pi.on("turn_start", async () => {
    editedThisTurn = false;
    taskCompleteReminderSaidThisTurn = false;
  });

  // After edit/write succeeds, track activity and (once per turn, when a task
  // is in-progress) remind the agent to complete the task when the work is done.
  pi.on("tool_result", async (event, ctx) => {
    if (!plannerSessionEnabled) return;
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    editedThisTurn = true;
    if (taskCompleteReminderSaidThisTurn) return;
    try {
      const st = loadStore(ctx);
      if (!(await st.exists().catch(() => false))) return;
      const guard = await getPlannerExecutionGuard(st).catch(() => null);
      if (guard && guard.inProgressTaskIds.length > 0) {
        taskCompleteReminderSaidThisTurn = true;
        return {
          content: [{ type: "text", text: "Reminder: when this implementation work is finished, call task_complete (or /planner task complete) so the task status moves to done and phase/feature rollups stay correct." }],
        };
      }
    } catch {}
  });

  // ── Commands ───────────────────────────────────────────────────────

  // ── Planner handler (reusable from multiple commands) ──────────

  const plannerInteractionCancelled = Symbol("planner-interaction-cancelled");

  /**
   * Pi returns `undefined` when Escape closes an input/editor/select. Treat
   * that as a transaction-wide cancellation, not as an omitted optional
   * field: interactive planner commands must never keep prompting or write a
   * partial edit after Escape.
   */
  function withCancellablePlannerUi(ctx: ExtensionContext): ExtensionContext {
    const cancellableCtx = Object.create(ctx) as ExtensionContext;
    const ui = new Proxy(ctx.ui, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (typeof member !== "function") return member;
        if (property === "input" || property === "editor" || property === "select") {
          return async (...args: unknown[]) => {
            const result = await member.apply(target, args);
            if (result === undefined || result === null) throw plannerInteractionCancelled;
            return result;
          };
        }
        return member.bind(target);
      },
    });
    Object.defineProperty(cancellableCtx, "ui", { value: ui, enumerable: true });
    return cancellableCtx;
  }

  async function handlePlanner(args: string, ctx: ExtensionContext): Promise<void> {
    try {
      await withPlanBusy(() => runPlanner(args, withCancellablePlannerUi(ctx)));
    } catch (error) {
      if (error === plannerInteractionCancelled) {
        ctx.ui.notify("Cancelled — no changes saved.", "info");
        return;
      }
      throw error;
    }
  }

  async function runPlanner(args: string, ctx: ExtensionContext): Promise<void> {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const [a, b, ...rest] = parts;
    const subArgs = rest.join(" ");

    const PLANNER_MENU_ACTIONS = [
      "init",
      "show",
      "version",
      "repair",
      "cleanup-orphans",
      "project discuss",
      "project language",
      "feature list",
      "feature add",
      "feature show",
      "feature update",
      "feature delete",
      "phase add",
      "phase show",
      "phase discuss",
      "phase update",
      "phase delete",
      "task add",
      "task show",
      "task discuss",
      "task update",
      "task delete",
      "task start",
      "task complete",
      "handoff prepare",
      "handoff show",
      "handoff write",
      "handoff clear",
      "web start",
      "web stop",
      "web status",
      "export",
      "export-full",
      "bypass",
      "clear-bypass",
      "load",
      "stop",
    ];

    const SUB_HELP = "Available: init, show, version, repair, cleanup-orphans, project, feature, phase, task, discuss, handoff, web, export, export-full, bypass, clear-bypass, load, stop\n" +
      "Try: /planner <TAB>  |  /planner feature list  |  /planner task start  |  /planner cleanup-orphans\n" +
      "Handoff actions: /planner handoff list | show P00x | write P00x | clear P00x | prepare (prepare proposes a target and asks for confirmation)";

    if (!a) {
      const action = await ctx.ui.select("Planner action", PLANNER_MENU_ACTIONS);
      if (!action) {
        ctx.ui.notify(SUB_HELP, "info");
        return;
      }
      await runPlanner(action, ctx);
      return;
    }

    if (a === "version") {
      ctx.ui.notify([
        "Agent Plan runtime versions",
        `${PI_ADAPTER_PACKAGE.name}: ${PI_ADAPTER_PACKAGE.version}`,
        `${CORE_PACKAGE.name}: ${CORE_PACKAGE.version}`,
        `${SERVER_PACKAGE.name}: ${SERVER_PACKAGE.version}`,
      ].join("\n"), "info");
      return;
    }

    const st = ensureStore(ctx);

    // ── init ──
    if (a === "init") {
      if (await st.exists()) {
        const confirm = await ctx.ui.input("Project already exists. Do you want to reset and reinitialize? (y/N)");
        if (!isYes(confirm)) {
          ctx.ui.notify("Aborted", "warning");
          return;
        }
        const oldProject = await st.loadProject();
        // Collect the replacement metadata before deleting the existing plan;
        // Escape must leave the old project intact.
        const name = await ctx.ui.input(`Project title [${oldProject.name}]`);
        if (!name?.trim()) { ctx.ui.notify("Aborted", "warning"); return; }
        const description = await ctx.ui.input(`Short project description [${oldProject.description || ""}]`);
        ctx.ui.notify("Resetting project... all current plan data will be lost.", "warning");
        
        if (server) {
          ctx.ui.notify("Stopping active web server...", "info");
          await server.close();
          server = null;
        }
        await rm(st.root, { recursive: true, force: true });

        await st.init(name.trim());
        const project = await st.loadProject();
        project.description = description?.trim() ?? oldProject.description;
        await st.saveProject(project);
        await st.writeGenerated();
        await scanCodebase();
        ctx.ui.notify(`.planner/ initialized for "${name.trim()}". Starting project discuss…`, "info");
        enablePlannerSession();
        await maybeStartWeb(ctx);
        await handlePlanner("project discuss", ctx);
        return;
      }
      const name = await ctx.ui.input("Project title");
      if (!name?.trim()) { ctx.ui.notify("Aborted", "warning"); return; }
      const description = await ctx.ui.input("Short project description");
      await st.init(name.trim());
      const project = await st.loadProject();
      project.description = description?.trim() ?? "";
      await st.saveProject(project);
      await st.writeGenerated();
      await scanCodebase();
      ctx.ui.notify(`.planner/ initialized for "${name.trim()}". Starting project discuss…`, "info");
      enablePlannerSession();
      await maybeStartWeb(ctx);
      await handlePlanner("project discuss", ctx);
      return;
    }

    // Guard: most subcommands need .planner/
    if (!(await st.exists())) {
      ctx.ui.notify("No .planner/ — start with /planner init", "warning");
      return;
    }

    // ── show ──
    if (a === "show") {
      const plan = await st.loadAll();
      ctx.ui.notify([
        `📋 **${plan.project.name}**`,
        `   Description: ${plan.project.description || "*not set*"}`,
        `   Goal: ${plan.project.goal || "*not set*"}`,
        `   Phases: ${plan.phases.length}`,
        `   Requirements: ${plan.requirements.requirements.length}`,
        `   Updated: ${plan.manifest.updatedAt}`,
      ].join("\n"), "info");
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Helper: pick a feature interactively
    // ═══════════════════════════════════════════════════════════════
        async function pickFeature(): Promise<Feature | null> {
      const features = (await st.loadFeatures().catch(() => ({ features: [] as Feature[] }))).features
        .slice()
        .sort((a, b) => a.number - b.number);
      if (features.length === 0) return null;
      return paginatedSelect(ctx, {
        title: "Pick a feature",
        items: features,
        render: (f) => `  ${formatFeatureRef(f.number)} ${statusIcon(f.status)} ${f.name}${f.shortId ? ` · ${f.shortId}` : ""}`,
        pageSize: 10,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Helper: pick a phase interactively
    // ═══════════════════════════════════════════════════════════════
        async function pickPhase(): Promise<Phase | null> {
      const phases = (await st.loadAllPhases().catch(() => [] as Phase[])).slice().sort((a, b) => a.number - b.number);
      if (phases.length === 0) { return null; }
      const features = (await st.loadFeatures().catch(() => ({ features: [] as Feature[] }))).features;
      return paginatedSelect(ctx, {
        title: "Pick a phase",
        items: phases,
        render: (p) => `  ${formatPhaseRef(p.number, featureNumberOfPhase(p, features))} ${statusIcon(p.status)} ${p.title}${p.shortId ? ` · ${p.shortId}` : ""}`,
        pageSize: 10,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Helper: pick a task interactively from a phase
    // ═══════════════════════════════════════════════════════════════
        async function pickTask(phase: Phase): Promise<Task | null> {
      if (phase.tasks.length === 0) return null;
      const tasks = phase.tasks.slice().sort((a, b) => a.number - b.number);
      return paginatedSelect(ctx, {
        title: `Pick a task from "${phase.title}"`,
        items: tasks,
        render: (t) => `  T${String(t.number).padStart(3, "0")} ${statusIcon(t.status)} ${t.title}${t.shortId ? ` · ${t.shortId}` : ""}`,
        pageSize: 10,
      });
    }

    function parseMultilineList(value: string | undefined): string[] {
      return (value ?? "")
        .split("\n")
        .map((line) => line.trim())
        .map((line) => line.replace(/^[-*•]\s*/, "")) // strip bullet points if the user types them
        .filter(Boolean);
    }

    function splitCsv(value: string | undefined): string[] {
      return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
    }

    function isYes(value: string | undefined): boolean {
      return ["y", "yes", "si", "sì"].includes((value ?? "").trim().toLowerCase());
    }

    function findFeatureByRef(features: Feature[], ref: string): Feature | null {
      const normalized = ref.trim().toLowerCase();
      if (!normalized) return null;
      const fMatch = normalized.match(/^f(\d+)$/);
      if (fMatch) {
        const n = parseInt(fMatch[1]!, 10);
        const byNum = features.find((f) => f.number === n);
        if (byNum) return byNum;
      }
      return features.find((feature) => feature.shortId && feature.shortId.toLowerCase() === normalized)
        ?? features.find((feature) => feature.id.toLowerCase() === normalized)
        ?? features.find((feature) => feature.name.toLowerCase() === normalized)
        ?? features.find((feature) => feature.name.toLowerCase().includes(normalized))
        ?? null;
    }

    function resolveFeatureRef(features: Feature[], ref: string):
      | { ok: true; feature: Feature }
      | { ok: false; error: string } {
      const raw = ref.trim();
      if (!raw) return { ok: false, error: "Feature ref is required." };
      const normalized = raw.toLowerCase();
      const byNumber = normalized.match(/^f(\d+)$/)
        ? features.find((feature) => feature.number === parseInt(normalized.slice(1), 10))
        : undefined;
      if (byNumber) return { ok: true, feature: byNumber };

      const byShortId = features.find((feature) => feature.shortId?.toLowerCase() === normalized);
      if (byShortId) return { ok: true, feature: byShortId };

      const byId = features.find((feature) => feature.id.toLowerCase() === normalized);
      if (byId) return { ok: true, feature: byId };

      const exactName = features.filter((feature) => feature.name.toLowerCase() === normalized);
      if (exactName.length == 1) return { ok: true, feature: exactName[0]! };
      if (exactName.length > 1) return { ok: false, error: `Ambiguous feature ref: ${raw}. Multiple features have that exact name; use F00x, shortId, or UUID.` };

      const partialName = features.filter((feature) => feature.name.toLowerCase().includes(normalized));
      if (partialName.length == 1) return { ok: true, feature: partialName[0]! };
      if (partialName.length > 1) return { ok: false, error: `Ambiguous feature ref: ${raw}. Matches: ${partialName.map((feature) => formatFeatureRef(feature.number)).join(", ")}. Use a specific F00x, shortId, or UUID.` };

      return { ok: false, error: `Feature not found: ${raw}` };
    }


    function profile_packageManager(pkg: CodebaseProfile["packageJson"], lockfile: string): string {
      if (pkg?.packageManager) return pkg.packageManager;
      if (lockfile === "pnpm-lock.yaml") return "pnpm";
      if (lockfile === "yarn.lock") return "yarn";
      if (lockfile === "bun.lockb") return "bun";
      if (lockfile === "package-lock.json") return "npm";
      return "";
    }

    async function scanCodebase(persist = true): Promise<CodebaseProfile> {
      const root = ctx.cwd;
      const rootFiles: { path: string; kind: string }[] = [];
      const directories: string[] = [];
      const tree: string[] = [];

      // Top-level entries (skip noise)
      const skip = new Set([".git", "node_modules", ".planner", ".plan", "dist", "build", ".next", ".cache", ".turbo", "coverage"]);
      let entries: string[] = [];
      try { entries = readdirSync(root).sort(); } catch { entries = []; }
      for (const name of entries) {
        if (skip.has(name) || name.startsWith(".")) continue;
        const full = join(root, name);
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            directories.push(`${name}/`);
            tree.push(`${name}/`);
          } else {
            rootFiles.push({ path: name, kind: "file" });
            tree.push(name);
          }
        } catch { /* ignore */ }
      }

      // package.json summary
      let packageJson: CodebaseProfile["packageJson"] = null;
      try {
        const raw = readFileSync(join(root, "package.json"), "utf-8");
        const pkg = JSON.parse(raw);
        packageJson = {
          name: pkg.name,
          packageManager: pkg.packageManager,
          scripts: pkg.scripts ?? {},
          dependencies: pkg.dependencies ?? {},
          devDependencies: pkg.devDependencies ?? {},
        };
      } catch { /* no package.json */ }

      // AGENTS.md / README excerpts (first ~4KB)
      const readExcerpt = (file: string): string => {
        try { return readFileSync(join(root, file), "utf-8").slice(0, 4096); } catch { return ""; }
      };
      const agentsMd = readExcerpt("AGENTS.md") || readExcerpt("CLAUDE.md");
      const readme = readExcerpt("README.md");

      // Ambient facts: node version, package manager, lockfile, key scripts
      const lockfile = ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb"].find((f) => existsSync(join(root, f))) ?? "";
      const pm = profile_packageManager(packageJson, lockfile);
      const allScripts = packageJson?.scripts ?? {};
      const keyScriptKeys = ["build", "dev", "start", "test", "lint", "typecheck", "tsc", "format"];
      const keyScripts: Record<string, string> = {};
      for (const k of keyScriptKeys) if (allScripts[k]) keyScripts[k] = allScripts[k];
      const ambient = {
        nodeVersion: process.versions.node ?? "",
        packageManager: pm,
        lockfile,
        scripts: keyScripts,
      };

      const profile: CodebaseProfile = {
        scannedAt: nowISO(),
        rootPath: root,
        rootFiles,
        directories,
        packageJson,
        agentsMd,
        readme,
        tree,
        ambient,
      };
      if (persist) await st.saveCodebaseProfile(profile);
      return profile;
    }

    // ═══════════════════════════════════════════════════════════════
    //  project <sub>
    // ═══════════════════════════════════════════════════════════════
    if (a === "project") {
      if (!b) {
        ctx.ui.notify("project actions: discuss | language", "info");
        return;
      }
      if (b === "discuss") {
        const project = await ensureProjectLanguagePreferences(st, false);
        const profile = await scanCodebase(false);
        ctx.ui.notify(`Codebase scanned: ${profile.directories.length} dirs, ${profile.rootFiles.length} root files${profile.packageJson?.name ? `, pkg ${profile.packageJson.name}` : ""}.`, "info");

        ctx.ui.notify("Opening text editors for the initial project profile. These will serve as the foundation for the agent's deep discovery process.", "info");

        const goal = await ctx.ui.editor(
          "Project goal: What is the main, single-focus objective of this project?",
          project.goal || ""
        );
        const techRaw = await ctx.ui.editor(
          "Technologies & Tools: What frameworks, languages, or external utilities are used? (Type one per line)",
          [...project.technologies, ...project.tools].join("\n") || ""
        );
        const rulesRaw = await ctx.ui.editor(
          "Project rules: Standards, non-negotiable guidelines, or architectural preferences. (Type one per line)",
          project.globalRules.join("\n") || ""
        );
        const decisionsRaw = await ctx.ui.editor(
          "Key decisions / notes (Type one per line)",
          project.decisions.join("\n") || ""
        );

        const parsedDecisionLines = parseMultilineList(decisionsRaw);
        const draftProject = {
          ...project,
          goal: goal?.trim() ? goal.trim() : project.goal,
          technologies: parseMultilineList(techRaw).filter((t) => !project.tools.includes(t)),
          tools: parseMultilineList(techRaw).filter((t) => !project.technologies.includes(t)),
          globalRules: parseMultilineList(rulesRaw),
          decisions: parsedDecisionLines,
          acceptedDecisions: parsedDecisionLines.length > 0
            ? parsedDecisionLines.map((entry, index) => ({
                id: `project-decision-${index + 1}`,
                title: entry,
                decision: entry,
                rationale: "Accepted during planner project discuss.",
                implementationNotes: "",
                acceptedAt: nowISO(),
              }))
            : project.acceptedDecisions,
        };

        await st.saveProject(draftProject);
        await st.saveCodebaseProfile(profile);
        await st.writeGenerated();

        ctx.ui.notify("Initial profile saved. The agent will now take over as Lead Architect to conduct discovery.", "info");

        if (capturedPi) {
          await capturedPi.sendUserMessage(
            "I have provided the initial project goal and description. You are now the Lead Architect for Agent Plan only. " +
            "Do NOT invoke GSD workflows, GSD skills, or reinterpret this discuss flow as GSD orchestration. " +
            "Your mission is to produce a professional-grade specification. " +
            `\n\nLANGUAGE PREFERENCES: plan content language=${draftProject.contentLanguage || "(not set)"}; chat language=${draftProject.chatLanguage || "(not set)"}. ` +
            "If these preferences are already set, follow them and do NOT ask again. " +
            "Ask for language only if BOTH preferences are unset. If one is set and the other is unset, infer the missing one from the saved value and persist it with project_set_language_preferences without asking.\n\n" +
            "DO NOT generate the plan yet. Instead, enter the DISCOVERY PHASE:\n" +
            "1. Use your tools to research the codebase and perform online research on the tech stack and domain.\n" +
            "2. Analyze the current state and identify knowledge gaps, ambiguities, or missing requirements regarding scope and technical constraints.\n" +
            "3. Formulate and ask me targeted, iterative questions to resolve these gaps.\n" +
            "4. We will iterate until you have a complete, detailed picture.\n\n" +
            "Once you are 100% certain and we agree the context is complete, you will then generate the exhaustive professional specification (Features, Phases, Tasks) including deep logic, code examples, and technical references as previously required."
          );
        }
        return;
      }
      if (b === "language") {
        const project = await st.loadProject();
        const contentLanguage = await ctx.ui.input(`Plan content language [${project.contentLanguage || "English"}]`);
        const chatLanguage = await ctx.ui.input(`Chat language [${project.chatLanguage || contentLanguage?.trim() || project.contentLanguage || "Italian"}]`);
        project.contentLanguage = contentLanguage?.trim() || project.contentLanguage || "English";
        project.chatLanguage = chatLanguage?.trim() || project.chatLanguage || project.contentLanguage || "Italian";
        await st.saveProject(project);
        await st.writeGenerated();
        ctx.ui.notify(`Saved language preferences: content=${project.contentLanguage}, chat=${project.chatLanguage}`, "info");
        return;
      }
      ctx.ui.notify(`Unknown project action "${b}". Try: discuss, language`, "warning");
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    //  feature <sub>
    // ═══════════════════════════════════════════════════════════════
    if (a === "feature") {
      if (!b) {
        ctx.ui.notify("feature actions: list  |  add [name]  |  show [id|name]  |  discuss [id|name]  |  update [id|name]  |  delete [id|name]", "info");
        return;
      }
      if (b === "list") {
        const features = (await st.loadFeatures()).features;
        if (features.length === 0) {
          ctx.ui.notify("No features", "info");
          return;
        }
        const phases = await st.loadAllPhases();
        const lines = features.map((feature) => {
          const featurePhases = phases.filter((phase) => phase.featureId === feature.id);
          const taskCount = featurePhases.reduce((total, phase) => total + phase.tasks.length, 0);
          return `${statusIcon(feature.status)} ${feature.name} (${feature.id}) — ${featurePhases.length} phases, ${taskCount} tasks`;
        });
        await paginatedNotify(ctx, { title: "features", lines, pageSize: 10 });
        return;
      }
      if (b === "add") {
        const nameInput = subArgs.trim() || await ctx.ui.input("Feature name");
        if (!nameInput?.trim()) { ctx.ui.notify("Aborted", "warning"); return; }
        const description = await ctx.ui.editor("Feature description (optional)", "");
        const statusInput = await ctx.ui.input("Status [planned] (planned|in-progress|done|blocked|canceled|rejected|deferred|waiting)");
        const validStatuses = ["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"];
        const status = statusInput?.trim() || "planned";
        if (!validStatuses.includes(status)) {
          ctx.ui.notify(`Invalid status. Use: ${validStatuses.join(", ")}`, "error");
          return;
        }
        const now = nowISO();
        const id = createFeatureId();
        const identity = await st.allocateEntityIdentity("feature", id);
        const priority = await st.nextPriority("feature");
        const feature: Feature = {
          id,
          number: identity.number,
          shortId: identity.shortId,
          priority,
          name: nameInput.trim(),
          description: description?.trim() ?? "",
          descriptionUpdatedAt: now,
          status: status as Feature["status"],
          discussedAt: "",
          contextReady: false,
          contextReadyReason: "",
          startDate: status === "in-progress" ? new Date().toISOString().slice(0, 10) : "",
          endDate: status === "done" ? new Date().toISOString().slice(0, 10) : "",
          workDone: "",
          workRemaining: "",
          acceptedDecisions: [],
          phaseIds: [],
          dependsOn: [],
          statusLog: [],
          createdAt: now,
          updatedAt: now,
        };
        await st.updateFeatures((doc) => {
          doc.features.push(feature);
          return doc;
        });
        await st.writeGenerated();
        ctx.ui.notify(`Feature created: ${formatFeatureRef(feature.number)}${feature.shortId ? ` +MI+ ${feature.shortId}` : ""} +EM+ ${feature.name}`, "info");
        return;
      }
      if (b === "show") {
        const features = (await st.loadFeatures()).features;
        let feature: Feature | null = subArgs.trim() ? findFeatureByRef(features, subArgs.trim()) : null;
        if (!feature) {
          feature = await pickFeature();
          if (!feature) { ctx.ui.notify("No features available", "warning"); return; }
        }
        const phases = (await st.loadAllPhases()).filter((phase) => phase.featureId === feature.id);
        const taskCount = phases.reduce((total, phase) => total + phase.tasks.length, 0);
        ctx.ui.notify([
          `🌟 **${feature.name}**`,
          `   ID: ${feature.id}`,
          `   Status: ${feature.status}`,
          `   Phases: ${phases.length}`,
          `   Tasks: ${taskCount}`,
          `   Window: ${feature.startDate || "not set"} → ${feature.endDate || "not set"}`,
          feature.description ? "" : "",
          feature.description || "",
          feature.workDone ? `Work done: ${feature.workDone}` : "",
          feature.workRemaining ? `Work remaining: ${feature.workRemaining}` : "",
        ].filter(Boolean).join("\n"), "info");
        return;
      }
      if (b === "discuss") {
        const featuresDoc = await st.loadFeatures();
        let feature = subArgs.trim() ? findFeatureByRef(featuresDoc.features, subArgs.trim()) : null;
        if (!feature) {
          feature = await pickFeature();
          if (!feature) { ctx.ui.notify("No features to discuss. Create one first.", "warning"); return; }
        }
        const description = await ctx.ui.editor("Feature description / scope / current implementation state", feature.description || "");
        const workDone = await ctx.ui.editor("Work done / already decided", feature.workDone || "");
        const workRemaining = await ctx.ui.editor("Work remaining / next work", feature.workRemaining || "");
        const dependencies = await ctx.ui.input(`Dependencies (comma-separated) [${feature.dependsOn.join(", ") || ""}]`);
        const featureId = feature.id;
        const updatedDoc = await st.updateFeatures((doc) => {
          const target = doc.features.find((entry) => entry.id === featureId);
          if (!target) return doc;
          if (description !== undefined) target.description = description.trim();
          if (workDone !== undefined) target.workDone = workDone.trim();
          if (workRemaining !== undefined) target.workRemaining = workRemaining.trim();
          if (dependencies !== undefined) target.dependsOn = splitCsv(dependencies);
          target.discussedAt = nowISO();
          target.contextReady = true;
          target.contextReadyReason = "Updated through /planner feature discuss.";
          target.updatedAt = nowISO();
          return doc;
        });
        feature = updatedDoc.features.find((entry) => entry.id === featureId) ?? feature;
        await st.writeGenerated();
        ctx.ui.notify(`Feature discussed/updated: ${formatFeatureRef(feature.number)}${feature.shortId ? ` +MI+ ${feature.shortId}` : ""} +EM+ ${feature.name}`, "info");
        return;
      }
      if (b === "update") {
        const featuresDoc = await st.loadFeatures();
        let feature = subArgs.trim() ? findFeatureByRef(featuresDoc.features, subArgs.trim()) : null;
        if (!feature) {
          feature = await pickFeature();
          if (!feature) { ctx.ui.notify("No features available", "warning"); return; }
        }
        const title = await ctx.ui.input(`Name [${feature.name}]`);
        const statusInput = await ctx.ui.input(`Status [${feature.status}] (planned|in-progress|done|blocked|canceled|rejected|deferred|waiting)`);
        const description = await ctx.ui.editor("Description [leave unchanged by submitting current text]", feature.description || "");
        const workDone = await ctx.ui.editor("Work done [leave unchanged by submitting current text]", feature.workDone || "");
        const workRemaining = await ctx.ui.editor("Work remaining [leave unchanged by submitting current text]", feature.workRemaining || "");
        const startDate = await ctx.ui.input(`Start date YYYY-MM-DD [${feature.startDate || ""}]`);
        const endDate = await ctx.ui.input(`End date YYYY-MM-DD [${feature.endDate || ""}]`);
        const validStatuses = ["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"];
        if (statusInput?.trim() && !validStatuses.includes(statusInput.trim())) {
          ctx.ui.notify(`Invalid status. Use: ${validStatuses.join(", ")}`, "error");
          return;
        }
        const featureId = feature.id;
        const updatedDoc = await st.updateFeatures((doc) => {
          const target = doc.features.find((entry) => entry.id === featureId);
          if (!target) return doc;
          if (title?.trim()) target.name = title.trim();
          if (statusInput?.trim()) {
            const nextStatus = statusInput.trim() as Feature["status"];
            if (nextStatus === "in-progress" && !target.startDate) target.startDate = new Date().toISOString().slice(0, 10);
            if (nextStatus === "done" && !target.endDate) target.endDate = new Date().toISOString().slice(0, 10);
            target.status = nextStatus;
          }
          if (description !== undefined) target.description = description.trim();
          if (workDone !== undefined) target.workDone = workDone.trim();
          if (workRemaining !== undefined) target.workRemaining = workRemaining.trim();
          if (startDate !== undefined) target.startDate = startDate.trim();
          if (endDate !== undefined) target.endDate = endDate.trim();
          target.updatedAt = nowISO();
          return doc;
        });
        feature = updatedDoc.features.find((entry) => entry.id === featureId) ?? feature;
        await st.writeGenerated();
        ctx.ui.notify(`Feature updated: ${formatFeatureRef(feature.number)}${feature.shortId ? ` +MI+ ${feature.shortId}` : ""} +EM+ ${feature.name} (${feature.status})`, "info");
        return;
      }
      if (b === "delete") {
        const features = (await st.loadFeatures()).features;
        let feature = subArgs.trim() ? findFeatureByRef(features, subArgs.trim()) : null;
        if (!feature) {
          feature = await pickFeature();
          if (!feature) { ctx.ui.notify("No features available", "warning"); return; }
        }
        const phases = (await st.loadAllPhases()).filter((phase) => phase.featureId === feature!.id);
        const cascade = phases.length > 0
          ? await ctx.ui.confirm(`Delete ${phases.length} phase(s) inside "${feature.name}" too? If no, phases remain but are unlinked.`, "Delete phases too")
          : false;
        const confirm = await ctx.ui.input(`Confirm delete "${feature.name}" (${feature.id})? Type yes:`);
        if (confirm?.trim() !== "yes") {
          ctx.ui.notify("Aborted", "warning");
          return;
        }
        const featureId = feature.id;
        await st.updateFeatures((doc) => {
          doc.features = doc.features.filter((entry) => entry.id !== featureId);
          return doc;
        });
        let affectedPhases = 0;
        if (cascade) {
          for (const phase of phases) {
            await st.deletePhase(phase.id);
            affectedPhases += 1;
          }
        } else {
          for (const phase of phases) {
            phase.featureId = undefined;
            phase.updatedAt = nowISO();
            await st.savePhase(phase);
            affectedPhases += 1;
          }
        }
        await st.writeGenerated();
        ctx.ui.notify(`Feature deleted: ${featureId}${phases.length > 0 ? cascade ? `; deleted ${affectedPhases} phase(s)` : `; unlinked ${affectedPhases} phase(s)` : ""}`, "info");
        return;
      }
      ctx.ui.notify(`Unknown feature action "${b}". Try: list, add, show, discuss, update, delete`, "warning");
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    //  phase <sub>
    // ═══════════════════════════════════════════════════════════════
    if (a === "phase") {
      if (!b) {
        ctx.ui.notify("phase actions: add <title>  |  show [id]  |  discuss [id|name]  |  delete  |  update", "info");
        return;
      }
      if (b === "add") {
        const title = subArgs.trim();
        if (!title) { ctx.ui.notify("Usage: /planner phase add <title>", "warning"); return; }
        const features = (await st.loadFeatures()).features;
        if (features.length === 0) {
          ctx.ui.notify("Create a feature first: a phase must belong to a feature. Use /planner feature add.", "warning");
          return;
        }
        const feature = await pickFeature();
        if (!feature) { ctx.ui.notify("Phase creation cancelled: no feature selected.", "warning"); return; }
        // This belongs to the creation transaction: Escape before the phase
        // is persisted cancels the whole command rather than creating a phase
        // and only then abandoning the follow-up question.
        const startDiscuss = await ctx.ui.input("Start phase discuss now? Type yes to continue");
        let phase: Phase | undefined;
        await withFeatureLock(feature.id, async () => {
          const phases = await st.loadAllPhases();
          const featurePhases = phases.filter((p) => p.featureId === feature.id);
          const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const id = createPhaseId();
          const identity = await st.allocateEntityIdentity("phase", id);
          const priority = await st.nextPriority("phase", feature.id);
          phase = {
            id, number: identity.number, shortId: identity.shortId, priority, slug, title, featureId: feature.id, status: "draft", discussedAt: "", contextReady: false, contextReadyReason: "", summary: "", description: "", descriptionUpdatedAt: "", notes: "",
            goals: [], nonGoals: [], dependencies: [], dependsOn: [], risks: [],
            openQuestions: [], decisions: [], acceptedDecisions: [], completionCriteria: [], taskIds: [], tasks: [],
            createdAt: nowISO(), updatedAt: nowISO(),
            handoff: "", handoffUpdatedAt: "",
            handoffReadAt: "",
            handoffHistory: [],
            statusLog: [],
          };
          await st.savePhase(phase);
          await st.updateFeatures((doc) => {
            const target = doc.features.find((f) => f.id === feature.id);
            if (target && !target.phaseIds.includes(phase!.id)) {
              target.phaseIds.push(phase!.id);
              target.updatedAt = nowISO();
            }
            return doc;
          });
          await st.writeGenerated();
        });
        if (!phase) return;
          ctx.ui.notify(`Phase created: ${formatPhaseRef(phase.number, feature.number)} — ${title}${phase.shortId ? ` · ${phase.shortId}` : ""} (feature ${feature.name})`, "info");
        if (isYes(startDiscuss)) {
          await handlePlanner(`phase discuss ${phase.id}`, ctx);
        }
        return;
      }
      if (b === "discuss") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = findPhaseByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, subArgs.trim()) ?? null;
        }
        if (!phase) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("No phases to discuss. Create one first.", "warning"); return; }
        }

        if (phase.status !== "draft" && phase.status !== "discovery" && phase.status !== "planned") {
          ctx.ui.notify(`Phase is already "${phase.status}". Re-discuss works best on draft/discovery/planned phases.`, "info");
        }

        ctx.ui.notify(`Discovery for ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, (await st.loadFeatures()).features))}…`, "info");

        // ── Recap: give full context before planning tasks ──
        const recapPlan = await st.loadAll();
        const recapProject = recapPlan.project;
        const recapLines = [
          `📋 RECAP — ${recapProject.name}`,
          `Goal: ${recapProject.goal || "(not set)"}`,
          `Stack: ${[...recapProject.technologies, ...recapProject.tools].join(", ") || "(not set)"}`,
          `Global rules: ${recapProject.globalRules.join(" | ") || "(none)"}`,
          `Phases: ${recapPlan.phases.map((p) => `${p.id}(${p.status})`).join(", ") || "(none)"}`,
          "",
          `Now discussing phase: ${phase.id} — ${phase.title}`,
          `  current goals: ${phase.goals.join(" | ") || "(none)"}`,
          `  dependencies: ${phase.dependencies.join(", ") || "(none)"}`,
          `  risks: ${phase.risks.join(", ") || "(none)"}`,
          `  completion criteria: ${phase.completionCriteria.join(", ") || "(none)"}`,
          `  tasks: ${phase.tasks.length}`,
          "",
          "⚠️  Have requirements or dependencies changed since last time?",
          "   Tell me now before we (re)plan the tasks. If nothing changed, continue with the questions below.",
        ];
        ctx.ui.notify(recapLines.join("\n"), "info");
        const changeNote = await ctx.ui.input("Anything changed? (free text, or leave empty to keep current plan)");
        if (changeNote?.trim()) {
          phase.notes = `${phase.notes ? phase.notes + "\n" : ""}[discuss ${nowISO()}] ${changeNote.trim()}`;
          await st.savePhase(phase);
          if (capturedPi) {
            await capturedPi.sendUserMessage(
              `Before planning tasks for phase ${phase.id} (${phase.title}), the user reported a change: ${changeNote.trim()}. ` +
              "Discuss this change with the user, update the phase scope/dependencies/risks if needed, then propose the task breakdown. " +
              "Do NOT invoke GSD. Stay in Agent Plan."
            );
          }
        }


        const answers: Record<string, string> = {};
        const questions = [
          { key: "goal", prompt: `Main goal of "${phase.title}"?` },
          { key: "summary", prompt: `Short summary [${phase.summary || ""}]` },
          { key: "scope", prompt: "What is in scope for this phase?" },
          { key: "non_scope", prompt: "What is out of scope for this phase?" },
          { key: "deps", prompt: "What does this phase depend on? (comma-separated)" },
          { key: "risks", prompt: "Main risks? (comma-separated)" },
          { key: "completion", prompt: "What defines completion? (comma-separated)" },
        ];
        for (const q of questions) {
          const ans = await ctx.ui.input(q.prompt);
          if (ans?.trim()) answers[q.key] = ans.trim();
        }

        if (answers.goal) phase.goals = [answers.goal];
        if (answers.summary) phase.summary = answers.summary;
        if (answers.scope) phase.description = answers.scope;
        if (answers.non_scope) phase.nonGoals = [answers.non_scope];
        if (answers.deps) phase.dependencies = splitCsv(answers.deps);
        if (answers.risks) phase.risks = splitCsv(answers.risks);
        if (answers.completion) phase.completionCriteria = splitCsv(answers.completion);

        phase.status = "planned";
        phase.updatedAt = nowISO();
        await st.savePhase(phase);
        await st.writeGenerated();
        ctx.ui.notify(`Phase ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, (await st.loadFeatures()).features))} is now **planned**.${phase.shortId ? ` · ${phase.shortId}` : ""}`, "info");
        return;
      }
      if (b === "show") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = findPhaseByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, subArgs.trim()) ?? null;
        }
        if (!phase) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("No phases available", "warning"); return; }
        }
        ctx.ui.notify([
          `🧩 **${phase.title}**`,
          `   ID: ${phase.id}`,
          `   Status: ${phase.status}`,
          `   Feature: ${phase.featureId ?? "none"}`,
          `   Tasks: ${phase.tasks.length}`,
          `   Goals: ${phase.goals.length}`,
          `   Dependencies: ${phase.dependencies.length}`,
          `   Completion criteria: ${phase.completionCriteria.length}`,
          phase.summary || "",
          phase.description || "",
        ].filter(Boolean).join("\n"), "info");
        return;
      }
      if (b === "delete") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = findPhaseByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, subArgs.trim()) ?? null;
        }
        if (!phase) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("Aborted", "warning"); return; }
        }
        const confirm = await ctx.ui.input(`Confirm delete "${phase.title}" (${phase.id})? Type yes:`);
        if (confirm?.trim() !== "yes") {
          ctx.ui.notify("Aborted", "warning"); return;
        }
        await st.deletePhase(phase.id);
        await st.writeGenerated();
          ctx.ui.notify(`Phase deleted: ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, (await st.loadFeatures()).features))}${phase.shortId ? ` · ${phase.shortId}` : ""}`, "info");
        return;
      }
      if (b === "update") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = findPhaseByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, subArgs.trim()) ?? null;
        }
        if (!phase) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("Aborted", "warning"); return; }
        }
        const title = await ctx.ui.input(`Title [${phase.title}]`);
        const statusInput = await ctx.ui.input(`Status [${phase.status}] (draft|discovery|planned|in-progress|done|blocked|canceled)`);
        const summary = await ctx.ui.input(`Summary [${phase.summary || ""}]`);
        const desc = await ctx.ui.input(`Description [leave empty to keep]`);
        const goals = await ctx.ui.input(`Goals (comma-separated) [${phase.goals.join(", ") || ""}]`);
        const nonGoals = await ctx.ui.input(`Non-goals (comma-separated) [${phase.nonGoals.join(", ") || ""}]`);
        const deps = await ctx.ui.input(`Dependencies (comma-separated) [${phase.dependencies.join(", ") || ""}]`);
        const risks = await ctx.ui.input(`Risks (comma-separated) [${phase.risks.join(", ") || ""}]`);
        const completion = await ctx.ui.input(`Completion criteria (comma-separated) [${phase.completionCriteria.join(", ") || ""}]`);

        // Update only changed fields
        if (title?.trim()) phase.title = title.trim();
        if (statusInput?.trim()) {
          const valid = ["draft", "discovery", "planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"];
          if (!valid.includes(statusInput.trim())) {
            ctx.ui.notify(`Invalid status. Use: ${valid.join(", ")}`, "error"); return;
          }
          phase.status = statusInput.trim() as Phase["status"];
        }
        if (summary !== undefined) phase.summary = summary;
        if (desc?.trim()) phase.description = desc.trim();
        if (goals?.trim()) phase.goals = goals.split(",").map((g) => g.trim()).filter(Boolean);
        if (nonGoals?.trim()) phase.nonGoals = nonGoals.split(",").map((g) => g.trim()).filter(Boolean);
        if (deps?.trim()) phase.dependencies = deps.split(",").map((g) => g.trim()).filter(Boolean);
        if (risks?.trim()) phase.risks = risks.split(",").map((g) => g.trim()).filter(Boolean);
        if (completion?.trim()) phase.completionCriteria = completion.split(",").map((g) => g.trim()).filter(Boolean);
        phase.updatedAt = nowISO();

        await st.savePhase(phase);
        await st.writeGenerated();
          ctx.ui.notify(`Phase updated: ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, (await st.loadFeatures()).features))} — ${phase.title} (${phase.status})${phase.shortId ? ` · ${phase.shortId}` : ""}`, "info");
        return;
      }
      ctx.ui.notify(`Unknown phase action "${b}". Try: add, show, discuss, delete, update`, "warning");
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    //  task <sub>
    // ═══════════════════════════════════════════════════════════════
    if (a === "task") {
      if (!b) {
        ctx.ui.notify("task actions: add  |  show [id]  |  discuss [id|name]  |  delete  |  update  |  start [id]  |  complete [id]  |  checklist-add <T00x> <title>  |  checklist-remove <T00x> <C{n}|title>  |  checklist-toggle <T00x> <C{n}|title> [on|off]", "info");
        return;
      }
      if (b === "add") {
        const phase = await pickPhase();
        if (!phase) { ctx.ui.notify("Aborted", "warning"); return; }
        const title = await ctx.ui.input(`Task title (for "${phase.title}")`);
        if (!title?.trim()) { ctx.ui.notify("Aborted", "warning"); return; }
        // Keep the optional follow-up inside the creation transaction so
        // Escape can still cancel before a task is persisted.
        const startDiscuss = await ctx.ui.input("Start task discuss now? Type yes to continue");
        const shortName = clampSlug(title, 30, `task-${Date.now().toString(36)}`);
        const taskId = createTaskId();
        const identity = await st.allocateEntityIdentity("task", taskId);
        const priority = await st.nextPriority("task", phase.id);
        const now = nowISO();
        const task: Task = {
          id: taskId, phaseId: phase.id, number: identity.number, shortId: identity.shortId, priority, shortName,
          title: title.trim(), status: "planned",
          description: "",
          descriptionUpdatedAt: "",
          notes: "",
          statusLog: [],
          decisions: [],
          acceptedDecisions: [],
          checklist: [], subtasks: [],
          dependsOn: [],
          pauseSnapshot: null, pauseHistory: [],
          startedAt: "", completedAt: "",
          createdAt: now, updatedAt: now,
        };
        phase.tasks.push(task);
        phase.taskIds.push(taskId);
        phase.updatedAt = nowISO();
        await st.savePhase(phase);
        await st.writeGenerated();
        ctx.ui.notify(`Task created: ${taskId} — ${title}`, "info");
        if (isYes(startDiscuss)) {
          await handlePlanner(`task discuss ${taskId}`, ctx);
        }
        return;
      }
      if (b === "discuss") {
        const phases = await st.loadAllPhases();
        let resolved = subArgs.trim() ? findTaskByRef(phases, (await st.loadFeatures()).features, subArgs.trim()) : null;
        if (!resolved) {
          const phase = await pickPhase();
          if (!phase) { ctx.ui.notify("No phases available", "warning"); return; }
          if (phase.tasks.length === 0) { ctx.ui.notify(`No tasks in "${phase.title}"`, "info"); return; }
          const task = await pickTask(phase);
          if (!task) { ctx.ui.notify("Aborted", "warning"); return; }
          resolved = { phase, task };
        }

        const { phase, task } = resolved;
        const description = await ctx.ui.input(`Execution notes / description [${task.description || ""}]`);
        const checklistSeed = await ctx.ui.input("Checklist items (comma-separated, blank to keep current)");
        if (description?.trim()) task.description = description.trim();
        if (checklistSeed?.trim()) {
          task.checklist = splitCsv(checklistSeed).map((itemTitle, index) => ({ number: index + 1,
            id: createChecklistItemId(task.id, index + 1, itemTitle),
            title: itemTitle,
            checked: false,
          }));
        }
        task.updatedAt = nowISO();
        phase.updatedAt = nowISO();
        await st.savePhase(phase);
        await st.writeGenerated();
          ctx.ui.notify(`Task ${formatPhaseRef(phase!.number, featureNumberOfPhase(phase!, (await st.loadFeatures()).features))}/T${String(task.number).padStart(3, "0")} discussed and updated.`, "info");
        return;
      }
      if (b === "show") {
        let phase: Phase | null = null;
        let task: Task | null = null;
        if (subArgs.trim()) {
          const resolved = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, subArgs.trim());
          phase = resolved?.phase ?? null;
          task = resolved?.task ?? null;
        }
        if (!task) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("No phases available", "warning"); return; }
          if (phase.tasks.length === 0) { ctx.ui.notify(`No tasks in "${phase.title}"`, "info"); return; }
          task = await pickTask(phase);
          if (!task) { ctx.ui.notify("Aborted", "warning"); return; }
        }
        ctx.ui.notify([
          `📝 **${task.title}**`,
          `   ID: ${task.id}`,
          `   Status: ${task.status}`,
          `   Phase: ${phase?.title ?? task.phaseId}`,
          `   Checklist items: ${task.checklist.length}`,
          `   Subtasks: ${task.subtasks.length}`,
          task.description || "",
        ].filter(Boolean).join("\n"), "info");
        return;
      }
      if (b === "delete") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = findPhaseByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, subArgs.trim()) ?? null;
        }
        if (!phase) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("Aborted", "warning"); return; }
        }
        if (phase.tasks.length === 0) {
          ctx.ui.notify(`No tasks in "${phase.title}"`, "info"); return;
        }
        const task = await pickTask(phase);
        if (!task) { ctx.ui.notify("Aborted", "warning"); return; }
        const confirm = await ctx.ui.input(`Confirm delete "${task.title}" (${task.id})? Type yes:`);
        if (confirm?.trim() !== "yes") {
          ctx.ui.notify("Aborted", "warning"); return;
        }
        phase.tasks = phase.tasks.filter((t) => t.id !== task.id);
        phase.taskIds = phase.taskIds.filter((id) => id !== task.id);
        phase.updatedAt = nowISO();
        await st.savePhase(phase);
        await st.writeGenerated();
          ctx.ui.notify(`Task deleted: ${formatPhaseRef(phase!.number, featureNumberOfPhase(phase!, (await st.loadFeatures()).features))}/T${String(task.number).padStart(3, "0")}${task.shortId ? ` · ${task.shortId}` : ""}`, "info");
        return;
      }
      if (b === "update") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = findPhaseByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, subArgs.trim()) ?? null;
        }
        if (!phase) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("Aborted", "warning"); return; }
        }
        if (phase.tasks.length === 0) {
          ctx.ui.notify(`No tasks in "${phase.title}"`, "info"); return;
        }
        const task = await pickTask(phase);
        if (!task) { ctx.ui.notify("Aborted", "warning"); return; }
        const title = await ctx.ui.input(`Title [${task.title}]`);
        const statusInput = await ctx.ui.input(`Status [${task.status}] (planned|in-progress|done|blocked|canceled)`);
        const desc = await ctx.ui.input(`Description [leave empty to keep]`);

        // Update only changed fields
        if (title?.trim()) task.title = title.trim();
        const now = nowISO();
        if (statusInput?.trim()) {
          const normalizedStatus = statusInput.trim();
          const valid = ["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"];
          if (!valid.includes(normalizedStatus)) {
            ctx.ui.notify(`Invalid status. Use: ${valid.join(", ")}`, "error"); return;
          }
          if (normalizedStatus === "in-progress" && (await st.listHandoffs()).length > 0) {
            ctx.ui.notify("ℹ️  One or more phases have a pending handoff — if relevant to this task, read it with /planner handoff show <ref>, then clear with /planner handoff clear. Proceeding with the status change.", "info");
          }
          applyTaskLifecycleDates(task, normalizedStatus as Task["status"], now);
        }
        if (desc?.trim()) task.description = desc.trim();
        task.updatedAt = now;
        phase.updatedAt = now;
        await st.savePhase(phase);
        await st.syncTaskStatusRollup(phase.id);
        await st.writeGenerated();
          ctx.ui.notify(`Task updated: ${formatPhaseRef(phase!.number, featureNumberOfPhase(phase!, (await st.loadFeatures()).features))}/T${String(task.number).padStart(3, "0")} — ${task.title} (${task.status})${task.shortId ? ` · ${task.shortId}` : ""}`, "info");
        return;
      }
      if (b === "start") {
        let phase: Phase | null = null;
        let task: Task | null = null;
        if (subArgs.trim()) {
          const resolved = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, subArgs.trim());
          phase = resolved?.phase ?? null;
          task = resolved?.task ?? null;
        }
        if (!task) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("No phases available", "warning"); return; }
          if (phase.tasks.length === 0) { ctx.ui.notify(`No tasks in "${phase.title}"`, "info"); return; }
          task = await pickTask(phase);
          if (!task) { ctx.ui.notify("Aborted", "warning"); return; }
        }
        if (phase && !hasReadParents(phase.featureId, phase.id)) {
          ctx.ui.notify("⚠️ READ REQUIRED before proceeding: read the parent feature and phase (full=true) for this task before starting it.", "warning");
        }
        if (phase) {
          const linkedRequirementIds = [
            ...(await st.linkedRequirementsForPhase(phase.id)).map((r) => r.id),
            ...(phase.featureId ? (await st.linkedRequirementsForFeature(phase.featureId)).map((r) => r.id) : []),
          ];
          if (linkedRequirementIds.length > 0 && !hasReadRequirements(linkedRequirementIds)) {
            ctx.ui.notify("⚠️ REQUIREMENTS READ REQUIRED: read the requirements linked to this phase (and feature) before starting the task.", "warning");
          }
        }
        if (task.status === "in-progress") {
          ctx.ui.notify(`Task "${task.title}" is already in-progress.`, "info");
          return;
        }
        // A pending handoff is context, not a lock: task start RETAINS it.
        // It is archived only when the phase completes (auto) or the user
        // explicitly clears it.
        const now = nowISO();
        // Record status change in the incremental statusLog.
        const prevStatus = task.status;
        const entry: StatusLogEntry = {
          id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${task.status}-in-progress`),
          date: now,
          fromStatus: task.status as any,
          toStatus: "in-progress" as any,
          title: task.status === "done" ? "Reopened" : `→ in-progress`,
          description: task.status === "done" ? "Task reopened from done status." : "",
        };
        task.statusLog = [...(task.statusLog ?? []), entry];
        applyTaskLifecycleDates(task, "in-progress", now);
        task.updatedAt = now;
        phase!.updatedAt = now;
        await st.savePhase(phase!);
        await st.syncTaskStatusRollup(phase!.id);
        await st.writeGenerated();
          ctx.ui.notify(`✅ Task started: ${formatPhaseRef(phase!.number, featureNumberOfPhase(phase!, (await st.loadFeatures()).features))}/T${String(task.number).padStart(3, "0")} — ${task.title} (in-progress)${task.shortId ? ` · ${task.shortId}` : ""}`, "info");
        return;
      }
      if (b === "complete") {
        let phase: Phase | null = null;
        let task: Task | null = null;
        if (subArgs.trim()) {
          const resolved = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, subArgs.trim());
          phase = resolved?.phase ?? null;
          task = resolved?.task ?? null;
        }
        if (!task) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("No phases available", "warning"); return; }
          if (phase.tasks.length === 0) { ctx.ui.notify(`No tasks in "${phase.title}"`, "info"); return; }
          task = await pickTask(phase);
          if (!task) { ctx.ui.notify("Aborted", "warning"); return; }
        }
        if (task.status === "done") {
          ctx.ui.notify(`Task "${task.title}" is already done.`, "info");
          return;
        }
        const unchecked = task.checklist.filter((item) => !item.checked);
        if (unchecked.length > 0) {
          const confirm = await ctx.ui.input(`⚠️  ${unchecked.length} checklist item(s) not done. Complete anyway? (y/N)`);
          if (!isYes(confirm)) {
            ctx.ui.notify("Completion cancelled — resolve checklist items first.", "info");
            return;
          }
        }
        const now = nowISO();
        // Record status change in the incremental statusLog.
        const entry: StatusLogEntry = {
          id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${task.status}-done`),
          date: now,
          fromStatus: task.status as any,
          toStatus: "done" as any,
          title: `→ done`,
          description: "",
        };
        task.statusLog = [...(task.statusLog ?? []), entry];
        applyTaskLifecycleDates(task, "done", now);
        task.updatedAt = now;
        phase!.updatedAt = now;
        const clearedRef = await st.syncTaskStatusRollup(phase!.id);
        await st.writeGenerated();
          ctx.ui.notify(`✅ Task completed: ${formatPhaseRef(phase!.number, featureNumberOfPhase(phase!, (await st.loadFeatures()).features))}/T${String(task.number).padStart(3, "0")} — ${task.title} (done)${task.shortId ? ` · ${task.shortId}` : ""}${clearedRef ? ` — phase handoff archived (${clearedRef})` : ""}`, "info");
        return;
      }
      // checklist-add <T00x> <title>  /  checklist-remove <T00x> <C{n}|title>  /  checklist-toggle <T00x> <C{n}|title> [on|off]
      if (b === "checklist-add" || b === "checklist-remove" || b === "checklist-toggle") {
        const [taskRef, ...itemParts] = rest;
        const itemText = itemParts.join(" ").trim();
        if (!taskRef || !itemText) { ctx.ui.notify(`Usage: /planner task ${b} <T00x> <${b === "checklist-add" ? "title" : "C{n}|title"}>${b === "checklist-toggle" ? " [on|off]" : ""}`, "warning"); return; }
        const resolved = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, taskRef.trim());
        if (!resolved) { ctx.ui.notify(`Task not found: ${taskRef}`, "warning"); return; }
        let checked: boolean | undefined;
        if (b === "checklist-toggle") {
          const m = itemText.match(/\s+(on|off)$/i);
          if (m) { checked = m[1]!.toLowerCase() === "on"; }
        }
        const selector = b === "checklist-toggle" ? itemText.replace(/\s+(on|off)$/i, "").trim() : itemText;
        let msg = "";
        await st.updatePhase(resolved.phase.id, (phase) => {
          const task = phase.tasks.find((t) => t.id === resolved.task.id);
          if (!task) { msg = `Task not found: ${taskRef}`; return phase; }
          const ck = task.checklist ?? [];
          if (b === "checklist-add") {
            const item = addChecklistItem(ck, task.id, selector);
            ck.push(item); task.checklist = ck;
            msg = `Added C${item.number} "${item.title}" (${ck.length} items)`;
          } else if (b === "checklist-remove") {
            if (ck.length === 0) { msg = `Task "${task.title}" has no checklist.`; return phase; }
            const removed = removeChecklistItem(ck, selector);
            if (!removed) { msg = `No checklist item matching "${selector}".`; return phase; }
            msg = `Removed C${removed.number} "${removed.title}" (${ck.length} items left)`;
          } else {
            if (ck.length === 0) { msg = `Task "${task.title}" has no checklist.`; return phase; }
            const target = toggleChecklistItem(ck, selector, checked);
            if (!target) { msg = `No checklist item matching "${selector}".`; return phase; }
            const doneCount = ck.filter((i) => i.checked).length;
            msg = `C${target.number} "${target.title}" → ${target.checked ? "done" : "open"} (${doneCount}/${ck.length} checked)`;
          }
          task.updatedAt = nowISO(); phase.updatedAt = nowISO();
          return phase;
        });
        await st.writeGenerated();
        ctx.ui.notify(`✅ ${msg}`, "info");
        return;
      }
      ctx.ui.notify(`Unknown task action "${b}". Try: add, show, discuss, delete, update, start, complete, checklist-add, checklist-remove, checklist-toggle`, "warning");
      return;
    }

    // ── discuss (legacy alias) ──
    if (a === "discuss") {
      await handlePlanner(`phase discuss ${[b, ...rest].filter(Boolean).join(" ")}`.trim(), ctx);
      return;
    }

    // ── handoff ──
    if (a === "handoff") {
      const action = b || "show";
      const phaseRef = parts[2]?.trim();
      if (!(await st.exists())) { ctx.ui.notify("No .planner/ found.", "warning"); return; }
      if (action === "list") {
        const list = await st.listHandoffs();
        if (list.length === 0) { ctx.ui.notify("No phase handoffs set.", "info"); return; }
        await paginatedNotify(ctx, {
          title: "phase handoffs",
          lines: list.map((e) => `• ${e.compositeRef} — ${e.firstLine} (updated ${e.updatedAt})`),
          pageSize: 10,
        });
        return;
      }
      if (action === "show") {
        const r = await resolvePhaseForHandoff(st, phaseRef);
        if (!r.ok) { ctx.ui.notify(r.error, "warning"); return; }
        const content = await st.getPhaseHandoff(r.phase.id);
        ctx.ui.notify(content.trim() ? `Handoff ${r.compositeRef}:\n${content}` : `No handoff set on ${r.compositeRef}.`, "info");
        return;
      }
      if (action === "write") {
        const r = await resolvePhaseForHandoff(st, phaseRef);
        if (!r.ok) { ctx.ui.notify(r.error, "warning"); return; }
        const text = await ctx.ui.input(`Handoff text for ${r.compositeRef}`);
        if (!text?.trim()) { ctx.ui.notify("No text provided; nothing written.", "info"); return; }
        const confirmed = await ctx.ui.confirm(`Write this handoff on ${r.compositeRef}?`, "Write handoff");
        if (!confirmed) { ctx.ui.notify("Handoff write cancelled.", "info"); return; }
        await st.setPhaseHandoff(r.phase.id, text);
        ctx.ui.notify(`Wrote handoff on ${r.compositeRef}`, "info");
        return;
      }
      if (action === "prepare") {
        if (!capturedPi) { ctx.ui.notify("Agent bridge unavailable; use /planner handoff write for an auto-generated handoff.", "warning"); return; }
        await capturedPi.sendUserMessage(
          "Prepare a canonical session handoff proposal. Do not write anything yet. First identify from this conversation and the latest planner lifecycle events the exact feature and phase where the decisions/work belong. Never use the first in-progress phase or a stale resume pointer as a target.\n\n" +
          "If the last phase was just completed, do not create an operational handoff for it; its existing handoff must have been archived by the phase-done lifecycle. If another non-done phase is the real continuation, identify that phase explicitly.\n\n" +
          "Before calling `handoff_write`, tell the user exactly: `I propose writing this handoff on P00x(F00x) — <phase title>. Confirm?` Wait for an explicit confirmation. Only after confirmation call `handoff_write` with that exact phaseRef. If the target is ambiguous, ask the user to identify the feature and phase instead of guessing.\n\n" +
          "After confirmation, the handoff MUST contain at minimum:\n" +
          "- `Created at:` and `Updated at:` lines (ISO timestamps)\n" +
          "- `Reason:` why this handoff is being written\n" +
          "- `## Current focus`: feature, phase and task refs/titles/statuses derived from the confirmed target\n" +
          "- `## What was being done`: the concrete decisions/work from this session\n" +
          "- `## How to resume`: explicit ordered steps\n" +
          "- `## Files touched`, `## Blockers`, `## Next steps`, and `## Recent decisions`\n" +
          "Pass a meaningful title beginning with the confirmed phase ref. Generic titles are rejected. Handoffs are stored on phase.handoff; `.planner/HANDOFF.md` is deprecated."
        );
        ctx.ui.notify("Instructing the agent to prepare the phase handoff…", "info");
        return;
      }
      if (action === "clear" || action === "delete") {
        const r = await resolvePhaseForHandoff(st, phaseRef);
        if (!r.ok) { ctx.ui.notify(r.error, "warning"); return; }
        await st.clearPhaseHandoff(r.phase.id, "manual");
        ctx.ui.notify(`Cleared handoff on ${r.compositeRef}`, "info");
        return;
      }
      ctx.ui.notify("handoff actions: list | show [phaseRef] | write [phaseRef] | clear [phaseRef] | prepare\nUse: /planner handoff list | show | write | clear | prepare", "info");
      return;
    }

    // ── web ──
    if (a === "web") {
      const action = b || "status";
      const requestedPort = parts[2]?.trim() ? parseInt(parts[2], 10) : undefined;
      if (parts[2]?.trim() && (!Number.isFinite(requestedPort) || (requestedPort ?? 0) <= 0)) {
        ctx.ui.notify(`Invalid port "${parts[2]}"`, "error");
        return;
      }
      switch (action) {
        case "start": {
          if (server) { ctx.ui.notify(`Already running at ${server.lanUrl ? server.localUrl + " (LAN: " + server.lanUrl + ")" : server.url}`, "info"); return; }
          const visibilityArg = normalizeVisibility(parts[2]);
          const portArg = parts[2]?.trim() && Number.isFinite(parseInt(parts[2], 10)) ? parseInt(parts[2], 10) : undefined;
          const visibility = visibilityArg ?? "lan";
          ctx.ui.notify(`Starting web server (${visibility})${portArg ? ` on port ${portArg}` : ""} …`, "info");
          await startServer(ctx, portArg, visibility);
          const srv = server as ServeHandle | null;
          if (srv) ctx.ui.notify(srv.lanUrl ? `Web UI ready. Local: ${srv.localUrl} — LAN: ${srv.lanUrl}` : `Web UI ready. Open: ${srv.url}`, "info");
          break;
        }
        case "stop":
          if (!server) { ctx.ui.notify("Not running", "info"); return; }
          await stopServer();
          ctx.ui.notify("Server stopped", "info");
          break;
        default: {
          const srv = server as ServeHandle | null;
          if (!srv) { ctx.ui.notify("Not running", "info"); return; }
          const lines = [`Web UI running (${srv.mode}).`, `  local: ${srv.localUrl}`];
          if (srv.lanUrl) lines.push(`  lan:   ${srv.lanUrl}`);
          ctx.ui.notify(lines.join("\n"), "info");
        }
      }
      return;
    }

    // ── maintenance/session actions ──
    if (a === "repair") {
      const report = await st.repair();
      const m = report.migrated;
      const dup = report.integrity.duplicatePhaseIds.length;
      const dang = report.integrity.danglingPhaseIds.length;
      ctx.ui.notify(`Repair done: renamed ${m.renamed}, repaired ${m.repaired} refs, inferred ${m.inferred}, archived ${report.handoffs.archived} stale handoff(s). Integrity: ${dup} duplicate, ${dang} dangling.`, "info");
      return;
    }

    if (a === "cleanup-orphans") {
      const found = await st.listOrphanPhases();
      if (found.length === 0) {
        ctx.ui.notify("No orphan phases found.", "info");
        return;
      }
      const lines = [
        `Found ${found.length} orphan phase${found.length === 1 ? "" : "s"}:`,
        ...found.map((phase) => `- ${phase.compositeRef}${phase.shortId ? ` · ${phase.shortId}` : ""} — ${phase.title} (${phase.reason})`),
      ];
      const confirmed = await ctx.ui.confirm(lines.join("\n\n"), "Delete orphan phase files?");
      if (!confirmed) {
        ctx.ui.notify("Cleanup aborted.", "warning");
        return;
      }
      const report = await st.cleanupOrphanPhases();
      ctx.ui.notify(`Removed ${report.removed.length} orphan phase${report.removed.length === 1 ? "" : "s"}.`, "info");
      return;
    }

    // ── export ──
    if (a === "export" || a === "export-full") {
      const isFull = a === "export-full" || subArgs.includes("--full");
      try {
        const plan = await st.loadAll();
        const markdown = new ExportService().exportToMarkdown(plan, isFull);
        const filePath = join(st.root, "EXPORT.md");
        await writeFile(filePath, markdown, "utf-8");
        ctx.ui.notify(`Export generated: ${filePath}\n\n${markdown.slice(0, 500)}${markdown.length > 500 ? "..." : ""}`, "info");
      } catch (e) {
        ctx.ui.notify(`Export failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      return;
    }

    // ── bypass / clear-bypass ──
    if (a === "bypass" || a === "clear-bypass") {
      try {
        if (a === "bypass") {
          const mins = parseInt(subArgs.trim(), 10);
          const until = authorizeGuardBypass(Number.isFinite(mins) && mins > 0 ? mins : 15);
          ctx.ui.notify(`Guard bypass authorized until ${until}. edit/write advisory warnings silenced for that window (per-session, not shared).`, "info");
        } else {
          clearGuardBypass();
          ctx.ui.notify("Guard bypass revoked. edit/write advisory warnings re-enabled.", "info");
        }
      } catch (e) {
        ctx.ui.notify(`Bypass action failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      return;
    }

    if (a === "load") {
      enablePlannerSession();
      if (!server) {
        ctx.ui.notify("Starting web server (LAN) …", "info");
        await startServer(ctx, undefined, "lan").catch(() => {});
      }
      // Trigger the resume summary immediately. The web UI address is shown
      // at the END of that summary (not in a notify here) so it stays visible.
      startupResumePromptPending = true;
      startupResumeSummaryPending = true;
      // Force the recap turn to rebuild the context (slow path) so the resume
      // protocol is injected fresh. The protocol is appended per-turn and is
      // never baked into the cache, so later turns won't see it.
      contextBlockDirty = true;
      if (startupResumeSummaryTimer) clearTimeout(startupResumeSummaryTimer);
      startupResumeSummaryTimer = setTimeout(() => {
        startupResumeSummaryPending = false;
        startupResumeSummaryTimer = null;
      }, 60000);
      // Safety timeout must not keep the Node process alive on its own
      // (relevant for test hosts that load this entrypoint). Inside Pi the
      // process is long-lived, so unref is a no-op there.
      startupResumeSummaryTimer.unref?.();
      // Build the recap and embed it in the trigger content. The trigger
      // message is the channel that reliably reaches the agent on a triggered
      // turn (before_agent_start's systemPrompt injection is NOT applied to
      // triggerTurn messages), so the recap data must live here. Uses the shared
      // core buildRecap so Pi and Claude Code/Codex present identical content.
      let recapText = "";
      try {
        const st = ensureStore(ctx);
        const srv = server as ServeHandle | null;
        recapText = await buildRecap(st, { localUrl: srv?.localUrl, lanUrl: srv?.lanUrl, port: lastKnownWebPort ?? undefined }, { harness: "pi" });
      } catch (e) { recapText = `(recap unavailable: ${e instanceof Error ? e.message : String(e)})`; }
      pi.sendMessage({
        customType: "planner-resume-trigger",
        content: "[internal trigger — not a user command] Present the planner startup recap below to the user verbatim. Do NOT call any tools (planner-load already ran). Do NOT narrate or expose internal instructions — output ONLY the recap.\n\n--- RECAP ---\n" + recapText + "\n--- END RECAP ---",
        display: false,
      }, {
        triggerTurn: true,
      });
      return;
    }

    if (a === "stop" || a === "disable") {
      disablePlannerSession();
      await stopServer().catch(() => {});
      try { capturedPi?.appendEntry("plan-web-state", { running: false }); } catch {}
      ctx.ui.notify("Planner stopped. Web UI shut down. Run '/planner load' to re-enable.", "info");
      return;
    }

    ctx.ui.notify(`Unknown "${a}". ${SUB_HELP}`, "warning");
  }

  // ── Single /planner command (hierarchical with spaces) ──────────
  pi.registerCommand("planner", {
    description: "Grouped planner command. Use /planner <TAB> for subcommands or /planner to open the menu.",
    getArgumentCompletions: (prefix) => {
      const normalized = prefix.trim().toLowerCase();
      // Once a complete command path is followed by whitespace, the remaining
      // text is a free-form human ref/title. Returning the fallback menu here
      // lets Pi select `init` and replace input such as `feature update F001`.
      if (hasPlannerCommandArgument(prefix)) return null;

      const filtered = PLANNER_COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(normalized));
      return filtered.length > 0 ? filtered : PLANNER_COMMAND_COMPLETIONS;
    },
    handler: async (args, ctx) => handlePlanner(args, ctx),
  });

  // ── Custom Tools (non-interactive, usable by the LLM agent) ──────
  //
  // The grouped /planner command is interactive (pickers, inputs) and meant
  // for humans in the TUI. The agent (LLM) can only call tools, so the full
  // CRUD surface is exposed here as tools that operate directly on the store.

  function loadStore(ctx: ExtensionContext): PlanStore {
    const s = new PlanStore(resolvePlanRoot(ctx.cwd));
    s.enableAutoSync(true);
    return s;
  }

  async function requirePlan(ctx: ExtensionContext): Promise<PlanStore | null> {
    const st = loadStore(ctx);
    if (!(await st.exists())) return null;
    await maybeHealStatuses(st, ctx);
    return st;
  }

  // ── plan lifecycle ──────────────────────────────────────────────────

  pi.registerTool({
    name: "project_set_language_preferences",
    label: "Project Set Language Preferences",
    description: "Persist preferred languages for plan content and chat in the current planner project. Use this once after the user decides, so you do not have to ask again in later sessions.",
    parameters: Type.Object({
      contentLanguage: Type.Optional(Type.String({ description: "Preferred language for plan content (rules, decisions, descriptions, summaries)" })),
      chatLanguage: Type.Optional(Type.String({ description: "Preferred language for assistant-user chat in this project" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      if (params.contentLanguage === undefined && params.chatLanguage === undefined) {
        return { content: [{ type: "text", text: "Nothing to update. Provide contentLanguage and/or chatLanguage." }], details: {} };
      }
      const project = await st.loadProject();
      if (params.contentLanguage !== undefined) project.contentLanguage = params.contentLanguage.trim();
      if (params.chatLanguage !== undefined) project.chatLanguage = params.chatLanguage.trim();
      const normalizedContent = normalizeLanguagePref(project.contentLanguage);
      const normalizedChat = normalizeLanguagePref(project.chatLanguage);
      if (normalizedContent || normalizedChat) {
        const fallback = normalizedContent || normalizedChat;
        project.contentLanguage = normalizedContent || fallback;
        project.chatLanguage = normalizedChat || fallback;
      }
      await st.saveProject(project);
      await st.writeGenerated();
      return {
        content: [{ type: "text", text: `Saved language preferences: content=${project.contentLanguage || "(unset)"}, chat=${project.chatLanguage || "(unset)"}` }],
        details: { contentLanguage: project.contentLanguage, chatLanguage: project.chatLanguage },
      };
    },
  });

  pi.registerTool({
    name: "plan_init",
    label: "Plan Init",
    description: "Initialize a new project plan (.planner/) in the current cwd. Use once at the start of a project. When deriving the planner from an existing document or plan, use a concise human project title and ask the user to confirm it if your candidate title is long, compound, or looks like a phase heading.",
    parameters: Type.Object({
      projectName: Type.String({ description: "Concise project name/title" }),
      description: Type.Optional(Type.String({ description: "Short project description" })),
      goal: Type.Optional(Type.String({ description: "Main project goal / objective" })),
      requirements: Type.Optional(Type.Array(Type.String(), { description: "Initial top-level requirements to seed requirements.json" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = loadStore(ctx);
      if (await st.exists()) {
        return { content: [{ type: "text", text: ".planner/ already exists" }], details: {} };
      }
      let projectName = params.projectName.trim();
      if (projectName.length > 60 || projectName.includes("—") || projectName.includes("->")) {
        const confirmed = await ctx.ui.confirm(
          `The project name "${projectName}" seems long or compound. Is this the final concise title you want for the .planner/ root?`,
          "Yes, use this title"
        );
        if (!confirmed) {
          const newTitle = await ctx.ui.input("Please enter a more concise project title:");
          if (newTitle) projectName = newTitle.trim();
        }
      }
      await st.init(projectName);
      const project = await st.loadProject();
      if (params.description !== undefined) project.description = params.description.trim();
      if (params.goal !== undefined) project.goal = params.goal.trim();
      await st.saveProject(project);

      const requirementTitles = (params.requirements ?? []).map((entry) => entry.trim()).filter(Boolean);
      if (requirementTitles.length > 0) {
        const now = nowISO();
        await st.saveRequirements({
          requirements: requirementTitles.map((title, index) => ({
        id: createRequirementId(),
            title,
            description: "",
            status: "planned",
            macroTasks: [],
            linkedPhaseIds: [],
            createdAt: now,
            updatedAt: now,
          } satisfies Requirement)),
        });
      }

      await st.writeGenerated();
      return {
        content: [{ type: "text", text: `.planner/ initialized for "${projectName}"` }],
        details: { projectName, description: project.description, goal: project.goal, requirementsCount: requirementTitles.length },
      };
    },
  });

  pi.registerTool({
    name: "project_update",
    label: "Project Update",
    description: "Update project-level metadata such as title, description, goal, scope, technologies, and rules. Use this after importing or refining an existing plan so the planner root is not left empty.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Project title" })),
      description: Type.Optional(Type.String({ description: "Short project description" })),
      goal: Type.Optional(Type.String({ description: "Main project goal / objective" })),
      scope: Type.Optional(Type.Array(Type.String(), { description: "Replace in-scope items" })),
      outOfScope: Type.Optional(Type.Array(Type.String(), { description: "Replace out-of-scope items" })),
      technologies: Type.Optional(Type.Array(Type.String(), { description: "Replace technologies list" })),
      tools: Type.Optional(Type.Array(Type.String(), { description: "Replace tools list" })),
      globalRules: Type.Optional(Type.Array(Type.String(), { description: "Replace global rules" })),
      decisions: Type.Optional(Type.Array(Type.String(), { description: "Replace project decisions" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found. Use plan_init first." }], details: {} };
      const project = await st.loadProject();
      if (params.name !== undefined) project.name = params.name.trim();
      if (params.description !== undefined) project.description = params.description.trim();
      if (params.goal !== undefined) project.goal = params.goal.trim();
      if (params.scope !== undefined) project.scope = params.scope.map((entry) => entry.trim()).filter(Boolean);
      if (params.outOfScope !== undefined) project.outOfScope = params.outOfScope.map((entry) => entry.trim()).filter(Boolean);
      if (params.technologies !== undefined) project.technologies = params.technologies.map((entry) => entry.trim()).filter(Boolean);
      if (params.tools !== undefined) project.tools = params.tools.map((entry) => entry.trim()).filter(Boolean);
      if (params.globalRules !== undefined) project.globalRules = params.globalRules.map((entry) => entry.trim()).filter(Boolean);
      if (params.decisions !== undefined) project.decisions = params.decisions.map((entry) => entry.trim()).filter(Boolean);
      await st.saveProject(project);
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Project updated: ${project.name}` }], details: project };
    },
  });

  pi.registerTool({
    name: "requirement_list",
    label: "Requirement List",
    description: "List all top-level requirements in requirements.json.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const requirements = await st.loadRequirements();
      requirements.requirements.forEach((req) => markRequirementRead(req.id));
      return {
        content: [{ type: "text", text: requirements.requirements.map((req) => `- ${req.id} — ${req.title} (${req.status})`).join("\n") || "No requirements" }],
        details: requirements,
      };
    },
  });

  pi.registerTool({
    name: "requirement_create",
    label: "Requirement Create",
    description: "Create a new top-level requirement in requirements.json.",
    parameters: Type.Object({
      title: Type.String({ description: "Requirement title" }),
      description: Type.Optional(Type.String({ description: "Requirement description" })),
      status: Type.Optional(Type.String({ description: "Initial status: planned|in-progress|done|blocked|canceled" })),
      linkedPhaseIds: Type.Optional(Type.Array(Type.String(), { description: "Optional linked phase IDs" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const title = params.title?.trim();
      if (!title) return { content: [{ type: "text", text: "title required" }], details: {} };
      const links = await resolveRequirementPhaseRefs(st, params.linkedPhaseIds);
      if (!links.ok) return { content: [{ type: "text", text: links.error }], details: {} };
      const requirements = await st.loadRequirements();
      const now = nowISO();
      const requirement: Requirement = {
        id: createRequirementId(),
        title,
        description: params.description?.trim() ?? "",
        status: (params.status?.trim() as Requirement["status"] | undefined) ?? "planned",
        macroTasks: [],
        linkedPhaseIds: links.linkedPhaseIds,
        createdAt: now,
        updatedAt: now,
      };
      requirements.requirements.push(requirement);
      await st.saveRequirements(requirements);
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Requirement created: ${requirement.id}` }], details: requirement };
    },
  });

  pi.registerTool({
    name: "requirement_update",
    label: "Requirement Update",
    description: "Update an existing top-level requirement.",
    parameters: Type.Object({
      requirementId: Type.String({ description: "Requirement ID" }),
      title: Type.Optional(Type.String({ description: "Requirement title" })),
      description: Type.Optional(Type.String({ description: "Requirement description" })),
      status: Type.Optional(Type.String({ description: "Status: planned|in-progress|done|blocked|canceled" })),
      linkedPhaseIds: Type.Optional(Type.Array(Type.String(), { description: "Replace linked phase IDs" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const requirements = await st.loadRequirements();
      const requirement = requirements.requirements.find((entry) => entry.id === params.requirementId);
      if (!requirement) return { content: [{ type: "text", text: `Requirement not found: ${params.requirementId}` }], details: {} };
      if (params.title !== undefined) {
        const title = params.title.trim();
        if (!title) return { content: [{ type: "text", text: "title required" }], details: {} };
        requirement.title = title;
      }
      if (params.description !== undefined) requirement.description = params.description.trim();
      if (params.status !== undefined) requirement.status = params.status.trim() as Requirement["status"];
      if (params.linkedPhaseIds !== undefined) {
        const links = await resolveRequirementPhaseRefs(st, params.linkedPhaseIds);
        if (!links.ok) return { content: [{ type: "text", text: links.error }], details: {} };
        requirement.linkedPhaseIds = links.linkedPhaseIds;
      }
      requirement.updatedAt = nowISO();
      await st.saveRequirements(requirements);
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Requirement updated: ${requirement.id}` }], details: requirement };
    },
  });

  pi.registerTool({
    name: "requirement_delete",
    label: "Requirement Delete",
    description: "Delete a top-level requirement from requirements.json.",
    parameters: Type.Object({
      requirementId: Type.String({ description: "Requirement ID" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const requirements = await st.loadRequirements();
      const next = requirements.requirements.filter((entry) => entry.id !== params.requirementId);
      if (next.length === requirements.requirements.length) {
        return { content: [{ type: "text", text: `Requirement not found: ${params.requirementId}` }], details: {} };
      }
      await st.saveRequirements({ requirements: next });
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Requirement deleted: ${params.requirementId}` }], details: { deleted: params.requirementId } };
    },
  });

  pi.registerTool({
    name: "plan_get",
    label: "Plan Get",
    description: "Read the full plan: manifest, project, features, phases (with their tasks), and requirements. Call this first to understand current state before planning work.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found. Use plan_init first." }], details: {} };
      const plan = await st.loadAll();
      return {
        content: [{ type: "text", text: `Plan "${plan.project.name}": ${plan.features.features.length} features, ${plan.phases.length} phases, ${plan.requirements.requirements.length} requirements` }],
        details: plan,
      };
    },
  });

  pi.registerTool({
    name: "plan_render",
    label: "Plan Render",
    description: "Regenerate all generated markdown views in .planner/.local/generated/. Call after any data change to keep docs in sync.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const files = await st.writeGenerated();
      return { content: [{ type: "text", text: `Regenerated ${files.length} files` }], details: { files } };
    },
  });

  pi.registerTool({
    name: "plan_repair",
    label: "Plan Repair",
    description: "Repair dangling feature→phase references, rebuild phase containment from each task's own phaseId (heals the migrateToGlobalSequence task-shuffle bug), and report plan integrity (duplicate phase ids, dangling phase refs). Safe to run anytime; run if the planner reports ENOENT/phase not found, tasks appear in the wrong phase, or after manual edits to .planner/.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const report = await st.repair();
      const m = report.migrated;
      const c = report.containment;
      const lines = [
        `Repair complete.`,
        `Migration: renamed=${m.renamed}, repaired=${m.repaired} refs, inferred=${m.inferred}.`,
        `Containment: ${c.changed} phase file${c.changed === 1 ? "" : "s"} rewritten (tasks regrouped by their own phaseId), ${c.tasks} tasks scanned, ${c.orphan} orphan.`,
        `Handoffs: archived=${report.handoffs.archived} stale completed/canceled handoff(s).`,
        `Integrity: duplicatePhaseIds=${report.integrity.duplicatePhaseIds.length}, danglingPhaseIds=${report.integrity.danglingPhaseIds.length}.`,
      ];
      if (report.integrity.danglingPhaseIds.length) lines.push("Dangling: " + report.integrity.danglingPhaseIds.join(", "));
      if (report.integrity.duplicatePhaseIds.length) lines.push("Duplicates: " + report.integrity.duplicatePhaseIds.join(", "));
      return { content: [{ type: "text", text: lines.join("\n") }], details: report };
    },
  });

  pi.registerTool({
    name: "plan_cleanup_orphan_phases",
    label: "Plan Cleanup Orphan Phases",
    description: "Discover phase files that no longer resolve to a valid owning feature, and optionally delete them. Run once with confirm=false (default) to inspect, then rerun with confirm=true to remove them.",
    parameters: Type.Object({
      confirm: Type.Optional(Type.Boolean({ description: "Set true to actually delete the discovered orphan phase files. Default: false (dry-run/list only)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const found = await st.listOrphanPhases();
      if (!params.confirm) {
        if (found.length === 0) return { content: [{ type: "text", text: "No orphan phases found." }], details: { found: [] } };
        const lines = [
          `Found ${found.length} orphan phase${found.length === 1 ? "" : "s"}.`,
          ...found.map((phase) => `- ${phase.compositeRef}${phase.shortId ? ` · ${phase.shortId}` : ""} — ${phase.title} (${phase.reason})`),
          "Rerun with confirm=true to delete these orphan phase files.",
        ];
        return { content: [{ type: "text", text: lines.join("\n") }], details: { found, confirmRequired: true } };
      }
      const report = await st.cleanupOrphanPhases();
      if (report.removed.length === 0) return { content: [{ type: "text", text: "No orphan phases found." }], details: report };
      const lines = [
        `Removed ${report.removed.length} orphan phase${report.removed.length === 1 ? "" : "s"}.`,
        ...report.removed.map((phase) => `- ${phase.compositeRef}${phase.shortId ? ` · ${phase.shortId}` : ""} — ${phase.title}`),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], details: report };
    },
  });

  pi.registerTool({
    name: "plan_get_handoff",
    label: "Plan Get Handoff",
    description: "DEPRECATED — redirects to the entity-scoped handoff (phase.handoff). Lists current phase handoffs. Prefer handoff_list / handoff_show.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const list = await st.listHandoffs();
      if (list.length === 0) return { content: [{ type: "text", text: "⚠️ plan_get_handoff is deprecated — no phase handoffs set. Use handoff_list / handoff_show (entity-scoped, phase.handoff field)." }], details: { deprecated: true, count: 0 } };
      const lines = list.map((e) => `- ${e.compositeRef} — ${e.firstLine} (updated ${e.updatedAt})`);
      return { content: [{ type: "text", text: `⚠️ plan_get_handoff is deprecated — use handoff_list / handoff_show. Phase handoffs (${list.length}):\n${lines.join("\n")}` }], details: { deprecated: true, count: list.length, handoffs: list } };
    },
  });

  pi.registerTool({
    name: "plan_write_handoff",
    label: "Plan Write Handoff",
    description: "DEPRECATED — writes to the entity-scoped phase.handoff (not .planner/HANDOFF.md). Prefer handoff_write. phaseRef is required and must be the exact phase confirmed with the user; never infer a target from current status or resume pointers. Completed/canceled phases reject new handoffs.",
    parameters: Type.Object({
      phaseRef: Type.String({ description: "Exact confirmed phase ref: P00x | P00x(F00x) | UUID | title." }),
      confirmed: Type.Boolean({ description: "Set true only after the user explicitly confirms the proposed feature+phase target." }),
      reason: Type.Optional(Type.String({ description: "Why the handoff is being written" })),
      title: Type.Optional(Type.String({ description: "Meaningful handoff title summarizing the work (becomes the H1 / first line in lists). Example: 'P049 — featureId validation: tests + adapter wiring'." })),
      whatWasBeingDone: Type.Optional(Type.String({ description: "Optional override for the current work summary" })),
      howToResume: Type.Optional(Type.String({ description: "Optional override for resume instructions" })),
      extraSections: Type.Optional(Type.Array(
        Type.Object({
          heading: Type.String({ description: "Section heading (without the leading ## markers)" }),
          body: Type.String({ description: "Markdown body of the section. Use file:line refs, IDs, and concrete mappings." }),
        }),
        { description: "Rich context sections injected between 'What was being done' and 'How to resume'. Use for: Locked Design Decisions ({id,title,decision,rationale}), Architecture (new modules with file:line), Mode/State Flow (textual diagrams), Plugin/API Contracts, Data Mappings, Files Touched (new/modified/planner), Known Gaps. Maximize the design context a resuming agent needs." },
      )),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const resolved = await resolvePhaseForHandoff(st, params.phaseRef);
      if (!resolved.ok) return { content: [{ type: "text", text: `⚠️ plan_write_handoff is deprecated (writes to phase.handoff, not .planner/HANDOFF.md). ${resolved.error}` }], details: { deprecated: true, error: resolved.error } };
      if (!params.confirmed) return { content: [{ type: "text", text: `Proposal only: I would write this handoff on ${resolved.compositeRef}. Ask the user to confirm this exact feature/phase, then retry with confirmed=true.` }], details: { deprecated: true, phaseRef: resolved.compositeRef, confirmationRequired: true } };
      const markdown = await buildHandoffMarkdown(st, params.reason?.trim() || "manual tool handoff", {
        phaseId: resolved.phase.id,
        ...(params.title?.trim() ? { title: params.title.trim() } : {}),
        ...(params.whatWasBeingDone?.trim() ? { whatWasBeingDone: params.whatWasBeingDone.trim() } : {}),
        ...(params.howToResume?.trim() ? { howToResume: params.howToResume.trim() } : {}),
        ...(params.extraSections && params.extraSections.length > 0
          ? {
              extraSections: params.extraSections
                .map((section) => ({ heading: section.heading?.trim() ?? "", body: section.body ?? "" }))
                .filter((section) => section.heading),
            }
          : {}),
      });
      await st.setPhaseHandoff(resolved.phase.id, markdown);
      return { content: [{ type: "text", text: `⚠️ plan_write_handoff is deprecated — wrote handoff on ${resolved.compositeRef} (phase.handoff field) instead of .planner/HANDOFF.md. Prefer the handoff_write tool.` }], details: { deprecated: true, phaseRef: resolved.compositeRef, phaseId: resolved.phase.id } };
    },
  });

  pi.registerTool({
    name: "plan_delete_handoff",
    label: "Plan Delete Handoff",
    description: "DEPRECATED — clears/archives the entity-scoped handoff of a phase. phaseRef is required. Prefer handoff_clear.",
    parameters: Type.Object({ phaseRef: Type.String({ description: "Exact phase ref: P00x | P00x(F00x) | UUID | title." }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const r = await resolvePhaseForHandoff(st, params.phaseRef);
      if (!r.ok) return { content: [{ type: "text", text: `⚠️ plan_delete_handoff is deprecated — use handoff_clear. ${r.error}` }], details: { deprecated: true, error: r.error } };
      await st.clearPhaseHandoff(r.phase.id, "manual");
      return { content: [{ type: "text", text: `⚠️ plan_delete_handoff is deprecated — cleared handoff on ${r.compositeRef} (phase.handoff). Prefer handoff_clear.` }], details: { deprecated: true, phaseRef: r.compositeRef, phaseId: r.phase.id } };
    },
  });

  // ── entity-scoped handoff (phase.handoff field) ──
  type PhaseHandoffResolve =
    | { ok: true; phase: Phase; compositeRef: string }
    | { ok: false; error: string };

  // Resolve a phase for entity-scoped handoff tools. ref = P00x | P00x(F00x) |
  // UUID | title. A write target is always explicit: never guess from the
  // first in-progress phase or a stale resume pointer.
  async function resolvePhaseForHandoff(
    st: PlanStore,
    ref: string | undefined,
  ): Promise<PhaseHandoffResolve> {
    const phases = await st.loadAllPhases();
    const features = (await st.loadFeatures()).features;
    let phase: Phase | undefined;
    if (ref && ref.trim()) {
      phase = findPhaseByRef(phases, features, ref.trim());
    }
    if (!phase) {
      return {
        ok: false,
        error: ref && ref.trim()
          ? `Phase not found: "${ref.trim()}". Use P00x, P00x(F00x), UUID, or title.`
          : "A phaseRef is required. First identify the exact feature and phase with the user, then pass P00x or P00x(F00x).",
      };
    }
    const feat = phase.featureId ? features.find((f) => f.id === phase.featureId) : undefined;
    return { ok: true, phase, compositeRef: formatPhaseRef(phase.number, feat?.number) };
  }

  async function resolveRequirementPhaseRefs(
    st: PlanStore,
    refs: string[] | undefined,
  ): Promise<{ ok: true; linkedPhaseIds: string[] } | { ok: false; error: string }> {
    if (!Array.isArray(refs) || refs.length === 0) {
      return { ok: false, error: "linkedPhaseIds must contain at least one phase" };
    }
    const trimmed = refs.map((entry) => entry.trim()).filter(Boolean);
    if (trimmed.length === 0) {
      return { ok: false, error: "linkedPhaseIds must contain non-empty phase references" };
    }
    const phases = await st.loadAllPhases();
    const features = (await st.loadFeatures()).features;
    const resolved = trimmed.map((ref) => findPhaseByRef(phases, features, ref));
    const missingIndex = resolved.findIndex((phase) => !phase);
    if (missingIndex !== -1) {
      return { ok: false, error: `linked phase not found: ${trimmed[missingIndex]}` };
    }
    return { ok: true, linkedPhaseIds: [...new Set(resolved.map((phase) => phase!.id))] };
  }

  pi.registerTool({
    name: "handoff_list",
    label: "Handoff List",
    description: "List all phases with a non-empty entity-scoped handoff (phase.handoff field). Returns composite refs (P00x / P00x(F00x)) with the first line and last-updated time.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const list = await st.listHandoffs();
      if (list.length === 0) return { content: [{ type: "text", text: "No phase handoffs set." }], details: { count: 0 } };
      const lines = list.map((e) => `- ${e.compositeRef} — ${e.firstLine} (updated ${e.updatedAt})`);
      return { content: [{ type: "text", text: `Phase handoffs (${list.length}):\n${lines.join("\n")}` }], details: { count: list.length, handoffs: list } };
    },
  });

  pi.registerTool({
    name: "handoff_show",
    label: "Handoff Show",
    description: "Read the entity-scoped handoff of a phase. phaseRef is required and accepts P00x, P00x(F00x), UUID, or title. Never infer a phase automatically.",
    parameters: Type.Object({ phaseRef: Type.String({ description: "Exact phase ref: P00x | P00x(F00x) | UUID | title. Ask the user when the target is ambiguous." }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const r = await resolvePhaseForHandoff(st, params.phaseRef);
      if (!r.ok) return { content: [{ type: "text", text: `❌ ${r.error}` }], details: { error: r.error } };
      const content = await st.getPhaseHandoff(r.phase.id);
      if (!content.trim()) return { content: [{ type: "text", text: `No handoff set on ${r.compositeRef}.` }], details: { phaseRef: r.compositeRef, empty: true } };
      return { content: [{ type: "text", text: `Handoff for ${r.compositeRef}:\n\n${content}` }], details: { phaseRef: r.compositeRef, phaseId: r.phase.id } };
    },
  });

  pi.registerTool({
    name: "handoff_write",
    label: "Handoff Write",
    description: "Write/refresh the entity-scoped handoff on a phase. phaseRef is required and must be the exact phase selected with the user. Pass content (or markdown_content) AND a meaningful `title` summarizing the work (e.g. 'P049 — featureId validation: tests + adapter wiring'). Never guess the phase from in-progress status or stale context. Completed/canceled phases reject new handoffs.",
    parameters: Type.Object({
      phaseRef: Type.String({ description: "Exact confirmed phase ref: P00x | P00x(F00x) | UUID | title." }),
      title: Type.Optional(Type.String({ description: "Meaningful handoff title summarizing the work (becomes the H1 / first line in lists). REQUIRED if your markdown's first heading is generic. Example: 'P049 — featureId validation: tests + adapter wiring'." })),
      confirmed: Type.Boolean({ description: "Set true only after the user explicitly confirms the proposed feature+phase target." }),
      content: Type.Optional(Type.String({ description: "Handoff text (plain)." })),
      markdown_content: Type.Optional(Type.String({ description: "Handoff text (markdown). Preferred over content." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      let body = (params.markdown_content ?? params.content ?? "").trim();
      if (!body) return { content: [{ type: "text", text: "❌ Provide the handoff text (content or markdown_content)." }], details: { error: "empty text" } };
      const title = params.title?.trim();
      // Derive the current first non-empty line (H1) of the supplied body.
      const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
      const firstHeadingText = firstLine.replace(/^#+\s*/, "").trim();
      const genericTitlePattern = /^(handoff|canonical handoff|session handoff)$/i;
      const effectiveHeadingText = (title && title.length > 0) ? title : firstHeadingText;
      const isGeneric = !effectiveHeadingText || genericTitlePattern.test(effectiveHeadingText);
      if (isGeneric) {
        return {
          content: [{ type: "text", text: "❌ Generic handoff title. Provide a meaningful `title` (or start your markdown with a descriptive H1) summarizing the work — e.g. 'P049 — featureId validation: tests + adapter wiring'. Generic titles like 'Handoff' or 'Canonical handoff' are not accepted." }],
          details: { error: "generic title", firstHeadingText: effectiveHeadingText || firstHeadingText },
        };
      }
      // Normalize: if a title is provided, replace or prepend the H1 so the first line is the title.
      if (title) {
        const lines = body.split(/\r?\n/);
        const firstIdx = lines.findIndex((l) => l.trim().length > 0);
        if (firstIdx !== -1 && /^#+\s/.test(lines[firstIdx] ?? "")) {
          lines[firstIdx] = `# ${title}`;
          body = lines.join("\n");
        } else {
          body = `# ${title}\n\n${body}`;
        }
      }
      const r = await resolvePhaseForHandoff(st, params.phaseRef);
      if (!r.ok) return { content: [{ type: "text", text: `❌ ${r.error}` }], details: { error: r.error } };
      if (!params.confirmed) {
        return { content: [{ type: "text", text: `Proposal only: I would write this handoff on ${r.compositeRef}. Ask the user to confirm this exact feature/phase, then retry with confirmed=true.` }], details: { phaseRef: r.compositeRef, confirmationRequired: true } };
      }
      await st.setPhaseHandoff(r.phase.id, body);
      return { content: [{ type: "text", text: `✅ Wrote handoff on ${r.compositeRef}.` }], details: { phaseRef: r.compositeRef, phaseId: r.phase.id } };
    },
  });

  pi.registerTool({
    name: "handoff_clear",
    label: "Handoff Clear",
    description: "Clear the entity-scoped handoff of a phase (archives it and keeps handoffUpdatedAt as an audit trail). phaseRef is required; never infer a phase automatically.",
    parameters: Type.Object({ phaseRef: Type.String({ description: "Exact phase ref: P00x | P00x(F00x) | UUID | title." }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const r = await resolvePhaseForHandoff(st, params.phaseRef);
      if (!r.ok) return { content: [{ type: "text", text: `❌ ${r.error}` }], details: { error: r.error } };
      await st.clearPhaseHandoff(r.phase.id, "manual");
      return { content: [{ type: "text", text: `✅ Cleared handoff on ${r.compositeRef} (handoffUpdatedAt preserved as audit; archived to .planner/.local/handoff-archive/).` }], details: { phaseRef: r.compositeRef, phaseId: r.phase.id } };
    },
  });

  pi.registerTool({
    name: "plan_authorize_bypass",
    label: "Plan Authorize Guard Bypass",
    description: "Authorize a temporary guard bypass (default 15 minutes) so the edit/write advisory guard stops warning when no task is in-progress. Per-session in-memory: not persisted, not shared across agents. Use ONLY after the user explicitly authorizes proceeding without a task.",
    parameters: Type.Object({
      durationMinutes: Type.Optional(Type.Number({ description: "Bypass window in minutes. Default 15." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const ok = await requirePlan(ctx);
      if (!ok) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const mins = params.durationMinutes ?? 15;
      const until = authorizeGuardBypass(mins);
      return { content: [{ type: "text", text: `Guard bypass authorized until ${until}. Advisory edit/write warnings silenced for ${mins} minutes (per-session, not shared).` }], details: { until } };
    },
  });

  pi.registerTool({
    name: "plan_clear_bypass",
    label: "Plan Clear Guard Bypass",
    description: "Revoke the per-session guard bypass so the edit/write advisory warnings resume.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const ok = await requirePlan(ctx);
      if (!ok) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      clearGuardBypass();
      return { content: [{ type: "text", text: "Guard bypass revoked." }], details: { cleared: true } };
    },
  });

  // ── features ────────────────────────────────────────────────────────

    pi.registerTool({
      name: "feature_list",
      label: "Feature List",
      description: "List features (compact: F00x · shortId — name (status; N phases, M tasks)). Use this to discover refs cheaply — do NOT read .planner/ files or plan_get full=true to find entities.",
      parameters: Type.Object({ featureRef: Type.Optional(Type.String({ description: "Optional: filter to one feature (F00x/shortId/UUID/name)" })) }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const st = await requirePlan(ctx);
        if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
        const all = (await st.loadFeatures()).features;
        const ref = params.featureRef?.trim();
        const matchF = (f: Feature) => !ref || formatFeatureRef(f.number) === ref || f.shortId === ref || f.id === ref || f.name.toLowerCase() === ref.toLowerCase();
        const features = all.filter(matchF);
        const phases = await st.loadAllPhases();
        const summary = features.map((f) => {
          const fp = phases.filter((p) => p.featureId === f.id);
          return `- ${formatFeatureRef(f.number)}${f.shortId ? ` · ${f.shortId}` : ""} — ${f.name} (${f.status}; ${fp.length} phases, ${fp.reduce((t, p) => t + p.tasks.length, 0)} tasks)`;
        }).join("\n");
        return { content: [{ type: "text", text: summary || "No features" }], details: {} };
      },
    });

    pi.registerTool({
      name: "feature_get",
      label: "Feature Get",
      description: "Show a feature. Compact identity by default (saves tokens); pass full=true to include the description and derived linked requirements.",
      parameters: Type.Object({
        featureId: Type.String({ description: "Feature ref: F00x, shortId, UUID, or name" }),
        full: Type.Optional(Type.Boolean({ description: "If true, include the feature description. Default: compact identity only." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const st = await requirePlan(ctx);
        if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
        const features = (await st.loadFeatures()).features;
        const ref = params.featureId.trim();
        const resolvedFeature = resolveFeatureRefStrict(features, ref);
        if (!resolvedFeature.ok) return { content: [{ type: "text", text: resolvedFeature.error }], details: {} };
        const feature = resolvedFeature.feature;
        markFeatureRead(feature.id);
        const phases = (await st.loadAllPhases()).filter((p) => p.featureId === feature.id);
        const linkedRequirements = await st.linkedRequirementsForFeature(feature.id);
        const summary = `${feature.name} — ${formatFeatureRef(feature.number)}${feature.shortId ? ` · ${feature.shortId}` : ""} (${feature.status}; ${phases.length} phases${linkedRequirements.length ? `; ${linkedRequirements.length} linked requirement${linkedRequirements.length === 1 ? "" : "s"}` : ""})`;
        const requirementsBlock = linkedRequirements.length > 0
          ? `\n\nLinked requirements:\n${linkedRequirements.map((requirement) => `- ${requirement.title} (${requirement.status})`).join("\n")}`
          : "\n\nLinked requirements:\n- None linked to this feature.";
        return { content: [{ type: "text", text: params.full ? `${summary}\n\n${feature.description || ""}${requirementsBlock}` : summary }], details: { linkedRequirements } };
      },
    });

  pi.registerTool({
    name: "feature_create",
    label: "Feature Create",
    description: "Create a new feature with a RICH description. REQUIRED: description must include code references (file:line), current implementation state (what exists, what is unimplemented), systems/structs/traits involved, concrete goals, and behaviors to preserve. The description is the primary context for future agents resuming this feature; one-liners cause misalignment. Returns the generated feature id. Feature status is generally derived from child phases/tasks, so prefer not to set it directly unless you truly need an explicit override during setup.",
    parameters: Type.Object({
      name: Type.String({ description: "Feature name/title" }),
      description: Type.String({ description: "REQUIRED — code references (file:line), current state of the art, structs/traits/systems involved, goals, behaviors to preserve. Not a one-liner. Prefix with 'design-only' for pre-implementation design tasks.", minLength: 50 }),
      status: Type.Optional(Type.String({ description: "Initial status. One of: planned, in-progress, done, blocked, canceled. Default: planned. Usually leave this alone: feature status is derived from child phases/tasks." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const now = nowISO();
      const status = (params.status as Feature["status"] | undefined) ?? "planned";
      const currentFeatures = (await st.loadFeatures()).features;
      const id = createFeatureId();
      const identity = await st.allocateEntityIdentity("feature", id);
      const priority = await st.nextPriority("feature");
      const feature: Feature = {
        id,
        number: identity.number,
        shortId: identity.shortId,
        priority,
        name: params.name,
        description: params.description ?? "",
        descriptionUpdatedAt: now,
        status,
        discussedAt: "",
        contextReady: false,
        contextReadyReason: "",
        startDate: status === "in-progress" ? new Date().toISOString().slice(0, 10) : "",
        endDate: "",
        workDone: "",
        workRemaining: "",
        acceptedDecisions: [],
        phaseIds: [],
        dependsOn: [],
        statusLog: [],
        createdAt: now,
        updatedAt: now,
      };
      // Atomic read-modify-write: serializes concurrent feature_create calls
      // (batch) so they don't overwrite each other (last-write-wins race).
      await st.updateFeatures((doc) => {
        doc.features.push(feature);
        return doc;
      });
      await st.writeGenerated();
      return { content: [{ type: "text", text: `✅ Feature created: ${formatFeatureRef(feature.number)} — ${feature.name}${feature.shortId ? ` · ${feature.shortId}` : ""}` }], details: feature };
    },
  });

  pi.registerTool({
    name: "feature_discuss",
    label: "Feature Discuss",
    description: "Persist feature discovery/governance fields so the feature context is ready before detailed implementation planning.",
    parameters: Type.Object({
      featureId: Type.String({ description: "Feature ref: F00x, shortId, UUID, or name" }),
      description: Type.Optional(Type.String({ description: "Current implementation state, scope, and goals for this feature" })),
      workDone: Type.Optional(Type.String({ description: "What is already implemented / decided" })),
      workRemaining: Type.Optional(Type.String({ description: "What still needs to be done" })),
      dependencies: Type.Optional(Type.Array(Type.String(), { description: "Cross-feature or external dependencies" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const resolvedFeature = resolveFeatureRefStrict(features, params.featureId);
      if (!resolvedFeature.ok) return { content: [{ type: "text", text: resolvedFeature.error }], details: {} };
      const featureId = resolvedFeature.feature.id;
      const updatedDoc = await st.updateFeatures((doc) => {
        const feature = doc.features.find((f) => f.id === featureId);
        if (!feature) return doc;
        if (params.description !== undefined) feature.description = params.description;
        if (params.workDone !== undefined) feature.workDone = params.workDone;
        if (params.workRemaining !== undefined) feature.workRemaining = params.workRemaining;
        if (params.dependencies !== undefined) feature.dependsOn = params.dependencies.map((item) => item.trim()).filter(Boolean);
        feature.discussedAt = nowISO();
        feature.contextReady = true;
        feature.contextReadyReason = "Updated through feature_discuss tool.";
        feature.updatedAt = nowISO();
        return doc;
      });
      const feature = updatedDoc.features.find((f) => f.id === featureId);
      if (!feature) return { content: [{ type: "text", text: `Feature not found: ${params.featureId}` }], details: {} };
      await st.writeGenerated();
      return { content: [{ type: "text", text: `✅ Feature discussed/updated: ${formatFeatureRef(feature.number)} — ${feature.name}${feature.shortId ? ` · ${feature.shortId}` : ""}` }], details: feature };
    },
  });

  pi.registerTool({
    name: "feature_update",
    label: "Feature Update",
    description: "Update one or more fields of a feature. Only provided fields are changed. IMPORTANT: feature status is derived from child phases/tasks, so do not update feature.status directly unless truly necessary.",
    parameters: Type.Object({
      featureId: Type.String({ description: "Feature ref: F00x, shortId, UUID, or name" }),
      name: Type.Optional(Type.String({ description: "New name" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      status: Type.Optional(Type.String({ description: "New status: planned|in-progress|done|blocked|canceled. Avoid setting this directly unless you truly need an override: feature status is derived from child phases/tasks." })),
      startDate: Type.Optional(Type.String({ description: "Start date (YYYY-MM-DD)" })),
      endDate: Type.Optional(Type.String({ description: "End date (YYYY-MM-DD)" })),
      workDone: Type.Optional(Type.String({ description: "Notes on work done" })),
      workRemaining: Type.Optional(Type.String({ description: "Notes on remaining work" })),
      priority: Type.Optional(Type.Number({ description: "Display order within the project (lower = higher). Tiebreak by number then createdAt." })),
      acceptedDecisions: Type.Optional(Type.Array(Type.Object({
        id: Type.String(),
        title: Type.String(),
        decision: Type.String(),
        rationale: Type.String(),
        implementationNotes: Type.String(),
        acceptedAt: Type.String(),
      }), { description: "Replace accepted decisions list" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const resolvedFeature = resolveFeatureRefStrict(features, params.featureId);
      if (!resolvedFeature.ok) return { content: [{ type: "text", text: resolvedFeature.error }], details: {} };
      const featureId = resolvedFeature.feature.id;
      const mutableFields = [
        "name",
        "description",
        "status",
        "startDate",
        "endDate",
        "workDone",
        "workRemaining",
        "priority",
        "acceptedDecisions",
      ] as const;
      const receivedFields = mutableFields.filter((field) => params[field] !== undefined);
      if (receivedFields.length === 0) {
        return {
          content: [{
            type: "text",
            text: "Not updated — no mutable fields were received. No planner data was changed. If you attempted a large description, it may have exceeded the tool payload limit.",
          }],
          details: { updated: false, reason: "no-mutable-fields" },
        };
      }

      let foundDoc: FeaturesDocument | undefined;
      try {
        foundDoc = await st.updateFeatures((doc) => {
          const feature = doc.features.find((f) => f.id === featureId);
          if (!feature) return doc; // not found: no-op, handled below

          if (params.name !== undefined) feature.name = params.name;
          if (params.description !== undefined) feature.description = params.description;
          if (params.workDone !== undefined) feature.workDone = params.workDone;
          if (params.workRemaining !== undefined) feature.workRemaining = params.workRemaining;
          if (params.startDate !== undefined) feature.startDate = params.startDate;
          if (params.endDate !== undefined) feature.endDate = params.endDate;
          if (params.priority !== undefined) feature.priority = params.priority;
          if (params.acceptedDecisions !== undefined) feature.acceptedDecisions = params.acceptedDecisions;

          if (params.status !== undefined) {
            const status = params.status as Feature["status"];
            if (feature.status !== status) {
              if (status === "in-progress" && !feature.startDate) {
                feature.startDate = new Date().toISOString().slice(0, 10);
              }
              if (status === "done" && !feature.endDate) {
                feature.endDate = new Date().toISOString().slice(0, 10);
              }
            }
            feature.status = status;
          }

          feature.updatedAt = nowISO();
          return doc;
        });
      } catch (e) {
        return { content: [{ type: "text", text: `Update failed: ${e}` }], details: {} };
      }
      const feature = foundDoc?.features.find((f) => f.id === featureId);
      if (!feature) return { content: [{ type: "text", text: `Feature not found: ${params.featureId}` }], details: {} };
      await st.writeGenerated();
      return {
        content: [{
          type: "text",
          text: `✅ Feature updated: ${formatFeatureRef(feature.number)} — ${feature.name}${feature.shortId ? ` · ${feature.shortId}` : ""}. Fields saved: ${receivedFields.join(", ")}.`,
        }],
        details: { ...feature, updated: true, updatedFields: receivedFields },
      };
    },
  });

  pi.registerTool({
    name: "feature_delete",
    label: "Feature Delete",
    description: "Delete a feature. Its phases are unlinked (featureId cleared) but NOT deleted unless cascade=true.",
    parameters: Type.Object({
      featureId: Type.String({ description: "Feature ref: F00x, shortId, UUID, or name to delete" }),
      cascade: Type.Optional(Type.Boolean({ description: "If true, also delete all phases belonging to this feature. Default: false" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const resolvedFeature = resolveFeatureRefStrict(features, params.featureId);
      if (!resolvedFeature.ok) return { content: [{ type: "text", text: resolvedFeature.error }], details: {} };
      const featureId = resolvedFeature.feature.id;
      let deleted = false;
      await st.updateFeatures((doc) => {
        const before = doc.features.length;
        doc.features = doc.features.filter((f) => f.id !== featureId);
        if (doc.features.length !== before) deleted = true;
        return doc;
      });

      let cascadeCount = 0;
      if (params.cascade) {
        const phases = await st.loadAllPhases();
        for (const phase of phases.filter((p) => p.featureId === featureId)) {
          await st.deletePhase(phase.id);
          cascadeCount += 1;
        }
      }
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Feature deleted: ${params.featureId}${params.cascade ? ` (cascade: ${cascadeCount} phases)` : ""}` }], details: { deleted: params.featureId, cascadedPhases: cascadeCount } };
    },
  });

  // ── phases ──────────────────────────────────────────────────────────

    pi.registerTool({
      name: "phase_list",
      label: "Phase List",
      description: "List phases (compact: F00x/P00x · shortId — title (status; N tasks) [F00x]). Filters: featureRef, status. Cheap discovery — do NOT read .planner/ files or plan_get full=true.",
      parameters: Type.Object({
        featureRef: Type.Optional(Type.String({ description: "Optional: filter to one feature (F00x/shortId/UUID/name)" })),
        status: Type.Optional(Type.String({ description: "Optional: filter by status name" })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const st = await requirePlan(ctx);
        if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
        const features = (await st.loadFeatures()).features;
        let phases = await st.loadAllPhases();
        const fref = params.featureRef?.trim();
        if (fref) {
          const f = features.find((x) => formatFeatureRef(x.number) === fref || x.shortId === fref || x.id === fref || x.name.toLowerCase() === fref.toLowerCase());
          if (!f) return { content: [{ type: "text", text: `Feature not found: ${fref}` }], details: {} };
          phases = phases.filter((p) => p.featureId === f.id);
        }
        if (params.status) phases = phases.filter((p) => p.status === params.status);
        const summary = phases.map((p) => {
          const fNum = featureNumberOfPhase(p, features);
          const fTag = fNum !== undefined ? ` [F${pad(fNum)}]` : "";
          return `- ${formatPhaseRef(p.number, fNum)}${p.shortId ? ` · ${p.shortId}` : ""} — ${p.title} (${p.status}; ${p.tasks.length} tasks)${fTag}`;
        }).join("\n");
        return { content: [{ type: "text", text: summary || "No phases" }], details: {} };
      },
    });

    pi.registerTool({
      name: "phase_get",
      label: "Phase Get",
      description: "Show a phase. Compact identity by default (saves tokens); pass full=true to include the description and derived linked requirements.",
      parameters: Type.Object({
        phaseId: Type.String({ description: "Phase ref: F00x/P00x, bare P00x (global), shortId, UUID, or title" }),
        full: Type.Optional(Type.Boolean({ description: "If true, include the phase description. Default: compact identity only." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const st = await requirePlan(ctx);
        if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
        const features = (await st.loadFeatures()).features;
        const phase = findPhaseByRef(await st.loadAllPhases(), features, params.phaseId.trim());
        if (!phase) return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
        markPhaseRead(phase.id, phase.featureId);
        const linkedRequirements = await st.linkedRequirementsForPhase(phase.id);
        const reqCount = linkedRequirements.length;
        const summary = `${phase.title} — ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, features))}${phase.shortId ? ` · ${phase.shortId}` : ""} (${phase.status}; ${phase.tasks.length} tasks${reqCount ? `; ${reqCount} linked requirement${reqCount === 1 ? "" : "s"}` : ""})`;
        const requirementsBlock = reqCount > 0
          ? `\n\nLinked requirements:\n${linkedRequirements.map((requirement) => `- ${requirement.title} (${requirement.status})`).join("\n")}`
          : "";
        return { content: [{ type: "text", text: params.full ? `${summary}\n\n${phase.description || ""}${requirementsBlock}` : summary }], details: { linkedRequirements } };
      },
    });

  pi.registerTool({
    name: "phase_create",
    label: "Phase Create",
    description: "Create a new phase linked to a feature with a RICH description. REQUIRED: description must include code references (file:line), current implementation state, dependencies, specific files/systems to modify, and behaviors to preserve. The description is the primary context for future agents; one-liners cause misalignment. Status defaults to draft. featureId is required. Once tasks exist, phase status is generally derived from task statuses.",
    parameters: Type.Object({
      title: Type.String({ description: "Phase title" }),
      featureId: Type.String({ description: "Feature ID to link this phase to (required)" }),
      summary: Type.Optional(Type.String({ description: "One-line summary of the phase" })),
      description: Type.String({ description: "REQUIRED — code references (file:line), current state, structs/traits involved, concrete work items, behaviors to preserve. Not a one-liner. Prefix with 'design-only' for pre-implementation design tasks.", minLength: 50 }),
      status: Type.Optional(Type.String({ description: "Initial status. Default: draft. Usually leave this alone: once tasks exist, phase status is derived from task statuses." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const title = params.title?.trim();
      if (!title) return { content: [{ type: "text", text: "title required" }], details: {} };
      if (!params.featureId?.trim()) return { content: [{ type: "text", text: "featureId is required: a phase must belong to a feature." }], details: {} };
      const createPhaseFeatures = (await st.loadFeatures()).features;
      const resolvedFeature = resolveFeatureRefStrict(createPhaseFeatures, params.featureId);
      if (!resolvedFeature.ok) return { content: [{ type: "text", text: resolvedFeature.error }], details: {} };
      const featureId = resolvedFeature.feature.id;
      const featureValidation = await validateResolvedTarget("feature", featureId, () => st.loadFeatures().then((doc) => doc.features.find((f) => f.id === featureId)).catch(() => undefined));
      if (!featureValidation.ok) return { content: [{ type: "text", text: featureValidation.error }], details: {} };
      const existingFeature = (await st.loadFeatures()).features.find((f) => f.id === featureId);
      if (!existingFeature) return { content: [{ type: "text", text: `Resolved feature ${featureId} no longer exists. Refusing to create phase.` }], details: {} };
      let phase: Phase | undefined;
      await withFeatureLock(featureId, async () => {
        const id = createPhaseId();
        const identity = await st.allocateEntityIdentity("phase", id);
        const priority = await st.nextPriority("phase", featureId);
        const now = nowISO();
        phase = {
          id, number: identity.number, shortId: identity.shortId, priority, slug: normalizeSlug(title), title,
          featureId,
          status: (params.status as Phase["status"] | undefined) ?? "draft",
          discussedAt: "",
          contextReady: false,
          contextReadyReason: "",
          summary: params.summary ?? "", description: params.description ?? "", descriptionUpdatedAt: now, notes: "",
          goals: [], nonGoals: [], dependencies: [], dependsOn: [], risks: [],
          openQuestions: [], decisions: [], acceptedDecisions: [], completionCriteria: [], taskIds: [], tasks: [],
          createdAt: now, updatedAt: now,
          handoff: "", handoffUpdatedAt: "",
          handoffReadAt: "",
          handoffHistory: [],
          statusLog: [],
        };
        await st.savePhase(phase);

        // Atomic: serialize concurrent phase_create linking to the same feature.
        await st.updateFeatures((doc) => {
          const feature = doc.features.find((f) => f.id === featureId);
          if (feature && !feature.phaseIds.includes(phase!.id)) {
            feature.phaseIds.push(phase!.id);
            feature.updatedAt = now;
          }
          return doc;
        });
        await st.writeGenerated();
      });
      if (!phase) return { content: [{ type: "text", text: "Phase creation failed." }], details: {} };
      const phaseCreateFeatures = (await st.loadFeatures()).features;
        return { content: [{ type: "text", text: `✅ Phase created: ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, phaseCreateFeatures))} — ${phase.title}${phase.shortId ? ` · ${phase.shortId}` : ""}` }], details: phase };
    },
  });

  pi.registerTool({
    name: "phase_update",
    label: "Phase Update",
    description: "Update one or more fields of a phase. Only provided fields are changed. Supports re-linking to a feature via featureId. IMPORTANT: phase status is derived from task statuses, so do not update phase.status directly unless truly necessary.",
    parameters: Type.Object({
      phaseId: Type.String({ description: "Phase ref: F00x/P00x, bare P00x (global), shortId, UUID, or title" }),
      title: Type.Optional(Type.String({ description: "New title" })),
      status: Type.Optional(Type.String({ description: "New status: draft|discovery|planned|in-progress|done|blocked|canceled. Avoid setting this directly unless you truly need an override: phase status is derived from task statuses." })),
      summary: Type.Optional(Type.String({ description: "New summary" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      featureId: Type.Optional(Type.String({ description: "Link/unlink phase to a feature. Use empty string to unlink." })),
      priority: Type.Optional(Type.Number({ description: "Display order within the feature (lower = higher)" })),
      goals: Type.Optional(Type.Array(Type.String(), { description: "Replace goals list" })),
      nonGoals: Type.Optional(Type.Array(Type.String(), { description: "Replace non-goals list" })),
      dependencies: Type.Optional(Type.Array(Type.String(), { description: "Replace dependencies list" })),
      risks: Type.Optional(Type.Array(Type.String(), { description: "Replace risks list" })),
      openQuestions: Type.Optional(Type.Array(Type.String(), { description: "Replace open questions list" })),
      decisions: Type.Optional(Type.Array(Type.String(), { description: "Replace decisions list" })),
      acceptedDecisions: Type.Optional(Type.Array(Type.Object({
        id: Type.String(),
        title: Type.String(),
        decision: Type.String(),
        rationale: Type.String(),
        implementationNotes: Type.String(),
        acceptedAt: Type.String(),
      }), { description: "Replace accepted decisions list" })),
      completionCriteria: Type.Optional(Type.Array(Type.String(), { description: "Replace completion criteria list" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const resolvedPhase = findPhaseByRef(await st.loadAllPhases(), features, params.phaseId.trim());
      if (!resolvedPhase) return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      const phaseId = resolvedPhase.id;
      let phase: Phase;
      try {
        phase = await st.loadPhase(phaseId);
      } catch {
        return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      }

      const prevFeatureId = phase.featureId;
      let nextFeatureIdForUpdate = prevFeatureId;
      if (params.title !== undefined) { phase.title = params.title; phase.slug = normalizeSlug(params.title); }
      if (params.status !== undefined) phase.status = params.status as Phase["status"];
      if (params.summary !== undefined) phase.summary = params.summary;
      if (params.description !== undefined) phase.description = params.description;
      if (params.priority !== undefined) phase.priority = params.priority;
      if (params.goals !== undefined) phase.goals = params.goals;
      if (params.nonGoals !== undefined) phase.nonGoals = params.nonGoals;
      if (params.dependencies !== undefined) phase.dependencies = params.dependencies;
      if (params.risks !== undefined) phase.risks = params.risks;
      if (params.openQuestions !== undefined) phase.openQuestions = params.openQuestions;
      if (params.decisions !== undefined) phase.decisions = params.decisions;
      if (params.acceptedDecisions !== undefined) phase.acceptedDecisions = params.acceptedDecisions;
      if (params.completionCriteria !== undefined) phase.completionCriteria = params.completionCriteria;

      if (params.featureId !== undefined) {
        if (params.featureId === "") {
          nextFeatureIdForUpdate = undefined;
        } else {
          const resolvedFeature = resolveFeatureRefStrict(features, params.featureId);
          if (!resolvedFeature.ok) return { content: [{ type: "text", text: resolvedFeature.error }], details: {} };
          nextFeatureIdForUpdate = resolvedFeature.feature.id;
        }
        phase.featureId = nextFeatureIdForUpdate;
        if (nextFeatureIdForUpdate !== prevFeatureId) {
          await st.updateFeatures((doc) => {
            for (const f of doc.features) {
              if (f.id === prevFeatureId) f.phaseIds = f.phaseIds.filter((pid) => pid !== phase.id);
              if (f.id === nextFeatureIdForUpdate && !f.phaseIds.includes(phase.id)) f.phaseIds.push(phase.id);
            }
            return doc;
          });
        }
      }

      phase.updatedAt = nowISO();
      await st.savePhase(phase);
      await st.writeGenerated();
      const phaseUpdateFeatures = (await st.loadFeatures()).features;
        return { content: [{ type: "text", text: `✅ Phase updated: ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, phaseUpdateFeatures))} — ${phase.title}${phase.shortId ? ` · ${phase.shortId}` : ""}` }], details: phase };
    },
  });

  pi.registerTool({
    name: "decision_record",
    label: "Decision Record",
    description: "Record a user-agreed decision on both a feature and one of its phases. This is planner metadata work, not a code edit. The decision is appended without overwriting existing history.",
    parameters: Type.Object({
      featureId: Type.String({ description: "Parent feature ref: F00x, shortId, UUID, or name" }),
      phaseId: Type.String({ description: "Active phase ref: P00x, shortId, UUID, or title" }),
      title: Type.String({ minLength: 1, description: "Short human-readable decision title" }),
      decision: Type.String({ minLength: 1, description: "The agreed decision" }),
      rationale: Type.String({ minLength: 1, description: "Why the decision was made" }),
      implementationNotes: Type.String({ minLength: 1, description: "Concrete follow-up or preservation notes" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const resolvedFeature = resolveFeatureRefStrict(features, params.featureId);
      if (!resolvedFeature.ok) return { content: [{ type: "text", text: resolvedFeature.error }], details: {} };
      const resolvedPhase = findPhaseByRef(await st.loadAllPhases(), features, params.phaseId);
      if (!resolvedPhase) return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      if (resolvedPhase.featureId !== resolvedFeature.feature.id) {
        return { content: [{ type: "text", text: `Phase ${formatPhaseRef(resolvedPhase.number, featureNumberOfPhase(resolvedPhase, features))} does not belong to feature ${formatFeatureRef(resolvedFeature.feature.number)}.` }], details: {} };
      }
      const acceptedAt = nowISO();
      const acceptedDecision: AcceptedDecision = {
        id: crypto.randomUUID(),
        title: params.title.trim(),
        decision: params.decision.trim(),
        rationale: params.rationale.trim(),
        implementationNotes: params.implementationNotes.trim(),
        acceptedAt,
      };
      await withFeatureLock(resolvedFeature.feature.id, async () => {
        let featureWritten = false;
        try {
          await st.updateFeatures((doc) => {
            const feature = doc.features.find((entry) => entry.id === resolvedFeature.feature.id);
            if (!feature) throw new Error(`Resolved feature no longer exists: ${resolvedFeature.feature.id}`);
            feature.acceptedDecisions = [...(feature.acceptedDecisions ?? []), acceptedDecision];
            feature.updatedAt = acceptedAt;
            return doc;
          });
          featureWritten = true;
          await st.updatePhase(resolvedPhase.id, (phase) => {
            phase.acceptedDecisions = [...(phase.acceptedDecisions ?? []), acceptedDecision];
            phase.updatedAt = acceptedAt;
            return phase;
          });
        } catch (error) {
          // Best-effort compensation keeps a failed dual-write from reporting
          // success with a decision persisted only on the feature.
          if (featureWritten) {
            await st.updateFeatures((doc) => {
              const feature = doc.features.find((entry) => entry.id === resolvedFeature.feature.id);
              if (feature) feature.acceptedDecisions = (feature.acceptedDecisions ?? []).filter((entry) => entry.id !== acceptedDecision.id);
              return doc;
            }).catch(() => {});
          }
          throw error;
        }
      });
      await st.writeGenerated();
      return { content: [{ type: "text", text: `✅ Decision recorded on ${formatFeatureRef(resolvedFeature.feature.number)} and ${formatPhaseRef(resolvedPhase.number, resolvedFeature.feature.number)}: ${acceptedDecision.title}` }], details: acceptedDecision };
    },
  });

  pi.registerTool({
    name: "phase_delete",
    label: "Phase Delete",
    description: "Delete a phase. Its tasks are deleted with it (cascade). Unlinks the phase from its feature.",
    parameters: Type.Object({
      phaseId: Type.String({ description: "Phase ref: F00x/P00x, bare P00x (global), shortId, UUID, or title to delete" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const resolvedPhase = findPhaseByRef(await st.loadAllPhases(), features, params.phaseId.trim());
      if (!resolvedPhase) return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      const phaseId = resolvedPhase.id;
      let phase: Phase | undefined;
      try {
        phase = await st.loadPhase(phaseId);
      } catch {
        return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      }
      await st.deletePhase(phaseId);
      if (phase.featureId) {
        await st.updateFeatures((doc) => {
          const feature = doc.features.find((f) => f.id === phase!.featureId);
          if (feature) {
            feature.phaseIds = feature.phaseIds.filter((pid) => pid !== phaseId);
            feature.updatedAt = nowISO();
          }
          return doc;
        });
      }
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Phase deleted: ${params.phaseId}` }], details: { deleted: params.phaseId } };
    },
  });

  // ── tasks ───────────────────────────────────────────────────────────

    pi.registerTool({
      name: "task_list",
      label: "Task List",
      description: "List tasks (compact: F00x/P00x/T00x · shortId — title (status)). Filters: featureRef, phaseRef, status. Omit all to list every task. Cheap discovery — do NOT read .planner/ files or plan_get full=true.",
      parameters: Type.Object({
        featureRef: Type.Optional(Type.String({})),
        phaseRef: Type.Optional(Type.String({})),
        status: Type.Optional(Type.String({ description: "Optional: filter by status name" })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const st = await requirePlan(ctx);
        if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
        const features = (await st.loadFeatures()).features;
        let phases = await st.loadAllPhases();
        const fref = params.featureRef?.trim();
        if (fref) {
          const f = features.find((x) => formatFeatureRef(x.number) === fref || x.shortId === fref || x.id === fref || x.name.toLowerCase() === fref.toLowerCase());
          if (!f) return { content: [{ type: "text", text: `Feature not found: ${fref}` }], details: {} };
          phases = phases.filter((p) => p.featureId === f.id);
        }
        const pref = params.phaseRef?.trim();
        if (pref) {
          const p = findPhaseByRef(phases, features, pref);
          if (!p) return { content: [{ type: "text", text: `Phase not found: ${pref}` }], details: {} };
          phases = [p];
        }
        const out: string[] = [];
        for (const phase of phases) {
          for (const task of phase.tasks) {
            if (params.status && task.status !== params.status) continue;
            out.push(`- ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, features))}/T${pad(task.number)}${task.shortId ? ` · ${task.shortId}` : ""} — ${task.title} (${task.status})`);
          }
        }
        return { content: [{ type: "text", text: out.join("\n") || "No tasks" }], details: {} };
      },
    });

    pi.registerTool({
      name: "task_get",
      label: "Task Get",
      description: "Show a task. Compact identity by default (saves tokens); pass full=true to include the description, resume checkpoint/advisory, and statusLog.",
      parameters: Type.Object({
        taskId: Type.String({ description: "Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title" }),
        full: Type.Optional(Type.Boolean({ description: "If true, include the task description, resume checkpoint/advisory, and statusLog. Default: compact identity only." })),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const st = await requirePlan(ctx);
        if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
        const features = (await st.loadFeatures()).features;
        const found = findTaskByRef(await st.loadAllPhases(), features, params.taskId.trim());
        if (!found) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
        markTaskRead(found.task.id, found.phase.id, found.phase.featureId);
        const summary = `${found.task.title} — ${formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features))}/T${pad(found.task.number)}${found.task.shortId ? ` · ${found.task.shortId}` : ""} (${found.task.status})`;
        if (!params.full) return { content: [{ type: "text", text: summary }], details: {} };
        const project = await st.loadProject();
        const pendingDeviation = found.task.status === "done" || found.task.status === "canceled" || found.task.status === "rejected"
          ? undefined
          : project.workDeviations
            .filter((deviation) => deviation.resumeTaskId === found.task.id
              && (deviation.state === "resume-required" || deviation.state === "resolved"))
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        const snapshot = found.task.pauseSnapshot ?? pendingDeviation?.snapshot ?? null;
        const log = (found.task.statusLog ?? []).map((e) => `  - ${e.date.slice(0,10)} ${e.title}`).join("\n");
        const sections = [summary];
        if (found.task.description?.trim()) sections.push(found.task.description.trim());
        if (snapshot || pendingDeviation) {
          sections.push([
            pendingDeviation
              ? "Resume advisory: this task has a saved checkpoint that should be evaluated before selecting other work."
              : "Resume checkpoint:",
            snapshot ? `Checkpoint reason: ${snapshot.reason}` : "",
            snapshot ? `Work checkpoint: ${snapshot.whatWasBeingDone}` : "",
            snapshot ? `Resume from: ${snapshot.resumeLocation}` : "",
            snapshot ? `How to resume: ${snapshot.howToResume}` : "",
          ].filter(Boolean).join("\n"));
        }
        if (log) sections.push(`Status log:\n${log}`);
        return { content: [{ type: "text", text: sections.join("\n\n") }], details: {} };
      },
    });

  pi.registerTool({
    name: "task_create",
    label: "Task Create",
    description: "Add a task to a phase with a RICH description. REQUIRED: description must include code references (file:line), what already exists vs what needs to be built, specific structs/traits/systems to modify, concrete implementation steps, and edge cases to handle. The description is the execution context for agents; one-liners cause misalignment. Status defaults to planned.",
    parameters: Type.Object({
      featureId: Type.String({ description: "Feature ID the phase belongs to (required)" }),
      phaseId: Type.String({ description: "Phase ID the task belongs to" }),
      title: Type.String({ description: "Task title" }),
      description: Type.String({ description: "REQUIRED — execution context: code references (file:line), current state vs desired state, structs/traits to modify, concrete implementation steps, edge cases. Not a one-liner. Prefix with 'design-only' for pre-implementation design tasks.", minLength: 50 }),
      status: Type.Optional(Type.String({ description: "Initial status. Default: planned" })),
      shortName: Type.Optional(Type.String({ description: "Short slug for the task id. Auto-derived from title if omitted." })),
      checklist: Type.Optional(Type.Array(Type.String(), { description: "Initial checklist items (plain strings). Seeded as C1, C2, … (unchecked)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const title = params.title?.trim();
      if (!title) return { content: [{ type: "text", text: "title required" }], details: {} };
      if (!params.featureId?.trim()) return { content: [{ type: "text", text: "featureId is required: a task must belong to a feature." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const resolvedFeature = resolveFeatureRefStrict(features, params.featureId.trim());
      if (!resolvedFeature.ok) return { content: [{ type: "text", text: resolvedFeature.error }], details: {} };
      const featureValidation = await validateResolvedTarget("feature", resolvedFeature.feature.id, () => st.loadFeatures().then((doc) => doc.features.find((f) => f.id === resolvedFeature.feature.id)).catch(() => undefined));
      if (!featureValidation.ok) return { content: [{ type: "text", text: featureValidation.error }], details: {} };
      const feature = resolvedFeature.feature;
      const existingFeature = features.find((f) => f.id === feature.id);
      if (!existingFeature) return { content: [{ type: "text", text: `Resolved feature ${feature.id} no longer exists. Refusing to create task.` }], details: {} };
      // Resolve the phase ref (accepts F00x/P00x, bare P00x, shortId, UUID, title).
      const resolvedPhase = findPhaseByRef(await st.loadAllPhases(), features, params.phaseId.trim());
      if (!resolvedPhase) return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      if (resolvedPhase.featureId !== feature.id) return { content: [{ type: "text", text: `Phase ${formatPhaseRef(resolvedPhase.number, featureNumberOfPhase(resolvedPhase, features))} does not belong to feature ${formatFeatureRef(feature.number)}. Refusing to create task.` }], details: {} };
      const phaseId = resolvedPhase.id;
      const phaseValidation = await validateResolvedTarget("phase", phaseId, () => st.loadPhase(phaseId).catch(() => undefined));
      if (!phaseValidation.ok) return { content: [{ type: "text", text: phaseValidation.error }], details: {} };
      const existingPhase = await st.loadPhase(phaseId);
      if (!existingPhase) return { content: [{ type: "text", text: `Resolved phase ${phaseId} no longer exists. Refusing to create task.` }], details: {} };
      const shortName = clampSlug(params.shortName ?? title, 30, `task-${Date.now().toString(36)}`); // clamp+strip trailing dash; never empty
      const taskId = createTaskId();
      const identity = await st.allocateEntityIdentity("task", taskId);
      const priority = await st.nextPriority("task", phaseId);
      const now = nowISO();
      const initialStatus = (params.status as Task["status"] | undefined) ?? "planned";
      if ((initialStatus as string) === "paused") {
        return { content: [{ type: "text", text: "A task cannot be created paused without an in-progress checkpoint. Create it planned, then use task_pause/task_switch." }], details: {} };
      }
      const task: Task = {
        id: taskId, phaseId, number: identity.number, shortId: identity.shortId, priority, shortName,
        title,
        status: initialStatus,
        description: params.description ?? "",
        descriptionUpdatedAt: now,
        notes: "",
        statusLog: [],
        decisions: [],
        acceptedDecisions: [],
        checklist: params.checklist
          ? params.checklist.map((itemTitle, index) => ({ number: index + 1, id: createChecklistItemId(taskId, index + 1, itemTitle), title: itemTitle, checked: false }))
          : [],
        subtasks: [],
        dependsOn: [],
        pauseSnapshot: null,
        pauseHistory: [],
        startedAt: initialStatus === "in-progress" || initialStatus === "done" ? now : "",
        completedAt: initialStatus === "done" ? now : "",
        createdAt: now, updatedAt: now,
      };
      // Atomic read-modify-write on the phase file: serializes concurrent
      // task_create calls on the SAME phaseId (batch) so tasks don't get lost.
      await st.updatePhase(phaseId, (phase) => {
        phase.tasks.push(task);
        phase.taskIds.push(taskId);
        phase.updatedAt = now;
        return phase;
      });
      await st.writeGenerated();
      const taskRef = `${formatPhaseRef(resolvedPhase.number, feature.number)}/T${String(task.number).padStart(3, "0")}`;
      return { content: [{ type: "text", text: `Task created: ${taskRef} — ${task.title}${task.shortId ? ` · ${task.shortId}` : ""}` }], details: task };
    },
  });

  pi.registerTool({
    name: "task_update",
    label: "Task Update",
    description: "Update one or more fields of a task. Only provided fields are changed. Do NOT use this tool to start or complete work; use task_start and task_complete for lifecycle transitions so startedAt/completedAt stay correct.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title" }),
      title: Type.Optional(Type.String({ description: "New title" })),
      status: Type.Optional(Type.String({ description: "New status: planned|in-progress|done|blocked|canceled|rejected|deferred|waiting" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      notes: Type.Optional(Type.String({ description: "New implementation notes" })),
      motivation: Type.Optional(Type.String({ description: "Motivation for status change. REQUIRED when changing to blocked, canceled, rejected, deferred, waiting, or back to planned from another status." })),
      decisions: Type.Optional(Type.Array(Type.String(), { description: "Replace decisions list" })),
      acceptedDecisions: Type.Optional(Type.Array(Type.Object({
        id: Type.String(),
        title: Type.String(),
        decision: Type.String(),
        rationale: Type.String(),
        implementationNotes: Type.String(),
        acceptedAt: Type.String(),
      }), { description: "Replace accepted decisions list" })),
      priority: Type.Optional(Type.Number({ description: "Display order within the phase (lower = higher)" })),
      checklist: Type.Optional(Type.Array(Type.String(), { description: "Replace checklist (plain strings). For interactive toggling use the web UI." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      // Find the phase hosting this task first.
      const features = (await st.loadFeatures()).features;
      const found = findTaskByRef(await st.loadAllPhases(), features, params.taskId.trim());
      if (!found) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      const hostPhase = found.phase;
      const now = nowISO();
      let updatedTask: Task | undefined;
      // Validate the motivation requirement for restrictive status transitions,
      // mirroring the MCP adapter and the /planner task update command
      // (AGENTS.md rule 8 — rejected writes must leave the files unchanged).
      if (found.task.pauseSnapshot && params.status === "in-progress" && params.status !== found.task.status) {
        return {
          content: [{ type: "text", text: "Resume checkpoint lifecycle transitions require task_start so the checkpoint and return stack remain consistent." }],
          details: {},
        };
      }
      if (
        params.status !== undefined &&
        params.status !== found.task.status &&
        needsMotivation(found.task.status, params.status)
      ) {
        if (!params.motivation || !params.motivation.trim()) {
          return {
            content: [{ type: "text", text: `Status transition "${found.task.status} → ${params.status}" requires a motivation. Provide the "motivation" parameter with a detailed explanation of why this change is needed.` }],
            details: {},
          };
        }
      }
      try {
        const updatedPhase = await st.updatePhase(hostPhase.id, (phase) => {
          const task = phase.tasks.find((t) => t.id === found.task.id);
          if (!task) return phase;
          if (params.title !== undefined) task.title = params.title;
          if (params.priority !== undefined) task.priority = params.priority;
          if (params.description !== undefined) task.description = params.description;
          if (params.notes !== undefined) task.notes = params.notes;
          if (params.decisions !== undefined) task.decisions = params.decisions;
          if (params.acceptedDecisions !== undefined) task.acceptedDecisions = params.acceptedDecisions;
          if (params.checklist !== undefined) {
            task.checklist = params.checklist.map((itemTitle, index) => ({ number: index + 1,
              id: createChecklistItemId(task.id, index + 1, itemTitle),
              title: itemTitle,
              checked: false,
            }));
          }
          if (params.status !== undefined) {
            if (params.status !== task.status) {
              const entry: StatusLogEntry = {
                id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${task.status}-${params.status}`),
                date: now,
                fromStatus: task.status as any,
                toStatus: params.status as any,
                title: params.motivation?.split("\n")[0]?.trim() || `${task.status} → ${params.status}`,
                description: params.motivation?.trim() || "",
              };
              task.statusLog = [...(task.statusLog ?? []), entry];
            }
            applyTaskLifecycleDates(task, params.status as Task["status"], now);
          }
          task.updatedAt = now;
          phase.updatedAt = now;
          updatedTask = task;
          return phase;
        });
        void updatedPhase;
      } catch (e) {
        return { content: [{ type: "text", text: `Update failed: ${e}` }], details: {} };
      }
      if (!updatedTask) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      await st.syncTaskStatusRollup(found.phase.id);
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Task updated: ${updatedTask.id} (${updatedTask.status})` }], details: updatedTask };
    },
  });

  pi.registerTool({
    name: "task_delete",
    label: "Task Delete",
    description: "Delete a task from its phase.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title to delete" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const found = findTaskByRef(await st.loadAllPhases(), features, params.taskId.trim());
      if (!found) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      await st.updatePhase(found.phase.id, (phase) => {
        phase.tasks = phase.tasks.filter((t: Task) => t.id !== found.task.id);
        phase.taskIds = phase.taskIds.filter((id: string) => id !== found.task.id);
        phase.updatedAt = nowISO();
        return phase;
      });
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Task deleted: ${params.taskId}` }], details: { deleted: params.taskId } };
    },
  });

  // ── task start / complete tools ──────────────────────────────────

  pi.registerTool({
    name: "task_recommend",
    label: "Task Recommend",
    description: "Return the recommended next task without starting work: continue one active task, otherwise choose ready work by feature → phase → task priority. Reports approved deviation/resume context and never blocks an explicit user choice.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const [features, phases, project] = await Promise.all([st.loadFeatures(), st.loadAllPhases(), st.loadProject()]);
      const result = recommendNextTask(features.features, phases, project.workDeviations);
      if (!result.candidate) return { content: [{ type: "text", text: `No task recommendation: ${result.reason}` }], details: result };
      const { candidate } = result;
      const reference = `${formatPhaseRef(candidate.phase.number, featureNumberOfPhase(candidate.phase, features.features))}/T${String(candidate.task.number).padStart(3, "0")}`;
      return {
        content: [{ type: "text", text: `Recommended (${result.kind}): ${reference} — ${candidate.task.title}\n${result.reason}${result.deviation ? `\nDeviation: ${result.deviation.id}; resume target ${result.deviation.resumeTaskId}.` : ""}` }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "task_deviation",
    label: "Task Deviation",
    description: "Record a user-approved temporary task deviation. It preserves the recommended/resume task but never starts, pauses, or blocks work; use normal task lifecycle tools for those transitions.",
    parameters: Type.Object({
      temporary_task: Type.String({ description: "Temporary task ref" }),
      resume_task: Type.Optional(Type.String({ description: "Task to resume; defaults to the current recommendation" })),
      reason: Type.String({ description: "Why this approved temporary deviation is needed" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const [features, phases, project] = await Promise.all([st.loadFeatures(), st.loadAllPhases(), st.loadProject()]);
      const temporary = findTaskByRef(phases, features.features, params.temporary_task.trim());
      if (!temporary) return { content: [{ type: "text", text: `Task not found: ${params.temporary_task}` }], details: {} };
      const selected = recommendNextTask(features.features, phases, project.workDeviations);
      const resume = params.resume_task ? findTaskByRef(phases, features.features, params.resume_task.trim()) : selected.candidate;
      if (!resume) return { content: [{ type: "text", text: `No resume task is available. Provide resume_task explicitly. ${selected.reason}` }], details: selected };
      if (temporary.task.id === resume.task.id) return { content: [{ type: "text", text: "A temporary task must differ from its resume target." }], details: {} };
      if (temporary.task.status !== "planned") return { content: [{ type: "text", text: `Temporary task is not startable: ${temporary.task.status}.` }], details: {} };
      const timestamp = nowISO();
      const record = {
        id: crypto.randomUUID(), recommendedTaskId: selected.candidate?.task.id ?? resume.task.id,
        temporaryTaskId: temporary.task.id, resumeTaskId: resume.task.id, reason: params.reason, snapshot: null,
        requestedBy: "user" as const, approvedBy: "user", state: "approved" as const,
        createdAt: timestamp, activatedAt: "", resumeRequiredAt: "", resolvedAt: "", resumedAt: "",
      };
      await st.addWorkDeviation(record);
      await st.writeGenerated();
      const tempRef = `${formatPhaseRef(temporary.phase.number, featureNumberOfPhase(temporary.phase, features.features))}/T${String(temporary.task.number).padStart(3, "0")}`;
      const resumeRef = `${formatPhaseRef(resume.phase.number, featureNumberOfPhase(resume.phase, features.features))}/T${String(resume.task.number).padStart(3, "0")}`;
      return { content: [{ type: "text", text: `✅ Approved deviation: ${tempRef} temporarily overrides ${resumeRef}. Resume target retained.` }], details: { deviation: record } };
    },
  });

  pi.registerTool({
    name: "task_pause",
    label: "Task Pause",
    description: "Pause an in-progress task with a mandatory durable checkpoint: why work stopped, what was underway, the exact resume location, and how to continue.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ref to pause" }),
      reason: Type.String({ description: "Why work is being paused" }),
      what_was_being_done: Type.String({ description: "Concrete work underway at the checkpoint" }),
      resume_location: Type.String({ description: "Exact file, symbol, command, or location from which to continue" }),
      how_to_resume: Type.String({ description: "Actionable instructions for resuming" }),
      paused_by: Type.Optional(Type.String({ description: "Agent/session identifier" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const found = findTaskByRef(await st.loadAllPhases(), features, params.taskId.trim());
      if (!found) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      if (found.task.status !== "in-progress") return { content: [{ type: "text", text: `Task pause denied: task is ${found.task.status}, not in-progress.` }], details: found.task };
      const snapshot = {
        id: crypto.randomUUID(), reason: params.reason.trim(), whatWasBeingDone: params.what_was_being_done.trim(),
        resumeLocation: params.resume_location.trim(), howToResume: params.how_to_resume.trim(), relatedTaskId: "",
        pausedAt: nowISO(), pausedBy: params.paused_by?.trim() ?? "",
      };
      invalidateReads();
      const checkpointed = await st.pauseTask(found.phase.id, found.task.id, snapshot);
      await st.syncTaskStatusRollup(found.phase.id);
      const activeDeviation = (await st.loadProject()).workDeviations
        .filter((deviation) => (deviation.state === "approved" || deviation.state === "active")
          && deviation.temporaryTaskId === found.task.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (activeDeviation) await st.setWorkDeviationState(activeDeviation.id, "resume-required", snapshot.pausedAt);
      const resume = activeDeviation
        ? findTaskByRef(await st.loadAllPhases(), features, activeDeviation.resumeTaskId)
        : undefined;
      await st.writeGenerated();
      const reference = `${formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features))}/T${String(checkpointed.number).padStart(3, "0")}`;
      const resumeRef = resume
        ? `${formatPhaseRef(resume.phase.number, featureNumberOfPhase(resume.phase, features))}/T${String(resume.task.number).padStart(3, "0")}`
        : "";
      return {
        content: [{ type: "text", text: [
          `💾 Resume checkpoint saved: ${reference} — ${checkpointed.title}`,
          `Why: ${snapshot.reason}`,
          `Checkpoint: ${snapshot.whatWasBeingDone}`,
          `Resume from: ${snapshot.resumeLocation}`,
          `How to resume: ${snapshot.howToResume}`,
          resume ? `↩️ RESUME REQUIRED: ${resumeRef} — ${resume.task.title}` : "",
        ].filter(Boolean).join("\n") }],
        details: { task: checkpointed, snapshot, ...(resume ? { resumeRequired: { taskId: resume.task.id } } : {}) },
      };
    },
  });

  pi.registerTool({
    name: "task_switch",
    label: "Task Switch",
    description: "Switch from active work to a temporary task, even outside priority order. Atomically snapshots/pauses the source, starts the target, and pushes a durable LIFO return target.",
    parameters: Type.Object({
      from_task: Type.String({ description: "Currently in-progress task ref" }),
      to_task: Type.String({ description: "Temporary task ref to start" }),
      reason: Type.String({ description: "Why this temporary switch is necessary" }),
      what_was_being_done: Type.String({ description: "Concrete work underway in the source task" }),
      resume_location: Type.String({ description: "Exact source resume location" }),
      how_to_resume: Type.String({ description: "Actionable source resume instructions" }),
      switched_by: Type.Optional(Type.String({ description: "Agent/session identifier" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const [featuresDoc, phases, project] = await Promise.all([st.loadFeatures(), st.loadAllPhases(), st.loadProject()]);
      const features = featuresDoc.features;
      const source = findTaskByRef(phases, features, params.from_task.trim());
      const target = findTaskByRef(phases, features, params.to_task.trim());
      if (!source) return { content: [{ type: "text", text: `Task not found: ${params.from_task}` }], details: {} };
      if (!target) return { content: [{ type: "text", text: `Task not found: ${params.to_task}` }], details: {} };
      if (source.task.id === target.task.id) return { content: [{ type: "text", text: "Source and temporary task must differ." }], details: {} };
      if (source.task.status !== "in-progress" && !source.task.pauseSnapshot) {
        return { content: [{ type: "text", text: `Task switch denied: source is ${source.task.status}; only in-progress or checkpointed work can be switched.` }], details: {} };
      }
      const eligibility = checkExplicitTaskStart(features, phases, target.task.id, project.workDeviations);
      if (!eligibility.eligible) return { content: [{ type: "text", text: `Task switch denied: ${eligibility.reason}` }], details: eligibility };

      const timestamp = nowISO();
      const snapshot = {
        id: crypto.randomUUID(), reason: params.reason.trim(), whatWasBeingDone: params.what_was_being_done.trim(),
        resumeLocation: params.resume_location.trim(), howToResume: params.how_to_resume.trim(),
        relatedTaskId: target.task.id, pausedAt: timestamp, pausedBy: params.switched_by?.trim() ?? "",
      };
      const selection = recommendNextTask(features, phases, project.workDeviations);
      const record = {
        id: crypto.randomUUID(), recommendedTaskId: selection.candidate?.task.id ?? source.task.id,
        temporaryTaskId: target.task.id, resumeTaskId: source.task.id, reason: snapshot.reason, snapshot,
        requestedBy: "agent" as const, approvedBy: params.switched_by?.trim() || "explicit task_switch",
        state: "active" as const, createdAt: timestamp, activatedAt: timestamp,
        resumeRequiredAt: "", resolvedAt: "", resumedAt: "",
      };
      const sourceWasActive = source.task.status === "in-progress";
      let sourceCheckpointed = false;
      let targetStarted = false;
      try {
        if (sourceWasActive) {
          await st.pauseTask(source.phase.id, source.task.id, snapshot);
        } else {
          await st.updatePhase(source.phase.id, (phase) => {
            const task = phase.tasks.find((entry) => entry.id === source.task.id);
            if (!task) throw new Error(`Checkpointed source task disappeared: ${params.from_task}`);
            task.pauseSnapshot = snapshot;
            task.pauseHistory = [...task.pauseHistory, snapshot];
            task.updatedAt = timestamp;
            return phase;
          });
        }
        sourceCheckpointed = true;
        if (target.task.pauseSnapshot) {
          await st.resumeTask(target.phase.id, target.task.id, timestamp);
        } else {
          await st.updatePhase(target.phase.id, (phase) => {
            const task = phase.tasks.find((entry) => entry.id === target.task.id);
            if (!task) throw new Error(`Temporary task disappeared: ${params.to_task}`);
            const previousStatus = task.status;
            applyTaskLifecycleDates(task, "in-progress", timestamp);
            task.statusLog = [...task.statusLog, {
              id: createChecklistItemId(task.id, task.statusLog.length + 1, `${previousStatus}-in-progress`),
              date: timestamp, fromStatus: previousStatus, toStatus: "in-progress",
              title: `${previousStatus} → in-progress`, description: `Temporary switch from ${source.task.title}.`,
            }];
            task.updatedAt = timestamp;
            phase.updatedAt = timestamp;
            return phase;
          });
        }
        targetStarted = true;
        await st.addWorkDeviation(record);
        if (target.task.pauseSnapshot) {
          const resumedDeviation = project.workDeviations
            .filter((deviation) => deviation.resumeTaskId === target.task.id
              && (deviation.state === "resume-required" || deviation.state === "resolved"))
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
          if (resumedDeviation) await st.setWorkDeviationState(resumedDeviation.id, "resumed", timestamp);
        }
      } catch (error) {
        if (targetStarted) {
          await st.updatePhase(target.phase.id, (phase) => {
            phase.tasks = phase.tasks.map((task) => task.id === target.task.id ? target.task : task);
            return phase;
          }).catch(() => {});
        }
        if (sourceCheckpointed) {
          if (sourceWasActive) await st.resumeTask(source.phase.id, source.task.id, nowISO()).catch(() => {});
          else await st.updatePhase(source.phase.id, (phase) => {
            phase.tasks = phase.tasks.map((task) => task.id === source.task.id ? source.task : task);
            return phase;
          }).catch(() => {});
        }
        throw error;
      }
      await st.syncTaskStatusRollup(source.phase.id);
      if (target.phase.id !== source.phase.id) await st.syncTaskStatusRollup(target.phase.id);
      await st.writeGenerated();
      const sourceRef = `${formatPhaseRef(source.phase.number, featureNumberOfPhase(source.phase, features))}/T${String(source.task.number).padStart(3, "0")}`;
      const targetRef = `${formatPhaseRef(target.phase.number, featureNumberOfPhase(target.phase, features))}/T${String(target.task.number).padStart(3, "0")}`;
      const targetReadAdvisory = parentReadAdvisory(target.phase.featureId, target.phase.id);
      const targetRequirementAdvisory = requirementReadAdvisory([
        ...(await st.linkedRequirementsForPhase(target.phase.id)).map((r) => r.id),
        ...(target.phase.featureId ? (await st.linkedRequirementsForFeature(target.phase.featureId)).map((r) => r.id) : []),
      ]);
      return {
        content: [{ type: "text", text: [
          `🔀 Task switched: ${sourceRef} → ${targetRef}`,
          `Resume checkpoint: ${snapshot.whatWasBeingDone}`,
          `Return target: ${sourceRef} from ${snapshot.resumeLocation}`,
          "Normal priority was deliberately overridden; completing the temporary task will emit RESUME REQUIRED.",
          ...(targetReadAdvisory ? [targetReadAdvisory.trimStart()] : []),
          ...(targetRequirementAdvisory ? [targetRequirementAdvisory.trimStart()] : []),
        ].join("\n") }],
        details: { deviation: record, snapshot, resumeTaskId: source.task.id, temporaryTaskId: target.task.id, ...(targetReadAdvisory || targetRequirementAdvisory ? { readRequired: true } : {}) },
      };
    },
  });

  pi.registerTool({
    name: "task_start",
    label: "Task Start",
    description: "Set a task to in-progress or resume checkpointed work. BEFORE calling, read feature_get(full=true), phase_get(full=true), then task_get(full=true). A different active task must first be suspended through task_switch. Otherwise follow active/pending-resume/feature → phase → task priority guidance.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title to start" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const found = findTaskByRef(await st.loadAllPhases(), features, params.taskId.trim());
      if (!found) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      const task = found.task;
      if (task.status === "in-progress") return { content: [{ type: "text", text: `Task ${task.id} is already in-progress.` }], details: task };
      if (task.status === "done") return { content: [{ type: "text", text: `Task ${task.id} is done. Use task_update to reopen.` }], details: task };
      const project = await st.loadProject();
      const phases = await st.loadAllPhases();
      const eligibility = checkExplicitTaskStart(features, phases, task.id, project.workDeviations);
      if (!eligibility.eligible) return { content: [{ type: "text", text: `Task start denied: ${eligibility.reason}` }], details: eligibility };
      const selection = recommendNextTask(features, phases, project.workDeviations);
      if (selection.kind === "conflict") {
        return { content: [{ type: "text", text: `${selection.reason} Pause/reconcile active tasks before starting another task.` }], details: selection };
      }
      if (selection.kind === "active" && selection.candidate?.task.id !== task.id) {
        const activeRef = `${formatPhaseRef(selection.candidate!.phase.number, featureNumberOfPhase(selection.candidate!.phase, features))}/T${String(selection.candidate!.task.number).padStart(3, "0")}`;
        return { content: [{ type: "text", text: `Task start denied: ${activeRef} is active. Use task_switch to snapshot and pause it before starting another task.` }], details: selection };
      }
      let resumeProposal: ReturnType<typeof buildResumeRequiredProposal> | undefined;
      if (selection.kind === "resume" && selection.candidate && selection.candidate.task.id !== task.id) {
        // Advisory only: a pending resume must be surfaced loudly, but it must
        // not hard-block an explicit start of a different task. Capture a
        // structured proposal so the resume-first guidance is explicit and
        // machine-readable for the host/agent.
        const resumeTask = selection.candidate;
        const resumeRef = `${formatPhaseRef(resumeTask.phase.number, featureNumberOfPhase(resumeTask.phase, features))}/T${String(resumeTask.task.number).padStart(3, "0")}`;
        const resumeSnapshot = resumeTask.task.pauseSnapshot
          ?? project.workDeviations.find((deviation) =>
            deviation.resumeTaskId === resumeTask.task.id
            && (deviation.state === "resume-required" || deviation.state === "resolved"))?.snapshot
          ?? null;
        resumeProposal = buildResumeRequiredProposal({
          ref: resumeRef,
          title: resumeTask.task.title,
          taskId: resumeTask.task.id,
          phaseId: resumeTask.phase.id,
          snapshot: resumeSnapshot
            ? { reason: resumeSnapshot.reason, resumeLocation: resumeSnapshot.resumeLocation, howToResume: resumeSnapshot.howToResume }
            : null,
        });
      }
      // Assemble the mandatory parent context before changing task lifecycle state.
      // The output order is feature + its requirements, then phase + its requirements.
      const parentFeature = found.phase.featureId ? features.find((f) => f.id === found.phase.featureId) : undefined;
      const [phaseWithRequirements, featureRequirements] = await Promise.all([
        st.loadPhaseWithRequirements(found.phase.id),
        parentFeature ? st.linkedRequirementsForFeature(parentFeature.id) : Promise.resolve([]),
      ]);
      const phaseContext = buildPhaseContextBlock(
        phaseWithRequirements,
        parentFeature,
        phaseWithRequirements.linkedRequirements ?? [],
        featureRequirements,
      );
      const advisory = selection.candidate && selection.candidate.task.id !== task.id
        ? selection.kind === "resume"
          ? `\n\n${resumeProposal ? resumeProposal.text : `⚠️ Resume advisory: ${formatPhaseRef(selection.candidate.phase.number, featureNumberOfPhase(selection.candidate.phase, features))}/T${String(selection.candidate.task.number).padStart(3, "0")} has a saved checkpoint. Evaluate its resume context before continuing with this explicit task request. Explicit task request honored.`}`
          : `\n\n⚠️ Priority advisory: ${formatPhaseRef(selection.candidate.phase.number, featureNumberOfPhase(selection.candidate.phase, features))}/T${String(selection.candidate.task.number).padStart(3, "0")} is the automatic recommendation. Explicit task request honored.`
        : "";
      const now = nowISO();
      let startedTask: Task | undefined;
      if (task.pauseSnapshot) {
        startedTask = await st.resumeTask(found.phase.id, found.task.id, now);
      } else {
        await st.updatePhase(found.phase.id, (phase) => {
          const t = phase.tasks.find((x) => x.id === found.task.id);
          if (!t) return phase;
          const previousStatus = t.status;
          applyTaskLifecycleDates(t, "in-progress", now);
          t.statusLog = [...t.statusLog, {
            id: createChecklistItemId(t.id, t.statusLog.length + 1, `${previousStatus}-in-progress`),
            date: now, fromStatus: previousStatus, toStatus: "in-progress",
            title: `${previousStatus} → in-progress`, description: "",
          }];
          t.updatedAt = now;
          phase.updatedAt = now;
          startedTask = t;
          return phase;
        });
      }
      await st.syncTaskStatusRollup(found.phase.id);
      const approvedDeviation = project.workDeviations.find((deviation) =>
        deviation.temporaryTaskId === task.id && deviation.state === "approved",
      );
      if (approvedDeviation) await st.setWorkDeviationState(approvedDeviation.id, "active", now);
      const resumedDeviation = project.workDeviations
        .filter((deviation) => deviation.resumeTaskId === task.id
          && (deviation.state === "resume-required" || deviation.state === "resolved"))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (resumedDeviation) await st.setWorkDeviationState(resumedDeviation.id, "resumed", now);
      await st.writeGenerated();
      if (!startedTask) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      const readAdvisory = parentReadAdvisory(parentFeature?.id, found.phase.id);
      const requirementAdvisory = requirementReadAdvisory([
        ...(phaseWithRequirements.linkedRequirements ?? []).map((r) => r.id),
        ...featureRequirements.map((r) => r.id),
      ]);
      return {
        content: [{ type: "text", text: `✅ Task started: ${formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features))}/T${String(startedTask.number).padStart(3, "0")} — ${startedTask.title} (in-progress)${startedTask.shortId ? ` · ${startedTask.shortId}` : ""}${phaseContext}${advisory}${readAdvisory}${requirementAdvisory}` }],
        details: startedTask,
        ...(resumeProposal ? { resumeRequired: resumeProposal.structured } : {}),
        ...(readAdvisory || requirementAdvisory ? { readRequired: true } : {}),
      };
    },
  });

  pi.registerTool({
    name: "task_complete",
    label: "Task Complete",
    description: "Mark a task as done. Sets completedAt and startedAt (if missing) automatically. Checks for unchecked checklist items and warns unless force=true.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title to complete" }),
      force: Type.Optional(Type.Boolean({ description: "Skip checklist completion check. Default: false" })),
      description_update: Type.Optional(Type.String({ description: "Post-hoc summary: commit hash(s), files touched, decisions made, updated code references with new line numbers. Keeps the planner alive and traceable." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const found = findTaskByRef(await st.loadAllPhases(), features, params.taskId.trim());
      if (!found) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      const task = found.task;
      if (task.status === "done") return { content: [{ type: "text", text: `Task ${task.id} is already done.` }], details: task };
      if (task.pauseSnapshot) return { content: [{ type: "text", text: "Task completion denied: resume checkpointed work with task_start before completing it, or cancel it explicitly with motivation." }], details: task };
      const unchecked = task.checklist.filter((item) => !item.checked);
      if (unchecked.length > 0 && !params.force) {
        return {
          content: [{ type: "text", text: `⚠️  ${unchecked.length} checklist item(s) not done: ${unchecked.map((i) => i.title).join(", ")}. Use task_complete with force=true to override.` }],
          details: { task, uncheckedChecklistItems: unchecked },
        };
      }
      const now = nowISO();
      let completedTask: Task | undefined;
      await st.updatePhase(found.phase.id, (phase) => {
        const t = phase.tasks.find((x) => x.id === found.task.id);
        if (!t) return phase;
        const previousStatus = t.status;
        applyTaskLifecycleDates(t, "done", now);
        t.statusLog = [...t.statusLog, {
          id: createChecklistItemId(t.id, t.statusLog.length + 1, `${previousStatus}-done`),
          date: now, fromStatus: previousStatus, toStatus: "done",
          title: `${previousStatus} → done`, description: "",
        }];
        if (params.description_update) {
          const sep = t.description ? "\n\n---\n**Completion summary:**\n" : "**Completion summary:**\n";
          t.description = t.description + sep + params.description_update;
        }
        t.updatedAt = now;
        phase.updatedAt = now;
        completedTask = t;
        return phase;
      });
      const clearedRef = await st.syncTaskStatusRollup(found.phase.id);
      const completedDeviation = (await st.loadProject()).workDeviations
        .filter((deviation) => (deviation.state === "approved" || deviation.state === "active") && deviation.temporaryTaskId === task.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (completedDeviation) await st.setWorkDeviationState(completedDeviation.id, "resume-required", now);
      await st.writeGenerated();
      if (!completedTask) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      let resumeNotice = "";
      let resumeRequired: Record<string, unknown> | undefined;
      if (completedDeviation) {
        const resume = findTaskByRef(await st.loadAllPhases(), features, completedDeviation.resumeTaskId);
        if (resume) {
          const snapshot = resume.task.pauseSnapshot ?? completedDeviation.snapshot;
          const resumeRef = `${formatPhaseRef(resume.phase.number, featureNumberOfPhase(resume.phase, features))}/T${String(resume.task.number).padStart(3, "0")}`;
          resumeNotice = [
            "",
            `↩️ RESUME REQUIRED: ${resumeRef} — ${resume.task.title}`,
            snapshot ? `Checkpoint reason: ${snapshot.reason}` : "Return to the preserved task before selecting new priority work.",
            snapshot ? `Resume from: ${snapshot.resumeLocation}` : "",
            snapshot ? `How to resume: ${snapshot.howToResume}` : "",
            `Next action: task_start ${resumeRef}`,
          ].filter(Boolean).join("\n");
          resumeRequired = { taskId: resume.task.id, phaseId: resume.phase.id, snapshot };
        }
      }
      const completedRef = `${formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features))}/T${String(completedTask.number).padStart(3, "0")}`;
      return {
        content: [{ type: "text", text: `✅ Task completed: ${completedRef} — ${completedTask.title} (done)${clearedRef ? ` — phase handoff archived (${clearedRef})` : ""}${resumeNotice}` }],
        details: resumeRequired ? { task: completedTask, resumeRequired } : completedTask,
      };
    },
  });

  pi.registerTool({
    name: "task_checklist_toggle",
    label: "Task Checklist Toggle",
    description: "Tick/untick a task checklist item (a 'step') without rewriting the whole list. Accepts the item as C{n} (e.g. C2), item id, or title (case-insensitive, first match). Pass checked=true/false to set explicitly, or omit to toggle. Use this instead of writing DONE in step titles. Items are numbered C1/C2… per task.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title" }),
      item: Type.String({ description: "Checklist item selector: C{n} (e.g. C2), item id, or title (case-insensitive)" }),
      checked: Type.Optional(Type.Boolean({ description: "Set explicitly: true=done, false=open. Omit to toggle." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, params.taskId.trim());
      if (!found) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      let result = "";
      await st.updatePhase(found.phase.id, (phase) => {
        const task = phase.tasks.find((t) => t.id === found.task.id);
        if (!task) { result = `Task not found: ${params.taskId}`; return phase; }
        const ck = task.checklist ?? [];
        if (ck.length === 0) { result = `Task "${found.task.title}" has no checklist.`; return phase; }
        const target = toggleChecklistItem(ck, params.item, params.checked);
        if (!target) { result = `No checklist item matching "${params.item}".`; return phase; }
        task.updatedAt = nowISO();
        phase.updatedAt = nowISO();
        const doneCount = ck.filter((i) => i.checked).length;
        result = `C${target.number} "${target.title}" → ${target.checked ? "done" : "open"} (${doneCount}/${ck.length} checked)`;
        return phase;
      });
      await st.writeGenerated();
      return { content: [{ type: "text", text: `✅ ${result}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "task_checklist_add",
    label: "Task Checklist Add",
    description: "Add a single checklist item (a 'step') to a task without rewriting the list. The new item is appended as C{n} (next progressive number, stable id, unchecked). Use this to subdivide a task into smaller steps INSTEAD of spawning sub-tasks — the checklist keeps description, notes, statusLog and steps concentrated in one task (sub-tasks disperse context). Also use for granular adds instead of replacing the whole checklist via task_update.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title" }),
      title: Type.String({ description: "Checklist item text (a single step)" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, params.taskId.trim());
      if (!found) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      let result = "";
      await st.updatePhase(found.phase.id, (phase) => {
        const task = phase.tasks.find((t) => t.id === found.task.id);
        if (!task) { result = `Task not found: ${params.taskId}`; return phase; }
        const ck = task.checklist ?? [];
        const item = addChecklistItem(ck, task.id, params.title);
        ck.push(item);
        task.checklist = ck;
        task.updatedAt = nowISO();
        phase.updatedAt = nowISO();
        result = `Added C${item.number} "${item.title}" (${ck.length} items)`;
        return phase;
      });
      await st.writeGenerated();
      return { content: [{ type: "text", text: `✅ ${result}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "task_checklist_remove",
    label: "Task Checklist Remove",
    description: "Remove a single checklist item (a 'step') from a task by C{n} (e.g. C2), item id, or title (case-insensitive). Remaining items are renumbered C1..Cn for readability; their stable ids are preserved. Use this for granular removes instead of replacing the whole checklist via task_update.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title" }),
      item: Type.String({ description: "Checklist item selector: C{n} (e.g. C2), item id, or title (case-insensitive)" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, params.taskId.trim());
      if (!found) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      let result = "";
      await st.updatePhase(found.phase.id, (phase) => {
        const task = phase.tasks.find((t) => t.id === found.task.id);
        if (!task) { result = `Task not found: ${params.taskId}`; return phase; }
        const ck = task.checklist ?? [];
        if (ck.length === 0) { result = `Task "${found.task.title}" has no checklist.`; return phase; }
        const removed = removeChecklistItem(ck, params.item);
        if (!removed) { result = `No checklist item matching "${params.item}".`; return phase; }
        task.updatedAt = nowISO();
        phase.updatedAt = nowISO();
        result = `Removed C${removed.number} "${removed.title}" (${ck.length} items left)`;
        return phase;
      });
      await st.writeGenerated();
      return { content: [{ type: "text", text: `✅ ${result}` }], details: {} };
    },
  });

  // ── Web lifecycle tools (agent-callable; parity with @agent-plan/mcp planner-web) ──
  // These let the agent manage the web dashboard directly, without relying
  // on the /planner slash command (which is not intercepted when the planner
  // is disabled by default). Planner operations are NOT code edits.

  pi.registerTool({
    name: "planner-web",
    label: "Planner Web",
    description: "Manage the planner web dashboard (start/status/stop). The dashboard is LAN-bound (0.0.0.0) with a dynamic OS-assigned port by default. Planner operations are NOT code edits and need no active task. The web does NOT auto-start; call action=start explicitly.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("status")], { description: "start | stop | status. Default: status" }),
      port: Type.Optional(Type.Number({ description: "Optional requested port for start. Omit/0 → OS assigns a free port." })),
      visibility: Type.Optional(Type.Union([Type.Literal("local"), Type.Literal("lan")], { description: "Bind scope for start. Default: lan (0.0.0.0, reachable from other devices)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const action = params.action ?? "status";
      if (action === "start") {
        const st = await requirePlan(ctx);
        if (!st) return { content: [{ type: "text", text: "No .planner/ found. Run plan_init first." }], details: { running: false } };
        const visibility = params.visibility ?? "lan";
        if (server) {
          const srv = server as ServeHandle;
          return { content: [{ type: "text", text: `Web UI already running. Local: ${srv.localUrl}${srv.lanUrl ? ` — LAN: ${srv.lanUrl}` : ""} (mode: ${srv.mode}, port: ${lastKnownWebPort ?? "?"})` }], details: { running: true, localUrl: srv.localUrl, lanUrl: srv.lanUrl, port: lastKnownWebPort, mode: srv.mode } };
        }
        await startServer(ctx, params.port && params.port > 0 ? params.port : undefined, visibility);
        const srv = server as ServeHandle | null;
        if (!srv) return { content: [{ type: "text", text: "Failed to start web server." }], details: { running: false } };
        return { content: [{ type: "text", text: `Web UI started. Local: ${srv.localUrl}${srv.lanUrl ? ` — LAN: ${srv.lanUrl}` : ""} (mode: ${srv.mode}, port: ${lastKnownWebPort ?? "?"})` }], details: { running: true, localUrl: srv.localUrl, lanUrl: srv.lanUrl, port: lastKnownWebPort, mode: srv.mode } };
      }
      if (action === "stop") {
        if (!server) return { content: [{ type: "text", text: "Web UI not running." }], details: { running: false } };
        const stoppedUrl = (server as ServeHandle).localUrl;
        await stopServer();
        return { content: [{ type: "text", text: `Web UI stopped (was ${stoppedUrl}).` }], details: { running: false } };
      }
      // status
      const srv = server as ServeHandle | null;
      if (!srv) return { content: [{ type: "text", text: "Web UI not running. Use planner-web with action=start to start the dashboard." }], details: { running: false } };
      return { content: [{ type: "text", text: `Web UI running. Local: ${srv.localUrl}${srv.lanUrl ? ` — LAN: ${srv.lanUrl}` : ""} (mode: ${srv.mode}, port: ${lastKnownWebPort ?? "?"})` }], details: { running: true, localUrl: srv.localUrl, lanUrl: srv.lanUrl, port: lastKnownWebPort, mode: srv.mode } };
    },
  });

  pi.registerTool({
    name: "planner-load",
    label: "Planner Load",
    description: "Enable the planner for this project and start the web dashboard (LAN), then return a resume recap (project status + handoff if present + Web UI address). This is the explicit way to enable the planner — it does NOT auto-start. Planner operations are NOT code edits.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found. Run plan_init first." }], details: { enabled: false, running: false } };
      enablePlannerSession();
      if (!server) {
        await startServer(ctx, undefined, "lan").catch(() => {});
      }
      const srv = server as ServeHandle | null;
      let recap = "";
      try { recap = await buildRecap(st, { localUrl: srv?.localUrl, lanUrl: srv?.lanUrl, port: lastKnownWebPort ?? undefined }, { harness: "pi" }); } catch (e) { recap = `(recap unavailable: ${e instanceof Error ? e.message : String(e)})`; }
      return { content: [{ type: "text", text: recap }], details: { enabled: true, running: Boolean(srv), localUrl: srv?.localUrl, lanUrl: srv?.lanUrl, port: lastKnownWebPort } };
    },
  });

  pi.registerTool({
    name: "planner-stop",
    label: "Planner Stop",
    description: "Disable the planner for this project and stop the web dashboard. Alias: planner-disable. Planner operations are NOT code edits.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      disablePlannerSession();
      await stopServer().catch(() => {});
      try { capturedPi?.appendEntry("plan-web-state", { running: false }); } catch {}
      return { content: [{ type: "text", text: "Planner disabled. Web UI shut down. Run /planner load or planner-load to re-enable." }], details: { disabled: true, webRunning: false } };
    },
  });

  // ── Context injection ─────────────────────────────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!plannerSessionEnabled) return;
    const st = ensureStore(ctx);
    if (!(await st.exists())) return;

    try {
      // Session initialization must not mutate canonical planner entities.
      // Migrations/backfills/repairs are explicit tools; resume is `.local`.
      if (!plannerHeavyInitDone) {
        await st.refreshResume();
        plannerHeavyInitDone = true;
      }

      // Resume-flag lifecycle — MUST run every turn, including cache hits.
      // /planner load sets both flags and dirties the cache so the recap turn
      // rebuilds (slow path) and injects the resume protocol. We consume
      // startupResumePromptPending here (it marks the recap turn only), and we
      // stop appending the web UI address on every later turn. Doing this
      // BEFORE the cache fast-path is what prevents the URL from leaking onto
      // every assistant message after /planner load.
      const isRecapTurn = startupResumePromptPending;
      startupResumePromptPending = false;
      if (startupResumeSummaryPending && !isRecapTurn) {
        startupResumeSummaryPending = false;
      }

      // Fast path: on steady turns (no plan changes since last build) reuse
      // the cached context block and skip all the per-turn I/O + string build.
      // The cache is invalidated by the write-notify hook whenever the plan
      // is mutated, and on first turn (contextBlockDirty starts true).
      if (!contextBlockDirty && contextBlockCache) {
        return {
          systemPrompt: `${event.systemPrompt}\n\n---\n${contextBlockCache}`,
        };
      }

      const plan = await st.loadAll();
      const project = plan.project;
      const profile = await st.loadCodebaseProfile();
      const resume = await st.loadResume().catch(() => null) ?? await st.refreshResume();
      const activity = await st.loadActivityLog();
      const recentActivity = activity.entries.slice(-3).reverse();
      const handoffs = await st.listHandoffs();
      const extensionRules = await st.extensionRules();

      const featureById = new Map(plan.features.features.map((feature) => [feature.id, feature]));
      const phaseById = new Map(plan.phases.map((phase) => [phase.id, phase]));
      const orderedPhases = [
        ...plan.features.features.flatMap((feature) => {
          const linked = feature.phaseIds.map((id) => phaseById.get(id)).filter((phase): phase is Phase => Boolean(phase));
          const linkedIds = new Set(linked.map((phase) => phase.id));
          const inferred = plan.phases.filter((phase) => phase.featureId === feature.id && !linkedIds.has(phase.id))
            .sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt));
          return [...linked, ...inferred];
        }),
        ...plan.phases.filter((phase) => !phase.featureId)
          .sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt)),
      ];
      const hasActiveWork = plan.features.features.some((feature) => feature.status === "in-progress")
        || plan.phases.some((phase) => phase.status === "in-progress" || phase.status === "discovery")
        || orderedPhases.some((phase) => phase.tasks.some((task) => task.status === "in-progress"));
      const currentPhase = hasActiveWork
        ? orderedPhases.find((phase) => phase.id === resume.currentPhaseId && (phase.status === "in-progress" || phase.tasks.some((task) => resume.inProgressTaskIds.includes(task.id))))
          ?? orderedPhases.find((phase) => phase.tasks.some((task) => resume.inProgressTaskIds.includes(task.id)))
          ?? orderedPhases.find((phase) => phase.status === "in-progress")
          ?? null
        : null;
      const currentTask = hasActiveWork
        ? ([...(currentPhase?.tasks ?? [])]
          .sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt))
          .find((task) => resume.inProgressTaskIds.includes(task.id))
          ?? [...(currentPhase?.tasks ?? [])]
            .sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt))
            .find((task) => task.status === "in-progress")
          ?? null)
        : null;
      const currentFeature = hasActiveWork && currentPhase?.featureId
        ? featureById.get(currentPhase.featureId) ?? null
        : hasActiveWork
          ? plan.features.features.find((feature) => feature.status === "in-progress") ?? null
          : null;
      const currentFeatureRef = currentFeature ? formatFeatureRef(currentFeature.number) : "";
      const currentPhaseRef = currentPhase ? formatPhaseRef(currentPhase.number, currentFeature?.number) : "";
      const currentTaskRef = currentTask && currentPhase
        ? `${formatPhaseRef(currentPhase.number, currentFeature?.number)}/T${pad(currentTask.number)}`
        : "";

      const phaseStatusOrder = ["draft", "discovery", "planned", "in-progress", "blocked", "done", "canceled"] as const;
      const phaseStatusCounts = new Map<string, number>(phaseStatusOrder.map((status) => [status, 0]));
      for (const phase of plan.phases) {
        phaseStatusCounts.set(phase.status, (phaseStatusCounts.get(phase.status) ?? 0) + 1);
      }
      const phaseCountsSummary = phaseStatusOrder
        .map((status) => `${status}=${phaseStatusCounts.get(status) ?? 0}`)
        .join(" ");

      const activeTaskMap = new Map<string, { phase: Phase; task: Task; featureNumber: number | undefined }>();
      for (const phase of orderedPhases) {
        const featureNumber = phase.featureId ? featureById.get(phase.featureId)?.number : undefined;
        for (const task of phase.tasks) {
          if (!resume.inProgressTaskIds.includes(task.id) && task.status !== "in-progress") continue;
          activeTaskMap.set(task.id, { phase, task, featureNumber });
        }
      }
      const inProgressTaskLines = [...activeTaskMap.values()]
        .sort((left, right) => left.task.number - right.task.number || left.task.createdAt.localeCompare(right.task.createdAt))
        .map(({ phase, task, featureNumber }) => `${formatPhaseRef(phase.number, featureNumber)}/T${pad(task.number)} — ${task.title}`);

      const otherActiveOrBlockedPhases = orderedPhases
        .filter((phase) => phase.id !== currentPhase?.id && (phase.status === "in-progress" || phase.status === "discovery" || phase.status === "blocked"))
        .slice(0, 6)
        .map((phase) => {
          const featureNumber = phase.featureId ? featureById.get(phase.featureId)?.number : undefined;
          return `${statusIcon(phase.status)} ${formatPhaseRef(phase.number, featureNumber)} — ${phase.title} (${phase.status})`;
        });

      const openQuestions = plan.phases
        .flatMap((phase: Phase) => phase.openQuestions.map((question: string) => `[${formatPhaseRef(phase.number, featureNumberOfPhase(phase, plan.features.features))}] ${question}`))
        .slice(0, 8);

      const acceptedDecisions = [
        ...project.acceptedDecisions.map((decision: AcceptedDecision) => `[project] ${decision.title}`),
        ...plan.features.features.flatMap((feature: Feature) => feature.acceptedDecisions.map((decision: AcceptedDecision) => `[feature ${formatFeatureRef(feature.number)}] ${decision.title}`)),
        ...plan.phases.flatMap((phase: Phase) => phase.acceptedDecisions.map((decision: AcceptedDecision) => `[phase ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, plan.features.features))}] ${decision.title}`)),
        ...plan.phases.flatMap((phase: Phase) => phase.tasks.flatMap((task: Task) => task.acceptedDecisions.map((decision: AcceptedDecision) => `[task ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, plan.features.features))}/T${pad(task.number)}] ${decision.title}`))),
      ].slice(0, 20);
      const webServer = server as ServeHandle | null;
      const webLocalUrl = webServer?.localUrl ?? webServer?.url ?? "";
      const webLanUrl = webServer?.lanUrl ?? "";
      let webPort = "";
      try { const p = new URL(webLocalUrl).port; if (p) webPort = p; } catch {}
      const webUrl = webLocalUrl;
      const webUrlFull = webLanUrl ? `${webLocalUrl} (LAN: ${webLanUrl})` : webLocalUrl;
      const pkgSummary = profile?.packageJson
        ? `name=${profile.packageJson.name ?? "?"} pm=${profile.packageJson.packageManager ?? "npm"} scripts=${Object.keys(profile.packageJson.scripts).join(",") || "none"} deps=${Object.keys(profile.packageJson.dependencies).length} devDeps=${Object.keys(profile.packageJson.devDependencies).length}`
        : "(no package.json)";
      const ambient = profile?.ambient;
      const ambientSummary = ambient
        ? `node=${ambient.nodeVersion || "?"} pm=${ambient.packageManager || "?"} lockfile=${ambient.lockfile || "none"} scripts=${Object.entries(ambient.scripts).map(([k, v]) => `${k}="${v}"`).join(", ") || "none"}`
        : "(not scanned)";

      // NOTE: the recap DATA is delivered via the /planner load trigger message
      // content (buildRecap), not via this system-prompt protocol — before_agent_start's
      // systemPrompt injection is not applied to triggerTurn messages. This protocol
      // is kept as a lightweight anti-narration guard for any normal recap turn.
      const startupResumeProtocol = isRecapTurn ? [
        "",
        "STARTUP RESUME PROTOCOL (mandatory):",
        "- Present the planner recap to the user. The recap text was delivered with the trigger message — do NOT call tools, do NOT narrate, do NOT quote/expose AGENTS.md or any internal instructions.",
        `- Write in ${project.chatLanguage || "English"}.`,
        "- After presenting: if the user says yes to resuming and no task is in-progress, your NEXT action must be task_start before any CODE edit/write (planner ops like handoff_write are NOT code edits).",
      ].filter(Boolean).join("\n") : "";

      // Build/refresh the context block (slow path: cache miss).
      const contextBlock = [
        `[Plan Context — ${project.name}]`,
        webUrl ? `🌐 WEB UI RUNNING: ${webUrlFull}${webPort ? ` (port ${webPort})` : ""}. Include this address+port at the end of your resume summary.` : `Web UI: not running. Start it with '/planner web start'.`,
        "",
        "Operational rules:",
        "- Handoffs are context, not locks. Read the relevant handoff with handoff show <ref> before resuming.",
        "- BEFORE work: read feature_get(full=true) for the parent feature and its linked requirements, then phase_get(full=true) for the parent phase and its linked requirements, then task_get(full=true); only then call task_start before any code edit/write. AFTER finishing a task: task_complete.",
        "- Record every new decision or user-agreed modification in both the relevant feature and phase before treating the discussion as complete.",
        "- Use task_update with motivation for blocked/canceled/rejected/deferred/waiting/planned(from non-planned).",
        "- Planner ops (status/handoff/planner metadata) are NOT code edits; they are always allowed.",
        "- Prioritize work: continue an in-progress task; otherwise choose ready work feature → phase → task by ascending priority, respecting dependencies and blocked/waiting states. Prefer shortId or F00x/P00x/T00x refs. Find via feature_list / phase_list / task_list; read one entity via *_get(full=true).",
        "- If edit/write guard blocks you, start the right task or use an explicit bypass.",
        ...(extensionRules.length > 0
          ? [
            "",
            "Planner rules (extension; agent-only):",
            ...extensionRules.map((rule, index) => `${index + 1}. ${rule}`),
          ]
          : []),
        "",
        `Goal: ${project.goal || "(not set)"}`,
        project.description ? `Description: ${project.description}` : "",
        `Stack: ${[...project.technologies, ...project.tools].join(", ") || "(not set)"}`,
        `Codebase: ${pkgSummary} | dirs=${profile?.directories.join(",") || "none"} | scanned=${profile?.scannedAt ?? "never"}`,
        `Ambient: ${ambientSummary}`,
        "",
        "Global rules:",
        project.globalRules.length ? project.globalRules.map((rule) => `- ${rule}`).join("\n") : "- (none)",
        "",
        `Workflow: before phase=${project.workflowRules.beforePhaseStart.join(" | ") || "(none)"}; before task=${project.workflowRules.beforeTaskStart.join(" | ") || "(none)"}; after phase=${project.workflowRules.afterPhaseComplete.join(" | ") || "(none)"}`,
        `Scope: ${project.scope.join(", ") || "(none)"}`,
        `Out of scope: ${project.outOfScope.join(", ") || "(none)"}`,
        "",
        acceptedDecisions.length ? "Accepted decisions (do not re-litigate):" : "",
        ...acceptedDecisions.map((decision) => `- ${decision}`),
        openQuestions.length ? "" : "",
        openQuestions.length ? "Open questions:" : "",
        ...openQuestions.map((question) => `- ${question}`),
        "",
        "Resume focus (stale/fallback pointer — may not match the phase you actually worked on in this session):",
        currentFeatureRef ? `  current feature pointer: ${currentFeatureRef} — ${currentFeature?.name}` : "  current feature pointer: (none)",
        currentPhaseRef ? `  current phase pointer: ${currentPhaseRef} — ${currentPhase?.title}` : "  current phase pointer: (none)",
        currentTaskRef ? `  current task pointer: ${currentTaskRef} — ${currentTask?.title}` : "  current task pointer: (none)",
        inProgressTaskLines.length ? `  in-progress tasks: ${inProgressTaskLines.join("; ")}` : "  in-progress tasks: (none)",
        resume.blockers.length ? `  blockers: ${resume.blockers.join("; ")}` : "  blockers: (none)",
        handoffs.length === 0 && resume.nextSteps.length
          ? `  next step: ${resume.nextSteps[0]}${resume.nextStepsUpdatedAt ? ` (updated ${resume.nextStepsUpdatedAt})` : ""}`
          : "",
        "",
        "CRITICAL: The 'Resume focus' pointers above are persisted across sessions. They are NOT necessarily the phase you worked on right now. When asked to write a handoff, use the phase the user explicitly identifies as the one just completed in this session, not a stale pointer.",
        "",
        "Phase overview:",
        `  counts: ${phaseCountsSummary}`,
        currentPhaseRef ? `  current: ${currentPhaseRef} — ${currentPhase?.title} (${currentPhase?.status})` : "  current: (none)",
        otherActiveOrBlockedPhases.length ? "  other active/blocked:" : "  other active/blocked: (none)",
        ...otherActiveOrBlockedPhases.map((line) => `  - ${line}`),
        "",
        recentActivity.length ? "Recent activity:" : "",
        ...recentActivity.map((entry) => `- ${entry.at} [${entry.type}] ${entry.ref}: ${entry.summary}`),
        "",
        handoffs.length > 0 ? "Pending phase handoffs (entity-scoped; may be on a stale phase — validate before treating as current focus):" : "",
        ...handoffs.map((handoff, index) => `  [${index + 1}] ${handoff.compositeRef} — ${handoff.updatedAt} — "${handoff.firstLine}"`),
        handoffs.length > 0 ? "Use handoff show <ref> for context. A pending handoff is a candidate to validate; do not default to it as the current focus unless it matches the phase you actually worked on in this session." : "",
        "",
        `Language: content=${project.contentLanguage || "(not set)"}; chat=${project.chatLanguage || "(not set)"}`,
        "Planner discuss mode is Agent Plan only: ignore GSD workflows unless the user explicitly asks for GSD.",
      ].filter(Boolean).join("\n");
        contextBlockCache = contextBlock;
        contextBlockDirty = false;

      // The resume protocol is per-turn only (the recap turn) — never bake it
      // into the cached context block, or it would persist on every later turn.
      return {
        systemPrompt: `${event.systemPrompt}\n\n---\n${contextBlockCache}${startupResumeProtocol ? `\n\n${startupResumeProtocol}` : ""}`,
      };
    } catch {
      return;
    }
  });
}
