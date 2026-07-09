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
import { ExportService, PlanStore, setWriteBusyHook, setWriteNotifyHook, migrateToUuids, withFeatureLock, needsMotivation } from "@agent-plan/core";
import { createChecklistItemId, createFeatureId, createPhaseId, createTaskId, normalizeSlug } from "@agent-plan/core/naming";
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
let startupResumePromptPending = false;
let startupResumeSummaryPending = false;
let plannerHeavyInitDone = false; // runs migrate/heal/refreshResume once per session, not every turn
let startupResumeSummaryText = "";
let contextBlockCache = ""; // cached before_agent_start context; rebuilt only when plan changes
let contextBlockDirty = true; // build on first turn; invalidated by write notify hook
let editedThisTurn = false; // tracks edit/write activity for the task_complete reminder
let taskCompleteReminderSaidThisTurn = false;
const healedStatusRoots = new Set<string>();

const PLANNER_COMMAND_COMPLETIONS = [
  { value: "init", label: "init", description: "Initialize planner in this project" },
  { value: "show", label: "show", description: "Show planner overview" },
  { value: "repair", label: "repair", description: "Repair planner integrity" },
  { value: "project discuss", label: "project discuss", description: "Run project discovery" },
  { value: "project language", label: "project language", description: "Set persistent language preferences" },
  { value: "feature list", label: "feature list", description: "List features" },
  { value: "feature add", label: "feature add", description: "Create a feature" },
  { value: "feature show", label: "feature show", description: "Show a feature" },
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
  { value: "handoff prepare", label: "handoff prepare", description: "Tell the agent to create/update the handoff" },
  { value: "handoff show", label: "handoff show", description: "Show the current handoff" },
  { value: "handoff write", label: "handoff write", description: "Write handoff directly from planner data" },
  { value: "handoff clear", label: "handoff clear", description: "Delete the current handoff" },
  { value: "web start", label: "web start", description: "Start the web UI" },
  { value: "web stop", label: "web stop", description: "Stop the web UI" },
  { value: "web status", label: "web status", description: "Show web UI status" },
  { value: "export", label: "export", description: "Export plan summary as Markdown" },
  { value: "export-full", label: "export-full", description: "Export full detailed plan as Markdown" },
  { value: "bypass", label: "bypass", description: "Authorize edit/write without a task in-progress (15 min)" },
  { value: "clear-bypass", label: "clear-bypass", description: "Revoke the guard bypass" },
  { value: "load", label: "load", description: "Re-enable planner and start web UI" },
  { value: "disable", label: "disable", description: "Reset planner preferences and disable for this session" },
];

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

async function maybeHealStatuses(st: PlanStore): Promise<void> {
  if (healedStatusRoots.has(st.root)) return;
  await st.syncStatuses();
  healedStatusRoots.add(st.root);
}

function normalizeLanguagePref(value: string | undefined): string {
  return value?.trim() ?? "";
}

async function ensureProjectLanguagePreferences(st: PlanStore): Promise<Project> {
  const project = await st.loadProject();
  const contentLanguage = normalizeLanguagePref(project.contentLanguage);
  const chatLanguage = normalizeLanguagePref(project.chatLanguage);

  if (contentLanguage && chatLanguage) {
    if (project.contentLanguage !== contentLanguage || project.chatLanguage !== chatLanguage) {
      project.contentLanguage = contentLanguage;
      project.chatLanguage = chatLanguage;
      await st.saveProject(project);
    }
    return project;
  }

  if (contentLanguage || chatLanguage) {
    const fallback = contentLanguage || chatLanguage;
    project.contentLanguage = contentLanguage || fallback;
    project.chatLanguage = chatLanguage || fallback;
    await st.saveProject(project);
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
    ? allTasks.find(({ phase, task }) => phase.id === resume.currentPhaseId && task.status !== "done" && task.status !== "canceled")
    : undefined;
  const fallbackFocus = allTasks.find(({ task }) => task.status === "planned" || task.status === "blocked")
    ?? allTasks.find(({ task }) => task.status !== "done" && task.status !== "canceled");
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

async function buildStartupResumeSummary(st: PlanStore): Promise<string> {
  const [plan, resume, handoff] = await Promise.all([
    st.loadAll(),
    st.refreshResume(),
    st.loadHandoff(),
  ]);

  const phaseById = new Map(plan.phases.map((phase) => [phase.id, phase]));
  const orderedPhases = [
    ...plan.features.features.flatMap((feature) => {
      const linked = feature.phaseIds.map((id) => phaseById.get(id)).filter((phase): phase is Phase => Boolean(phase));
      const linkedIds = new Set(linked.map((phase) => phase.id));
      const inferred = plan.phases
        .filter((phase) => phase.featureId === feature.id && !linkedIds.has(phase.id))
        .sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt));
      return [...linked, ...inferred];
    }),
    ...plan.phases
      .filter((phase) => !phase.featureId)
      .sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt)),
  ];
  const allTasks = orderedPhases.flatMap((phase) => [...phase.tasks]
    .sort((left, right) => left.number - right.number || left.createdAt.localeCompare(right.createdAt))
    .map((task) => ({ phase, task })));
  const totalFeatures = plan.features.features.length;
  const doneFeatures = plan.features.features.filter((feature) => feature.status === "done").length;
  const activeFeatures = plan.features.features.filter((feature) => feature.status === "in-progress").length;
  const totalPhases = plan.phases.length;
  const donePhases = plan.phases.filter((phase) => phase.status === "done").length;
  const activePhases = plan.phases.filter((phase) => phase.status === "in-progress" || phase.status === "discovery").length;
  const totalTasks = allTasks.length;
  const doneTasks = allTasks.filter(({ task }) => task.status === "done").length;
  const activeTasks = allTasks.filter(({ task }) => task.status === "in-progress").length;
  const hasActiveWork = activeFeatures > 0 || activePhases > 0 || activeTasks > 0;

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
      ?? allTasks.find(({ task }) => task.status === "in-progress")?.task
      ?? null)
    : null;
  const currentFeature = hasActiveWork
    ? (currentPhase?.featureId
      ? plan.features.features.find((feature) => feature.id === currentPhase.featureId) ?? null
      : plan.features.features.find((feature) => feature.status === "in-progress") ?? null)
    : null;

  const nextActivity = hasActiveWork
    ? (resume.nextSteps[0]
      ?? (currentTask
        ? `riprendere il task ${currentTask.id} — ${taskLabel(currentTask)}`
        : currentPhase
          ? `riprendere la fase ${currentPhase.id} — ${phaseLabel(currentPhase)}`
          : "riprendere il lavoro attivo corrente"))
    : (handoff?.updatedAt
      ? "leggere l'handoff e verificare ordine, dipendenze e stato reale del piano prima di scegliere il prossimo task"
      : "rivedere il piano e scegliere il prossimo task concreto");

  const chatLanguage = (plan.project.chatLanguage || "").toLowerCase();
  const italian = chatLanguage.includes("ital");
  const localUrl = server?.localUrl ?? server?.url ?? "";
  const lanUrl = server?.lanUrl ?? "";
  const webUrl = lanUrl ? `${localUrl} (LAN: ${lanUrl})` : localUrl;

  if (italian || !chatLanguage) {
    return [
      "### Summary di ripresa planner",
      `- Progresso: ${doneFeatures}/${totalFeatures} feature completate (${activeFeatures} attive), ${donePhases}/${totalPhases} fasi completate (${activePhases} attive), ${doneTasks}/${totalTasks} task completati (${activeTasks} attivi).`,
      currentFeature ? `- Focus feature: ${currentFeature.id} — ${featureLabel(currentFeature)} (${currentFeature.status}).` : "- Focus feature: nessuna feature attiva chiara.",
      currentPhase ? `- Focus fase: ${currentPhase.id} — ${phaseLabel(currentPhase)} (${currentPhase.status}).` : "- Focus fase: nessuna fase attiva chiara.",
      currentTask ? `- Focus task: ${currentTask.id} — ${taskLabel(currentTask)} (${currentTask.status}).` : "- Focus task: nessun task attivo in questo momento.",
      handoff?.updatedAt ? `- Handoff letto da .planner/HANDOFF.md (aggiornato ${handoff.updatedAt}).` : "- Nessun handoff strutturato disponibile.",
      !hasActiveWork && handoff?.updatedAt ? "- Nota: l'handoff è un suggerimento della sessione precedente; con 0 task/fasi attivi va validato contro stato e dipendenze correnti prima di riprendere un task specifico." : "",
      webUrl ? `- Dashboard web: ${webUrl}` : "- Dashboard web: non attiva in questa sessione.",
      `- Prossima attività consigliata: ${nextActivity}.`,
      "",
      "Vuoi che riprendiamo da qui?",
    ].filter(Boolean).join("\n");
  }

  return [
    "### Planner resume summary",
    `- Progress: ${doneFeatures}/${totalFeatures} features done (${activeFeatures} active), ${donePhases}/${totalPhases} phases done (${activePhases} active), ${doneTasks}/${totalTasks} tasks done (${activeTasks} active).`,
    currentFeature ? `- Feature focus: ${currentFeature.id} — ${featureLabel(currentFeature)} (${currentFeature.status}).` : "- Feature focus: no clear active feature.",
    currentPhase ? `- Phase focus: ${currentPhase.id} — ${phaseLabel(currentPhase)} (${currentPhase.status}).` : "- Phase focus: no clear active phase.",
    currentTask ? `- Task focus: ${currentTask.id} — ${taskLabel(currentTask)} (${currentTask.status}).` : "- Task focus: no active task right now.",
    handoff?.updatedAt ? `- Handoff loaded from .planner/HANDOFF.md (updated ${handoff.updatedAt}).` : "- No structured handoff found.",
    !hasActiveWork && handoff?.updatedAt ? "- Note: the handoff is only a previous-session hint; with 0 active tasks/phases it must be validated against current planner state and dependencies before resuming a specific task." : "",
    webUrl ? `- Web dashboard: ${webUrl}` : "- Web dashboard: not active in this session.",
    `- Recommended next activity: ${nextActivity}.`,
    "",
    "Do you want to resume from here?",
  ].filter(Boolean).join("\n");
}

