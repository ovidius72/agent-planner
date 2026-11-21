#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PlanStore, PlanStoreError, ExportService, findPhaseByRef, findTaskByRef, buildRecap, buildBoundedAcceptedDecisionContext, renderAcceptedDecisionsSection, recommendNextWork, packageVersionFromModule, resolvedPackageVersion, createStaleProcessCheck, runtimeCapabilities, runtimePackagesDiagnostic, markCanonicalFullReadForSessionId, contextReadEligibilityForSession, requirementReadEligibilityForSession, markRequirementReadForSessionId, startReadSession, taskStartDenied, taskStartSucceeded, taskStartGateState, taskStartGateStateLine, noMutableFieldsReceived, projectGuidelinesReadStateForSession, HANDOFF_COMPLETENESS_AUDIT_VERSION, HANDOFF_COMPLETENESS_CATEGORIES, HANDOFF_COLD_START_INVENTORY_VERSION, HANDOFF_COLD_START_INVENTORY_CATEGORIES, HandoffContractError, buildProjectContextLoadReply, buildPlannerLoadReply, buildScopedDecisionContext, DEFAULT_PROJECT_CONTEXT_CHUNK_CHARS, projectContextStaleAdvisory, LEGACY_DECISIONS_ARRAY_READ_ONLY_MESSAGE, LEGACY_DECISIONS_ARRAY_READ_ONLY_ERROR_CODE, buildMutationReply, longTextFieldLimitNotice, buildRecommendationReply, taskOrderContextLine, higherPriorityOpenPhaseAdvisory, listOpenPhaseWork, openPhaseWorkLines, boundedOpenPhaseWork, deleteFeatureCascade, taskCompletionChecklistRefusal, taskCompletionForceMotivationRequired, taskCompletionMismatchLine, resolveFeatureRefStrict, resolveAcceptedDecisionTarget, handoffContractFailureReply, derivedStatusReadOnlyReply, acceptedDecisionMutationFailureReply, legacyContextMigrationSummary, moveTasks, buildTaskMoveReply } from "@agent-plan/core";
import { serve } from "@agent-plan/server";
import type { ServeHandle } from "@agent-plan/server";
import { formatPhaseRef, formatFeatureRef, formatIdeaRef, featureNumberOfPhase, taskCompositeRef } from "@agent-plan/core/naming";
import { HandoffFlowRefusal, RequirementFlowRefusal, TaskFlowRefusal, FeatureFlowRefusal, PhaseFlowRefusal, DiscussFlowRefusal, createRequirementFlow, updateRequirementFlow, deleteRequirementFlow, createTaskFlow, updateTaskFlow, addTaskDependencyFlow, removeTaskDependencyFlow, addTaskChecklistItemFlow, toggleTaskChecklistItemFlow, removeTaskChecklistItemFlow, createFeatureFlow, updateFeatureFlow, createPhaseFlow, updatePhaseFlow, deletePhaseFlow, discussProjectFlow, discussFeatureFlow, discussPhaseFlow, discussTaskFlow, listFeatureSummaries, listPhaseSummaries, listTaskSummaries, showFeature, showPhase, showTask, startTaskFlow, completeTaskFlow, pauseTaskFlow, reopenTaskFlow, switchTaskFlow, recordDeviationFlow, recoverSessionFlow, deleteTaskFlow, listIdeasFlow, showIdeaFlow, createIdeaFlow, updateIdeaFlow, deleteIdeaFlow, beginIdeaPromotionFlow, finalizeIdeaPromotionFlow, readProjectGuidelinesFlow, updateProjectGuidelinesFlow, updateProjectLanguageFlow, preparePhaseHandoffFlow, showPhaseHandoffFlow, writePhaseHandoffFlow, verifyPhaseHandoffFlow, clearPhaseHandoffFlow, listPhaseHandoffsFlow, type PhaseHandoffWriteRequest } from "@agent-plan/core";
import type { Phase, Task } from "@agent-plan/core/schema";
import type { HandoffCompletenessAuditInput, HandoffColdStartInventoryInput } from "@agent-plan/core";

const STATUS_VALUES = ["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"] as const;
const PHASE_STATUS_VALUES = ["draft", "discovery", ...STATUS_VALUES] as const;
const fallbackPlannerSessionId = `mcp-process:${randomUUID()}`;
startReadSession(fallbackPlannerSessionId);

type McpRequestExtra = { sessionId?: string };

function plannerSessionIdFor(extra?: McpRequestExtra): string {
  const transportSessionId = extra?.sessionId?.trim();
  const sessionId = transportSessionId ? `mcp:${transportSessionId}` : fallbackPlannerSessionId;
  startReadSession(sessionId);
  return sessionId;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

/** Stated on every long-prose input so a caller learns the limit before the
 * call rather than from the rejection. The number itself lives in the core
 * (PLANNER_LONG_TEXT_FIELD_MAX_CHARS) so both adapters state the same one. */
const LONG_TEXT_LIMIT_NOTICE = longTextFieldLimitNotice();

function text(textValue: string, structuredContent?: Record<string, unknown>): ToolResult {
  return structuredContent ? { content: [{ type: "text", text: textValue }], structuredContent } : { content: [{ type: "text", text: textValue }] };
}

function mcpHandoffContractFailure(error: HandoffContractError, action: "refresh" | "preparation" = "refresh"): ToolResult {
  const reply = handoffContractFailureReply(error, action);
  return { isError: true, content: [{ type: "text", text: reply.text }], structuredContent: reply.structured };
}

function handoffPreflightFailure(errorCode: "HANDOFF_PREFLIGHT_REQUIRED" | "HANDOFF_REASON_REQUIRED", message: string, details: Record<string, unknown> = {}): ToolResult {
  return { isError: true, content: [{ type: "text", text: `❌ Handoff refresh denied [${errorCode}]: ${message}` }], structuredContent: { errorCode, persisted: false, ...details } };
}

/**
 * Map a shared handoff-flow refusal to the exact tool result the MCP
 * surface has always produced. The code decides the shape (plain text vs
 * isError); the shared message text is reused verbatim so MCP behavior
 * is unchanged by the extraction.
 */
function handoffRefusalResult(error: HandoffFlowRefusal): ToolResult {
  switch (error.code) {
    case "GENERIC_HANDOFF_TITLE":
      return text("❌ Generic handoff title. Provide a meaningful title summarizing the work.");
    case "HANDOFF_CONFIRMATION_REQUIRED":
      return text(`Proposal only: I would refresh this handoff on ${String(error.details.phaseRef)}. Ask the user to confirm, then run planner-handoff-prepare with the exact phaseRef.`, { phaseRef: error.details.phaseRef, confirmationRequired: true });
    case "HANDOFF_PREFLIGHT_REQUIRED":
      return handoffPreflightFailure("HANDOFF_PREFLIGHT_REQUIRED", "Run planner-handoff-prepare first and pass expectedHandoffUpdatedAt.");
    case "HANDOFF_REASON_REQUIRED":
      return handoffPreflightFailure("HANDOFF_REASON_REQUIRED", "Handoff reason is required before persistence. Created at and Updated at are generated by the planner; do not add them to Markdown.", { requiredInputs: ["title", "reason"], generatedMetadata: ["Created at", "Updated at"] });
    default:
      // PHASE_REF_REQUIRED / PHASE_NOT_FOUND / TASK_NOT_IN_PHASE keep the
      // historical plain-refusal shape.
      return text(`❌ ${error.message}`);
  }
}

function mcpDerivedStatusReadOnlyResult(
  entity: "feature" | "phase",
  ref: string,
  attemptedStatus: string,
  effectiveStatus: string,
): ToolResult {
  const retryAction = entity === "feature"
    ? `Retry planner-feature-update ${ref} without the status field if you need to update metadata.`
    : `Retry planner-phase-update ${ref} without the status field if you need to update metadata.`;
  const reply = derivedStatusReadOnlyReply({ entity, ref, attemptedStatus, effectiveStatus, retryAction });
  return { isError: true, content: [{ type: "text", text: reply.text }], structuredContent: reply.structured };
}

function mcpMutationNoFieldsFailure(input: Parameters<typeof noMutableFieldsReceived>[0]): ToolResult {
  const outcome = noMutableFieldsReceived(input);
  return {
    isError: true,
    content: [{ type: "text", text: outcome.message }],
    structuredContent: { ...outcome },
  };
}

function mcpAcceptedDecisionMutationFailure(error: unknown, outcome: "created" | "updated" | "deleted"): ToolResult {
  const reply = acceptedDecisionMutationFailureReply(error, outcome);
  return { isError: true, content: [{ type: "text", text: reply.text }], structuredContent: reply.structured };
}

/** Dependency mutations: flow refusals keep their typed code, store errors keep their own. */
function taskDependencyFailure(error: unknown, fallbackCode: string, fallbackMessage: string): ToolResult {
  if (error instanceof TaskFlowRefusal) {
    return { ...text(error.message, { updated: false, errorCode: error.code }), isError: true };
  }
  const details = error instanceof PlanStoreError ? error.details as { errorCode?: string } | undefined : undefined;
  return {
    ...text(error instanceof Error ? error.message : fallbackMessage, { updated: false, errorCode: details?.errorCode ?? fallbackCode }),
    isError: true,
  };
}

function taskStartError(
  outcome: ReturnType<typeof taskStartDenied>,
  structuredContent: Record<string, unknown> = {},
): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: [
      `❌ TASK START FAILED [${outcome.errorCode}]`,
      "started: false",
      outcome.message,
      "No task lifecycle transition was applied.",
      "Next required actions:",
      ...outcome.nextActions.map((action, index) => `${index + 1}. ${action}`),
    ].join("\n") }],
    structuredContent: { ...outcome, ...structuredContent },
  };
}

function mcpContextReadActions(
  eligibility: ReturnType<typeof contextReadEligibilityForSession>,
  refs: { task: string; phase: string; feature?: string },
  projectGuidelinesReadRequired: boolean,
  requirementReadRequired: boolean,
  retryAction: string,
): string[] {
  const actions = projectGuidelinesReadRequired ? ["planner-project-guidelines-show"] : [];
  actions.push(...(eligibility.requiredReads ?? []).flatMap((read) => {
    if (read.kind === "task") return [`planner-task-show ${refs.task} with full=true`];
    if (read.kind === "phase") return [`planner-phase-show ${refs.phase} with full=true`];
    if (read.kind === "feature") return refs.feature ? [`planner-feature-show ${refs.feature} with full=true`] : [];
    return [];
  }));
  if (requirementReadRequired) actions.push(`planner-requirement-list with phaseRef=${refs.phase}`);
  actions.push(retryAction);
  return actions;
}

const MCP_PACKAGE = packageVersionFromModule(import.meta.url, "@agent-plan/mcp");
const CORE_PACKAGE = resolvedPackageVersion("@agent-plan/core", import.meta.url);
const staleServerNotice = createStaleProcessCheck(MCP_PACKAGE);

function planRoot(): string {
  return process.env.AGENT_PLAN_ROOT || join(process.cwd(), ".planner");
}

function store(): PlanStore {
  const st = new PlanStore(planRoot());
  st.enableAutoSync(true);
  return st;
}

async function requireStore(): Promise<PlanStore> {
  const st = store();
  if (!(await st.exists())) throw new Error(`No .planner/ found at ${st.root}. Use planner-init first.`);
  // Opening a plan is read-only. Global migrations/backfills are explicit
  // maintenance commands; running them here rewrites unrelated feature files.
  return st;
}

// In-process web server handle, managed by the planner-web tool and planner-load.
// Lives as long as this MCP stdio process (i.e. the host session). Null when not running.
let webHandle: ServeHandle | null = null;

/** Start the web dashboard on the loopback interface (127.0.0.1, OS-assigned
 *  port) if not already running. Returns the local URL. No-op (empty url) when
 *  no .planner/ exists. LAN mode was removed (T490): the service binds the
 *  loopback interface only. */
interface PlannerWebStartup {
  localUrl: string;
  lanUrl?: string | undefined;
  mode?: string;
  bindHost?: string;
  error?: string;
}

function plannerWebMetadata(web: PlannerWebStartup): Record<string, unknown> {
  const address = web.lanUrl || web.localUrl;
  let host = web.bindHost ?? "";
  let port = 0;
  if (address) {
    try {
      const parsed = new URL(address);
      host = parsed.hostname;
      port = Number(parsed.port);
    } catch {
      // Preserve the original address when a custom server returns a non-standard URL.
    }
  }
  return {
    running: Boolean(web.localUrl),
    address,
    localUrl: web.localUrl,
    lanUrl: web.lanUrl ?? "",
    host,
    port,
    mode: web.mode ?? "",
    ...(web.error ? { errorCode: "PLANNER_WEB_START_FAILED", error: web.error } : {}),
  };
}

async function ensureWebStarted(): Promise<PlannerWebStartup> {
  if (webHandle) return { localUrl: webHandle.localUrl, lanUrl: webHandle.lanUrl, mode: webHandle.mode, bindHost: webHandle.bindHost };
  const root = planRoot();
  const st = new PlanStore(root);
  if (!(await st.exists())) return { localUrl: "", error: "Planner workspace does not exist." };
  try {
    webHandle = await serve({ planRoot: root, port: 0, quiet: true });
    return { localUrl: webHandle.localUrl, lanUrl: webHandle.lanUrl, mode: webHandle.mode, bindHost: webHandle.bindHost };
  } catch (error) {
    return { localUrl: "", error: error instanceof Error ? error.message : String(error) };
  }
}

async function writeAndSummarize(st: PlanStore, message: string, structuredContent?: Record<string, unknown>): Promise<ToolResult> {
  await st.writeGenerated();
  return text(message, structuredContent);
}

const server = new McpServer({
  name: "agent-plan-planner",
  version: MCP_PACKAGE.version,
});

/**
 * Claude Code gives the agent only `structuredContent` when a result has
 * one, and drops `content[].text`. Anything a tool says in text — a handoff
 * body, a phase work map, task-start context, an advisory — would never
 * reach the agent. So every result with a structured part also carries its
 * text there, as `text`. `content` keeps the text for clients that read
 * only that. Applied once, to every tool, by the registerTool wrapper below;
 * no handler needs to know.
 */
export function foldTextIntoStructured<T extends ToolResult>(result: T): T {
  if (!result?.structuredContent) return result;
  const replyText = result.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n\n");
  // A reply that already uses `text` for something else is left as it is;
  // the MCP tests fail on that, so it never ships.
  if (!replyText || "text" in result.structuredContent) return result;
  return { ...result, structuredContent: { text: replyText, ...result.structuredContent } };
}

/** Add one line to a reply when this server is older than what is now
 * installed (see createStaleProcessCheck). */
function withStaleServerNotice<T extends ToolResult>(result: T): T {
  const notice = staleServerNotice();
  if (!notice || !result?.content) return result;
  return { ...result, content: [...result.content, { type: "text", text: notice }] };
}

{
  const sessionOperations = new Set(["planner-load", "planner-task-start", "planner-task-switch", "planner-task-pause", "planner-task-complete", "planner-task-reopen", "planner-task-update", "planner-task-deviation", "planner-session-recover"]);
  const registeredSessions = new Set<string>();
  const registerToolUnwrapped = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (...args: unknown[]) => {
    const handler = args[args.length - 1] as (...handlerArgs: unknown[]) => Promise<ToolResult> | ToolResult;
    const wrapped = async (...handlerArgs: unknown[]) => {
      const invoke = async () => foldTextIntoStructured(withStaleServerNotice(await handler(...handlerArgs)));
      if (!sessionOperations.has(args[0] as string)) return invoke();
      const st = store();
      if (!(await st.exists())) return invoke();
      const sessionId = plannerSessionIdFor(handlerArgs[1] as McpRequestExtra | undefined);
      const prepare = async () => {
        if (!registeredSessions.has(sessionId)) {
          await st.registerSession(sessionId);
          registeredSessions.add(sessionId);
        }
      };
      // Server/watchers must be created outside a write transaction's async context.
      if (args[0] === "planner-load") {
        await st.runBatch(prepare);
        return invoke();
      }
      return st.runBatch(async () => {
        await prepare();
        const result = await invoke();
        if (!result.isError) await st.refreshResume(undefined, undefined, sessionId);
        return result;
      });
    };
    return registerToolUnwrapped(...args.slice(0, -1), wrapped);
  };
}