async function buildHandoffMarkdown(
  st: PlanStore,
  reason: string,
  overrides?: {
    whatWasBeingDone?: string;
    howToResume?: string;
    nextSteps?: string[];
    blockers?: string[];
  },
): Promise<string> {
  const [plan, resume, activity, existingHandoff] = await Promise.all([
    st.loadAll(),
    st.refreshResume(),
    st.loadActivityLog(),
    st.loadHandoff(),
  ]);

  const createdAt = existingHandoff?.createdAt || nowISO();
  const updatedAt = nowISO();
  const allTasks = plan.phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));
  const nonTerminalTasks = allTasks.filter(({ task }) => task.status !== "done" && task.status !== "canceled");
  const latestTaskUpdate = [...allTasks].sort((left, right) => right.task.updatedAt.localeCompare(left.task.updatedAt))[0] ?? null;
  const latestPhaseUpdate = [...plan.phases].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const latestFeatureUpdate = [...plan.features.features].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const currentPhase = plan.phases.find((phase) => phase.id === resume.currentPhaseId)
    ?? plan.phases.find((phase) => phase.tasks.some((task) => resume.inProgressTaskIds.includes(task.id)))
    ?? plan.phases.find((phase) => phase.status === "in-progress")
    ?? nonTerminalTasks[0]?.phase
    ?? latestPhaseUpdate
    ?? null;
  const currentTask = currentPhase?.tasks.find((task) => resume.inProgressTaskIds.includes(task.id))
    ?? currentPhase?.tasks.find((task) => task.status === "in-progress")
    ?? [...(currentPhase?.tasks ?? [])].filter((task) => task.status !== "done" && task.status !== "canceled").sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
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
      "2. Read `.planner/HANDOFF.md` and compare it with the latest planner data.",
      currentTask && currentTask.status !== "in-progress"
        ? `3. Before implementation work, run /planner task start ${currentTask.id} (or call task_start).`
        : "3. Confirm whether the current task is already in-progress before doing implementation work.",
      `4. Continue with the next activity: ${inferredNextSteps[0] ?? "choose the next concrete task"}`,
    ].join("\n");

  const filesTouched = [
    ".planner/project.json",
    ".planner/features.json",
    currentPhase ? `.planner/phases/${currentPhase.id}.json` : "",
    latestPhaseUpdate && latestPhaseUpdate.id !== currentPhase?.id ? `.planner/phases/${latestPhaseUpdate.id}.json` : "",
    ".planner/resume.json",
    ".planner/HANDOFF.md",
    ".planner/generated/PLAN.md",
  ].filter(Boolean);

  const recentActivityLines = recentActivity.length > 0
    ? recentActivity.map((entry) => `- ${entry.at} [${entry.type}] ${entry.ref}: ${entry.summary}`)
    : inferredRecentChanges.length > 0
      ? inferredRecentChanges.map((entry) => `- ${entry}`)
      : ["- No recent activity recorded"];

  return [
    "# Handoff",
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
    "- When work is fully resumed and this handoff is no longer needed, delete `.planner/HANDOFF.md`.",
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
  },
): Promise<void> {
  const markdown = await buildHandoffMarkdown(st, reason, overrides);
  await st.saveHandoff(markdown);
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
  };
  return icons[status] ?? "❓";
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

  if (project.webPort > 0) {
    return project.webPort;
  }

  for (let port = 3030; port <= 3999; port += 1) {
    if (await isPortAvailable(port)) {
      project.webPort = port;
      await st.saveProject(project);
      return port;
    }
  }

  throw new Error("No free port found in range 3030-3999");
}

// ─── Server lifecycle (uses capturedPi) ─────────────────────────────────

function resolveStaticDir(): string | undefined {
  try {
    // When loaded as Pi extension, find the monorepo's plan-web dist
    const adapterFile = fileURLToPath(import.meta.url);
    const adapterDir = dirname(adapterFile);
    // adapter is in packages/pi-adapter/src/
    // web dist is in packages/plan-web-ui/dist/
    return join(adapterDir, "..", "..", "plan-web-ui", "dist");
  } catch {
    return undefined;
  }
}

async function maybeStartWeb(ctx: ExtensionContext): Promise<void> {
  if (server) {
    plannerSessionEnabled = true;
    return;
  }
  const ans = await ctx.ui.input("Planner active for this session. Start the web UI now? (y/N)");
  if (ans && /^(y|yes|s|si|sì)$/i.test(ans.trim())) {
    ctx.ui.notify("Starting web server…", "info");
    try {
      await startServer(ctx);
      ctx.ui.notify(`Web UI ready. Open: ${(server as ServeHandle | null)?.url ?? "?"}`, "info");
    } catch (err) {
      ctx.ui.notify(`Failed to start web server: ${String(err)}`, "error");
    }
  }
}

function normalizeVisibility(input: string | undefined): "local" | "lan" | undefined {
  const v = (input ?? "").trim().toLowerCase();
  if (!v) return undefined;
  if (v === "lan" || v === "network" || v === "0.0.0.0") return "lan";
  if (v === "local" || v === "localhost" || v === "127.0.0.1") return "local";
  return undefined;
}

async function promptWebVisibility(ctx: ExtensionContext): Promise<"local" | "lan"> {
  try {
    const ans = await ctx.ui.input("Web UI visibility: (local) only this machine  /  (lan) visible on the local network? [local/lan]");
    const v = normalizeVisibility(ans);
    if (v) return v;
  } catch {}
  return "local";
}

async function startServer(ctx: ExtensionContext, requestedPort?: number, visibility: "local" | "lan" = "local"): Promise<void> {
  plannerSessionEnabled = true;
  if (server) return;
  const host = visibility === "lan" ? "0.0.0.0" : "127.0.0.1";
  const port = await pickProjectPort(ctx, requestedPort);
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
    // EADDRINUSE or other listen failure: retry on a random free port.
    if (e instanceof Error && /EADDRINUSE|EACCES|EADDRNOTAVAIL/.test(e.message)) {
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
        ctx.ui.notify(`Planner web server: requested port ${port} busy, started on ${server?.url ?? "?"} instead.`, "info");
      } catch (e2) {
        ctx.ui.notify(`Failed to start web server (also retry failed): ${e2 instanceof Error ? e2.message : String(e2)}`, "error");
      }
    } else {
      ctx.ui.notify(`Failed to start web server: ${e instanceof Error ? e.message : String(e)}`, "error");
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
        project.webPort = realPort;
        await st.saveProject(project);
      }
    } catch {}
  }
}

async function stopServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
  }
  capturedPi?.appendEntry("plan-web-state", { running: false });
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
    let enablePlanner = false;
    if (exists) {
      if (project?.plannerAutoEnable) {
        enablePlanner = true; // 'always' persisted — no prompt
      } else if (project?.plannerNeverAsk) {
        enablePlanner = false; // 'never' persisted — no prompt, no activation
      } else {
        try {
          const ans = await ctx.ui.input("Planner detected in this project. Enable the planner extension? (y)es / (n)o / (a)lways / n(e)ver)");
          const normalized = ans?.trim().toLowerCase() ?? "";
          if (["a", "always", "sempre"].includes(normalized)) {
            enablePlanner = true;
            if (project) { project.plannerAutoEnable = true; project.plannerNeverAsk = false; await st.saveProject(project); }
            ctx.ui.notify("Saved: planner will auto-enable for this project.", "info");
          } else if (["e", "never", "mai"].includes(normalized)) {
            enablePlanner = false;
            if (project) { project.plannerNeverAsk = true; project.plannerAutoEnable = false; await st.saveProject(project); }
            try { capturedPi?.appendEntry("plan-web-state", { running: false }); } catch {}
            ctx.ui.notify("Saved: planner will not ask again for this project. Use '/planner load' to re-enable manually.", "info");
          } else if (/^(y|yes|s|si|sì)$/i.test(normalized)) {
            enablePlanner = true; // this session only
          } else {
            // 'n' / 'no' / empty — this session only, NOT persisted
            enablePlanner = false;
            try { capturedPi?.appendEntry("plan-web-state", { running: false }); } catch {}
            ctx.ui.notify("Planner disabled for this session. Use '/planner load' to enable manually.", "info");
          }
        } catch {
          enablePlanner = false;
          try { capturedPi?.appendEntry("plan-web-state", { running: false }); } catch {}
        }
      }
    }
    plannerSessionEnabled = enablePlanner;

    // Proactive check for leftover handoff files.
    if (plannerSessionEnabled) {
      const handoffPath = join(st.root, "HANDOFF.md");
      if (existsSync(handoffPath)) {
        ctx.ui.notify("🚨 HANDOFF DETECTED: Read and delete .planner/HANDOFF.md immediately to avoid state conflicts.", "warning");
      }
    }

    // If the user declined enablement, skip EVERYTHING (no web prompt, no migration, no summary).
    if (exists && !enablePlanner) {
      startupResumePromptPending = false;
      startupResumeSummaryPending = false;
      return;
    }

    // ── Step 2: Web UI gating (only if planner enabled) ─────────────
    startupResumePromptPending = exists && plannerSessionEnabled;
    startupResumeSummaryPending = exists && plannerSessionEnabled;
    if (exists && plannerSessionEnabled) {
      // Migration first.
      try { await migrateToUuids(st); } catch (e) {
        ctx.ui.notify(`Migration failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      await st.ensureStructureOrdering().catch(() => {});
      // Reconcile derived statuses once on startup: backfills any drift from
      // manual edits, pre-fix data, or tools that bypassed the rollup.
      await st.syncStatuses().catch(() => {});

      // Decide whether to start the web UI based on persisted prefs or prompt.
      let startWeb = false;
      if (project?.plannerAutoStartWeb) {
        startWeb = true; // 'always' persisted
      } else if (project?.plannerNeverStartWeb) {
        startWeb = false; // 'never' persisted
      } else if (server === null) {
        try {
          const ans = await ctx.ui.input("Start the planner web UI? (y)es / (n)o / (a)lways / n(e)ver)");
          const normalized = ans?.trim().toLowerCase() ?? "";
          if (["a", "always", "sempre"].includes(normalized)) {
            startWeb = true;
            if (project) { project.plannerAutoStartWeb = true; project.plannerNeverStartWeb = false; await st.saveProject(project); }
          } else if (["e", "never", "mai"].includes(normalized)) {
            startWeb = false;
            if (project) { project.plannerNeverStartWeb = true; project.plannerAutoStartWeb = false; await st.saveProject(project); }
          } else if (/^(y|yes|s|si|sì)$/i.test(normalized)) {
            startWeb = true;
          } else {
            startWeb = false; // 'n' / 'no' / empty — this session only
          }
        } catch {
          startWeb = false;
        }
      }

      if (startWeb && server === null) {
        const visibility = await promptWebVisibility(ctx);
        await startServer(ctx, preferredPort, visibility).catch(() => {});
        const srv = server as ServeHandle | null;
        if (srv) {
          const urls = srv.lanUrl ? `${srv.localUrl} (LAN: ${srv.lanUrl})` : srv.url;
          ctx.ui.notify(`Web UI started at ${urls}`, "info");
        }
      }

      const url = (server as ServeHandle | null)?.url ?? "Starting server...";
      ctx.ui.notify(`Planner enabled. Dashboard: ${url}\nAnalyzing project state and preparing resume summary...`, "info");
      await ensureProjectLanguagePreferences(st).catch(() => null);
      await maybeHealStatuses(st).catch(() => {});
      // Background cleanup of orphan .bak/.tmp.* files (non-blocking)
      st.cleanupOrphanBackups().catch(() => {});
      const handoff = await st.loadHandoff().catch(() => null);
      if (handoff?.content) {
        ctx.ui.notify(`Handoff detected at .planner/HANDOFF.md (updated ${handoff.updatedAt}). It will be loaded automatically when the agent starts.`, "info");
      }

      pi.sendMessage({
        customType: "planner-resume-trigger",
        content: "Emit the mandatory planner startup resume summary now.",
        display: false,
      }, {
        triggerTurn: true,
      });
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
    const hasVisibleText = event.message.content.some((item) => item.type === "text" && Boolean((item as { text?: string }).text?.trim()));
    if (!hasVisibleText) return;

    startupResumeSummaryPending = false;
    const summaryText = startupResumeSummaryText.trim();
    startupResumeSummaryText = "";
    if (!summaryText) return;

    return {
      message: {
        ...event.message,
        content: [{ type: "text", text: summaryText }],
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

    const st = loadStore(ctx);
    if (!(await st.exists().catch(() => false))) return;
    await maybeHealStatuses(st).catch(() => {});

    const guard = await getPlannerExecutionGuard(st).catch(() => null);
    if (!guard || guard.totalTasks === 0) return; // nothing to enforce yet
    if (guard.inProgressTaskIds.length > 0) return; // a task is open → we're good

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

  async function handlePlanner(args: string, ctx: ExtensionContext): Promise<void> {
    await withPlanBusy(() => runPlanner(args, ctx));
  }

  async function runPlanner(args: string, ctx: ExtensionContext): Promise<void> {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const [a, b, ...rest] = parts;
    const subArgs = rest.join(" ");

    const PLANNER_MENU_ACTIONS = [
      "init",
      "show",
      "repair",
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
      "disable",
    ];

    const SUB_HELP = "Available: init, show, repair, project, feature, phase, task, discuss, handoff, web, export, export-full, bypass, clear-bypass, load, disable\n" +
      "Try: /planner <TAB>  |  /planner feature list  |  /planner task start  |  /planner export-full\n" +
      "Handoff actions: /planner handoff prepare | show | write | clear";

    if (!a) {
      const action = await ctx.ui.select("Planner action", PLANNER_MENU_ACTIONS);
      if (!action) {
        ctx.ui.notify(SUB_HELP, "info");
        return;
      }
      await runPlanner(action, ctx);
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
        ctx.ui.notify("Resetting project... all current plan data will be lost.", "warning");
        
        if (server) {
          ctx.ui.notify("Stopping active web server...", "info");
          await server.close();
          server = null;
        }
        await rm(st.root, { recursive: true, force: true });

        const name = await ctx.ui.input(`Project title [${oldProject.name}]`);
        if (!name?.trim()) { ctx.ui.notify("Aborted", "warning"); return; }
        const description = await ctx.ui.input(`Short project description [${oldProject.description || ""}]`);
        
        await st.init(name.trim());
        const project = await st.loadProject();
        project.description = description?.trim() ?? oldProject.description;
        await st.saveProject(project);
        await st.writeGenerated();
        await scanCodebase();
        ctx.ui.notify(`.planner/ initialized for "${name.trim()}". Starting project discuss…`, "info");
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
      const features = (await st.loadFeatures().catch(() => ({ features: [] as Feature[] }))).features;
      if (features.length === 0) return null;
      const list = features.map((f, i) => `  ${i + 1}. ${statusIcon(f.status)} ${f.name} (${f.id})`).join("\n");
      ctx.ui.notify(`Pick a feature:\n${list}`, "info");
      const pick = await ctx.ui.input("Enter feature number");
      if (!pick?.trim()) return null;
      const idx = parseInt(pick.trim(), 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= features.length) {
        ctx.ui.notify("Invalid number", "error");
        return null;
      }
      return features[idx]!;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Helper: pick a phase interactively
    // ═══════════════════════════════════════════════════════════════
    async function pickPhase(): Promise<Phase | null> {
      const phases = await st.loadAllPhases().catch(() => [] as Phase[]);
      if (phases.length === 0) { return null; }
      const list = phases.map((p, i) =>
        `  ${i + 1}. ${statusIcon(p.status)} ${p.title} (${p.id})`
      ).join("\n");
      ctx.ui.notify(`Pick a phase:\n${list}`, "info");
      const pick = await ctx.ui.input("Enter phase number");
      if (!pick?.trim()) return null;
      const idx = parseInt(pick.trim(), 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= phases.length) {
        ctx.ui.notify("Invalid number", "error");
        return null;
      }
      return phases[idx]!;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Helper: pick a task interactively from a phase
    // ═══════════════════════════════════════════════════════════════
    async function pickTask(phase: Phase): Promise<Task | null> {
      if (phase.tasks.length === 0) return null;
      const list = phase.tasks.map((t, i) =>
        `  ${i + 1}. ${statusIcon(t.status)} ${t.title} (${t.id})`
      ).join("\n");
      ctx.ui.notify(`Pick a task from "${phase.title}":\n${list}`, "info");
      const pick = await ctx.ui.input("Enter task number");
      if (!pick?.trim()) return null;
      const idx = parseInt(pick.trim(), 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= phase.tasks.length) {
        ctx.ui.notify("Invalid number", "error");
        return null;
      }
      return phase.tasks[idx]!;
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
      return features.find((feature) => feature.id.toLowerCase() === normalized)
        ?? features.find((feature) => feature.name.toLowerCase() === normalized)
        ?? features.find((feature) => feature.name.toLowerCase().includes(normalized))
        ?? null;
    }

    function findPhaseByRef(phases: Phase[], ref: string): Phase | null {
      const normalized = ref.trim().toLowerCase();
      if (!normalized) return null;
      return phases.find((phase) => phase.id.toLowerCase() === normalized)
        ?? phases.find((phase) => phase.title.toLowerCase() === normalized)
        ?? phases.find((phase) => phase.title.toLowerCase().includes(normalized))
        ?? null;
    }

    function findTaskByRef(phases: Phase[], ref: string): { phase: Phase; task: Task } | null {
      const normalized = ref.trim().toLowerCase();
      if (!normalized) return null;
      for (const phase of phases) {
        const task = phase.tasks.find((entryTask) =>
          entryTask.id.toLowerCase() === normalized
          || entryTask.title.toLowerCase() === normalized
          || entryTask.title.toLowerCase().includes(normalized));
        if (task) return { phase, task };
      }
      return null;
    }

    function profile_packageManager(pkg: CodebaseProfile["packageJson"], lockfile: string): string {
      if (pkg?.packageManager) return pkg.packageManager;
      if (lockfile === "pnpm-lock.yaml") return "pnpm";
      if (lockfile === "yarn.lock") return "yarn";
      if (lockfile === "bun.lockb") return "bun";
      if (lockfile === "package-lock.json") return "npm";
      return "";
    }

    async function scanCodebase(): Promise<CodebaseProfile> {
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
      await st.saveCodebaseProfile(profile);
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
        const project = await ensureProjectLanguagePreferences(st);
        const profile = await scanCodebase();
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
        ctx.ui.notify("feature actions: list  |  add [name]  |  show [id|name]  |  update [id|name]  |  delete [id|name]", "info");
        return;
      }
      if (b === "list") {
        const features = (await st.loadFeatures()).features;
        if (features.length === 0) {
          ctx.ui.notify("No features", "info");
          return;
        }
        const phases = await st.loadAllPhases();
        ctx.ui.notify(features.map((feature) => {
          const featurePhases = phases.filter((phase) => phase.featureId === feature.id);
          const taskCount = featurePhases.reduce((total, phase) => total + phase.tasks.length, 0);
          return `${statusIcon(feature.status)} ${feature.name} (${feature.id}) — ${featurePhases.length} phases, ${taskCount} tasks`;
        }).join("\n"), "info");
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
        const featureNumber = (await st.loadFeatures()).features.length + 1;
        const feature: Feature = {
          id: createFeatureId(),
          number: featureNumber,
          name: nameInput.trim(),
          description: description?.trim() ?? "",
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
          createdAt: now,
          updatedAt: now,
        };
        await st.updateFeatures((doc) => {
          doc.features.push(feature);
          return doc;
        });
        await st.writeGenerated();
        ctx.ui.notify(`Feature created: ${feature.id} — ${feature.name}`, "info");
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
        ctx.ui.notify(`Feature updated: ${feature.id} — ${feature.name} (${feature.status})`, "info");
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
      ctx.ui.notify(`Unknown feature action "${b}". Try: list, add, show, update, delete`, "warning");
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
        let phase: Phase | undefined;
        await withFeatureLock(feature.id, async () => {
          const phases = await st.loadAllPhases();
          const featurePhases = phases.filter((p) => p.featureId === feature.id);
          const number = featurePhases.reduce((max, p) => Math.max(max, p.number), 0) + 1;
          const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const id = createPhaseId();
          phase = {
            id, number, slug, title, featureId: feature.id, status: "draft", discussedAt: "", contextReady: false, contextReadyReason: "", summary: "", description: "", notes: "",
            goals: [], nonGoals: [], dependencies: [], dependsOn: [], risks: [],
            openQuestions: [], decisions: [], acceptedDecisions: [], completionCriteria: [], taskIds: [], tasks: [],
            createdAt: nowISO(), updatedAt: nowISO(),
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
        ctx.ui.notify(`Phase created: ${phase.id} — ${title} (feature ${feature.name})`, "info");
        const startDiscuss = await ctx.ui.input("Start phase discuss now? Type yes to continue");
        if (isYes(startDiscuss)) {
          await handlePlanner(`phase discuss ${phase.id}`, ctx);
        }
        return;
      }
      if (b === "discuss") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = findPhaseByRef(await st.loadAllPhases(), subArgs.trim());
        }
        if (!phase) {
          phase = await pickPhase();
          if (!phase) { ctx.ui.notify("No phases to discuss. Create one first.", "warning"); return; }
        }

        if (phase.status !== "draft" && phase.status !== "discovery" && phase.status !== "planned") {
          ctx.ui.notify(`Phase is already "${phase.status}". Re-discuss works best on draft/discovery/planned phases.`, "info");
        }

        phase.status = "discovery";
        phase.updatedAt = nowISO();
        await st.savePhase(phase);
        ctx.ui.notify(`Discovery for ${phase.id}…`, "info");

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
        ctx.ui.notify(`Phase ${phase.id} is now **planned**.`, "info");
        return;
      }
      if (b === "show") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = await st.loadPhase(subArgs.trim()).catch(() => null);
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
          phase = await st.loadPhase(subArgs.trim()).catch(() => null);
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
        ctx.ui.notify(`Phase deleted: ${phase.id}`, "info");
        return;
      }
      if (b === "update") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = await st.loadPhase(subArgs.trim()).catch(() => null);
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
        ctx.ui.notify(`Phase updated: ${phase.id} — ${phase.title} (${phase.status})`, "info");
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
        ctx.ui.notify("task actions: add  |  show [id]  |  discuss [id|name]  |  delete  |  update  |  start [id]  |  complete [id]", "info");
        return;
      }
      if (b === "add") {
        const phase = await pickPhase();
        if (!phase) { ctx.ui.notify("Aborted", "warning"); return; }
        const title = await ctx.ui.input(`Task title (for "${phase.title}")`);
        if (!title?.trim()) { ctx.ui.notify("Aborted", "warning"); return; }
        const shortName = title.trim().toLowerCase()
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
        const taskNum = phase.tasks.length + 1;
        const taskId = createTaskId();
        const now = nowISO();
        const task: Task = {
          id: taskId, phaseId: phase.id, number: taskNum, shortName,
          title: title.trim(), status: "planned",
          description: "",
          notes: "",
          statusLog: [],
          decisions: [],
          acceptedDecisions: [],
          checklist: [], subtasks: [],
          dependsOn: [],
          startedAt: "", completedAt: "",
          createdAt: now, updatedAt: now,
        };
        phase.tasks.push(task);
        phase.taskIds.push(taskId);
        phase.updatedAt = nowISO();
        await st.savePhase(phase);
        await st.writeGenerated();
        ctx.ui.notify(`Task created: ${taskId} — ${title}`, "info");
        const startDiscuss = await ctx.ui.input("Start task discuss now? Type yes to continue");
        if (isYes(startDiscuss)) {
          await handlePlanner(`task discuss ${taskId}`, ctx);
        }
        return;
      }
      if (b === "discuss") {
        const phases = await st.loadAllPhases();
        let resolved = subArgs.trim() ? findTaskByRef(phases, subArgs.trim()) : null;
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
          task.checklist = splitCsv(checklistSeed).map((itemTitle, index) => ({
            id: createChecklistItemId(task.id, index + 1, itemTitle),
            title: itemTitle,
            checked: false,
          }));
        }
        task.updatedAt = nowISO();
        phase.updatedAt = nowISO();
        await st.savePhase(phase);
        await st.writeGenerated();
        ctx.ui.notify(`Task ${task.id} discussed and updated.`, "info");
        return;
      }
      if (b === "show") {
        let phase: Phase | null = null;
        let task: Task | null = null;
        if (subArgs.trim()) {
          const resolved = findTaskByRef(await st.loadAllPhases(), subArgs.trim());
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
          phase = await st.loadPhase(subArgs.trim()).catch(() => null);
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
        ctx.ui.notify(`Task deleted: ${task.id}`, "info");
        return;
      }
      if (b === "update") {
        let phase: Phase | null = null;
        if (subArgs.trim()) {
          phase = await st.loadPhase(subArgs.trim()).catch(() => null);
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
          if (normalizedStatus === "in-progress" && existsSync(join(st.root, "HANDOFF.md"))) {
            ctx.ui.notify("🚨 HYGIENE VIOLATION: A pending handoff file exists at .planner/HANDOFF.md. You MUST read and delete it before you can move a task to in-progress.", "error");
            return;
          }
          applyTaskLifecycleDates(task, normalizedStatus as Task["status"], now);
        }
        if (desc?.trim()) task.description = desc.trim();
        task.updatedAt = now;
        phase.updatedAt = now;
        await st.savePhase(phase);
        await st.writeGenerated();
        ctx.ui.notify(`Task updated: ${task.id} — ${task.title} (${task.status})`, "info");
        return;
      }
      if (b === "start") {
        let phase: Phase | null = null;
        let task: Task | null = null;
        if (subArgs.trim()) {
          const resolved = findTaskByRef(await st.loadAllPhases(), subArgs.trim());
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
        if (task.status === "in-progress") {
          ctx.ui.notify(`Task "${task.title}" is already in-progress.`, "info");
          return;
        }
        // Hygiene Gate: block starting work if a pending handoff exists.
        if (existsSync(join(st.root, "HANDOFF.md"))) {
          ctx.ui.notify("🚨 HYGIENE VIOLATION: A pending handoff file exists at .planner/HANDOFF.md. You MUST read and delete it before you can officially start a task.", "error");
          return;
        }
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
        await st.writeGenerated();
        ctx.ui.notify(`✅ Task started: ${task.id} — ${task.title} (in-progress)`, "info");
        return;
      }
      if (b === "complete") {
        let phase: Phase | null = null;
        let task: Task | null = null;
        if (subArgs.trim()) {
          const resolved = findTaskByRef(await st.loadAllPhases(), subArgs.trim());
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
        await st.savePhase(phase!);
        await st.writeGenerated();
        ctx.ui.notify(`✅ Task completed: ${task.id} — ${task.title} (done)`, "info");
        return;
      }
      ctx.ui.notify(`Unknown task action "${b}". Try: add, show, discuss, delete, update, start, complete`, "warning");
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
      if (!(await st.exists())) { ctx.ui.notify("No .planner/ found.", "warning"); return; }
      if (action === "show") {
        const handoff = await st.loadHandoff();
        if (!handoff) { ctx.ui.notify("No .planner/HANDOFF.md present.", "info"); return; }
        ctx.ui.notify(handoff.content, "info");
        return;
      }
      if (action === "prepare" || action === "write") {
        if (action === "prepare") {
          if (!capturedPi) { ctx.ui.notify("Agent bridge unavailable; use /planner handoff write for an auto-generated handoff.", "warning"); return; }
          const handoff = await st.loadHandoff();
          await capturedPi.sendUserMessage(
            "Prepare the canonical session handoff now and write it to `.planner/HANDOFF.md` using the `plan_write_handoff` tool.\n\n" +
            "The handoff MUST be a structured markdown document containing at minimum:\n" +
            "- `Created at:` and `Updated at:` lines (ISO timestamps)\n" +
            "- `Reason:` why this handoff is being written\n" +
            "- `## Current focus`: the current feature (id + name + status), phase (id + title + status) and task (id + title + status). Derive them from the plan data.\n" +
            "- `## What was being done`: a concrete 3–10 line narrative of the work in progress, based on our conversation and the current task notes/description.\n" +
            "- `## How to resume`: explicit, ordered steps to pick the work back up (next command / tool / file to open / build to run).\n" +
            "- `## Files touched`: explicit file paths modified during this session.\n" +
            "- `## Blockers`: any open blockers, or `None recorded`.\n" +
            "- `## Next steps`: the immediate next steps.\n" +
            "- `## Recent decisions`: accepted decisions made this session, if any.\n" +
            "- `## Reminder`: note that when the work is fully resumed, the agent must delete `.planner/HANDOFF.md` using `plan_delete_handoff`.\n\n" +
            "Do NOT write the handoff to `.pi/`. The canonical path is `.planner/HANDOFF.md`. " +
            (handoff?.content ? "A previous handoff exists; refresh its `Updated at` and merge/replace stale sections. " : "") +
            "Once written, confirm to me with a one-line summary."
          );
          ctx.ui.notify("Instructing the agent to prepare .planner/HANDOFF.md…", "info");
          return;
        }
        // action === "write": auto-generate from plan data without agent narrative.
        const whatWasBeingDone = await ctx.ui.input("What was being done? (optional override)");
        const howToResume = await ctx.ui.input("How should the next agent resume? (optional override)");
        await writeProjectHandoff(st, "manual on-demand handoff", {
          ...(whatWasBeingDone?.trim() ? { whatWasBeingDone: whatWasBeingDone.trim() } : {}),
          ...(howToResume?.trim() ? { howToResume: howToResume.trim() } : {}),
        });
        ctx.ui.notify("Wrote .planner/HANDOFF.md", "info");
        return;
      }
      if (action === "clear" || action === "delete") {
        await st.deleteHandoff();
        ctx.ui.notify("Deleted .planner/HANDOFF.md", "info");
        return;
      }
      ctx.ui.notify("handoff actions: prepare | show | write | clear\nUse: /planner handoff prepare | show | write | clear", "info");
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
          const visibility = visibilityArg ?? await promptWebVisibility(ctx);
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
      ctx.ui.notify(`Repair done: renamed ${m.renamed}, repaired ${m.repaired} refs, inferred ${m.inferred}. Integrity: ${dup} duplicate, ${dang} dangling.`, "info");
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
          const until = await st.authorizeGuardBypass(Number.isFinite(mins) && mins > 0 ? mins : 15);
          ctx.ui.notify(`Guard bypass authorized until ${until}. edit/write will work without a task in-progress for that window.`, "info");
        } else {
          await st.clearGuardBypass();
          ctx.ui.notify("Guard bypass revoked. edit/write now requires a task in-progress again.", "info");
        }
      } catch (e) {
        ctx.ui.notify(`Bypass action failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      return;
    }

    if (a === "load") {
      const project = await st.loadProject().catch(() => null);
      if (project) {
        let changed = false;
        if (project.plannerNeverAsk) { project.plannerNeverAsk = false; changed = true; }
        if (project.plannerNeverStartWeb) { project.plannerNeverStartWeb = false; changed = true; }
        if (changed) {
          await st.saveProject(project);
          ctx.ui.notify("Cleared 'never' flags. Planner enabled for this session.", "info");
        }
      }
      plannerSessionEnabled = true;
      if (!server) {
        ctx.ui.notify("Starting web server …", "info");
        await startServer(ctx);
      }
      ctx.ui.notify(`Planner loaded. Web UI: ${server?.url ?? "(not started)"}`, "info");
      return;
    }

    if (a === "disable") {
      const project = await st.loadProject().catch(() => null);
      if (project) {
        project.plannerAutoEnable = false;
        project.plannerNeverAsk = false;
        project.plannerAutoStartWeb = false;
        project.plannerNeverStartWeb = false;
        await st.saveProject(project);
      }
      plannerSessionEnabled = false;
      await stopServer().catch(() => {});
      try { capturedPi?.appendEntry("plan-web-state", { running: false }); } catch {}
      ctx.ui.notify("Planner preferences reset to 'ask'. Disabled for this session. Next restart will prompt again.", "info");
      return;
    }

    ctx.ui.notify(`Unknown "${a}". ${SUB_HELP}`, "warning");
  }

  // ── Single /planner command (hierarchical with spaces) ──────────
  pi.registerCommand("planner", {
    description: "Grouped planner command. Use /planner <TAB> for subcommands or /planner to open the menu.",
    getArgumentCompletions: (prefix) => {
      const normalized = prefix.trim().toLowerCase();
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
    await maybeHealStatuses(st);
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
      const requirements = await st.loadRequirements();
      const now = nowISO();
      const requirement: Requirement = {
        id: createRequirementId(),
        title: params.title.trim(),
        description: params.description?.trim() ?? "",
        status: (params.status?.trim() as Requirement["status"] | undefined) ?? "planned",
        macroTasks: [],
        linkedPhaseIds: (params.linkedPhaseIds ?? []).map((entry) => entry.trim()).filter(Boolean),
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
      if (params.title !== undefined) requirement.title = params.title.trim();
      if (params.description !== undefined) requirement.description = params.description.trim();
      if (params.status !== undefined) requirement.status = params.status.trim() as Requirement["status"];
      if (params.linkedPhaseIds !== undefined) requirement.linkedPhaseIds = params.linkedPhaseIds.map((entry) => entry.trim()).filter(Boolean);
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
    description: "Regenerate all generated markdown views in .planner/generated/. Call after any data change to keep docs in sync.",
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
    description: "Repair dangling feature→phase references and report plan integrity (duplicate phase ids, dangling phase refs). Safe to run anytime; run if the planner reports ENOENT/phase not found or after manual edits to .planner/.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const report = await st.repair();
      const m = report.migrated;
      const lines = [
        `Repair complete.`,
        `Migration: renamed=${m.renamed}, repaired=${m.repaired} refs, inferred=${m.inferred}.`,
        `Integrity: duplicatePhaseIds=${report.integrity.duplicatePhaseIds.length}, danglingPhaseIds=${report.integrity.danglingPhaseIds.length}.`,
      ];
      if (report.integrity.danglingPhaseIds.length) lines.push("Dangling: " + report.integrity.danglingPhaseIds.join(", "));
      if (report.integrity.duplicatePhaseIds.length) lines.push("Duplicates: " + report.integrity.duplicatePhaseIds.join(", "));
      return { content: [{ type: "text", text: lines.join("\n") }], details: report };
    },
  });

  pi.registerTool({
    name: "plan_get_handoff",
    label: "Plan Get Handoff",
    description: "Read the current .planner/HANDOFF.md if present.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const handoff = await st.loadHandoff();
      if (!handoff) return { content: [{ type: "text", text: "No .planner/HANDOFF.md present." }], details: { exists: false } };
      return { content: [{ type: "text", text: handoff.content }], details: { exists: true, ...handoff } };
    },
  });

  pi.registerTool({
    name: "plan_write_handoff",
    label: "Plan Write Handoff",
    description: "Write or refresh the canonical .planner/HANDOFF.md document.",
    parameters: Type.Object({
      reason: Type.Optional(Type.String({ description: "Why the handoff is being written" })),
      whatWasBeingDone: Type.Optional(Type.String({ description: "Optional override for the current work summary" })),
      howToResume: Type.Optional(Type.String({ description: "Optional override for resume instructions" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      await writeProjectHandoff(st, params.reason?.trim() || "manual tool handoff", {
        ...(params.whatWasBeingDone?.trim() ? { whatWasBeingDone: params.whatWasBeingDone.trim() } : {}),
        ...(params.howToResume?.trim() ? { howToResume: params.howToResume.trim() } : {}),
      });
      const handoff = await st.loadHandoff();
      return { content: [{ type: "text", text: "Wrote .planner/HANDOFF.md" }], details: handoff ?? {} };
    },
  });

  pi.registerTool({
    name: "plan_delete_handoff",
    label: "Plan Delete Handoff",
    description: "Delete .planner/HANDOFF.md after the resume has been fully consumed.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      await st.deleteHandoff();
      return { content: [{ type: "text", text: "Deleted .planner/HANDOFF.md" }], details: { deleted: true } };
    },
  });

  pi.registerTool({
    name: "plan_authorize_bypass",
    label: "Plan Authorize Guard Bypass",
    description: "Authorize a temporary guard bypass (default 15 minutes) so edit/write tools can proceed even when no task is in-progress. Use this ONLY after the user explicitly authorizes proceeding without a task. Harness-agnostic: stored in resume.json so all adapters respect it.",
    parameters: Type.Object({
      durationMinutes: Type.Optional(Type.Number({ description: "Bypass window in minutes. Default 15." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const mins = params.durationMinutes ?? 15;
      const until = await st.authorizeGuardBypass(mins);
      return { content: [{ type: "text", text: `Guard bypass authorized until ${until}. edit/write is allowed without a task in-progress for ${mins} minutes.` }], details: { until } };
    },
  });

  pi.registerTool({
    name: "plan_clear_bypass",
    label: "Plan Clear Guard Bypass",
    description: "Revoke any active guard bypass so edit/write again requires a task in-progress.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      await st.clearGuardBypass();
      return { content: [{ type: "text", text: "Guard bypass revoked." }], details: { cleared: true } };
    },
  });

  // ── features ────────────────────────────────────────────────────────

  pi.registerTool({
    name: "feature_list",
    label: "Feature List",
    description: "List all features with their ids, statuses, and phase counts.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const phases = await st.loadAllPhases();
      const summary = features.map((f) => {
        const fp = phases.filter((p) => p.featureId === f.id);
        return `- ${statusIcon(f.status)} ${f.id} — ${f.name} (${fp.length} phases, ${fp.reduce((t, p) => t + p.tasks.length, 0)} tasks)`;
      }).join("\n");
      return { content: [{ type: "text", text: summary || "No features" }], details: { features } };
    },
  });

  pi.registerTool({
    name: "feature_get",
    label: "Feature Get",
    description: "Read full details of a feature, including its phases and their tasks.",
    parameters: Type.Object({
      featureId: Type.String({ description: "Feature ID, e.g. feature-001-dynamic-header" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const features = (await st.loadFeatures()).features;
      const feature = features.find((f) => f.id === params.featureId);
      if (!feature) return { content: [{ type: "text", text: `Feature not found: ${params.featureId}` }], details: {} };
      const phases = (await st.loadAllPhases()).filter((p) => p.featureId === feature.id);
      return { content: [{ type: "text", text: `${statusIcon(feature.status)} ${feature.name} (${feature.id}) — ${phases.length} phases` }], details: { feature, phases } };
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
      const feature: Feature = {
        id: createFeatureId(),
        number: currentFeatures.length + 1,
        name: params.name,
        description: params.description ?? "",
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
      return { content: [{ type: "text", text: `Feature created: ${feature.id}` }], details: feature };
    },
  });

  pi.registerTool({
    name: "feature_update",
    label: "Feature Update",
    description: "Update one or more fields of a feature. Only provided fields are changed. IMPORTANT: feature status is derived from child phases/tasks, so do not update feature.status directly unless truly necessary.",
    parameters: Type.Object({
      featureId: Type.String({ description: "Feature ID" }),
      name: Type.Optional(Type.String({ description: "New name" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      status: Type.Optional(Type.String({ description: "New status: planned|in-progress|done|blocked|canceled. Avoid setting this directly unless you truly need an override: feature status is derived from child phases/tasks." })),
      startDate: Type.Optional(Type.String({ description: "Start date (YYYY-MM-DD)" })),
      endDate: Type.Optional(Type.String({ description: "End date (YYYY-MM-DD)" })),
      workDone: Type.Optional(Type.String({ description: "Notes on work done" })),
      workRemaining: Type.Optional(Type.String({ description: "Notes on remaining work" })),
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
      let foundDoc: FeaturesDocument | undefined;
      try {
        foundDoc = await st.updateFeatures((doc) => {
          const feature = doc.features.find((f) => f.id === params.featureId);
          if (!feature) return doc; // not found: no-op, handled below

          if (params.name !== undefined) feature.name = params.name;
          if (params.description !== undefined) feature.description = params.description;
          if (params.workDone !== undefined) feature.workDone = params.workDone;
          if (params.workRemaining !== undefined) feature.workRemaining = params.workRemaining;
          if (params.startDate !== undefined) feature.startDate = params.startDate;
          if (params.endDate !== undefined) feature.endDate = params.endDate;
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
      const feature = foundDoc?.features.find((f) => f.id === params.featureId);
      if (!feature) return { content: [{ type: "text", text: `Feature not found: ${params.featureId}` }], details: {} };
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Feature updated: ${feature.id} (${feature.status})` }], details: feature };
    },
  });

  pi.registerTool({
    name: "feature_delete",
    label: "Feature Delete",
    description: "Delete a feature. Its phases are unlinked (featureId cleared) but NOT deleted unless cascade=true.",
    parameters: Type.Object({
      featureId: Type.String({ description: "Feature ID to delete" }),
      cascade: Type.Optional(Type.Boolean({ description: "If true, also delete all phases belonging to this feature. Default: false" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      let deleted = false;
      await st.updateFeatures((doc) => {
        const before = doc.features.length;
        doc.features = doc.features.filter((f) => f.id !== params.featureId);
        if (doc.features.length !== before) deleted = true;
        return doc;
      });
      if (!deleted) {
        return { content: [{ type: "text", text: `Feature not found: ${params.featureId}` }], details: {} };
      }

      let cascadeCount = 0;
      if (params.cascade) {
        const phases = await st.loadAllPhases();
        for (const phase of phases.filter((p) => p.featureId === params.featureId)) {
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
    description: "List all phases (optionally filtered by featureId) with id, status, and task counts.",
    parameters: Type.Object({
      featureId: Type.Optional(Type.String({ description: "If provided, only list phases of this feature" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      let phases = await st.loadAllPhases();
      if (params.featureId) phases = phases.filter((p) => p.featureId === params.featureId);
      const summary = phases.map((p) => `- ${statusIcon(p.status)} ${p.id} — ${p.title} (${p.tasks.length} tasks, feature ${p.featureId ?? "none"})`).join("\n");
      return { content: [{ type: "text", text: summary || "No phases" }], details: { phases } };
    },
  });

  pi.registerTool({
    name: "phase_get",
    label: "Phase Get",
    description: "Read full details of a phase, including its tasks.",
    parameters: Type.Object({
      phaseId: Type.String({ description: "Phase ID, e.g. phase-01-setup" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      let phase: Phase;
      try {
        phase = await st.loadPhase(params.phaseId);
      } catch {
        return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      }
      return { content: [{ type: "text", text: `${statusIcon(phase.status)} ${phase.title} (${phase.id}) — ${phase.tasks.length} tasks` }], details: phase };
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
      if (!params.featureId?.trim()) return { content: [{ type: "text", text: "featureId is required: a phase must belong to a feature." }], details: {} };
      let phase: Phase | undefined;
      await withFeatureLock(params.featureId, async () => {
        const phases = await st.loadAllPhases();
        const featurePhases = phases.filter((p) => p.featureId === params.featureId);
        const number = featurePhases.reduce((max, p) => Math.max(max, p.number), 0) + 1;
        const id = createPhaseId();
        const now = nowISO();
        phase = {
          id, number, slug: normalizeSlug(params.title), title: params.title,
          featureId: params.featureId,
          status: (params.status as Phase["status"] | undefined) ?? "draft",
          discussedAt: "",
          contextReady: false,
          contextReadyReason: "",
          summary: params.summary ?? "", description: params.description ?? "", notes: "",
          goals: [], nonGoals: [], dependencies: [], dependsOn: [], risks: [],
          openQuestions: [], decisions: [], acceptedDecisions: [], completionCriteria: [], taskIds: [], tasks: [],
          createdAt: now, updatedAt: now,
        };
        await st.savePhase(phase);

        // Atomic: serialize concurrent phase_create linking to the same feature.
        await st.updateFeatures((doc) => {
          const feature = doc.features.find((f) => f.id === params.featureId);
          if (feature && !feature.phaseIds.includes(phase!.id)) {
            feature.phaseIds.push(phase!.id);
            feature.updatedAt = now;
          }
          return doc;
        });
        await st.writeGenerated();
      });
      if (!phase) return { content: [{ type: "text", text: "Phase creation failed." }], details: {} };
      return { content: [{ type: "text", text: `Phase created: ${phase.id}` }], details: phase };
    },
  });

  pi.registerTool({
    name: "phase_update",
    label: "Phase Update",
    description: "Update one or more fields of a phase. Only provided fields are changed. Supports re-linking to a feature via featureId. IMPORTANT: phase status is derived from task statuses, so do not update phase.status directly unless truly necessary.",
    parameters: Type.Object({
      phaseId: Type.String({ description: "Phase ID" }),
      title: Type.Optional(Type.String({ description: "New title" })),
      status: Type.Optional(Type.String({ description: "New status: draft|discovery|planned|in-progress|done|blocked|canceled. Avoid setting this directly unless you truly need an override: phase status is derived from task statuses." })),
      summary: Type.Optional(Type.String({ description: "New summary" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      featureId: Type.Optional(Type.String({ description: "Link/unlink phase to a feature. Use empty string to unlink." })),
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
      let phase: Phase;
      try {
        phase = await st.loadPhase(params.phaseId);
      } catch {
        return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      }

      const prevFeatureId = phase.featureId;
      if (params.title !== undefined) { phase.title = params.title; phase.slug = normalizeSlug(params.title); }
      if (params.status !== undefined) phase.status = params.status as Phase["status"];
      if (params.summary !== undefined) phase.summary = params.summary;
      if (params.description !== undefined) phase.description = params.description;
      if (params.goals !== undefined) phase.goals = params.goals;
      if (params.nonGoals !== undefined) phase.nonGoals = params.nonGoals;
      if (params.dependencies !== undefined) phase.dependencies = params.dependencies;
      if (params.risks !== undefined) phase.risks = params.risks;
      if (params.openQuestions !== undefined) phase.openQuestions = params.openQuestions;
      if (params.decisions !== undefined) phase.decisions = params.decisions;
      if (params.acceptedDecisions !== undefined) phase.acceptedDecisions = params.acceptedDecisions;
      if (params.completionCriteria !== undefined) phase.completionCriteria = params.completionCriteria;

      if (params.featureId !== undefined) {
        const nextFeatureId = params.featureId === "" ? undefined : params.featureId;
        phase.featureId = nextFeatureId;
        if (nextFeatureId !== prevFeatureId) {
          await st.updateFeatures((doc) => {
            for (const f of doc.features) {
              if (f.id === prevFeatureId) f.phaseIds = f.phaseIds.filter((pid) => pid !== phase.id);
              if (f.id === nextFeatureId && !f.phaseIds.includes(phase.id)) f.phaseIds.push(phase.id);
            }
            return doc;
          });
        }
      }

      phase.updatedAt = nowISO();
      await st.savePhase(phase);
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Phase updated: ${phase.id} (${phase.status})` }], details: phase };
    },
  });

  pi.registerTool({
    name: "phase_delete",
    label: "Phase Delete",
    description: "Delete a phase. Its tasks are deleted with it (cascade). Unlinks the phase from its feature.",
    parameters: Type.Object({
      phaseId: Type.String({ description: "Phase ID to delete" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      let phase: Phase | undefined;
      try {
        phase = await st.loadPhase(params.phaseId);
      } catch {
        return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      }
      await st.deletePhase(params.phaseId);
      if (phase.featureId) {
        await st.updateFeatures((doc) => {
          const feature = doc.features.find((f) => f.id === phase!.featureId);
          if (feature) {
            feature.phaseIds = feature.phaseIds.filter((pid) => pid !== params.phaseId);
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
    description: "List tasks of a phase with id, status, and title.",
    parameters: Type.Object({
      phaseId: Type.String({ description: "Phase ID" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      let phase: Phase;
      try {
        phase = await st.loadPhase(params.phaseId);
      } catch {
        return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      }
      const summary = phase.tasks.map((t) => `- ${statusIcon(t.status)} ${t.id} — ${t.title}`).join("\n");
      return { content: [{ type: "text", text: summary || "No tasks" }], details: { tasks: phase.tasks } };
    },
  });

  pi.registerTool({
    name: "task_get",
    label: "Task Get",
    description: "Read full details of a single task.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const phases = await st.loadAllPhases();
      const phase = phases.find((p) => p.tasks.some((t) => t.id === params.taskId));
      const task = phase?.tasks.find((t) => t.id === params.taskId);
      if (!task || !phase) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      return { content: [{ type: "text", text: `${statusIcon(task.status)} ${task.title} (${task.id}) — phase ${phase.id}` }], details: { task, phaseId: phase.id } };
    },
  });

  pi.registerTool({
    name: "task_create",
    label: "Task Create",
    description: "Add a task to a phase with a RICH description. REQUIRED: description must include code references (file:line), what already exists vs what needs to be built, specific structs/traits/systems to modify, concrete implementation steps, and edge cases to handle. The description is the execution context for agents; one-liners cause misalignment. Status defaults to planned.",
    parameters: Type.Object({
      phaseId: Type.String({ description: "Phase ID the task belongs to" }),
      title: Type.String({ description: "Task title" }),
      description: Type.String({ description: "REQUIRED — execution context: code references (file:line), current state vs desired state, structs/traits to modify, concrete implementation steps, edge cases. Not a one-liner. Prefix with 'design-only' for pre-implementation design tasks.", minLength: 50 }),
      status: Type.Optional(Type.String({ description: "Initial status. Default: planned" })),
      shortName: Type.Optional(Type.String({ description: "Short slug for the task id. Auto-derived from title if omitted." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      // Verify phase exists first (fast-fail before generating an id).
      try {
        await st.loadPhase(params.phaseId);
      } catch {
        return { content: [{ type: "text", text: `Phase not found: ${params.phaseId}` }], details: {} };
      }
      const rawShort = params.shortName ?? normalizeSlug(params.title).slice(0, 30);
      const shortName = rawShort.trim() || `task-${Date.now().toString(36)}`; // never empty (fixes regex invalid_string)
      const taskId = createTaskId();
      const now = nowISO();
      const initialStatus = (params.status as Task["status"] | undefined) ?? "planned";
      const existingPhase = await st.loadPhase(params.phaseId);
      const task: Task = {
        id: taskId, phaseId: params.phaseId, number: existingPhase.tasks.length + 1, shortName,
        title: params.title,
        status: initialStatus,
        description: params.description ?? "",
        notes: "",
        statusLog: [],
        decisions: [],
        acceptedDecisions: [],
        checklist: [], subtasks: [],
        dependsOn: [],
        startedAt: initialStatus === "in-progress" || initialStatus === "done" ? now : "",
        completedAt: initialStatus === "done" ? now : "",
        createdAt: now, updatedAt: now,
      };
      // Atomic read-modify-write on the phase file: serializes concurrent
      // task_create calls on the SAME phaseId (batch) so tasks don't get lost.
      await st.updatePhase(params.phaseId, (phase) => {
        phase.tasks.push(task);
        phase.taskIds.push(taskId);
        phase.updatedAt = now;
        return phase;
      });
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Task created: ${taskId}` }], details: task };
    },
  });

  pi.registerTool({
    name: "task_update",
    label: "Task Update",
    description: "Update one or more fields of a task. Only provided fields are changed. Do NOT use this tool to start or complete work; use task_start and task_complete for lifecycle transitions so startedAt/completedAt stay correct.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID" }),
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
      checklist: Type.Optional(Type.Array(Type.String(), { description: "Replace checklist (plain strings). For interactive toggling use the web UI." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      // Find the phase hosting this task first.
      const allPhases = await st.loadAllPhases();
      const hostPhase = allPhases.find((p) => p.tasks.some((t) => t.id === params.taskId));
      if (!hostPhase) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      const now = nowISO();
      let updatedTask: Task | undefined;
      try {
        const updatedPhase = await st.updatePhase(hostPhase.id, (phase) => {
          const task = phase.tasks.find((t) => t.id === params.taskId);
          if (!task) return phase;
          if (params.title !== undefined) task.title = params.title;
          if (params.description !== undefined) task.description = params.description;
          if (params.notes !== undefined) task.notes = params.notes;
          if (params.decisions !== undefined) task.decisions = params.decisions;
          if (params.acceptedDecisions !== undefined) task.acceptedDecisions = params.acceptedDecisions;
          if (params.checklist !== undefined) {
            task.checklist = params.checklist.map((itemTitle, index) => ({
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
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Task updated: ${updatedTask.id} (${updatedTask.status})` }], details: updatedTask };
    },
  });

  pi.registerTool({
    name: "task_delete",
    label: "Task Delete",
    description: "Delete a task from its phase.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to delete" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const phases = await st.loadAllPhases();
      const hostPhase = phases.find((p: Phase) => p.tasks.some((t: Task) => t.id === params.taskId));
      if (!hostPhase) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      await st.updatePhase(hostPhase.id, (phase) => {
        phase.tasks = phase.tasks.filter((t: Task) => t.id !== params.taskId);
        phase.taskIds = phase.taskIds.filter((id: string) => id !== params.taskId);
        phase.updatedAt = nowISO();
        return phase;
      });
      await st.writeGenerated();
      return { content: [{ type: "text", text: `Task deleted: ${params.taskId}` }], details: { deleted: params.taskId } };
    },
  });

  // ── task start / complete tools ──────────────────────────────────

  pi.registerTool({
    name: "task_start",
    label: "Task Start",
    description: "Set a task to in-progress. Use this BEFORE starting implementation work on any task. Sets startedAt timestamp automatically.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to start" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const phases = await st.loadAllPhases();
      const hostPhase = phases.find((p: Phase) => p.tasks.some((t: Task) => t.id === params.taskId));
      const task = hostPhase?.tasks.find((t: Task) => t.id === params.taskId);
      if (!task || !hostPhase) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      if (task.status === "in-progress") return { content: [{ type: "text", text: `Task ${task.id} is already in-progress.` }], details: task };
      if (task.status === "done") return { content: [{ type: "text", text: `Task ${task.id} is done. Use task_update to reopen.` }], details: task };
      const now = nowISO();
      let startedTask: Task | undefined;
      await st.updatePhase(hostPhase.id, (phase) => {
        const t = phase.tasks.find((x) => x.id === params.taskId);
        if (!t) return phase;
        applyTaskLifecycleDates(t, "in-progress", now);
        t.updatedAt = now;
        phase.updatedAt = now;
        startedTask = t;
        return phase;
      });
      await st.writeGenerated();
      if (!startedTask) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      return { content: [{ type: "text", text: `✅ Task started: ${startedTask.id} — ${startedTask.title} (in-progress)` }], details: startedTask };
    },
  });

  pi.registerTool({
    name: "task_complete",
    label: "Task Complete",
    description: "Mark a task as done. Sets completedAt and startedAt (if missing) automatically. Checks for unchecked checklist items and warns unless force=true.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to complete" }),
      force: Type.Optional(Type.Boolean({ description: "Skip checklist completion check. Default: false" })),
      description_update: Type.Optional(Type.String({ description: "Post-hoc summary: commit hash(s), files touched, decisions made, updated code references with new line numbers. Keeps the planner alive and traceable." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const st = await requirePlan(ctx);
      if (!st) return { content: [{ type: "text", text: "No .planner/ found." }], details: {} };
      const phases = await st.loadAllPhases();
      const hostPhase = phases.find((p: Phase) => p.tasks.some((t: Task) => t.id === params.taskId));
      const task = hostPhase?.tasks.find((t: Task) => t.id === params.taskId);
      if (!task || !hostPhase) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      if (task.status === "done") return { content: [{ type: "text", text: `Task ${task.id} is already done.` }], details: task };
      const unchecked = task.checklist.filter((item) => !item.checked);
      if (unchecked.length > 0 && !params.force) {
        return {
          content: [{ type: "text", text: `⚠️  ${unchecked.length} checklist item(s) not done: ${unchecked.map((i) => i.title).join(", ")}. Use task_complete with force=true to override.` }],
          details: { task, uncheckedChecklistItems: unchecked },
        };
      }
      const now = nowISO();
      let completedTask: Task | undefined;
      await st.updatePhase(hostPhase.id, (phase) => {
        const t = phase.tasks.find((x) => x.id === params.taskId);
        if (!t) return phase;
        applyTaskLifecycleDates(t, "done", now);
        if (params.description_update) {
          const sep = t.description ? "\n\n---\n**Completion summary:**\n" : "**Completion summary:**\n";
          t.description = t.description + sep + params.description_update;
        }
        t.updatedAt = now;
        phase.updatedAt = now;
        completedTask = t;
        return phase;
      });
      await st.writeGenerated();
      if (!completedTask) return { content: [{ type: "text", text: `Task not found: ${params.taskId}` }], details: {} };
      return { content: [{ type: "text", text: `✅ Task completed: ${completedTask.id} — ${completedTask.title} (done)` }], details: completedTask };
    },
  });

  // ── Context injection ─────────────────────────────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!plannerSessionEnabled) return;
    const st = ensureStore(ctx);
    if (!(await st.exists())) return;

    try {
      // Heavy one-time-per-session init: migration, language prefs, status
      // healing, and a fresh resume. These write/scan the whole plan and would
      // add seconds of latency on every turn if run unconditionally.
      if (!plannerHeavyInitDone) {
        await migrateToUuids(st);
        await ensureProjectLanguagePreferences(st).catch(() => null);
        await maybeHealStatuses(st);
        await st.refreshResume();
        plannerHeavyInitDone = true;
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
      const recentActivity = activity.entries.slice(-8).reverse();
      const handoff = await st.loadHandoff();

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
      const phaseLines = orderedPhases
        .map((p) => `- ${statusIcon(p.status)} \`${p.id}\` — ${phaseLabel(p)} (${p.status})`)
        .join("\n");
      const active = orderedPhases
        .filter((p) => p.status === "in-progress")
        .map((p) => `\`${p.id}\``)
        .join(", ");
      const doneFeaturesCount = plan.features.features.filter((f) => f.status === "done").length;
      const activeFeaturesCount = plan.features.features.filter((f) => f.status === "in-progress").length;
      const donePhasesCount = plan.phases.filter((p) => p.status === "done").length;
      const activePhasesCount = plan.phases.filter((p) => p.status === "in-progress" || p.status === "discovery").length;
      const totalTasksCount = orderedPhases.reduce((total, phase) => total + phase.tasks.length, 0);
      const doneTasksCount = orderedPhases.reduce((total, phase) => total + phase.tasks.filter((task) => task.status === "done").length, 0);
      const activeTasksCount = orderedPhases.reduce((total, phase) => total + phase.tasks.filter((task) => task.status === "in-progress").length, 0);
      const hasActiveWork = activeFeaturesCount > 0 || activePhasesCount > 0 || activeTasksCount > 0;
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
        ? plan.features.features.find((feature) => feature.id === currentPhase.featureId) ?? null
        : hasActiveWork
          ? plan.features.features.find((feature) => feature.status === "in-progress") ?? null
          : null;
      const nextActivity = hasActiveWork
        ? (resume.nextSteps[0]
          ?? (currentTask ? `Resume task ${currentTask.id} — ${taskLabel(currentTask)}` : currentPhase ? `Resume phase ${currentPhase.id} — ${phaseLabel(currentPhase)}` : "Resume the active work stream"))
        : (handoff?.updatedAt
          ? "Read the handoff, then validate current plan ordering and dependencies before picking the next task."
          : "Review the current plan and choose the next task.");
      const webUrl = server?.url ?? "";

      const openQuestions = plan.phases
        .flatMap((p: Phase) => p.openQuestions.map((q: string) => `[${p.id}] ${q}`))
        .slice(0, 12);

      const acceptedDecisions = [
        ...project.acceptedDecisions.map((d: AcceptedDecision) => `[project] ${d.title}`),
        ...plan.features.features.flatMap((f: Feature) => f.acceptedDecisions.map((d: AcceptedDecision) => `[feature ${f.id}] ${d.title}`)),
        ...plan.phases.flatMap((p: Phase) => p.acceptedDecisions.map((d: AcceptedDecision) => `[phase ${p.id}] ${d.title}`)),
        ...plan.phases.flatMap((p: Phase) => p.tasks.flatMap((t: Task) => t.acceptedDecisions.map((d: AcceptedDecision) => `[task ${t.id}] ${d.title}`))),
      ].slice(0, 20);

      const pkgSummary = profile?.packageJson
        ? `name=${profile.packageJson.name ?? "?"} pm=${profile.packageJson.packageManager ?? "npm"} scripts=${Object.keys(profile.packageJson.scripts).join(",") || "none"} deps=${Object.keys(profile.packageJson.dependencies).length} devDeps=${Object.keys(profile.packageJson.devDependencies).length}`
        : "(no package.json)";
      const ambient = profile?.ambient;
      const ambientSummary = ambient
        ? `node=${ambient.nodeVersion || "?"} pm=${ambient.packageManager || "?"} lockfile=${ambient.lockfile || "none"} scripts=${Object.entries(ambient.scripts).map(([k, v]) => `${k}="${v}"`).join(", ") || "none"}`
        : "(not scanned)";

      if (startupResumeSummaryPending) {
        startupResumeSummaryText = await buildStartupResumeSummary(st).catch(() => "");
      }

      const startupResumeProtocol = startupResumePromptPending ? [
        "",
        "STARTUP RESUME PROTOCOL (first reply of the session — mandatory):",
        "- You are resuming a planner-backed project session.",
        "- FIRST give the user a concise summary of progress so far.",
        `- Mention progress counts: ${doneFeaturesCount}/${plan.features.features.length} features done, ${activeFeaturesCount} active; ${donePhasesCount}/${plan.phases.length} phases done, ${activePhasesCount} active; ${doneTasksCount}/${totalTasksCount} tasks done.`,
        currentFeature ? `- Mention current feature ONLY because it is actually active: ${currentFeature.id} — ${featureLabel(currentFeature)} (${currentFeature.status}).` : "- Mention that no current feature is active.",
        currentPhase ? `- Mention current phase ONLY because it is actually active: ${currentPhase.id} — ${phaseLabel(currentPhase)} (${currentPhase.status}).` : "- Mention that no current phase is active.",
        currentTask ? `- Mention current task ONLY because it is actually active: ${currentTask.id} — ${taskLabel(currentTask)} (${currentTask.status}).` : "- Mention that no current task is active.",
        !hasActiveWork ? "- If a handoff exists, describe it only as a previous-session hint to validate against current planner state, ordering, and dependencies. Do NOT present it as the current focus." : "",
        webUrl ? `- Mention the active web dashboard URL: ${webUrl}` : "- Explicitly say whether the web dashboard is active in this session.",
        `- Mention the next suggested activity: ${nextActivity}`,
        "- THEN ask the user explicitly whether they want to resume that activity now.",
        "- Do NOT assume yes. Wait for the user's answer before continuing implementation work.",
        "- If the user says yes and no task is currently in-progress, your NEXT action must be task_start before any bash/edit/write.",
      ].filter(Boolean).join("\n") : "";

      // Build/refresh the context block (slow path: cache miss).
      const contextBlock = [
        `[Plan Context — ${project.name}]`,
        // ── MANDATORY OPERATIONAL PROTOCOL (top priority, non-negotiable) ──
        "",
        "═══════════════════════════════════════════════════════════════",
        "MANDATORY OPERATIONAL PROTOCOL (violation = execution failure):",
        "═══════════════════════════════════════════════════════════════",
        "1. HANDOFF HYGIENE: If .planner/HANDOFF.md exists, READ and DELETE it IMMEDIATELY using the handoff delete tool. Do NOT summarize first. Do NOT ask for confirmation. Do NOT defer cleanup. DELETE \u2192 THEN work.",
        "2. TASK LIFECYCLE: BEFORE coding ANY file: call task_start. AFTER finishing work on ANY task: call task_complete. No exceptions. No 'I'll do it later'.",
        "3. IMMEDIATE SYNC: Update task status AT THE EXACT MOMENT of transition. Start = task_start NOW. Done = task_complete NOW. Blocked = task_update with motivation NOW. Never batch status updates.",
        "4. BLOCKED MOTIVATION: Transitions to blocked/canceled/rejected/deferred/waiting/planned(from non-planned) MUST include a detailed 'motivation' parameter. Write it as if the next person has zero context.",
        "5. NO SHORTCUTS: If a tool blocks you, follow the protocol. Bypasses are for emergencies only, not for convenience.",
        "═══════════════════════════════════════════════════════════════",
        "",
        // ── Project details ──
        `Goal: ${project.goal || "(not set)"}`,
        project.description ? `Description: ${project.description}` : "",
        `Stack: ${[...project.technologies, ...project.tools].join(", ") || "(not set)"}`,
        `Codebase: ${pkgSummary} | dirs=${profile?.directories.join(",") || "none"} | scanned=${profile?.scannedAt ?? "never"}`,
        `Ambient: ${ambientSummary}`,
        "",
        "Global rules (re-read before every phase/task start):",
        project.globalRules.length ? project.globalRules.map((r) => `- ${r}`).join("\n") : "- (none)",
        "",
        "Workflow rules:",
        `  before phase start: ${project.workflowRules.beforePhaseStart.join(" | ") || "(none)"}`,
        `  before task start: ${project.workflowRules.beforeTaskStart.join(" | ") || "(none)"}`,
        `  after phase complete: ${project.workflowRules.afterPhaseComplete.join(" | ") || "(none)"}`,
        "",
        `Scope: ${project.scope.join(", ") || "(none)"}`,
        `Out of scope: ${project.outOfScope.join(", ") || "(none)"}`,
        "",
        acceptedDecisions.length ? "Accepted decisions (do not re-litigate):" : "",
        ...acceptedDecisions.map((d) => `- ${d}`),
        openQuestions.length ? "" : "",
        openQuestions.length ? "Open questions:" : "",
        ...openQuestions.map((q) => `- ${q}`),
        "",
        "Resume focus (where we are now):",
        resume.currentPhaseId ? `  current phase: ${resume.currentPhaseId}` : "  current phase: (none)",
        resume.inProgressTaskIds.length ? `  in-progress tasks: ${resume.inProgressTaskIds.join(", ")}` : "  in-progress tasks: (none)",
        resume.blockers.length ? `  blockers: ${resume.blockers.join("; ")}` : "  blockers: (none)",
        resume.nextSteps.length ? `  next steps: ${resume.nextSteps.join("; ")}` : "  next steps: (none)",
        resume.lastSessionSummary ? `  last session: ${resume.lastSessionSummary}` : "",
        "",
        recentActivity.length ? "Recent activity (most recent first):" : "",
        ...recentActivity.map((e) => `- ${e.at} [${e.type}] ${e.ref}: ${e.summary}`),
        "",
        `${plan.phases.length} phases defined.`,
        "Current phases:",
        phaseLines || "  _none_",
        active ? `Active: ${active}` : "",
        "",
        "Primary command UX:",
        "- Use `/planner <TAB>` for grouped subcommand suggestions.",
        "- Use `/planner` with no args to open the navigable planner menu.",
        "- Feature commands: planner feature list|add|show|update|delete.",
        "- Phase commands: planner phase add|show|discuss|update|delete.",
        "- Task commands: planner task add|show|discuss|update|delete|start|complete.",
        "- Handoff commands: planner handoff prepare|show|write|clear.",
        "- Web/session commands: planner web start|stop|status, planner export|export-full, planner load, planner disable, planner repair.",
        "Legacy flat aliases may also exist for backward compatibility, but prefer grouped `/planner ...` forms.",
        "Planner discuss mode is Agent Plan only: ignore GSD workflows/skills/commands unless the user explicitly asks for GSD.",
        `Language preferences: plan content=${project.contentLanguage || "(not set)"}; chat=${project.chatLanguage || "(not set)"}.`,
        "If these language preferences are already set, follow them automatically and do NOT ask again in later sessions.",
        "Ask for language only if BOTH preferences are unset.",
        "If one preference is set and the other is unset, infer the missing one from the saved value and persist it immediately with project_set_language_preferences without asking the user again.",
        "Persist accepted decisions into project data, not only chat. Use acceptedDecisions on project/feature/phase/task when the user accepts a decision or solution.",
        "If you are creating a planner from an existing plan or document, do NOT leave project title, project description, project goal, or top-level requirements empty when the source material provides them.",
        "When deriving a project title from an existing document, prefer a concise human project title; if the candidate title is long or compound, ask the user to confirm before using it.",
        "Before starting any phase/task, emit a recap of current state and ask the user if requirements/dependencies changed before planning tasks.",
        "",
        "TASK STATUS RULES (strict — do not skip):",
        "- BEFORE you start implementation work on ANY task, you MUST call task_start to set it to in-progress. This sets startedAt.",
        "- AFTER you finish implementation work on ANY task, you MUST call task_complete to set it to done. This sets completedAt.",
        "- Phase and feature statuses are DERIVED from task statuses. They are not the primary source of truth.",
        "- Therefore, if not strictly necessary, do NOT change phase.status or feature.status directly. Move the task statuses instead and let rollup derive the parent statuses.",
        "- The extension blocks edit/write when no task is in-progress (bash stays free so git pull/build/test work). If you hit that block, either call task_start, OR ask the user to authorize a one-time bypass (they can run /planner bypass, or you can call plan_authorize_bypass) and then retry.",
        "- If you forget these task status calls, the derived rollup breaks: phase/feature can stay stale, the dashboard shows wrong active work, and resume focus is wrong.",
        "- Before your final answer after implementation work, either call task_complete if the task is finished, or explicitly tell the user the task remains in-progress.",
        "- Use task_complete with force=true only if you have a good reason to skip the checklist check.",
        "- To reopen a completed task, use task_start (recommended) or task_update.",
        handoff?.content ? "Handoff detected at `.planner/HANDOFF.md`. Read it as previous-session context, but validate it against the current planner state, ordering, and dependencies before treating any target as the next task." : "",
        handoff?.content ? "If planner state shows no task/phase in-progress, do NOT present the handoff target as the current focus; present it only as a candidate to validate." : "",
        handoff?.content ? "When the handoff has been fully consumed and work is safely resumed, delete `.planner/HANDOFF.md` using the dedicated handoff delete command/tool." : "",
        handoff?.content ? handoff.content : "",
        startupResumeProtocol,
        "Plan tools available: project_set_language_preferences, plan_init, project_update, requirement_list, requirement_create, requirement_update, requirement_delete, plan_get, feature_list, feature_get, feature_create, feature_update, feature_delete, phase_list, phase_get, phase_create, phase_update, phase_delete, task_list, task_get, task_create, task_update, task_delete, task_start, task_complete, plan_render, plan_get_handoff, plan_write_handoff, plan_delete_handoff, plan_authorize_bypass, plan_clear_bypass",
      ].filter(Boolean).join("\n");
        contextBlockCache = contextBlock;
        contextBlockDirty = false;

      startupResumePromptPending = false;
      return {
        systemPrompt: `${event.systemPrompt}\n\n---\n${contextBlockCache}`,
      };
    } catch {
      return;
    }
  });
}