server.registerTool("planner-version", {
  description: "Report loaded Agent Plan MCP/core runtime provenance plus plan schema and allocation compatibility. Available without an initialized .planner/ workspace.",
}, async () => {
  const packages = runtimePackagesDiagnostic([MCP_PACKAGE, CORE_PACKAGE]);
  const capabilities = runtimeCapabilities();
  const versions = {
    [MCP_PACKAGE.name]: MCP_PACKAGE.version,
    [CORE_PACKAGE.name]: CORE_PACKAGE.version,
  };
  return text([
    "Agent Plan runtime diagnostics",
    "Runtime packages (loaded package manifests):",
    `- ${MCP_PACKAGE.name}: loaded ${MCP_PACKAGE.version}`,
    `- ${CORE_PACKAGE.name}: loaded ${CORE_PACKAGE.version}`,
    `Plan schema: manifest schemaVersion ${capabilities.planSchema.manifestSchemaVersion}`,
    `Allocation registry: v${capabilities.allocationRegistry.version}; supported kinds: ${capabilities.allocationRegistry.supportedKinds.join(", ")}`,
  ].join("\n"), { versions, packages, capabilities });
});

server.registerTool("planner-export", {
  description: "Export the project plan as a Markdown report. Supports a concise summary or full hierarchical detail.",
  inputSchema: {
    full: z.boolean().optional().describe("If true, include full detail for every feature, phase, and task. Defaults to false (summary only)."),
  },
}, async ({ full = false }) => {
  const st = await requireStore();
  const plan = await st.loadAll();
  const exportService = new ExportService();
  const markdown = exportService.exportToMarkdown(plan, full);

  const fs = await import("node:fs/promises");
  await fs.writeFile(join(st.root, "EXPORT.md"), markdown, "utf-8");

  return text(`Project export generated. Summary results:\n\n${markdown.slice(0, 1000)}${markdown.length > 1000 ? "... (full report in .planner/EXPORT.md)" : ""}`);
});

server.registerTool("planner-authorize-bypass", {
  description: "Authorize a temporary guard bypass (default 15 minutes) that silences the no-task warning. Edits are never blocked; this only stops the agent being warned when it changes project code with no task in-progress. Use ONLY after the user explicitly authorizes working without a task. Harness-agnostic: stored in resume.json so all adapters (Pi, Claude Code, Codex, ...) respect it.",
  inputSchema: {
    durationMinutes: z.number().optional().describe("Bypass window in minutes. Default 15."),
  },
}, async ({ durationMinutes }) => {
  const st = await requireStore();
  const mins = durationMinutes ?? 15;
  const until = await st.authorizeGuardBypass(mins);
  return text(`Guard bypass authorized until ${until}. edit/write is allowed without a task in-progress for ${mins} minutes.`, { until });
});

server.registerTool("planner-clear-bypass", {
  description: "Revoke any active guard bypass so edit/write again requires a task in-progress.",
}, async () => {
  const st = await requireStore();
  await st.clearGuardBypass();
  return text("Guard bypass revoked.", { cleared: true });
});

server.registerTool("planner-init", {
  description: "Initialize .planner/ in the current project.",
  inputSchema: {
    projectName: z.string().min(1).describe("Concise project title"),
    description: z.string().optional().describe("Short project description"),
    goal: z.string().optional().describe("Main project goal"),
  },
}, async ({ projectName, description, goal }) => {
  const st = store();
  if (await st.exists()) return text(`.planner/ already exists at ${st.root}`);
  await st.init(projectName.trim());
  const project = await st.loadProject();
  if (description !== undefined) project.description = description.trim();
  if (goal !== undefined) project.goal = goal.trim();
  await st.saveProject(project);
  return writeAndSummarize(st, `.planner/ initialized for "${project.name}"`);
});

server.registerTool("planner-show", {
  description: "Show a compact planner overview with explicit active-task evidence: project metadata, counts, authoritative active task refs (or a verified-empty state), and a one-line summary of each feature. Never infer that no task is active from omitted task detail. Use planner-feature-list / planner-phase-list / planner-task-list for discovery and planner-*-show for full entity detail.",
}, async () => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const phases = await st.loadAllPhases();
  const allTasks = phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));
  const totalTasks = allTasks.length;
  const activeTasks = allTasks
    .filter(({ task }) => task.status === "in-progress")
    .map(({ phase, task }) => ({
      id: task.id,
      ref: taskCompositeRef(task, phase, features),
      title: task.title,
      phaseId: phase.id,
      featureId: phase.featureId ?? null,
      status: task.status,
    }));
  const activeTaskState = activeTasks.length === 0 ? "none" : activeTasks.length === 1 ? "single" : "conflict";
  const project = await st.loadProject();
  const projectDecisionContext = buildBoundedAcceptedDecisionContext([{ scope: "project", decisions: project.acceptedDecisions }]);
  const manifest = await st.loadManifest();
  const featureLines = features.map((feature) => {
    const featurePhases = phases.filter((phase) => phase.featureId === feature.id);
    const taskCount = featurePhases.reduce((total, phase) => total + phase.tasks.length, 0);
    return `- ${formatFeatureRef(feature.number)}${feature.shortId ? ` · ${feature.shortId}` : ""} — ${feature.name} (${feature.status}; ${featurePhases.length} phases, ${taskCount} tasks)`;
  });
  // P104(F005)/T422: a phase can be left in-progress with no active task and
  // nothing else says so on this cheap read — this renders that fact,
  // priority-ordered, instead of leaving it discoverable only by paying for
  // planner-task-recommend.
  const openPhaseWork = listOpenPhaseWork(phases, features);
  const openPhaseWorkText = openPhaseWorkLines(openPhaseWork);
  const summary = [
    `📋 ${project.name}`,
    `Description: ${project.description || "(not set)"}`,
    ...(project.descriptionRef ? [`Description ref: ${project.descriptionRef}`] : []),
    `Goal: ${project.goal || "(not set)"}`,
    projectDecisionContext.content,
    `Features: ${features.length}  |  Phases: ${phases.length}  |  Tasks: ${totalTasks}`,
    activeTasks.length === 0
      ? "Active tasks: none (verified from all persisted phase task statuses)"
      : `Active tasks (${activeTasks.length})${activeTaskState === "conflict" ? " — CONFLICT: multiple tasks are in progress" : ""}:\n${activeTasks.map((task) => `- ${task.ref} — ${task.title} (in-progress)`).join("\n")}`,
    ...(openPhaseWorkText ? [`In-progress phases with work left (priority order):`, openPhaseWorkText] : []),
    `Updated: ${manifest.updatedAt || "(unknown)"}`,
    "",
    "Features:",
    featureLines.join("\n") || "(none)",
  ].join("\n");
  // Compact structured overview (no full plan: avoids 1M+ char token overflow).
  const overview = {
    project: {
      name: project.name,
      description: project.description || null,
      descriptionRef: project.descriptionRef || null,
      goal: project.goal || null,
      // Identity only: `summary` above already carries every canonical field
      // (decision, rationale, implementationNotes) through projectDecisionContext,
      // bounded at MAX_ACCEPTED_DECISION_CONTEXT_CHARS. Echoing the full
      // AcceptedDecision objects here too would duplicate that content in both
      // channels — the discipline handoff-reply.ts and mutation-reply.ts hold
      // to (P104(F005)/T419). Full canonical detail for every decision: planner-load.
      acceptedDecisions: project.acceptedDecisions.map((decision) => ({ id: decision.id, title: decision.title, acceptedAt: decision.acceptedAt })),
      updatedAt: manifest.updatedAt || null,
    },
    counts: { features: features.length, phases: phases.length, tasks: totalTasks, activeTasks: activeTasks.length },
    activeTaskState,
    activeTasks,
    openPhaseWork: boundedOpenPhaseWork(openPhaseWork),
    openPhaseWorkTotal: openPhaseWork.length,
    features: features.map((feature) => ({
      ref: formatFeatureRef(feature.number),
      shortId: feature.shortId || null,
      name: feature.name,
      status: feature.status,
      phases: phases.filter((p) => p.featureId === feature.id).length,
      tasks: phases.filter((p) => p.featureId === feature.id).reduce((t, p) => t + p.tasks.length, 0),
    })),
  };
  return text(summary, { overview });
});

server.registerTool("planner-description-freshness", {
  description: "Preview deterministic child-to-parent description drift. Returns exact stale phase/feature refs and leaf-to-root reconciliation steps without rewriting user-authored descriptions.",
}, async () => {
  const st = await requireStore();
  const freshness = await st.previewDescriptionReconciliation();
  if (!freshness.reconciliationRequired) return text("Description hierarchy is fresh; no parent reconciliation is required.", { ...freshness });
  const lines = freshness.reconciliationPreview.map((step) => `- ${step.ownerRef} after ${step.causedByRef}: ${step.action}`);
  return text(`Parent description reconciliation required (${freshness.staleParentRefs.length}):\n${lines.join("\n")}`, { ...freshness });
});

server.registerTool("planner-repair", {
  description: "Repair dangling feature→phase references, rebuild phase containment from each task's own phaseId (heals the migrateToGlobalSequence task-shuffle bug where tasks land in the wrong phase file), and report integrity.",
}, async () => {
  const st = await requireStore();
  const report = await st.repair();
  return text(`Repair done: renamed ${report.migrated.renamed}, repaired ${report.migrated.repaired} refs, inferred ${report.migrated.inferred}. Containment: ${report.containment.changed} phase files rewritten (${report.containment.tasks} tasks scanned, ${report.containment.orphan} orphan). Handoffs: archived ${report.handoffs.archived} stale completed/canceled handoff(s). Integrity: ${report.integrity.duplicatePhaseIds.length} duplicate, ${report.integrity.danglingPhaseIds.length} dangling.`, { report });
});

server.registerTool("planner-cleanup-orphan-phases", {
  description: "Discover phase files that no longer resolve to a valid owning feature, and optionally delete them. Run once with confirm=false (default) to inspect, then rerun with confirm=true to remove them.",
  inputSchema: {
    confirm: z.boolean().optional().describe("Set true to actually delete the discovered orphan phase files. Default: false (dry-run/list only)."),
  },
}, async ({ confirm }) => {
  const st = await requireStore();
  const found = await st.listOrphanPhases();
  if (!confirm) {
    if (found.length === 0) return text("No orphan phases found.", { found: [] });
    const lines = [
      `Found ${found.length} orphan phase${found.length === 1 ? "" : "s"}.`,
      ...found.map((phase) => `- ${phase.compositeRef}${phase.shortId ? ` · ${phase.shortId}` : ""} — ${phase.title} (${phase.reason})`),
      "Rerun with confirm=true to delete these orphan phase files.",
    ];
    return text(lines.join("\n"), { found, confirmRequired: true });
  }
  const report = await st.cleanupOrphanPhases();
  if (report.removed.length === 0) return text("No orphan phases found.", report);
  const lines = [
    `Removed ${report.removed.length} orphan phase${report.removed.length === 1 ? "" : "s"}.`,
    ...report.removed.map((phase) => `- ${phase.compositeRef}${phase.shortId ? ` · ${phase.shortId}` : ""} — ${phase.title}`),
  ];
  return text(lines.join("\n"), report);
});

server.registerTool("planner-project-language", {
  description: "Persist preferred languages for plan content and chat.",
  inputSchema: {
    contentLanguage: z.string().optional(),
    chatLanguage: z.string().optional(),
  },
}, async ({ contentLanguage, chatLanguage }) => {
  const outcome = await updateProjectLanguageFlow(await requireStore(), { contentLanguage, chatLanguage });
  if (!outcome.ok) return text(outcome.message);
  return text(
    `Saved language preferences: content=${outcome.contentLanguage || "(unset)"}, chat=${outcome.chatLanguage || "(unset)"}`,
  );
});

server.registerTool("planner-project-discuss", {
  description: "Record/update project-level discovery fields. This is the MCP equivalent of grouped project discuss without Pi UI prompts.",
  inputSchema: {
    description: z.string().optional().describe(LONG_TEXT_LIMIT_NOTICE),
    descriptionRef: z.string().optional().describe("Optional markdown reference under .planner/docs/ for the full project description."),
    goal: z.string().optional(),
    scope: z.array(z.string()).optional(),
    outOfScope: z.array(z.string()).optional(),
    technologies: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    globalRules: z.array(z.string()).optional(),
    decisions: z.array(z.string()).optional().describe("Deprecated legacy field. Read-only history now; supplying it returns LEGACY_DECISIONS_ARRAY_READ_ONLY. Use planner-accepted-decision-create for new durable decisions."),
  },
}, async (params) => {
  const st = await requireStore();
  try {
    const outcome = await discussProjectFlow(st, params);
    return text(
      `Project discussed/updated: ${outcome.project.name}. Fields saved: ${outcome.updatedFields.join(", ")}.`,
      { project: outcome.project, discussed: true, updatedFields: outcome.updatedFields },
    );
  } catch (error) {
    if (error instanceof DiscussFlowRefusal) {
      if (error.code === "PROJECT_LEGACY_DECISIONS_READ_ONLY") {
        return { isError: true, content: [{ type: "text", text: LEGACY_DECISIONS_ARRAY_READ_ONLY_MESSAGE }], structuredContent: { updated: false, errorCode: LEGACY_DECISIONS_ARRAY_READ_ONLY_ERROR_CODE, targetType: "project" } };
      }
      if (error.code === "PROJECT_NO_MUTABLE_FIELDS") {
        return mcpMutationNoFieldsFailure({
          entity: "project",
          ref: error.details.ref as string,
          operation: "discuss",
          mutableFields: error.details.mutableFields as string[],
          retryCommand: "planner-project-discuss with a concise description summary and the intended metadata",
          readBackCommand: "planner-show",
          descriptionFallback: {
            inputField: "description",
            storedField: "project description",
            descriptionRefField: "descriptionRef",
          },
        });
      }
      return text(error.message, { updated: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-project-guidelines-show", {
  description: "Read the canonical Project Guidelines / Coding Standard section for this project. Call this when planner-task-start or planner-task-switch nextActions require it, and keep the guidance in working memory while doing task work.",
}, async (extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  // Same read flow as GET /api/v2/context/guidelines: the receipt is only
  // recorded when non-empty guidelines were actually delivered.
  const outcome = await readProjectGuidelinesFlow(await requireStore(), plannerSessionId);
  const content = outcome.projectGuidelines.content.trim();
  return text(
    content
      ? ["## Project Guidelines", content].join("\n\n")
      : "No project guidelines set.",
    { projectGuidelines: outcome.projectGuidelines, readRecorded: outcome.readRecorded },
  );
});

server.registerTool("planner-project-guidelines-update", {
  description: "Replace the canonical Project Guidelines / Coding Standard text that agents must read on load and before starting or switching task work.",
  inputSchema: {
    content: z.string().describe("Full Project Guidelines markdown/text. Pass an empty string to clear the section."),
  },
}, async ({ content }) => {
  const st = await requireStore();
  const outcome = await updateProjectGuidelinesFlow(st, { content });
  if (!outcome.ok) return text(outcome.message);
  return text(
    outcome.cleared
      ? "Project Guidelines cleared."
      : `Project Guidelines updated. Updated at ${outcome.projectGuidelines.updatedAt}.`,
    { updated: true, projectGuidelines: outcome.projectGuidelines },
  );
});

server.registerTool("planner-project-context-migrate", {
  description: "Preview or explicitly apply the lossless migration of legacy project globalRules/workflowRules into Project Guidelines and legacy decisions into structured accepted decisions. Ordinary planner loads never run this migration.",
  inputSchema: {
    apply: z.boolean().default(false).describe("False previews without mutation. True explicitly applies the previewed migration and clears only the migrated legacy fields."),
  },
}, async ({ apply }) => {
  const st = await requireStore();
  const preview = await st.previewLegacyProjectContextMigration();
  if (!apply) {
    return text(
      [`Project context migration preview (no changes applied).`, legacyContextMigrationSummary(preview), preview.hasLegacyContext ? "Retry with apply=true to confirm." : "No migration is needed."].join("\n"),
      { applied: false, preview },
    );
  }
  const result = await st.migrateLegacyProjectContext();
  return writeAndSummarize(
    st,
    [result.applied ? "Legacy project context migration applied and verified." : "No legacy project context required migration.", legacyContextMigrationSummary(result.preview)].join("\n"),
    { ...result },
  );
});

  server.registerTool("planner-feature-list", {
    description: "List features (compact: F00x · shortId — name (status; priority N; N phases, M tasks)). Pass featureRef to filter. Use this to discover refs cheaply — do NOT read .planner/ files or planner-plan-get full=true to find entities.",
    inputSchema: { featureRef: z.string().optional().describe("Optional: filter to one feature (F00x/shortId/UUID/name).") },
  }, async ({ featureRef }) => {
    const st = await requireStore();
    const { items } = await listFeatureSummaries(st, { featureRef });
    const lines = items.map((feature) => `- ${feature.ref}${feature.shortId ? ` · ${feature.shortId}` : ""} — ${feature.name} (${feature.status}${feature.priority > 0 ? `; priority ${feature.priority}` : ""}; ${feature.phaseCount} phases, ${feature.taskCount} tasks)`);
    return text(lines.join("\n") || "No features", { features: items });
  });

  server.registerTool("planner-phase-list", {
    description: "List phases (compact: F00x/P00x · shortId — title (status; priority N; N tasks) [F00x]). Filters: featureRef, status. Cheap discovery — do NOT read .planner/ files or planner-plan-get full=true.",
    inputSchema: { featureRef: z.string().optional().describe("Optional: filter to one feature (F00x/shortId/UUID/name)."), status: z.string().optional().describe("Optional: filter by status name.") },
  }, async ({ featureRef, status }) => {
    const st = await requireStore();
    const outcome = await listPhaseSummaries(st, { featureRef, status });
    if (!outcome.ok) return text(outcome.message);
    const items = outcome.items;
    const lines = items.map((phase) => {
      const fTag = phase.featureNumber !== undefined ? ` [F${String(phase.featureNumber).padStart(3, "0")}]` : "";
      return `- ${phase.ref}${phase.shortId ? ` · ${phase.shortId}` : ""} — ${phase.title} (${phase.status}${phase.priority > 0 ? `; priority ${phase.priority}` : ""}; ${phase.taskCount} tasks)${fTag}`;
    });
    return text(lines.join("\n") || "No phases", { phases: items });
  });

  server.registerTool("planner-task-list", {
    description: "List tasks (compact: F00x/P00x/T00x · shortId — title (status; priority N)). Filters: featureRef, phaseRef, status. Cheap discovery — do NOT read .planner/ files or planner-plan-get full=true.",
    inputSchema: { featureRef: z.string().optional(), phaseRef: z.string().optional(), status: z.string().optional().describe("Optional: filter by status name.") },
  }, async ({ featureRef, phaseRef, status }) => {
    const st = await requireStore();
    const outcome = await listTaskSummaries(st, { featureRef, phaseRef, status });
    if (!outcome.ok) return text(outcome.message);
    const out = outcome.items.map((task) => `- ${task.ref}${task.shortId ? ` · ${task.shortId}` : ""} — ${task.title} (${task.status}${task.priority > 0 ? `; priority ${task.priority}` : ""})`);
    return text(out.join("\n") || "No tasks", { tasks: outcome.items });
  });

server.registerTool("planner-accepted-decision-create", {
  description: "Create an accepted decision on the project, feature, phase, or task without replacing the full acceptedDecisions array.",
  inputSchema: {
    targetType: z.enum(["project", "feature", "phase", "task"]),
    targetRef: z.string().optional().describe("Feature/phase/task ref. Omit for targetType=project."),
    title: z.string().min(1),
    decision: z.string().optional(),
    rationale: z.string().optional(),
    implementationNotes: z.string().optional(),
  },
}, async ({ targetType, targetRef, title, decision, rationale, implementationNotes }) => {
  const st = await requireStore();
  const target = await resolveAcceptedDecisionTarget(st, targetType, targetRef);
  if (!target.ok) return { isError: true, content: [{ type: "text", text: target.error }], structuredContent: { created: false, errorCode: "ACCEPTED_DECISION_TARGET_NOT_FOUND" } };
  const createInput = {
    title,
    ...(decision !== undefined ? { decision } : {}),
    ...(rationale !== undefined ? { rationale } : {}),
    ...(implementationNotes !== undefined ? { implementationNotes } : {}),
  };
  try {
    const acceptedDecision = await st.createAcceptedDecision(target.owner, createInput);
    return writeAndSummarize(st, `Accepted decision created on ${target.ref}: ${acceptedDecision.title}`, {
      created: true,
      targetType,
      targetRef: target.ref,
      acceptedDecision,
    });
  } catch (error) {
    return mcpAcceptedDecisionMutationFailure(error, "created");
  }
});

server.registerTool("planner-accepted-decision-update", {
  description: "Update one accepted decision in place while preserving its id and acceptedAt timestamp.",
  inputSchema: {
    targetType: z.enum(["project", "feature", "phase", "task"]),
    targetRef: z.string().optional().describe("Feature/phase/task ref. Omit for targetType=project."),
    decisionId: z.string().min(1),
    title: z.string().optional(),
    decision: z.string().optional(),
    rationale: z.string().optional(),
    implementationNotes: z.string().optional(),
  },
}, async ({ targetType, targetRef, decisionId, title, decision, rationale, implementationNotes }) => {
  const mutableFields = ["title", "decision", "rationale", "implementationNotes"] as const;
  const receivedFields = mutableFields.filter((field) => ({ title, decision, rationale, implementationNotes })[field] !== undefined);
  if (receivedFields.length === 0) {
    return mcpMutationNoFieldsFailure({
      entity: "acceptedDecision",
      ref: decisionId,
      operation: "update",
      mutableFields,
      retryCommand: "planner-accepted-decision-update with title, decision, rationale, or implementationNotes",
      readBackCommand: "planner-show or the owning entity show tool",
    });
  }
  const st = await requireStore();
  const target = await resolveAcceptedDecisionTarget(st, targetType, targetRef);
  if (!target.ok) return { isError: true, content: [{ type: "text", text: target.error }], structuredContent: { updated: false, errorCode: "ACCEPTED_DECISION_TARGET_NOT_FOUND" } };
  const updateInput = {
    ...(title !== undefined ? { title } : {}),
    ...(decision !== undefined ? { decision } : {}),
    ...(rationale !== undefined ? { rationale } : {}),
    ...(implementationNotes !== undefined ? { implementationNotes } : {}),
  };
  try {
    const acceptedDecision = await st.updateAcceptedDecision(target.owner, decisionId, updateInput);
    return writeAndSummarize(st, `Accepted decision updated on ${target.ref}: ${acceptedDecision.title}`, {
      updated: true,
      targetType,
      targetRef: target.ref,
      acceptedDecision,
    });
  } catch (error) {
    return mcpAcceptedDecisionMutationFailure(error, "updated");
  }
});

server.registerTool("planner-accepted-decision-delete", {
  description: "Delete one accepted decision from the project, feature, phase, or task without replacing the full acceptedDecisions array.",
  inputSchema: {
    targetType: z.enum(["project", "feature", "phase", "task"]),
    targetRef: z.string().optional().describe("Feature/phase/task ref. Omit for targetType=project."),
    decisionId: z.string().min(1),
    confirmed: z.boolean().describe("Must be true to confirm deleting this accepted decision."),
  },
}, async ({ targetType, targetRef, decisionId, confirmed }) => {
  const st = await requireStore();
  const target = await resolveAcceptedDecisionTarget(st, targetType, targetRef);
  if (!target.ok) return { isError: true, content: [{ type: "text", text: target.error }], structuredContent: { deleted: false, errorCode: "ACCEPTED_DECISION_TARGET_NOT_FOUND" } };
  if (!confirmed) {
    return text(`Delete not confirmed for accepted decision ${decisionId} on ${target.ref}. Retry with confirmed=true.`, {
      deleted: false,
      confirmRequired: true,
      targetType,
      targetRef: target.ref,
      decisionId,
    });
  }
  try {
    const acceptedDecision = await st.deleteAcceptedDecision(target.owner, decisionId);
    return writeAndSummarize(st, `Accepted decision deleted from ${target.ref}: ${acceptedDecision.title}`, {
      deleted: true,
      targetType,
      targetRef: target.ref,
      decisionId,
      acceptedDecision,
    });
  } catch (error) {
    return mcpAcceptedDecisionMutationFailure(error, "deleted");
  }
});

server.registerTool("planner-feature-add", {
  description: "Create a feature with a rich description. REQUIRED: description must include code references (file:line), current implementation state (what exists, what is unimplemented), systems/structs/traits involved, concrete goals, and behaviors to preserve. The description is the primary context for future agents resuming this feature; one-liners cause misalignment.",
  inputSchema: {
    name: z.string().min(1),
    description: z.string().min(50, "Description must be at least 50 characters — include code references (file:line), current state, goals, and behaviors to preserve. Prefix with 'design-only' for pre-implementation design tasks without code refs.").describe(`Required code references (file:line), current state of the art, structs/traits/systems involved, goals, and behaviors to preserve. Not a one-liner. ${LONG_TEXT_LIMIT_NOTICE}`),
    status: z.enum(STATUS_VALUES).optional(),
  },
}, async ({ name, description, status }) => {
  const st = await requireStore();
  try {
    const outcome = await createFeatureFlow(st, { name, description, status });
    return text(outcome.message);
  } catch (error) {
    if (error instanceof FeatureFlowRefusal) {
      return text(error.message, { created: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-feature-show", {
  description: "Show a feature by id or name. Pass full=true for the description and every canonical Accepted Decision field.",
    inputSchema: { feature: z.string().min(1).describe("Feature ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."), full: z.boolean().optional().describe("If true, include the feature description. Default: compact identity only (saves tokens).") },
  }, async ({ feature: ref, full }, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  const st = await requireStore();
  const outcome = await showFeature(st, ref);
  if (!outcome.ok) return text(outcome.message);
  const { feature, ref: featureRef, phaseCount } = outcome;
    const summary = `${feature.name} — ${featureRef}${feature.shortId ? ` · ${feature.shortId}` : ""} (${feature.status}; ${phaseCount} phases)`;
    const descriptionRefBlock = feature.descriptionRef ? `\n\nDescription reference:\n- ${feature.descriptionRef}` : "";
    if (!full) return text(summary);
    const decisionBlock = renderAcceptedDecisionsSection("Accepted Decisions", feature.acceptedDecisions);
    const result = text(`${summary}\n\n${feature.description || ""}${descriptionRefBlock}\n\n${decisionBlock}`, {
      feature: {
        ref: featureRef,
        description: feature.description,
        descriptionRef: feature.descriptionRef || "",
        acceptedDecisions: feature.acceptedDecisions,
      },
    });
    markCanonicalFullReadForSessionId(plannerSessionId, "feature", feature, result.content[0]!.text);
    return result;
});

server.registerTool("planner-feature-discuss", {
  description: "Persist feature discovery/governance fields and mark the feature context as ready.",
  inputSchema: {
    feature: z.string().min(1).describe("Feature ref. Accepts F00x, shortId, UUID, or title."),
    description: z.string().optional().describe(`Current implementation state, scope, and goals for this feature. ${LONG_TEXT_LIMIT_NOTICE}`),
    descriptionRef: z.string().optional().describe("Optional markdown reference under .planner/docs/ for the full feature description."),
    workDone: z.string().optional().describe("What is already implemented / decided."),
    workRemaining: z.string().optional().describe("What still needs to be done."),
    dependencies: z.array(z.string()).optional().describe("Cross-feature or external dependencies."),
  },
}, async ({ feature: ref, description, descriptionRef: rawDescriptionRef, workDone, workRemaining, dependencies }) => {
  const st = await requireStore();
  try {
    const outcome = await discussFeatureFlow(st, ref, {
      description,
      descriptionRef: rawDescriptionRef,
      workDone,
      workRemaining,
      dependencies,
      contextReadyReason: "Updated through planner-feature-discuss MCP tool.",
    });
    const result = outcome.feature;
    const featureDiscussReply = buildMutationReply({
      identity: { entity: "feature", ref: outcome.ref, id: result.id, shortId: result.shortId, title: result.name, status: result.status },
      operation: "discuss",
      updatedFields: outcome.updatedFields,
      changedValues: result as unknown as Record<string, unknown>,
      readBackCommand: `planner-feature-show ${outcome.ref} full=true`,
    });
    return text(featureDiscussReply.text, featureDiscussReply.structured);
  } catch (error) {
    if (error instanceof DiscussFlowRefusal) {
      if (error.code === "FEATURE_NOT_FOUND") return text(error.message);
      if (error.code === "FEATURE_NO_MUTABLE_FIELDS") {
        return mcpMutationNoFieldsFailure({
          entity: "feature",
          ref: error.details.ref as string,
          operation: "discuss",
          mutableFields: error.details.mutableFields as string[],
          retryCommand: `planner-feature-discuss ${error.details.ref as string}`,
          readBackCommand: `planner-feature-show ${error.details.ref as string} with full=true`,
          descriptionFallback: {
            entityId: error.details.featureId as string,
            inputField: "description",
            storedField: "feature description",
            descriptionRefField: "descriptionRef",
          },
        });
      }
      return text(error.message, { updated: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-feature-update", {
  description: "Update a feature.",
  inputSchema: {
    feature: z.string().min(1).describe("Feature ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."),
    name: z.string().optional(),
    description: z.string().optional().describe(LONG_TEXT_LIMIT_NOTICE),
    descriptionRef: z.string().optional().describe("Optional markdown reference under .planner/docs/ for the full feature description."),
    status: z.enum(STATUS_VALUES).optional(),
    workDone: z.string().optional(),
    workRemaining: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    priority: z.number().int().nonnegative().optional().describe("Display order within the project (lower = higher). Tiebreak by number then createdAt."),
  },
}, async ({ feature: ref, ...updates }) => {
  const st = await requireStore();
  try {
    const outcome = await updateFeatureFlow(st, ref, updates);
    const result = outcome.feature;
    const featureRef = outcome.ref;
    const featureUpdateReply = buildMutationReply({
      identity: { entity: "feature", ref: featureRef, id: result.id, shortId: result.shortId, title: result.name, status: result.status },
      operation: "update",
      updatedFields: outcome.updatedFields,
      changedValues: result as unknown as Record<string, unknown>,
      readBackCommand: `planner-feature-show ${featureRef} full=true`,
    });
    return text(featureUpdateReply.text, featureUpdateReply.structured);
  } catch (error) {
    if (error instanceof FeatureFlowRefusal) {
      if (error.code === "FEATURE_STATUS_READ_ONLY") {
        return mcpDerivedStatusReadOnlyResult("feature", error.details.ref as string, error.details.attemptedStatus as string, error.details.effectiveStatus as string);
      }
      if (error.code === "FEATURE_NO_MUTABLE_FIELDS") {
        return mcpMutationNoFieldsFailure({
          entity: "feature",
          ref: error.details.ref as string,
          operation: "update",
          mutableFields: error.details.mutableFields as string[],
          retryCommand: `planner-feature-update ${error.details.ref as string}`,
          readBackCommand: `planner-feature-show ${error.details.ref as string} with full=true`,
          descriptionFallback: {
            entityId: error.details.featureId as string,
            inputField: "description",
            storedField: "feature description",
            descriptionRefField: "descriptionRef",
          },
        });
      }
      return text(error.message, { updated: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-feature-delete", {
  description: "Delete a feature. By default, phases are unlinked rather than deleted.",
  inputSchema: {
    feature: z.string().min(1).describe("Feature ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."),
    cascade: z.boolean().optional().describe("Also delete phases belonging to this feature"),
  },
}, async ({ feature: ref, cascade }) => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const resolvedFeature = resolveFeatureRefStrict(features, ref);
  if (!resolvedFeature.ok) return text(resolvedFeature.error);
  const outcome = await deleteFeatureCascade(st, resolvedFeature.feature.id, { cascade: Boolean(cascade) });
  if (!outcome.ok) return text(`❌ ${outcome.error}`, { deleted: false, errorCode: outcome.errorCode });
  const { result } = outcome;
  return text(
    `✅ Feature deleted: ${result.ref}${result.cascade ? `; deleted ${result.phaseCount} phases` : `; unlinked ${result.phaseCount} phases`}`,
    { deleted: true, ref: result.ref, id: result.id, affectedPhases: result.phaseCount, cascade: result.cascade },
  );
});

server.registerTool("planner-phase-add", {
  description: "Create a phase linked to a feature with a rich description. REQUIRED: feature ref and description. The description must include code references (file:line), current implementation state, dependencies, specific files/systems to modify, and behaviors to preserve. The description is the primary context for future agents; one-liners cause misalignment.",
  inputSchema: {
    title: z.string().min(1),
    feature: z.string().min(1).optional().describe("Feature ref (required). Accepts F00x/P00x/T00x composite, bare F00x (global), 5-char shortId, UUID, or title."),
    summary: z.string().optional().describe("One-line summary of the phase"),
    description: z.string().min(50, "Description must be at least 50 characters — include code references (file:line), current state, structs/traits involved, concrete work items, behaviors to preserve. Prefix with 'design-only' for pre-implementation design tasks.").describe(`Required code references (file:line), current state, structs/traits involved, concrete work items, behaviors to preserve. Not a one-liner. ${LONG_TEXT_LIMIT_NOTICE}`),
  },
}, async ({ title, feature: featureRef, summary, description }) => {
  const st = await requireStore();
  try {
    const outcome = await createPhaseFlow(st, { title, featureRef: featureRef ?? "", summary, description });
    return text(outcome.message);
  } catch (error) {
    if (error instanceof PhaseFlowRefusal) {
      return text(error.message, { created: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-phase-show", {
  description: "Show a phase by id or name, including every canonical Accepted Decision field and derived linked requirements in the full view.",
    inputSchema: { phase: z.string().min(1).describe("Phase ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."), full: z.boolean().optional().describe("If true, include the phase description. Default: compact identity only (saves tokens).") },
  }, async ({ phase: ref, full }, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  const st = await requireStore();
    const outcome = await showPhase(st, ref);
    if (!outcome.ok) return text(outcome.message);
    const { phase, ref: phaseRef, taskCount, linkedRequirements } = outcome;
    const reqCount = linkedRequirements.length;
    const summary = `${phase.title} — ${phaseRef}${phase.shortId ? ` · ${phase.shortId}` : ""} (${phase.status}; ${taskCount} tasks${reqCount ? `; ${reqCount} linked requirement${reqCount === 1 ? "" : "s"}` : ""})`;
    const descriptionRefBlock = phase.descriptionRef ? `\n\nDescription reference:\n- ${phase.descriptionRef}` : "";
    const requirementsBlock = reqCount > 0
      ? `\n\nLinked requirements:\n${linkedRequirements.map((requirement) => `- ${requirement.title}`).join("\n")}`
      : "";
    if (!full) return text(summary, {
      phase: {
        ref: phaseRef,
        shortId: phase.shortId,
        title: phase.title,
        summary: phase.summary,
        status: phase.status,
        taskCount,
      },
      linkedRequirements,
    });
    const decisionBlock = renderAcceptedDecisionsSection("Accepted Decisions", phase.acceptedDecisions);
    const result = text(`${summary}\n\n${phase.description || ""}${descriptionRefBlock}${requirementsBlock}\n\n${decisionBlock}`, {
      phase: {
        ref: phaseRef,
        shortId: phase.shortId,
        title: phase.title,
        summary: phase.summary,
        status: phase.status,
        taskCount,
        description: phase.description,
        descriptionRef: phase.descriptionRef || "",
        acceptedDecisions: phase.acceptedDecisions,
      },
      linkedRequirements,
    });
    markCanonicalFullReadForSessionId(plannerSessionId, "phase", phase, result.content[0]!.text);
    return result;
});

server.registerTool("planner-phase-discuss", {
  description: "Persist phase discovery fields and mark governance context ready without overriding derived status.",
  inputSchema: {
    phase: z.string().min(1).describe("Phase ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."),
    goal: z.string().optional().describe("Backward-compatible single main goal."),
    goals: z.array(z.string()).optional().describe("Replace the phase goals list."),
    summary: z.string().optional(),
    scope: z.string().optional(),
    descriptionRef: z.string().optional().describe("Optional markdown reference under .planner/docs/ for the full phase description."),
    nonGoals: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
    risks: z.array(z.string()).optional(),
    openQuestions: z.array(z.string()).optional(),
    completionCriteria: z.array(z.string()).optional(),
  },
}, async ({ phase: ref, ...updates }) => {
  const st = await requireStore();
  try {
    const outcome = await discussPhaseFlow(st, ref, {
      ...updates,
      contextReadyReason: "Updated through planner-phase-discuss MCP tool.",
    });
    const phaseDiscussReply = buildMutationReply({
      identity: { entity: "phase", ref: outcome.ref, id: outcome.phase.id, shortId: outcome.phase.shortId, title: outcome.phase.title, status: outcome.phase.status },
      operation: "discuss",
      updatedFields: outcome.updatedFields,
      changedValues: outcome.phase as unknown as Record<string, unknown>,
      extras: { contextReady: true },
      readBackCommand: `planner-phase-show ${outcome.ref} full=true`,
    });
    return text(phaseDiscussReply.text, phaseDiscussReply.structured);
  } catch (error) {
    if (error instanceof DiscussFlowRefusal) {
      if (error.code === "PHASE_NOT_FOUND") return text(error.message);
      if (error.code === "PHASE_NO_MUTABLE_FIELDS") {
        return mcpMutationNoFieldsFailure({
          entity: "phase",
          ref: error.details.ref as string,
          operation: "discuss",
          mutableFields: error.details.mutableFields as string[],
          retryCommand: `planner-phase-discuss ${error.details.ref as string}`,
          readBackCommand: `planner-phase-show ${error.details.ref as string} with full=true`,
          descriptionFallback: {
            entityId: error.details.phaseId as string,
            inputField: "scope",
            storedField: "phase description",
            descriptionRefField: "descriptionRef",
          },
        });
      }
      return text(error.message, { updated: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-phase-update", {
  description: "Update phase fields, including parent relinking and planning metadata. Derived status remains read-only.",
  inputSchema: {
    phase: z.string().min(1),
    title: z.string().optional(),
    status: z.enum(PHASE_STATUS_VALUES).optional(),
    summary: z.string().optional(),
    description: z.string().optional().describe(LONG_TEXT_LIMIT_NOTICE),
    descriptionRef: z.string().optional().describe("Optional markdown reference under .planner/docs/ for the full phase description."),
    featureId: z.string().optional().describe("Feature ref to relink this phase to, or an empty string to unlink it."),
    priority: z.number().int().nonnegative().optional().describe("Display order within the feature (lower = higher)."),
    goals: z.array(z.string()).optional(),
    nonGoals: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
    risks: z.array(z.string()).optional(),
    openQuestions: z.array(z.string()).optional(),
    decisions: z.array(z.string()).optional().describe("Deprecated legacy field. Read-only history now; supplying it returns LEGACY_DECISIONS_ARRAY_READ_ONLY. Use planner-accepted-decision-create for new durable decisions."),
    completionCriteria: z.array(z.string()).optional(),
  },
}, async ({ phase: ref, ...updates }) => {
  const st = await requireStore();
  try {
    const outcome = await updatePhaseFlow(st, ref, updates);
    const persisted = outcome.phase;
    const phaseUpdateRef = outcome.ref;
    const phaseUpdateReply = buildMutationReply({
      identity: { entity: "phase", ref: phaseUpdateRef, id: persisted.id, shortId: persisted.shortId, title: persisted.title, status: persisted.status },
      operation: "update",
      updatedFields: outcome.updatedFields,
      changedValues: persisted as unknown as Record<string, unknown>,
      extras: outcome.descriptionFreshness
        ? { descriptionFreshness: outcome.descriptionFreshness, staleParentRefs: outcome.staleParentRefs }
        : {},
      readBackCommand: `planner-phase-show ${phaseUpdateRef} full=true`,
    });
    return text(phaseUpdateReply.text, phaseUpdateReply.structured);
  } catch (error) {
    if (error instanceof PhaseFlowRefusal) {
      switch (error.code) {
        case "PHASE_NOT_FOUND":
          return text(error.message);
        case "PHASE_STATUS_READ_ONLY":
          return mcpDerivedStatusReadOnlyResult("phase", error.details.ref as string, error.details.attemptedStatus as string, error.details.effectiveStatus as string);
        case "PHASE_LEGACY_DECISIONS_READ_ONLY":
          return { isError: true, content: [{ type: "text", text: LEGACY_DECISIONS_ARRAY_READ_ONLY_MESSAGE }], structuredContent: { updated: false, errorCode: LEGACY_DECISIONS_ARRAY_READ_ONLY_ERROR_CODE, targetType: "phase", targetRef: error.details.ref as string } };
        case "PHASE_NO_MUTABLE_FIELDS":
          return mcpMutationNoFieldsFailure({
            entity: "phase",
            ref: error.details.ref as string,
            operation: "update",
            mutableFields: error.details.mutableFields as string[],
            retryCommand: `planner-phase-update ${error.details.ref as string}`,
            readBackCommand: `planner-phase-show ${error.details.ref as string} with full=true`,
            descriptionFallback: {
              entityId: error.details.phaseId as string,
              inputField: "description",
              storedField: "phase description",
              descriptionRefField: "descriptionRef",
            },
          });
        default:
          return text(error.message, { updated: false, errorCode: error.code });
      }
    }
    throw error;
  }
});

server.registerTool("planner-phase-delete", {
  description: "Delete a phase and unlink it from features.",
  inputSchema: { phase: z.string().min(1) },
}, async ({ phase: ref }) => {
  const st = await requireStore();
  try {
    const outcome = await deletePhaseFlow(st, ref);
    return writeAndSummarize(st, `Phase deleted: ${outcome.ref}${outcome.shortId ? ` · ${outcome.shortId}` : ""}`, { deleted: outcome.phaseId });
  } catch (error) {
    if (error instanceof PhaseFlowRefusal) {
      return text(error.message, { deleted: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-task-add", {
  description: "Create a task with a rich description. REQUIRED: description must include code references (file:line), what already exists vs what needs to be built, specific structs/traits/systems to modify, concrete implementation steps, and edge cases to handle. The description is the execution context for agents; one-liners cause misalignment.",
  inputSchema: {
    feature: z.string().min(1).optional().describe("Feature ref the task's phase belongs to. Accepts F00x/P00x/T00x composite, bare F00x (global), 5-char shortId, UUID, or title. REQUIRED."),
    phase: z.string().min(1).describe("Phase ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."),
    title: z.string().min(1),
    description: z.string().min(50, "Description must be at least 50 characters — include code references (file:line), current state vs desired state, structs/traits to modify, concrete implementation steps, edge cases. Prefix with 'design-only' for pre-implementation design tasks.").describe(`Required code references (file:line), current state vs desired state, structs/traits to modify, concrete implementation steps, edge cases. Not a one-liner. ${LONG_TEXT_LIMIT_NOTICE}`),
    checklist: z.array(z.string()).optional(),
  },
}, async ({ feature: featureRef, phase: ref, title, description, checklist }) => {
  const st = await requireStore();
  try {
    const outcome = await createTaskFlow(st, { featureRef: featureRef ?? "", phaseRef: ref, title, description, checklist });
    return text(outcome.message);
  } catch (error) {
    if (error instanceof TaskFlowRefusal) {
      return text(error.message, { created: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-task-show", {
  description: "Show a task by id or name. Pass full=true for every canonical Accepted Decision field plus execution and resume context.",
    inputSchema: { task: z.string().min(1).describe("Task ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."), full: z.boolean().optional().describe("If true, include the task description, resume checkpoint/advisory, and statusLog. Default: compact identity only (saves tokens).") },
  }, async ({ task: ref, full }, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  const st = await requireStore();
  const outcome = await showTask(st, ref, { sessionId: plannerSessionId });
  if (!outcome.ok) return text(outcome.message);
  const { task, phase, feature: parentFeature, ref: taskRef, phaseRef, featureRef, orderContext, snapshot, pendingDeviation, linkedRequirements } = outcome;
    const summary = `${task.title} — ${taskRef}${task.shortId ? ` · ${task.shortId}` : ""} (${task.status}; phase ${phaseRef})`;
    if (!full) return text(summary);
    const project = await st.loadProject(plannerSessionId);
    const log = (task.statusLog ?? []).map((e) => `  - ${e.date.slice(0,10)} ${e.title}`).join("\n");
    // P104(F005)/T421: priority and dependsOn at the point an agent reads
    // the task and decides what to do next — the fact planner-task-list and
    // planner-task-recommend already have, made visible here instead of
    // requiring a second call.
    const sections = [summary, taskOrderContextLine(orderContext, task.status)];
    const completionMismatch = taskCompletionMismatchLine(task.status, task.checklist);
    if (completionMismatch) sections.push(completionMismatch);
    if (task.description?.trim()) sections.push(task.description.trim());
    if (task.descriptionRef) sections.push(`Description reference:\n- ${task.descriptionRef}`);
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
    sections.push(renderAcceptedDecisionsSection("Accepted Decisions", task.acceptedDecisions));
    const result = text(sections.join("\n\n"), {
      task: {
        ref: taskRef,
        description: task.description,
        descriptionRef: task.descriptionRef || "",
        acceptedDecisions: task.acceptedDecisions,
        priority: orderContext.priority,
        dependsOn: orderContext.dependsOn,
        ...(completionMismatch ? { checklistMismatch: completionMismatch } : {}),
      },
      taskOrder: {
        readyCount: orderContext.readyCount,
        readyAheadCount: orderContext.readyAheadCount,
        nextByPriorityRef: orderContext.nextByPriorityRef,
      },
    });
    markCanonicalFullReadForSessionId(plannerSessionId, "task", task, result.content[0]!.text);

    // Advisory only (P104(F005)/T420): report whether planner-task-start
    // would succeed right now, using the exact checks it runs itself, so a
    // caller reading the task before starting it learns what else is needed
    // in this same call instead of from a denial. task-start recomputes this
    // at call time and remains the sole authority on whether work may begin.
    const linkedRequirementIds = linkedRequirements.map((requirement) => requirement.id);
    const contextEligibility = contextReadEligibilityForSession({
      sessionId: plannerSessionId,
      taskId: task.id,
      phaseId: phase.id,
      ...(phase.featureId ? { featureId: phase.featureId } : {}),
      task,
      phase,
      ...(parentFeature ? { feature: parentFeature } : {}),
      requirements: linkedRequirements,
      requirementIds: linkedRequirementIds,
    });
    const requirementEligibility = requirementReadEligibilityForSession(plannerSessionId, linkedRequirementIds, linkedRequirements);
    const projectGuidelinesReadState = projectGuidelinesReadStateForSession(project, plannerSessionId);
    const gateState = taskStartGateState(contextEligibility, requirementEligibility, projectGuidelinesReadState);
    const gateNextActions = gateState.ready ? [] : mcpContextReadActions(
      contextEligibility,
      { task: taskRef, phase: phaseRef, ...(featureRef ? { feature: featureRef } : {}) },
      projectGuidelinesReadState !== "valid" && projectGuidelinesReadState !== "not-required",
      !requirementEligibility.eligible,
      `planner-task-start ${taskRef}`,
    );
    return {
      content: [{ type: "text", text: `${result.content[0]!.text}\n\n${taskStartGateStateLine(gateState)}` }],
      structuredContent: {
        ...result.structuredContent,
        taskStartGateState: gateState,
        ...(gateNextActions.length > 0 ? { taskStartNextActions: gateNextActions } : {}),
      },
    };
});

server.registerTool("planner-task-discuss", {
  description: "Persist task execution notes/checklist.",
  inputSchema: {
    task: z.string().min(1),
    description: z.string().optional().describe(LONG_TEXT_LIMIT_NOTICE),
    descriptionRef: z.string().optional().describe("Optional markdown reference under .planner/docs/ for the full task description."),
    checklist: z.array(z.string()).optional().describe("Replace the task checklist (implementation steps, plain strings). Ticks carry over by exact title match, and by position when the new list is the same length (so renaming an item keeps its tick). Use planner-task-checklist-toggle/add/remove for granular edits."),
  },
}, async ({ task: ref, description, descriptionRef: rawDescriptionRef, checklist }) => {
  const st = await requireStore();
  try {
    const outcome = await discussTaskFlow(st, ref, { description, descriptionRef: rawDescriptionRef, checklist });
    const t = outcome.task;
    const lostTicksNotice = outcome.checklistLostTicks.length > 0
      ? ` ⚠️ Lost tick on ${outcome.checklistLostTicks.length} checklist item(s) that could not be matched to a new title: ${outcome.checklistLostTicks.join(", ")}.`
      : "";
    const taskDiscussReply = buildMutationReply({
      identity: { entity: "task", ref: outcome.ref, id: t.id, shortId: t.shortId, title: t.title, status: t.status },
      operation: "discuss",
      updatedFields: outcome.updatedFields,
      changedValues: t as unknown as Record<string, unknown>,
      extras: outcome.checklistLostTicks.length > 0 ? { checklistLostTicks: outcome.checklistLostTicks } : {},
      notices: [lostTicksNotice],
      readBackCommand: `planner-task-show ${outcome.ref} full=true`,
    });
    return text(taskDiscussReply.text, taskDiscussReply.structured);
  } catch (error) {
    if (error instanceof DiscussFlowRefusal) {
      if (error.code === "TASK_NOT_FOUND") return text(error.message);
      if (error.code === "TASK_NO_MUTABLE_FIELDS") {
        return mcpMutationNoFieldsFailure({
          entity: "task",
          ref: error.details.ref as string,
          operation: "discuss",
          mutableFields: error.details.mutableFields as string[],
          retryCommand: `planner-task-discuss ${error.details.ref as string}`,
          readBackCommand: `planner-task-show ${error.details.ref as string} with full=true`,
          descriptionFallback: {
            entityId: error.details.taskId as string,
            inputField: "description",
            storedField: "task description",
            descriptionRefField: "descriptionRef",
          },
        });
      }
      return text(error.message, { updated: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-task-dependency-add", {
  description: "Add a validated task dependency atomically. A task may depend on any task in any phase; the dependency is rejected only when the target does not exist, is the task itself, or would create a cycle.",
  inputSchema: { task: z.string().min(1), dependsOn: z.string().min(1) },
}, async ({ task: ref, dependsOn }) => {
  const st = await requireStore();
  try {
    const outcome = await addTaskDependencyFlow(st, ref, dependsOn);
    const reply = buildMutationReply({
      identity: { entity: "task", ref: outcome.ref, id: outcome.task.id, shortId: outcome.task.shortId, title: outcome.task.title, status: outcome.task.status },
      operation: "update",
      updatedFields: ["dependsOn"],
      changedValues: { dependsOn: outcome.dependsOn },
      readBackCommand: `planner-task-show ${outcome.ref} full=true`,
    });
    return text(`${reply.text} Depends on ${outcome.dependencyRef}.`, reply.structured);
  } catch (error) {
    return taskDependencyFailure(error, "DEPENDENCY_UPDATE_FAILED", "Dependency update failed.");
  }
});

server.registerTool("planner-task-dependency-delete", {
  description: "Remove a task dependency atomically after explicit confirmation.",
  inputSchema: { task: z.string().min(1), dependsOn: z.string().min(1), confirmed: z.boolean() },
}, async ({ task: ref, dependsOn, confirmed }) => {
  const st = await requireStore();
  try {
    const outcome = await removeTaskDependencyFlow(st, ref, dependsOn, confirmed);
    const reply = buildMutationReply({
      identity: { entity: "task", ref: outcome.ref, id: outcome.task.id, shortId: outcome.task.shortId, title: outcome.task.title, status: outcome.task.status },
      operation: "update",
      updatedFields: ["dependsOn"],
      changedValues: { dependsOn: outcome.dependsOn },
      readBackCommand: `planner-task-show ${outcome.ref} full=true`,
    });
    return text(reply.text, reply.structured);
  } catch (error) {
    return taskDependencyFailure(error, "DEPENDENCY_DELETE_FAILED", "Dependency deletion failed.");
  }
});

server.registerTool("planner-task-update", {
  description: "Update task fields. A motivation is REQUIRED when changing to blocked, canceled, deferred, rejected, waiting, or back to planned from another status.",
  inputSchema: {
    task: z.string().min(1),
    title: z.string().optional(),
    status: z.enum(STATUS_VALUES).optional(),
    description: z.string().optional().describe(LONG_TEXT_LIMIT_NOTICE),
    descriptionRef: z.string().optional().describe("Optional markdown reference under .planner/docs/ for the full task description."),
    notes: z.string().optional().describe("Implementation notes."),
    decisions: z.array(z.string()).optional().describe("Deprecated legacy field. Read-only history now; supplying it returns LEGACY_DECISIONS_ARRAY_READ_ONLY. Use planner-accepted-decision-create for new durable decisions."),
    motivation: z.string().optional(),
    priority: z.number().int().nonnegative().optional().describe("Display order within the phase (lower = higher)."),
    checklist: z.array(z.string()).optional().describe("Replace the task checklist (implementation steps, plain strings). Ticks carry over by exact title match, and by position when the new list is the same length (so renaming an item keeps its tick); an item that cannot be matched loses its tick and that loss is reported. Agents should tick steps via planner-task-checklist-toggle, not write DONE in titles, and use planner-task-checklist-add/remove for granular edits."),
    subtasks: z.array(z.object({ id: z.string().optional(), title: z.string().min(1), description: z.string().optional(), status: z.enum(STATUS_VALUES).optional() })).optional().describe("Replace subtasks; existing IDs must belong to this task and omitted IDs are planner-generated."),
  },
}, async ({ task: ref, title, status, description, descriptionRef: rawDescriptionRef, notes, decisions, motivation, priority, checklist, subtasks }, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  const st = await requireStore();
  let outcome: Awaited<ReturnType<typeof updateTaskFlow>>;
  try {
    outcome = await updateTaskFlow(st, ref, {
      title,
      status,
      description,
      descriptionRef: rawDescriptionRef,
      notes,
      decisions,
      motivation,
      priority,
      checklist,
      subtasks,
    }, { sessionId: plannerSessionId });
  } catch (error) {
    if (error instanceof TaskFlowRefusal) {
      if (error.code === "TASK_LEGACY_DECISIONS_READ_ONLY") {
        return { isError: true, content: [{ type: "text", text: LEGACY_DECISIONS_ARRAY_READ_ONLY_MESSAGE }], structuredContent: { updated: false, errorCode: LEGACY_DECISIONS_ARRAY_READ_ONLY_ERROR_CODE, targetType: "task", targetRef: error.details.ref as string } };
      }
      if (error.code === "TASK_NO_MUTABLE_FIELDS") {
        return mcpMutationNoFieldsFailure({
          entity: "task",
          ref: error.details.ref as string,
          operation: "update",
          mutableFields: error.details.mutableFields as string[],
          retryCommand: `planner-task-update ${error.details.ref as string}`,
          readBackCommand: `planner-task-show ${error.details.ref as string} with full=true`,
          descriptionFallback: {
            entityId: error.details.taskId as string,
            inputField: "description",
            storedField: "task description",
            descriptionRefField: "descriptionRef",
          },
        });
      }
      if (error.code === "SUBTASK_ID_INVALID") {
        return { ...text("Subtask IDs must belong to the target task.", { updated: false, errorCode: "SUBTASK_ID_INVALID" }), isError: true };
      }
      return text(error.message, { updated: false, errorCode: error.code });
    }
    const details = error instanceof PlanStoreError ? error.details : undefined;
    return { ...text(`Task update failed: ${error instanceof Error ? error.message : "unknown error"}`, { updated: false, errorCode: details?.errorCode ?? "TASK_UPDATE_FAILED" }), isError: true };
  }
  const t = outcome.task;
  const resumeNotice = outcome.resumeRequired
    ? `\n↩️ RESUME REQUIRED: ${outcome.resumeRequired.ref} — ${outcome.resumeRequired.title}`
    : "";
  const lostTicksNotice = outcome.checklistLostTicks.length > 0
    ? ` ⚠️ Lost tick on ${outcome.checklistLostTicks.length} checklist item(s) that could not be matched to a new title: ${outcome.checklistLostTicks.join(", ")}.`
    : "";
  const taskUpdateReply = buildMutationReply({
    identity: { entity: "task", ref: outcome.ref, id: t.id, shortId: t.shortId, title: t.title, status: t.status },
    operation: "update",
    updatedFields: outcome.updatedFields,
    changedValues: t as unknown as Record<string, unknown>,
    extras: {
      ...(outcome.resumeRequired ? { resumeRequired: outcome.resumeRequired } : {}),
      ...(outcome.descriptionFreshness ? { descriptionFreshness: outcome.descriptionFreshness, staleParentRefs: outcome.staleParentRefs } : {}),
      ...(outcome.checklistLostTicks.length > 0 ? { checklistLostTicks: outcome.checklistLostTicks } : {}),
    },
    notices: [resumeNotice, lostTicksNotice],
    readBackCommand: `planner-task-show ${outcome.ref} full=true`,
  });
  return text(taskUpdateReply.text, taskUpdateReply.structured);
});

server.registerTool("planner-task-move", {
  description: "Move one or more tasks to a different phase, atomically, without recreating them: id, number, shortId, status, statusLog, checklist, subtasks, acceptedDecisions, pause history, notes, description and dependsOn all survive — only the composite ref changes. Every other task's dependsOn keeps resolving (ids never change). An in-progress task may move. Refused into a terminal (done/canceled/rejected) target phase. Costs almost nothing regardless of task size: pass refs only, never task text; the reply echoes only old ref → new ref, id/shortId/title/status per task.",
  inputSchema: {
    tasks: z.array(z.string().min(1)).min(1).describe("Task refs to move. Accepts F00x/P00x/T00x composite, bare T00x (global), 5-char shortId, UUID, or title."),
    targetPhase: z.string().min(1).describe("Destination phase ref. Accepts F00x/P00x, bare P00x, 5-char shortId, UUID, or title."),
  },
}, async ({ tasks: refs, targetPhase: targetRef }) => {
  const st = await requireStore();
  const phases = await st.loadAllPhases();
  const features = (await st.loadFeatures()).features;
  const target = findPhaseByRef(phases, features, targetRef);
  if (!target) return { ...text(`Target phase not found: ${targetRef}`, { moved: false, errorCode: "TARGET_PHASE_NOT_FOUND" }), isError: true };
  const foundTasks: { phase: Phase; task: Task }[] = [];
  for (const ref of refs) {
    const found = findTaskByRef(phases, features, ref);
    if (!found) return { ...text(`Task not found: ${ref}`, { moved: false, errorCode: "TASK_NOT_FOUND" }), isError: true };
    foundTasks.push(found);
  }
  const outcome = await moveTasks(st, foundTasks.map((entry) => entry.task.id), target.id);
  if (!outcome.ok) return { ...text(`❌ ${outcome.error}`, { moved: false, errorCode: outcome.errorCode }), isError: true };
  const reply = buildTaskMoveReply(outcome.result, `planner-task-show ${outcome.result.targetPhaseRef} full=true`);
  return writeAndSummarize(st, reply.text, reply.structured);
});

server.registerTool("planner-task-checklist-toggle", {
  description: "Tick/untick a task checklist item (a 'step') without rewriting the whole list. Accepts the item as C{n} (e.g. C2), the item id, or the title (case-insensitive, first match). Pass checked=true/false to set explicitly, or omit to toggle. Use this instead of writing DONE in step titles. Items are numbered C1/C2… per task.",
  inputSchema: {
    task: z.string().min(1).describe("Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title"),
    item: z.string().min(1).describe("Checklist item selector: C{n} (e.g. C2), item id, or title (case-insensitive)"),
    checked: z.boolean().optional().describe("Set explicitly: true=done, false=open. Omit to toggle."),
  },
}, async ({ task: ref, item, checked }) => {
  const st = await requireStore();
  try {
    const outcome = await toggleTaskChecklistItemFlow(st, ref, item, checked);
    return writeAndSummarize(st, outcome.message);
  } catch (error) {
    if (error instanceof TaskFlowRefusal) return text(error.message);
    throw error;
  }
});

server.registerTool("planner-task-checklist-add", {
  description: "Add a single checklist item (a 'step') to a task without rewriting the list. The new item is appended as C{n} (next progressive number, stable id, unchecked). Use this to subdivide a task into smaller steps INSTEAD of spawning sub-tasks — the checklist keeps description, notes, statusLog and steps concentrated in one task (sub-tasks disperse context). Also use for granular adds instead of replacing the whole checklist via planner-task-update.",
  inputSchema: {
    task: z.string().min(1).describe("Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title"),
    title: z.string().min(1).describe("Checklist item text (a single step)"),
  },
}, async ({ task: ref, title }) => {
  const st = await requireStore();
  try {
    const outcome = await addTaskChecklistItemFlow(st, ref, title);
    return writeAndSummarize(st, outcome.message);
  } catch (error) {
    if (error instanceof TaskFlowRefusal) return text(error.message);
    throw error;
  }
});

server.registerTool("planner-task-checklist-remove", {
  description: "Remove a single checklist item (a 'step') from a task by C{n} (e.g. C2), item id, or title (case-insensitive). Remaining items are renumbered C1..Cn for readability; their stable ids are preserved. Use this for granular removes instead of replacing the whole checklist via planner-task-update.",
  inputSchema: {
    task: z.string().min(1).describe("Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title"),
    item: z.string().min(1).describe("Checklist item selector: C{n} (e.g. C2), item id, or title (case-insensitive)"),
  },
}, async ({ task: ref, item }) => {
  const st = await requireStore();
  try {
    const outcome = await removeTaskChecklistItemFlow(st, ref, item);
    return writeAndSummarize(st, outcome.message);
  } catch (error) {
    if (error instanceof TaskFlowRefusal) return text(error.message);
    throw error;
  }
});

server.registerTool("planner-task-delete", {
  description: "Delete a task.",
  inputSchema: { task: z.string().min(1) },
}, async ({ task: ref }) => {
  const st = await requireStore();
  // Same delete orchestration as the versioned API (plan-core
  // deleteTaskFlow): taskIds stays consistent and the derived phase status
  // is refreshed.
  let outcome;
  try {
    outcome = await deleteTaskFlow(st, ref);
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error));
  }
  return text(
    `Task deleted: ${outcome.ref}${outcome.shortId ? ` · ${outcome.shortId}` : ""}`,
    { deleted: outcome.taskId },
  );
});

server.registerTool("planner-task-recommend", {
  description: "Return the harness-agnostic next-work chain: active task if present, otherwise the lowest-priority ready feature → phase → task, plus bounded typed claims. Only persisted resume-ready handoffs are actionable; Markdown prose and terminal archives are not authority. Does not start or block work.",
  inputSchema: {},
}, async (_args, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  const st = await requireStore();
  const [features, phases, resume, handoffs, archivedHandoffs] = await Promise.all([
    st.loadFeatures(),
    st.loadAllPhases(),
    st.loadResume(plannerSessionId),
    st.listHandoffs(),
    st.listArchivedHandoffs(),
  ]);
  const result = recommendNextWork(features.features, phases, await st.listAllWorkDeviations(), resume?.currentPhaseId, plannerSessionId, {
    handoffs: handoffs.map((handoff) => ({
      compositeRef: handoff.compositeRef,
      firstLine: handoff.firstLine,
      resumeReady: handoff.resumeReady,
    })),
    archivedHandoffs: archivedHandoffs.map(({ compositeRef, firstLine, reason }) => ({ compositeRef, firstLine, reason })),
  });
  const reply = buildRecommendationReply(result, features.features);
  return text(reply.text, reply.structured);
});

server.registerTool("planner-task-deviation", {
  description: "Record a user-approved temporary task deviation. It preserves the recommended/resume task and never starts, pauses, or blocks work; use normal lifecycle tools for those transitions.",
  inputSchema: { temporary_task: z.string().min(1), resume_task: z.string().min(1).optional(), reason: z.string().min(1) },
}, async ({ temporary_task, resume_task, reason }, extra) => {
  const st = await requireStore();
  // Same bookkeeping as the versioned API (plan-core deviation-flow.ts
  // recordDeviationFlow). This tool records intent only; it never
  // transitions a task.
  const outcome = await recordDeviationFlow(st, plannerSessionIdFor(extra), {
    temporaryTask: temporary_task,
    resumeTask: resume_task,
    reason,
  });
  if (!outcome.ok) {
    if (outcome.code === "NO_RESUME_TASK") {
      return text(`No resume task is available. Provide resume_task explicitly. ${outcome.selectionReason ?? ""}`.trimEnd());
    }
    return text(outcome.message);
  }
  return text(
    `✅ Approved deviation: ${outcome.temporaryRef} temporarily overrides ${outcome.resumeRef}. Resume target retained.`,
    { deviation: outcome.deviation },
  );
});

server.registerTool("planner-task-pause", {
  description: "Pause an in-progress task with a mandatory durable checkpoint describing why work stopped, what was underway, the exact resume location, and how to continue.",
  inputSchema: {
    task: z.string().min(1),
    reason: z.string().min(1),
    what_was_being_done: z.string().min(1),
    resume_location: z.string().min(1),
    how_to_resume: z.string().min(1),
    paused_by: z.string().optional(),
  },
}, async ({ task: ref, reason, what_was_being_done, resume_location, how_to_resume, paused_by }, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  const st = await requireStore();
  // Same checkpoint orchestration as the versioned API
  // (plan-core task-lifecycle-flow.ts pauseTaskFlow).
  const outcome = await pauseTaskFlow(st, plannerSessionId, {
    task: ref,
    reason,
    whatWasBeingDone: what_was_being_done,
    resumeLocation: resume_location,
    howToResume: how_to_resume,
    pausedBy: paused_by,
  });
  if (!outcome.ok) return text(outcome.message);
  const resumeNotice = outcome.resumeRequired
    ? `\n↩️ RESUME REQUIRED: ${outcome.resumeRequired.taskRef} — ${outcome.resumeRequired.title}`
    : "";
  return writeAndSummarize(st, [
    `💾 Resume checkpoint saved: ${outcome.taskRef} — ${outcome.task.title}`,
    `Why: ${outcome.snapshot.reason}`,
    `Checkpoint: ${outcome.snapshot.whatWasBeingDone}`,
    `Resume from: ${outcome.snapshot.resumeLocation}`,
    `How to resume: ${outcome.snapshot.howToResume}${resumeNotice}`,
  ].join("\n"), {
    task: outcome.task,
    snapshot: outcome.snapshot,
    ...(outcome.resumeRequired ? { resumeRequired: { taskId: outcome.resumeRequired.taskId } } : {}),
  });
});

server.registerTool("planner-task-switch", {
  description: "Atomically switch from active work to a temporary task, even outside normal priority order. Call this tool first so valid sessionInfo context can be reused; on denial, perform only the missing/stale reads listed in nextActions and retry. If nextActions includes planner-project-guidelines-show, read that section and keep it in working memory while doing task work. Pause the source with a mandatory snapshot, start the target, and push a durable LIFO return target.",
  inputSchema: {
    from_task: z.string().min(1),
    to_task: z.string().min(1),
    reason: z.string().min(1),
    what_was_being_done: z.string().min(1),
    resume_location: z.string().min(1),
    how_to_resume: z.string().min(1),
    switched_by: z.string().optional(),
  },
}, async ({ from_task, to_task, reason, what_was_being_done, resume_location, how_to_resume, switched_by }, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  const st = await requireStore();
  // Same atomic switch as the versioned API (plan-core
  // task-lifecycle-flow.ts switchTaskFlow): pause the source with the
  // mandatory snapshot, claim the target, push the LIFO return target and
  // roll the lifecycle writes back on failure.
  const outcome = await switchTaskFlow(st, plannerSessionId, {
    fromTask: from_task,
    toTask: to_task,
    reason,
    whatWasBeingDone: what_was_being_done,
    resumeLocation: resume_location,
    howToResume: how_to_resume,
    switchedBy: switched_by,
  });
  if (!outcome.ok) {
    const { targetRef, targetPhaseRef, targetFeatureRef } = outcome.context;
    const retry = `Retry planner-task-switch to ${targetRef}`;
    const refs = { task: targetRef, phase: targetPhaseRef, ...(targetFeatureRef ? { feature: targetFeatureRef } : {}) };
    switch (outcome.code) {
      case "TASK_OWNED_BY_ANOTHER_SESSION":
        return { ...text(outcome.message, { started: false, errorCode: outcome.code }), isError: true };
      case "PROJECT_GUIDELINES_READ_REQUIRED": {
        const contextEligibility = outcome.evidence?.contextEligibility ?? { eligible: true, reason: "" };
        const nextActions = mcpContextReadActions(
          contextEligibility,
          refs,
          true,
          Boolean(outcome.evidence?.requirementEligibility && !outcome.evidence.requirementEligibility.eligible),
          retry,
        );
        return text(outcome.message, {
          projectGuidelinesReadState: outcome.context.projectGuidelinesReadState,
          contextEligibility,
          nextActions,
        });
      }
      case "CONTEXT_READ_REQUIRED": {
        const contextEligibility = outcome.evidence?.contextEligibility ?? { eligible: true, reason: "" };
        const nextActions = mcpContextReadActions(
          contextEligibility,
          refs,
          false,
          Boolean(outcome.evidence?.requirementEligibility && !outcome.evidence.requirementEligibility.eligible),
          retry,
        );
        return text(outcome.message, { ...contextEligibility, nextActions });
      }
      case "REQUIREMENTS_READ_REQUIRED":
        return text(outcome.message, {
          requirementIds: outcome.requirementIds,
          requirementEligibility: outcome.evidence?.requirementEligibility,
          nextActions: [`planner-requirement-list with phaseRef=${targetPhaseRef}`, retry],
        });
      default:
        return text(outcome.message);
    }
  }
  return writeAndSummarize(st, [
    `🔀 Task switched: ${outcome.sourceRef} → ${outcome.targetRef}`,
    `Resume checkpoint: ${outcome.snapshot.whatWasBeingDone}`,
    `Return target: ${outcome.sourceRef} from ${outcome.snapshot.resumeLocation}`,
    `Normal priority was deliberately overridden; completing the temporary task will emit RESUME REQUIRED.`,
  ].join("\n"), {
    deviation: outcome.deviation,
    snapshot: outcome.snapshot,
    resumeTaskId: outcome.deviation.resumeTaskId,
    temporaryTaskId: outcome.deviation.temporaryTaskId,
  });
});

server.registerTool("planner-task-reopen", {
  description: "Atomically reopen a completed task. Requires confirmed=true; retains completion evidence and never pauses another task.",
  inputSchema: { task: z.string().min(1), confirmed: z.boolean().optional().default(false) },
}, async ({ task: ref, confirmed }, extra) => {
  const st = await requireStore();
  // Same reopen orchestration as the versioned API
  // (plan-core task-lifecycle-flow.ts reopenTaskFlow).
  const outcome = await reopenTaskFlow(st, plannerSessionIdFor(extra), ref, confirmed);
  if (!outcome.ok) {
    if (outcome.code === "TASK_NOT_FOUND") {
      return { ...text(`Task not found: ${ref}`, { reopened: false, errorCode: "TASK_NOT_FOUND" }), isError: true };
    }
    return { ...text(`Task reopen denied: ${outcome.message}`, { reopened: false, errorCode: outcome.code }), isError: true };
  }
  return text(`✅ Task reopened: ${outcome.taskRef} — ${outcome.task.title} (in-progress)`, { reopened: true, task: outcome.task });
});

server.registerTool("planner-session-recover", {
  description: "Explicitly recover a stopped caller's task ownership, complete return stack and resume focus into this fresh connection. Identify the old session by an active task or a pending return task, without client-side session-ID mapping. Requires confirmed=true after confirming the previous caller has stopped; refuses a registered live process and a caller that already owns work. Task statuses, checkpoints and context-read gates are preserved. Then read the task context and use planner-task-start normally.",
  inputSchema: { task: z.string().min(1), confirmed: z.boolean() },
}, async ({ task: ref, confirmed }, extra) => {
  const st = await requireStore();
  // Same recovery as the versioned API (plan-core deviation-flow.ts
  // recoverSessionFlow): the store verifies the previous process is gone
  // and that this caller owns nothing already.
  const outcome = await recoverSessionFlow(st, plannerSessionIdFor(extra), ref, confirmed);
  if (!outcome.ok) {
    if (outcome.code === "TASK_NOT_FOUND") {
      return { ...text(`Task not found: ${ref}`, { recovered: false, errorCode: outcome.code }), isError: true };
    }
    return { ...text(`Session recovery denied: ${outcome.message}`, { recovered: false, errorCode: outcome.code }), isError: true };
  }
  return text("Session recovered. Existing tasks, checkpoints and return stack are preserved; read the task context before continuing.", {
    recovered: true,
    taskIds: outcome.taskIds,
    deviationIds: outcome.deviationIds,
  });
});

server.registerTool("planner-task-start", {
  description: "Set a task to in-progress or resume checkpointed work. Call this tool before reading context so it can reuse valid sessionInfo attestations; if denied, perform only the missing/stale reads listed in nextActions, then retry. Reads may be performed in any order within the current session. If nextActions includes planner-project-guidelines-show, read that section and keep it in working memory while doing task work. Every denied start is an MCP isError result with started=false; NEVER claim work started unless structuredContent.started is true. Success is returned only after persisted in-progress state is verified.",
  inputSchema: { task: z.string().min(1) },
}, async ({ task: ref }, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  let st: PlanStore;
  try {
    st = await requireStore();
  } catch {
    return taskStartError(taskStartDenied("PLAN_NOT_FOUND", "No .planner/ found.", ["Initialize or load the planner, then retry planner-task-start."]));
  }

  // One lifecycle flow serves this tool and the versioned API
  // (plan-core task-lifecycle-flow.ts). This adapter renders the pinned
  // MCP denial/success texts and echoes the flow's evidence.
  const outcome = await startTaskFlow(st, plannerSessionId, ref);
  if (!outcome.ok) {
    const { taskRef, phaseRef, featureRef, requirementReadRequired } = outcome.context;
    const retry = `Retry planner-task-start ${taskRef}`;
    const refs = { task: taskRef, phase: phaseRef, ...(featureRef ? { feature: featureRef } : {}) };
    let actions: string[];
    let structured: Record<string, unknown> = {};
    switch (outcome.code) {
      case "TASK_NOT_FOUND":
        actions = ["Resolve the task with planner-task-list or planner-task-show, then retry planner-task-start."];
        break;
      case "TASK_DONE":
        actions = [
          `Use planner-task-reopen with task=${taskRef} and confirmed=true after explicit user confirmation.`,
          `Retry planner-task-start ${taskRef} only if reopening is not the intended operation.`,
        ];
        break;
      case "PROJECT_GUIDELINES_READ_REQUIRED":
        actions = mcpContextReadActions(outcome.evidence?.contextEligibility ?? { eligible: true, reason: "" }, refs, true, Boolean(requirementReadRequired), retry);
        structured = {
          projectGuidelinesReadState: outcome.context.projectGuidelinesReadState,
          contextEligibility: outcome.evidence?.contextEligibility,
        };
        break;
      case "CONTEXT_READ_REQUIRED":
        actions = mcpContextReadActions(outcome.evidence?.contextEligibility ?? { eligible: true, reason: "" }, refs, false, Boolean(requirementReadRequired), retry);
        structured = { contextEligibility: outcome.evidence?.contextEligibility };
        break;
      case "REQUIREMENTS_READ_REQUIRED":
        actions = [`planner-requirement-list with phaseRef=${phaseRef}`, retry];
        structured = { requirementEligibility: outcome.evidence?.requirementEligibility };
        break;
      case "START_NOT_ALLOWED":
        actions = ["Resolve the reported task readiness condition, then retry planner-task-start."];
        structured = { eligibility: outcome.evidence?.startEligibility };
        break;
      case "ACTIVE_TASK_CONFLICT":
        actions = outcome.context.activeTaskRef
          ? [`Use planner-task-switch to snapshot and pause ${outcome.context.activeTaskRef}.`, retry]
          : ["Pause or reconcile the active tasks.", retry];
        structured = { selection: outcome.evidence?.selection };
        break;
      case "PERSISTENCE_VERIFICATION_FAILED":
        actions = ["Inspect planner-task-show for the persisted state and retry only after resolving the persistence failure."];
        break;
      default:
        actions = outcome.context.wasInProgress
          ? ["Continue with the owning caller, or use planner-session-recover after confirming it has stopped."]
          : ["Re-read the task and reconcile its owner before retrying."];
        break;
    }
    return taskStartError(
      taskStartDenied(outcome.code, outcome.message, actions, {
        ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
        ...(outcome.requirementIds ? { requirementIds: outcome.requirementIds } : {}),
      }),
      structured,
    );
  }

  const projectContextAdvisory = outcome.projectContextStale ? projectContextStaleAdvisory("stale") : "";
  const phaseOrderAdvisory = higherPriorityOpenPhaseAdvisory(outcome.higherPriorityOpenPhase);
  if (outcome.alreadyStarted) {
    const claimed = taskStartSucceeded(outcome.task.id, true);
    return text(
      `✅ Task already started: ${outcome.taskRef} — ${outcome.task.title} (in-progress)\nstarted: true${projectContextAdvisory}${phaseOrderAdvisory}`,
      {
        ...claimed,
        task: outcome.task,
        projectContextStale: outcome.projectContextStale,
        higherPriorityOpenPhase: outcome.higherPriorityOpenPhase,
      },
    );
  }
  const started = taskStartSucceeded(outcome.task.id);
  const recommendedRef = outcome.recommendedTaskRef ?? "";
  const advisory = outcome.advisory === "resume"
    ? `\n\n${outcome.resumeRequired
      ? outcome.resumeRequired.text
      : `⚠️ Resume advisory: ${recommendedRef} has a saved checkpoint. Evaluate its resume context before continuing with this explicit task request. Explicit task request honored.`}`
    : outcome.advisory === "priority"
      ? `\n\n⚠️ Priority advisory: ${recommendedRef} is the automatic recommendation. Explicit task request honored.`
      : "";
  return text(
    `✅ Task started: ${outcome.taskRef} — ${outcome.task.title} (in-progress)${outcome.task.shortId ? ` · ${outcome.task.shortId}` : ""}\nstarted: true${outcome.phaseContext}${advisory}${projectContextAdvisory}${phaseOrderAdvisory}`,
    {
      ...started,
      task: outcome.task,
      ...(outcome.resumeRequired ? { resumeRequired: outcome.resumeRequired.structured } : {}),
      projectContextStale: outcome.projectContextStale,
      higherPriorityOpenPhase: outcome.higherPriorityOpenPhase,
    },
  );
});

server.registerTool("planner-task-complete", {
  description: "Set a task to done with mandatory durable completion and verification evidence. Fails if checklist is incomplete — tick the completed items with planner-task-checklist-toggle first. force=true is the exception for a checklist that no longer matches the work, and requires a motivation; the overridden items are recorded, never auto-ticked.",
  inputSchema: {
    task: z.string().min(1),
    force: z.boolean().optional(),
    motivation: z.string().optional().describe("Required when force=true overrides unchecked checklist items: why the checklist no longer matches the work."),
    description_update: z.string().min(10).describe("Required evidence: shipped work, verification level including partial verification, remaining/unverified work, files, decisions, and updated code references."),
  },
}, async ({ task: ref, force, motivation, description_update }, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  const st = await requireStore();
  // Same completion orchestration as the versioned API
  // (plan-core task-lifecycle-flow.ts completeTaskFlow).
  const outcome = await completeTaskFlow(st, plannerSessionId, {
    task: ref,
    force,
    motivation,
    descriptionUpdate: description_update,
  });
  if (!outcome.ok) {
    if (outcome.code === "CHECKLIST_INCOMPLETE") {
      return text(
        taskCompletionChecklistRefusal(outcome.uncheckedItems ?? [], `planner-task-checklist-toggle ${outcome.taskRef} <item>`),
        { completed: false, errorCode: outcome.code, uncheckedItems: (outcome.uncheckedItems ?? []).map((item) => item.title) },
      );
    }
    if (outcome.code === "FORCE_MOTIVATION_REQUIRED") {
      return text(
        taskCompletionForceMotivationRequired(outcome.uncheckedItems ?? []),
        { completed: false, errorCode: outcome.code, uncheckedItems: (outcome.uncheckedItems ?? []).map((item) => item.title) },
      );
    }
    if (outcome.code === "TASK_CHECKPOINT_PENDING") {
      return text("Task completion denied: resume checkpointed work with planner-task-start before completing it, or cancel it explicitly with motivation.");
    }
    return text(outcome.message);
  }
  const resume = outcome.resumeRequired;
  const resumeNotice = resume
    ? [
      "",
      `↩️ RESUME REQUIRED: ${resume.taskRef} — ${resume.title}`,
      resume.snapshot ? `Checkpoint reason: ${resume.snapshot.reason}` : "Return to the preserved task before selecting new priority work.",
      resume.snapshot ? `Resume from: ${resume.snapshot.resumeLocation}` : "",
      resume.snapshot ? `How to resume: ${resume.snapshot.howToResume}` : "",
      `Next action: planner-task-start ${resume.taskRef}`,
    ].filter(Boolean).join("\n")
    : "";
  return writeAndSummarize(
    st,
    `✅ Task completed: ${outcome.taskRef} — ${outcome.task.title} (done)${outcome.task.shortId ? ` · ${outcome.task.shortId}` : ""}${outcome.clearedHandoffRef ? ` — phase handoff auto-cleared (${outcome.clearedHandoffRef})` : ""}${resumeNotice}`,
    resume ? { resumeRequired: { taskId: resume.taskId, phaseId: resume.phaseId, snapshot: resume.snapshot } } : undefined,
  );
});

server.registerTool("planner-handoff-list", {
  description: "List active handoffs as compact summary-only pages. Full bodies are never embedded; call planner-handoff-show for one exact phase.",
  inputSchema: {
    page: z.number().int().min(1).default(1).describe("1-based page number."),
    pageSize: z.number().int().min(1).max(25).default(10).describe("Summaries per page; maximum 25."),
  },
}, async ({ page, pageSize }) => {
  const st = await requireStore();
  const list = await listPhaseHandoffsFlow(st, page, pageSize);
  if (list.total === 0) return text("No phase handoffs set.", { count: 0, total: 0, page: 1, pageSize, totalPages: 1, handoffs: [] });
  const lines = list.items.map((e) => `- ${e.compositeRef} — ${e.firstLine} (updated ${e.updatedAt}; ${e.contentLength} chars; ${e.resumeReady ? "resume-ready" : "verification required"})`);
  return text(`Phase handoffs — page ${list.page}/${list.totalPages} (${list.total} total):\n${lines.join("\n")}`, { count: list.items.length, page: list.page, pageSize: list.pageSize, total: list.total, totalPages: list.totalPages, handoffs: list.items });
});

server.registerTool("planner-handoff-show", {
  description: "Read the active entity-scoped handoff of a phase, or its latest terminal archive, together with a bounded priority-ordered phase work map. Reread the canonical phase and relevant sibling tasks before proposing work so capability ownership is not duplicated. phaseRef is required; never infer a phase from in-progress status or stale context.",
  inputSchema: { phaseRef: z.string().min(1).describe("Exact phase ref: P00x | P00x(F00x) | UUID | title. Ask the user when ambiguous.") },
}, async ({ phaseRef }) => {
  const st = await requireStore();
  try {
    const reply = await showPhaseHandoffFlow(st, phaseRef);
    return text(reply.text, reply.structured);
  } catch (error) {
    if (error instanceof HandoffFlowRefusal) return text(`❌ ${error.message}`);
    throw error;
  }
});

server.registerTool("planner-handoff-verify", {
  description: "Finalize one persisted handoff as resume-ready after planner-handoff-show confirms the persisted compact resume capsule. Legacy sourceReviews and omissionsFound evidence remains accepted but is optional; the planner derives omitted evidence from persisted state.",
  inputSchema: {
    phaseRef: z.string().min(1),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceReviews: z.array(z.object({
      source: z.enum(["conversation", "planner-entities", "working-tree", "verification-runtime", "peer-agent-output"]),
      detail: z.string().min(12),
    })).optional().describe("Optional legacy evidence; omitted for compact handoffs."),
    omissionsFound: z.array(z.string().min(1)).optional().describe("Optional read-back gaps; omit when the persisted capsule is complete."),
  },
}, async ({ phaseRef, expectedContentHash, sourceReviews, omissionsFound }) => {
  const st = await requireStore();
  try {
    const outcome = await verifyPhaseHandoffFlow(st, phaseRef, {
      expectedContentHash,
      ...(sourceReviews ? { sourceReviews } : {}),
      ...(omissionsFound ? { omissionsFound } : {}),
    });
    return text(`✅ Handoff on ${outcome.phaseRef} is resume-ready after persisted read-back and source reconciliation.`, {
      phaseRef: outcome.phaseRef,
      ...outcome.result,
      resumeReady: true,
      verificationRequired: false,
    });
  } catch (error) {
    if (error instanceof HandoffFlowRefusal) return text(`❌ ${error.message}`, { resumeReady: false });
    if (error instanceof HandoffContractError) return mcpHandoffContractFailure(error);
    const message = error instanceof Error ? error.message : String(error);
    return text(`❌ Handoff read-back verification denied: ${message}`, { resumeReady: false, error: message });
  }
});

server.registerTool("planner-requirement-list", {
  description: "List declarative product Requirements: user, business, or system outcomes. Requirements never contain coding standards, best practices, formatting, verification process, or other Project Guidelines. Pass phaseRef to deliver and attest only the Requirements linked to that phase or its owning feature; an unscoped inventory does not satisfy task-start read gates.",
  inputSchema: {
    phaseRef: z.string().min(1).optional().describe("Optional target phase ref. When supplied, return full target-relevant requirements and record only those delivered requirements as read."),
  },
}, async ({ phaseRef }, extra) => {
  const plannerSessionId = plannerSessionIdFor(extra);
  const st = await requireStore();
  const requirements = await st.loadRequirements();
  if (!phaseRef?.trim()) {
    return text(requirements.requirements.map((req) => `- ${req.id} — ${req.title}`).join("\n") || "No requirements", {
      requirements,
      attestedRequirementIds: [],
      readScope: "inventory",
    });
  }
  const features = (await st.loadFeatures()).features;
  const phase = findPhaseByRef(await st.loadAllPhases(), features, phaseRef.trim());
  if (!phase) return { ...text(`Phase not found: ${phaseRef}`, { attestedRequirementIds: [] }), isError: true };
  const delivered = [
    ...(await st.linkedRequirementsForPhase(phase.id)),
    ...(phase.featureId ? await st.linkedRequirementsForFeature(phase.featureId) : []),
  ].filter((requirement, index, all) => all.findIndex((candidate) => candidate.id === requirement.id) === index);
  delivered.forEach((requirement) => markRequirementReadForSessionId(plannerSessionId, requirement.id));
  const targetRef = formatPhaseRef(phase.number, featureNumberOfPhase(phase, features));
  const body = delivered.map((requirement) => [
    `- ${requirement.id} — ${requirement.title}`,
    `  Description: ${requirement.description || "None"}`,
    `  Linked phases: ${requirement.linkedPhaseIds.join(", ") || "None"}`,
    `  Macro tasks: ${requirement.macroTasks.map((item) => `${item.title} (${item.status})`).join("; ") || "None"}`,
  ].join("\n")).join("\n");
  return text(body || `No requirements linked to ${targetRef}`, {
    requirements: { ...requirements, requirements: delivered },
    attestedRequirementIds: delivered.map((requirement) => requirement.id),
    readScope: "target",
    target: { phaseId: phase.id, phaseRef: targetRef, featureId: phase.featureId },
  });
});

server.registerTool("planner-requirement-create", {
  description: "Create a declarative product Requirement describing a user, business, or system outcome, with optional nested macro tasks. Never store coding standards, best practices, formatting, verification process, or other Project Guidelines here; use planner-project-guidelines-update instead. Requirements have no lifecycle status. Requirement and macro-task IDs/timestamps are assigned by the planner.",
  inputSchema: {
    title: z.string().min(1),
    description: z.string().optional().describe(LONG_TEXT_LIMIT_NOTICE),
    linkedPhaseIds: z.array(z.string().min(1)),
    macroTasks: z.array(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(STATUS_VALUES).optional(),
    })).optional(),
  },
}, async ({ title, description, linkedPhaseIds, macroTasks }) => {
  const st = await requireStore();
  try {
    const requirement = await createRequirementFlow(st, { title, description, linkedPhaseIds, macroTasks });
    return writeAndSummarize(st, `Requirement created: ${requirement.id}.`, { requirement, created: true });
  } catch (error) {
    if (error instanceof RequirementFlowRefusal) {
      return text(`❌ ${error.message}`, { created: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-requirement-update", {
  description: "Update a Requirement’s product outcome, linked phases, or complete ordered macro-task list. Never store coding standards, best practices, formatting, verification process, or other Project Guidelines here; use planner-project-guidelines-update instead. Requirements have no lifecycle status. Existing macro-task IDs and timestamps remain planner-managed; omit an ID to add a task.",
  inputSchema: {
    requirementId: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().optional().describe(LONG_TEXT_LIMIT_NOTICE),
    linkedPhaseIds: z.array(z.string().min(1)).optional(),
    macroTasks: z.array(z.object({
      id: z.string().min(1).optional(),
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(STATUS_VALUES),
    })).optional(),
  },
}, async ({ requirementId, title, description, linkedPhaseIds, macroTasks }) => {
  const st = await requireStore();
  if (title === undefined && description === undefined && linkedPhaseIds === undefined && macroTasks === undefined) {
    return mcpMutationNoFieldsFailure({
      entity: "requirement",
      ref: requirementId,
      operation: "update",
      mutableFields: ["title", "description", "linkedPhaseIds", "macroTasks"],
      retryCommand: `planner-requirement-update ${requirementId}`,
    });
  }
  try {
    const outcome = await updateRequirementFlow(st, requirementId, { title, description, linkedPhaseIds, macroTasks });
    const next = outcome.requirement;
    const requirementUpdateReply = buildMutationReply({
      identity: { entity: "requirement", ref: next.id, id: next.id, title: next.title },
      operation: "update",
      updatedFields: outcome.updatedFields,
      changedValues: next as unknown as Record<string, unknown>,
      readBackCommand: "planner-requirement-list",
    });
    return writeAndSummarize(st, requirementUpdateReply.text, requirementUpdateReply.structured);
  } catch (error) {
    if (error instanceof RequirementFlowRefusal) {
      return text(`❌ ${error.message}`, { updated: false, errorCode: error.code });
    }
    throw error;
  }
});

server.registerTool("planner-requirement-delete", {
  description: "Permanently delete a top-level requirement. Confirm the intended requirement first.",
  inputSchema: { requirementId: z.string().min(1) },
}, async ({ requirementId }) => {
  const st = await requireStore();
  const { deleted } = await deleteRequirementFlow(st, requirementId);
  if (!deleted) return text(`❌ Requirement not found: ${requirementId}`, { deleted: false, errorCode: "REQUIREMENT_NOT_FOUND" });
  return writeAndSummarize(st, `Requirement deleted: ${requirementId}.`, { deleted: true, requirementId });
});


server.registerTool("planner-idea-list", {
  description: "List top-level Ideas Inbox entries. Ideas never affect feature, phase, or task rollups.",
  inputSchema: {},
}, async () => {
  const outcome = await listIdeasFlow(await requireStore());
  return text(
    outcome.ideas.map((idea) => `- ${formatIdeaRef(idea.number)} · ${idea.shortId} — ${idea.title}${idea.promotion ? ` → ${idea.promotion.targetRef}` : ""}`).join("\n") || "No ideas",
    { ideas: outcome.ideas },
  );
});

server.registerTool("planner-idea-show", {
  description: "Show one Idea Inbox entry by I-number, short ID, UUID, or title.",
  inputSchema: { idea: z.string().min(1) },
}, async ({ idea: ref }) => {
  const outcome = await showIdeaFlow(await requireStore(), ref);
  if (!outcome.ok) return text(`Idea not found: ${ref}`, { errorCode: "NOT_FOUND" });
  const idea = outcome.idea;
  return text(`${formatIdeaRef(idea.number)} · ${idea.shortId} — ${idea.title}\n\n${idea.description || "(no description)"}`, { idea });
});

server.registerTool("planner-idea-create", {
  description: "Create a rollup-independent Ideas Inbox entry.",
  inputSchema: { title: z.string().min(1), description: z.string().optional() },
}, async ({ title, description }) => {
  const outcome = await createIdeaFlow(await requireStore(), { title, description });
  if (!outcome.ok) return text(outcome.message);
  const idea = outcome.idea;
  return text(`Idea created: ${formatIdeaRef(idea.number)} · ${idea.shortId} — ${idea.title}`, { idea, created: true });
});

server.registerTool("planner-idea-update", {
  description: "Update an unpromoted or promoted Idea Inbox entry title or description.",
  inputSchema: { idea: z.string().min(1), title: z.string().min(1).optional(), description: z.string().optional() },
}, async ({ idea: ref, title, description }) => {
  const st = await requireStore();
  const outcome = await updateIdeaFlow(st, ref, { title, description });
  if (!outcome.ok) {
    if (outcome.code === "IDEA_NOT_FOUND") return text(`Idea not found: ${ref}`, { errorCode: "NOT_FOUND", updated: false });
    if (outcome.code === "IDEA_TITLE_REQUIRED") return text(outcome.message, { errorCode: "IDEA_TITLE_REQUIRED", updated: false });
    if (outcome.code === "IDEA_NO_MUTABLE_FIELDS") {
      return mcpMutationNoFieldsFailure({
        entity: "idea",
        ref,
        operation: "update",
        mutableFields: ["title", "description"],
        retryCommand: `planner-idea-update ${ref}`,
      });
    }
    return text(outcome.message);
  }
  const idea = outcome.idea;
  const ideaUpdateReply = buildMutationReply({
    identity: { entity: "idea", ref: formatIdeaRef(idea.number), id: idea.id, title: idea.title },
    operation: "update",
    updatedFields: outcome.updatedFields,
    changedValues: idea as unknown as Record<string, unknown>,
    readBackCommand: `planner-idea-show ${formatIdeaRef(idea.number)}`,
  });
  return text(ideaUpdateReply.text, ideaUpdateReply.structured);
});

server.registerTool("planner-idea-delete", {
  description: "Delete an Idea Inbox entry. Confirm the exact idea with the user before calling.",
  inputSchema: { idea: z.string().min(1), confirmed: z.boolean() },
}, async ({ idea: ref, confirmed }) => {
  const outcome = await deleteIdeaFlow(await requireStore(), ref, confirmed);
  if (!outcome.ok) {
    if (outcome.code === "IDEA_NOT_FOUND") return text(`Idea not found: ${ref}`, { errorCode: "NOT_FOUND", deleted: false });
    if (outcome.code === "IDEA_DELETE_CONFIRMATION_REQUIRED") {
      return text(outcome.message, { errorCode: "CONFIRMATION_REQUIRED", deleted: false });
    }
    return text(outcome.message, { errorCode: outcome.code, deleted: false });
  }
  return text(`Idea deleted: ${outcome.ideaRef}.`, { deleted: true, ideaRef: outcome.ideaRef });
});

server.registerTool("planner-idea-promotion-begin", {
  description: "Begin an Idea promotion discussion without persisting a target or promotion. Returns the project-local grill-me instructions; follow them one question at a time, then use planner-idea-promotion-finalize only after target confirmation.",
  inputSchema: { idea: z.string().min(1), targetType: z.enum(["feature", "phase", "task"]) },
}, async ({ idea: ref, targetType }) => {
  const outcome = await beginIdeaPromotionFlow(await requireStore(), ref, targetType);
  if (!outcome.ok) {
    if (outcome.code === "IDEA_NOT_FOUND") return text(`Idea not found: ${ref}`, { errorCode: "NOT_FOUND" });
    return text(outcome.message, { errorCode: "ALREADY_PROMOTED", idea: outcome.idea });
  }
  return text(`Promotion discussion started for ${formatIdeaRef(outcome.idea.number)}. ${outcome.recommendation}`, {
    idea: outcome.idea,
    targetType: outcome.targetType,
    recommendation: outcome.recommendation,
    grillMeSkill: outcome.grillMeSkill,
    persisted: false,
    nextActions: outcome.nextActions,
  });
});

server.registerTool("planner-idea-promotion-finalize", {
  description: "Record a promotion only after grill-me discussion, explicit target confirmation, and successful target creation. targetRef must be the already-created agreed target; no raw UUID is returned.",
  inputSchema: { idea: z.string().min(1), targetType: z.enum(["feature", "phase", "task"]), targetRef: z.string().min(1), discussionCompleted: z.boolean(), confirmed: z.boolean() },
}, async ({ idea: ref, targetType, targetRef, discussionCompleted, confirmed }) => {
  const outcome = await finalizeIdeaPromotionFlow(await requireStore(), {
    idea: ref,
    targetType,
    targetRef,
    discussionCompleted,
    confirmed,
  });
  if (!outcome.ok) {
    if (outcome.code === "IDEA_NOT_FOUND") return text(`Idea not found: ${ref}`, { errorCode: "NOT_FOUND", promoted: false });
    if (outcome.code === "IDEA_PROMOTION_TARGET_NOT_FOUND") {
      return text(outcome.message, { errorCode: "TARGET_NOT_FOUND", promoted: false });
    }
    return text(outcome.message, { errorCode: "IDEA_PROMOTION_CONFIRMATION_REQUIRED", promoted: false });
  }
  return text(`Idea promoted: ${formatIdeaRef(outcome.idea.number)} → ${outcome.targetRef}`, {
    idea: outcome.idea,
    promoted: true,
    targetRef: outcome.targetRef,
  });
});

server.registerTool("planner-handoff-write", {
  description: "Persist a compact reconciled handoff candidate with durable context synchronization. The result always has resumeReady=false until a separate planner-handoff-show read-back and planner-handoff-verify succeeds. Run planner-handoff-prepare first; provide only resume-critical context and link optional extended detail from .planner/docs/ Markdown. On failure the submitted content is retained against phaseRef + expectedHandoffUpdatedAt: a retry against the exact same token may omit content to reuse it instead of resending the whole body.",
  inputSchema: {
    phaseRef: z.string().min(1).describe("Exact confirmed phase ref: P00x | P00x(F00x) | UUID | title."),
    title: z.string().min(3).optional().describe("Meaningful handoff title summarizing the work. Ignored when content is omitted (the retained title is reused)."),
    reason: z.string().min(1).optional().describe("Why work is stopping and why a cold agent needs this handoff. Required for confirmed writes; rendered by the planner, not in Markdown."),
    confirmed: z.boolean().describe("Set true only after the user explicitly confirms the proposed feature+phase target."),
    content: z.string().min(1).optional().describe("Full reconciled handoff text (markdown). Omit only on a retry after a failed write against the exact same expectedHandoffUpdatedAt, to reuse the body retained from that failed attempt."),
    expectedHandoffUpdatedAt: z.string().optional().describe("Exact token returned by planner-handoff-prepare; empty when no handoff exists."),
    reconciledExistingHandoff: z.boolean().optional().describe("Confirm that still-relevant existing handoff information was retained."),
    sectionDispositions: z.array(z.object({
      section: z.string().min(1).describe("Exact prior heading text named by a HANDOFF_SECTION_RECONCILIATION_REQUIRED refusal."),
      disposition: z.string().min(1).describe("What happened to that section: dropped, superseded, or folded into another section."),
    })).optional().describe("Required only when a prior write was refused with HANDOFF_SECTION_RECONCILIATION_REQUIRED; one entry per section it named. Omit on a first write."),
    completenessAudit: z.object({
      version: z.literal(HANDOFF_COMPLETENESS_AUDIT_VERSION),
      entries: z.array(z.object({
        category: z.string().min(1).describe(`One required category id: ${HANDOFF_COMPLETENESS_CATEGORIES.map((entry) => entry.id).join(", ")}`),
        status: z.enum(["captured", "not-applicable"]),
        detail: z.string().min(1),
      })),
    }).optional().describe("Optional legacy completeness evidence. Compact handoffs omit this duplicate prose."),
    coldStartInventory: z.object({
      version: z.literal(HANDOFF_COLD_START_INVENTORY_VERSION),
      sourceReviews: z.array(z.object({ source: z.string().min(1), detail: z.string().min(1) })),
      entries: z.array(z.object({
        category: z.string().min(1).describe(`One required cold-start category id: ${HANDOFF_COLD_START_INVENTORY_CATEGORIES.map((entry) => entry.id).join(", ")}`),
        items: z.array(z.string().min(1)),
        notApplicableReason: z.string().min(1).optional().describe("Optional explanation only; every category still requires a concrete item, using an explicit verified-negative statement when nothing exists."),
      })),
    }).optional().describe("Optional legacy cold-start evidence. Compact handoffs omit this duplicate prose."),
    supportingDocuments: z.array(z.object({
      path: z.string().min(1).describe("Committed Markdown path under .planner/docs/."),
      description: z.string().min(1).describe("What the document contains and why the next agent needs it."),
    })).optional(),
    taskUpdates: z.array(z.object({
      taskRef: z.string().min(1),
      completionSummary: z.string().min(1),
      verification: z.string().min(1),
      remainingWork: z.string().min(1),
      filesTouched: z.array(z.string().min(1)).optional(),
      decisions: z.array(z.string().min(1)).optional(),
    })).optional(),
    phaseUpdate: z.object({
      progressSummary: z.string().min(1),
      remainingWork: z.string().min(1),
      decisions: z.array(z.string().min(1)).optional(),
    }).optional(),
    phaseNoUpdateReason: z.string().min(1).optional(),
    featureUpdate: z.object({ workDone: z.string().min(1), workRemaining: z.string().min(1) }).optional(),
    featureNoUpdateReason: z.string().min(1).optional(),
  },
}, async ({ phaseRef, title, reason, confirmed, content, expectedHandoffUpdatedAt, reconciledExistingHandoff, sectionDispositions, completenessAudit, coldStartInventory, supportingDocuments, taskUpdates, phaseUpdate, phaseNoUpdateReason, featureUpdate, featureNoUpdateReason }) => {
  const st = await requireStore();
  const request: PhaseHandoffWriteRequest = {
    confirmed: confirmed === true,
    title,
    reason,
    // content is optional so a retry after a failed write can omit it and reuse
    // the body PlanStore retained against this phase + expectedHandoffUpdatedAt
    // (see PlanStore.refreshPhaseHandoff).
    content,
    expectedHandoffUpdatedAt,
    reconciledExistingHandoff,
    sectionDispositions,
    completenessAudit: completenessAudit as HandoffCompletenessAuditInput | undefined,
    coldStartInventory: coldStartInventory as HandoffColdStartInventoryInput | undefined,
    supportingDocuments,
    taskUpdates,
    phaseUpdate,
    phaseNoUpdateReason,
    featureUpdate,
    featureNoUpdateReason,
  };
  try {
    const outcome = await writePhaseHandoffFlow(st, phaseRef, request);
    const result = outcome.result;
    return text(`⚠️ Handoff candidate persisted on ${outcome.phaseRef}, but it is NOT resume-ready yet. Required next action: call planner-handoff-show ${outcome.phaseRef}, read the persisted compact capsule, then call planner-handoff-verify with the returned contentHash. Rewrite only if resume-critical context is missing.`, {
      phaseRef: outcome.phaseRef,
      phaseId: outcome.phaseId,
      updatedTaskIds: result.updatedTaskIds,
      handoffUpdatedAt: result.handoffUpdatedAt,
      handoffAudit: result.handoffAudit,
      persisted: true,
      resumeReady: false,
      verificationRequired: true,
      nextActions: [
        `Call planner-handoff-show ${outcome.phaseRef} and read the entire persisted body.`,
        "Call planner-handoff-verify with the shown contentHash; legacy sourceReviews and omissionsFound are optional because the planner derives omitted evidence from persisted state.",
      ],
    });
  } catch (error) {
    if (error instanceof HandoffFlowRefusal) return handoffRefusalResult(error);
    if (error instanceof HandoffContractError) return mcpHandoffContractFailure(error);
    const message = error instanceof Error ? error.message : String(error);
    return text(`❌ Handoff refresh denied: ${message} If you retry against the same phaseRef and expectedHandoffUpdatedAt, you may omit content to reuse the body just submitted.`, { error: message });
  }
});

server.registerTool("planner-handoff-prepare", {
  description: "Identify or prepare the exact handoff target. With a confirmed phaseRef, returns a compact resume scaffold, bounded priority-ordered phase work map, current token, missing task evidence, and inline budget. Reread the canonical phase and relevant sibling tasks before proposing work.",
  inputSchema: {
    phaseRef: z.string().min(1).optional(),
    supportingDocuments: z.array(z.object({
      path: z.string().min(1).describe("Committed Markdown path under .planner/docs/."),
      description: z.string().min(1).describe("What the document contains and why the next agent needs it."),
    })).optional().describe("Optional: validate an already-known manifest now, before drafting. Usually unnecessary — most handoffs need none; oversized content is externalized automatically."),
  },
}, async ({ phaseRef, supportingDocuments }) => {
  if (!phaseRef) return text([
    "First identify the exact feature and phase actually discussed/worked on in this session. Do not use a stale resume pointer or target a phase that just became done.",
    "Tell the user: 'I propose writing this handoff on P00x(F00x) — <phase title>. Confirm?' Wait for explicit confirmation.",
    "After confirmation, call planner-handoff-prepare again with that exact phaseRef, then reconcile its current handoff and missing task evidence through planner-handoff-write.",
  ].join("\n"));
  const st = await requireStore();
  try {
    const reply = await preparePhaseHandoffFlow(st, phaseRef, supportingDocuments);
    return text(reply.text, reply.structured);
  } catch (error) {
    if (error instanceof HandoffFlowRefusal) return text(`❌ ${error.message}`);
    if (error instanceof HandoffContractError) return mcpHandoffContractFailure(error, "preparation");
    const message = error instanceof Error ? error.message : String(error);
    return text(`❌ Handoff preparation failed: ${message}`, { error: message });
  }
});

server.registerTool("planner-handoff-clear", {
  description: "Clear/archive the entity-scoped handoff of a phase. phaseRef is required; never infer a phase automatically.",
  inputSchema: { phaseRef: z.string().min(1).describe("Exact phase ref: P00x | P00x(F00x) | UUID | title.") },
}, async ({ phaseRef }) => {
  const st = await requireStore();
  try {
    const cleared = await clearPhaseHandoffFlow(st, phaseRef);
    return text(`✅ Cleared handoff on ${cleared.phaseRef} (handoffUpdatedAt preserved as audit; archived to .planner/.local/handoff-archive/).`, { phaseRef: cleared.phaseRef, phaseId: cleared.phaseId });
  } catch (error) {
    if (error instanceof HandoffFlowRefusal) return text(`❌ ${error.message}`);
    throw error;
  }
});

server.registerTool("planner-web", {
  description: "Manage the planner web dashboard (start/status/stop) from MCP stdio. Runs an in-process HTTP+WS server bound to LAN; it lives as long as this MCP process. plan-root comes from AGENT_PLAN_ROOT or cwd()/.planner.",
  inputSchema: {
    action: z.enum(["start", "stop", "status"]).default("status"),
  },
}, async ({ action }) => {
  if (action === "start") {
    if (webHandle) {
      const web = { localUrl: webHandle.localUrl, lanUrl: webHandle.lanUrl, mode: webHandle.mode, bindHost: webHandle.bindHost };
      return text(`planner-web already running: ${webHandle.localUrl}${webHandle.lanUrl ? ` — LAN: ${webHandle.lanUrl}` : ""} (mode: ${webHandle.mode})`, plannerWebMetadata(web));
    }
    const root = planRoot();
    const storeCheck = new PlanStore(root);
    if (!(await storeCheck.exists())) {
      return text(`planner-web start: no .planner/ found at ${root}. Run planner-init first.`, { running: false, address: "", localUrl: "", lanUrl: "", host: "", port: 0, mode: "", errorCode: "PLANNER_NOT_INITIALIZED" });
    }
    try {
      // port: 0 → OS assigns a free port (no conflict with plan-server CLI / Pi).
      // host: 0.0.0.0 → bind LAN (reachable from other devices), like Pi /planner load.
      webHandle = await serve({ planRoot: root, port: 0, quiet: true });
      const web = { localUrl: webHandle.localUrl, lanUrl: webHandle.lanUrl, mode: webHandle.mode, bindHost: webHandle.bindHost };
      return text(`planner-web started: ${webHandle.localUrl}${webHandle.lanUrl ? ` — LAN: ${webHandle.lanUrl}` : ""} (mode: ${webHandle.mode})`, plannerWebMetadata(web));
    } catch (err) {
      webHandle = null;
      const web = { localUrl: "", error: (err as Error).message };
      return text(`planner-web start failed: ${web.error}`, plannerWebMetadata(web));
    }
  }
  if (action === "stop") {
    if (!webHandle) return text("planner-web not running.", { running: false, address: "", localUrl: "", lanUrl: "", host: "", port: 0, mode: "" });
    const stoppedUrl = webHandle.localUrl;
    await webHandle.close().catch(() => {});
    webHandle = null;
    return text(`planner-web stopped (was ${stoppedUrl}).`, { running: false, address: "", localUrl: "", lanUrl: "", host: "", port: 0, mode: "" });
  }
  // status
  if (webHandle) {
    const web = { localUrl: webHandle.localUrl, lanUrl: webHandle.lanUrl, mode: webHandle.mode, bindHost: webHandle.bindHost };
    return text(`planner-web running: ${webHandle.localUrl}${webHandle.lanUrl ? ` — LAN: ${webHandle.lanUrl}` : ""} (mode: ${webHandle.mode}, bindHost: ${webHandle.bindHost})`, plannerWebMetadata(web));
  }
  return text("planner-web not running. Use planner-web with action=start to start the dashboard.", { running: false, address: "", localUrl: "", lanUrl: "", host: "", port: 0, mode: "" });
});

server.registerTool("planner-load", {
  description: "Load/refresh the planner on explicit user request (NOT automatic): starts the web dashboard on LAN and returns one text with, in order: a recap under '## Recap — show this to the user verbatim', then agent-only context under '## Agent-only context' (the complete project-level context — description, goal, scope, out-of-scope, technologies, tools, language preferences, Project Guidelines, every Requirement, every project Accepted Decision — then Accepted Decisions of features, phases and tasks, then where the Agent Plan operating guide lives). Call it ONLY when the user runs /planner load or /planner recap (or asks to load the planner). Show the user ONLY the recap section, verbatim, including its final Web UI line; never quote the agent-only context. If structuredContent.projectContext.contextComplete is false, the project-level context was NOT delivered — follow structuredContent.projectContext.nextActions and retry before relying on it. A pending handoff is read-only context: NEVER call planner-handoff-show or planner-handoff-clear as part of load/recap. Archive it only when every phase task is done/canceled, when replacing it with a new handoff, or after an explicit user handoff-clear request. Do NOT start the planner/web or show the web URL unless the user explicitly asks (load/recap/web status).",
  inputSchema: {
    maxChars: z.number().int().positive().optional().describe(`Single-response bound (chars) for the project-context delivery. Default ${DEFAULT_PROJECT_CONTEXT_CHUNK_CHARS}. Raise this and retry if a prior call returned projectContext.contextComplete=false.`),
  },
}, async ({ maxChars }, extra) => {
  const st = store();
  if (!(await st.exists())) return text("No .planner/ found at " + planRoot() + ". Run planner-init first.");
  const plannerSessionId = plannerSessionIdFor(extra);
  let preparation: Awaited<ReturnType<PlanStore["preparePlannerSession"]>>;
  try {
    preparation = await st.preparePlannerSession();
  } catch (error) {
    return text(`Planner load aborted: ${error instanceof Error ? error.message : String(error)}`, { errorCode: "PLANNER_SESSION_PREPARATION_FAILED", loaded: false });
  }
  const project = preparation.project;
  await st.runBatch(() => st.refreshResume(undefined, undefined, plannerSessionId));
  if (project.projectGuidelines.content.trim()) {
    await st.recordProjectGuidelinesRead({ sessionId: plannerSessionId });
  }
  const plannerSkill = await st.syncPlannerSkill();
  await st.syncGrillMeSkill();
  const web = await ensureWebStarted();
  const recap = await buildRecap(st, web, { harness: "mcp", sessionId: plannerSessionId });
  const plan = await st.loadAll();

  // Explicit planner load must deliver the complete project-level context
  // (P102(F005)/T404), attested through the same lossless contract used
  // everywhere else: loadProjectContextDelivery + recordProjectContextRead.
  const boundedMaxChars = maxChars ?? DEFAULT_PROJECT_CONTEXT_CHUNK_CHARS;
  const projectContextDelivery = await st.loadProjectContextDelivery(boundedMaxChars);
  const projectContextReply = buildProjectContextLoadReply(projectContextDelivery, boundedMaxChars);
  if (projectContextReply.structured.contextComplete) {
    await st.recordProjectContextRead({ sessionId: plannerSessionId, chunks: projectContextDelivery.chunks });
  }

  // One text, each piece once (shared with Pi via buildPlannerLoadReply).
  // The guide body is not resent: the /planner command already carries it,
  // and a bare planner-load call is pointed at the project-local copy.
  const reply = buildPlannerLoadReply({
    recap: preparation.changed ? `${preparation.legacyProjectContext.summary}\n\n${recap}` : recap,
    projectContext: projectContextReply,
    scopedDecisions: buildScopedDecisionContext(plan),
    plannerGuide: { mode: "pointer", path: ".planner/SKILL.md", customized: plannerSkill.customized, message: plannerSkill.message },
  });
  return text(reply.text, {
    ...reply.structured,
    webUi: plannerWebMetadata(web),
    preparation: preparation.legacyProjectContext,
  });
});

server.registerTool("planner-disable", {
  description: "MCP no-op equivalent of Pi /planner disable. Stop the MCP process from the host to disable it.",
}, async () => text("To disable planner MCP, remove/disable this MCP server from the host config or stop the process."));

export async function startStdioServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`agent-plan MCP server running on stdio (root: ${planRoot()})`);
}

function isDirectExecution(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isDirectExecution()) {
  startStdioServer().catch((error) => {
    console.error("agent-plan MCP server failed:", error);
    process.exit(1);
  });
}
