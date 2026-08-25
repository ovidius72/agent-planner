#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PlanStore, ExportService, withFeatureLock, needsMotivation, findPhaseByRef, findTaskByRef, buildRecap, addChecklistItem, removeChecklistItem, toggleChecklistItem, buildPhaseContextBlock, checkExplicitTaskStart, recommendNextTask, buildResumeRequiredProposal, packageVersionFromModule, resolvedPackageVersion, markFeatureReadForSessionId, markPhaseReadForSessionId, markTaskReadForSessionId, contextReadEligibilityForSession, hasValidSessionAttestation, hasReadRequirementsForSession, markRequirementReadForSessionId, startReadSession, invalidateReads, taskStartDenied, taskStartSucceeded } from "@agent-plan/core";
import { serve } from "@agent-plan/server";
import type { ServeHandle } from "@agent-plan/server";
import { createChecklistItemId, createFeatureId, createPhaseId, createTaskId, clampSlug, normalizeSlug, formatPhaseRef, formatFeatureRef, isUuid, validateResolvedTarget } from "@agent-plan/core/naming";
import type { Feature, Phase, Task, StatusLogEntry } from "@agent-plan/core/schema";

const STATUS_VALUES = ["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"] as const;
const PHASE_STATUS_VALUES = ["draft", "discovery", ...STATUS_VALUES] as const;
const plannerSessionId = randomUUID();
startReadSession(plannerSessionId);

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

function text(textValue: string, structuredContent?: Record<string, unknown>): ToolResult {
  return structuredContent ? { content: [{ type: "text", text: textValue }], structuredContent } : { content: [{ type: "text", text: textValue }] };
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

const MCP_PACKAGE = packageVersionFromModule(import.meta.url, "@agent-plan/mcp");
const CORE_PACKAGE = resolvedPackageVersion("@agent-plan/core", import.meta.url);

function nowISO(): string {
  return new Date().toISOString();
}

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

/** Start the web dashboard on LAN (0.0.0.0:0, OS-assigned port) if not already
 *  running. Returns the local/LAN URLs. No-op (empty url) when no .planner/ exists. */
async function ensureWebStarted(): Promise<{ localUrl: string; lanUrl?: string | undefined; mode?: string }> {
  if (webHandle) return { localUrl: webHandle.localUrl, lanUrl: webHandle.lanUrl, mode: webHandle.mode };
  const root = planRoot();
  const st = new PlanStore(root);
  if (!(await st.exists())) return { localUrl: "" };
  try {
    webHandle = await serve({ planRoot: root, host: "0.0.0.0", port: 0, quiet: true });
    return { localUrl: webHandle.localUrl, lanUrl: webHandle.lanUrl, mode: webHandle.mode };
  } catch {
    return { localUrl: "" };
  }
}

function findFeatureByRef(features: Feature[], ref: string): Feature | undefined {
  const normalized = ref.trim().toLowerCase();
  if (!normalized) return undefined;
  const fMatch = normalized.match(/^f(\d+)$/);
  if (fMatch) {
    const n = parseInt(fMatch[1]!, 10);
    const byNum = features.find((feature) => feature.number === n);
    if (byNum) return byNum;
  }
  return features.find((feature) => feature.shortId?.toLowerCase() === normalized)
    ?? features.find((feature) => feature.id.toLowerCase() === normalized)
    ?? features.find((feature) => feature.name.toLowerCase() === normalized)
    ?? features.find((feature) => feature.name.toLowerCase().includes(normalized));
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
/** Belt-and-suspenders validation: a resolved ref must be a real UUID and the target
 *  must still exist in the store before we allocate numbers or write. */
function featureNumberOfPhase(phase: Phase, features: Feature[]): number | undefined {
  return phase.featureId ? features.find((f) => f.id === phase.featureId)?.number : undefined;
}
function taskCompositeRef(task: Task, phase: Phase, features: Feature[]): string {
  return `${formatPhaseRef(phase.number, featureNumberOfPhase(phase, features))}/T${String(task.number).padStart(3, "0")}`;
}
function applyTaskLifecycleDates(task: Task, nextStatus: Task["status"], now: string): void {
  const previousStatus = task.status;
  if (nextStatus === "in-progress" && !task.startedAt) task.startedAt = now;
  if (nextStatus === "done") {
    if (!task.startedAt) task.startedAt = now;
    task.completedAt = now;
  } else if (previousStatus === "done") {
    task.completedAt = "";
  }
  task.status = nextStatus;
}

async function writeAndSummarize(st: PlanStore, message: string, structuredContent?: Record<string, unknown>): Promise<ToolResult> {
  await st.writeGenerated();
  return text(message, structuredContent);
}

const server = new McpServer({
  name: "agent-plan-planner",
  version: MCP_PACKAGE.version,
});

// Resolve a phase for entity-scoped handoff tools. ref = P00x | P00x(F00x) |
// UUID | title. A write target is always explicit; never guess from the
// first in-progress phase or a stale resume pointer.
type PhaseHandoffResolve =
  | { ok: true; phase: Phase; compositeRef: string }
  | { ok: false; error: string };

async function resolvePhaseForHandoff(st: PlanStore, ref: string | undefined): Promise<PhaseHandoffResolve> {
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

server.registerTool("planner-version", {
  description: "Report the versions of the Agent Plan MCP server and core package actually loaded by this process. Available without an initialized .planner/ workspace.",
}, async () => {
  const versions = {
    [MCP_PACKAGE.name]: MCP_PACKAGE.version,
    [CORE_PACKAGE.name]: CORE_PACKAGE.version,
  };
  return text([
    "Agent Plan runtime versions",
    `${MCP_PACKAGE.name}: ${MCP_PACKAGE.version}`,
    `${CORE_PACKAGE.name}: ${CORE_PACKAGE.version}`,
  ].join("\n"), { versions });
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
  description: "Authorize a temporary guard bypass (default 15 minutes) so edit/write tools can proceed even when no task is in-progress. Use ONLY after the user explicitly authorizes proceeding without a task. Harness-agnostic: stored in resume.json so all adapters (Pi, Claude Code, Codex, ...) respect it.",
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
  description: "Show a compact planner overview: project metadata, counts, and a one-line summary of each feature (F00x · shortId — name (status; N phases, M tasks)). Does NOT include full descriptions, phases, or tasks — use planner-feature-list / planner-phase-list / planner-task-list for discovery and planner-*-show for full detail of a single entity. Keeps the result small to avoid token overflow.",
}, async () => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const phases = await st.loadAllPhases();
  const totalTasks = phases.reduce((total, phase) => total + phase.tasks.length, 0);
  const project = await st.loadProject();
  const manifest = await st.loadManifest();
  const featureLines = features.map((feature) => {
    const featurePhases = phases.filter((phase) => phase.featureId === feature.id);
    const taskCount = featurePhases.reduce((total, phase) => total + phase.tasks.length, 0);
    return `- ${formatFeatureRef(feature.number)}${feature.shortId ? ` · ${feature.shortId}` : ""} — ${feature.name} (${feature.status}; ${featurePhases.length} phases, ${taskCount} tasks)`;
  });
  const summary = [
    `📋 ${project.name}`,
    `Description: ${project.description || "(not set)"}`,
    `Goal: ${project.goal || "(not set)"}`,
    `Features: ${features.length}  |  Phases: ${phases.length}  |  Tasks: ${totalTasks}`,
    `Updated: ${manifest.updatedAt || "(unknown)"}`,
    "",
    "Features:",
    featureLines.join("\n") || "(none)",
  ].join("\n");
  // Compact structured overview (no full plan: avoids 1M+ char token overflow).
  const overview = {
    project: { name: project.name, description: project.description || null, goal: project.goal || null, updatedAt: manifest.updatedAt || null },
    counts: { features: features.length, phases: phases.length, tasks: totalTasks },
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
  const st = await requireStore();
  const project = await st.loadProject();
  if (contentLanguage !== undefined) project.contentLanguage = contentLanguage.trim();
  if (chatLanguage !== undefined) project.chatLanguage = chatLanguage.trim();
  await st.saveProject(project);
  return writeAndSummarize(st, `Saved language preferences: content=${project.contentLanguage || "(unset)"}, chat=${project.chatLanguage || "(unset)"}`);
});

server.registerTool("planner-project-discuss", {
  description: "Record/update project-level discovery fields. This is the MCP equivalent of grouped project discuss without Pi UI prompts.",
  inputSchema: {
    goal: z.string().optional(),
    scope: z.array(z.string()).optional(),
    outOfScope: z.array(z.string()).optional(),
    technologies: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    globalRules: z.array(z.string()).optional(),
    decisions: z.array(z.string()).optional(),
  },
}, async (params) => {
  const st = await requireStore();
  const project = await st.loadProject();
  if (params.goal !== undefined) project.goal = params.goal.trim();
  if (params.scope !== undefined) project.scope = params.scope.map((entry) => entry.trim()).filter(Boolean);
  if (params.outOfScope !== undefined) project.outOfScope = params.outOfScope.map((entry) => entry.trim()).filter(Boolean);
  if (params.technologies !== undefined) project.technologies = params.technologies.map((entry) => entry.trim()).filter(Boolean);
  if (params.tools !== undefined) project.tools = params.tools.map((entry) => entry.trim()).filter(Boolean);
  if (params.globalRules !== undefined) project.globalRules = params.globalRules.map((entry) => entry.trim()).filter(Boolean);
  if (params.decisions !== undefined) project.decisions = params.decisions.map((entry) => entry.trim()).filter(Boolean);
  await st.saveProject(project);
  return writeAndSummarize(st, `Project discussed/updated: ${project.name}`);
});

  server.registerTool("planner-feature-list", {
    description: "List features (compact: F00x · shortId — name (status; N phases, M tasks)). Pass featureRef to filter. Use this to discover refs cheaply — do NOT read .planner/ files or planner-plan-get full=true to find entities.",
    inputSchema: { featureRef: z.string().optional().describe("Optional: filter to one feature (F00x/shortId/UUID/name).") },
  }, async ({ featureRef }) => {
    const st = await requireStore();
    const allFeatures = (await st.loadFeatures()).features;
    const features = featureRef ? allFeatures.filter((f) => f.id === findFeatureByRef(allFeatures, featureRef)?.id) : allFeatures;
    const phases = await st.loadAllPhases();
    const lines = features.map((feature) => {
      const featurePhases = phases.filter((phase) => phase.featureId === feature.id);
      const taskCount = featurePhases.reduce((total, phase) => total + phase.tasks.length, 0);
      return `- ${formatFeatureRef(feature.number)}${feature.shortId ? ` · ${feature.shortId}` : ""} — ${feature.name} (${feature.status}; ${featurePhases.length} phases, ${taskCount} tasks)`;
    });
    return text(lines.join("\n") || "No features");
  });

  server.registerTool("planner-phase-list", {
    description: "List phases (compact: F00x/P00x · shortId — title (status; N tasks) [F00x]). Filters: featureRef, status. Cheap discovery — do NOT read .planner/ files or planner-plan-get full=true.",
    inputSchema: { featureRef: z.string().optional().describe("Optional: filter to one feature (F00x/shortId/UUID/name)."), status: z.string().optional().describe("Optional: filter by status name.") },
  }, async ({ featureRef, status }) => {
    const st = await requireStore();
    const features = (await st.loadFeatures()).features;
    let phases = await st.loadAllPhases();
    if (featureRef) {
      const f = findFeatureByRef(features, featureRef);
      if (!f) return text(`Feature not found: ${featureRef}`);
      phases = phases.filter((p) => p.featureId === f.id);
    }
    if (status) phases = phases.filter((p) => p.status === status);
    const lines = phases.map((phase) => {
      const fNum = featureNumberOfPhase(phase, features);
      const fTag = fNum !== undefined ? ` [F${String(fNum).padStart(3, "0")}]` : "";
      return `- ${formatPhaseRef(phase.number, fNum)}${phase.shortId ? ` · ${phase.shortId}` : ""} — ${phase.title} (${phase.status}; ${phase.tasks.length} tasks)${fTag}`;
    });
    return text(lines.join("\n") || "No phases");
  });

  server.registerTool("planner-task-list", {
    description: "List tasks (compact: F00x/P00x/T00x · shortId — title (status)). Filters: featureRef, phaseRef, status. Cheap discovery — do NOT read .planner/ files or planner-plan-get full=true.",
    inputSchema: { featureRef: z.string().optional(), phaseRef: z.string().optional(), status: z.string().optional().describe("Optional: filter by status name.") },
  }, async ({ featureRef, phaseRef, status }) => {
    const st = await requireStore();
    const features = (await st.loadFeatures()).features;
    let phases = await st.loadAllPhases();
    if (featureRef) {
      const f = findFeatureByRef(features, featureRef);
      if (!f) return text(`Feature not found: ${featureRef}`);
      phases = phases.filter((p) => p.featureId === f.id);
    }
    if (phaseRef) {
      const p = findPhaseByRef(phases, features, phaseRef);
      if (!p) return text(`Phase not found: ${phaseRef}`);
      phases = [p];
    }
    const out: string[] = [];
    for (const phase of phases) {
      for (const task of phase.tasks) {
        if (status && task.status !== status) continue;
        out.push(`- ${taskCompositeRef(task, phase, features)}${task.shortId ? ` · ${task.shortId}` : ""} — ${task.title} (${task.status})`);
      }
    }
    return text(out.join("\n") || "No tasks");
  });

server.registerTool("planner-feature-add", {
  description: "Create a feature with a rich description. REQUIRED: description must include code references (file:line), current implementation state (what exists, what is unimplemented), systems/structs/traits involved, concrete goals, and behaviors to preserve. The description is the primary context for future agents resuming this feature; one-liners cause misalignment.",
  inputSchema: {
    name: z.string().min(1),
    description: z.string().min(50, "Description must be at least 50 characters — include code references (file:line), current state, goals, and behaviors to preserve. Prefix with 'design-only' for pre-implementation design tasks without code refs.").describe("Required code references (file:line), current state of the art, structs/traits/systems involved, goals, and behaviors to preserve. Not a one-liner."),
    status: z.enum(STATUS_VALUES).optional(),
  },
}, async ({ name, description, status }) => {
  const st = await requireStore();
  const timestamp = nowISO();
  const effectiveStatus = status ?? "planned";
  const existingFeatures = (await st.loadFeatures()).features;
  const id = createFeatureId();
  const identity = await st.allocateEntityIdentity("feature", id);
  const priority = await st.nextPriority("feature");
  const feature: Feature = {
    id,
    number: identity.number,
    shortId: identity.shortId,
    priority,
    name: name.trim(),
    description: description?.trim() ?? "",
    descriptionUpdatedAt: timestamp,
    status: effectiveStatus,
    discussedAt: "",
    contextReady: false,
    contextReadyReason: "",
    startDate: effectiveStatus === "in-progress" ? new Date().toISOString().slice(0, 10) : "",
    endDate: effectiveStatus === "done" ? new Date().toISOString().slice(0, 10) : "",
    workDone: "",
    workRemaining: "",
    acceptedDecisions: [],
    phaseIds: [],
    dependsOn: [],
    statusLog: [],
    sessionInfo: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await st.updateFeatures((doc) => {
    doc.features.push(feature);
    return doc;
  });
  return writeAndSummarize(st, `✅ Feature created: ${formatFeatureRef(feature.number)} — ${feature.name}${feature.shortId ? ` · ${feature.shortId}` : ""}`);
});

server.registerTool("planner-feature-show", {
  description: "Show a feature by id or name.",
    inputSchema: { feature: z.string().min(1).describe("Feature ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."), full: z.boolean().optional().describe("If true, include the feature description. Default: compact identity only (saves tokens).") },
  }, async ({ feature: ref, full }) => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const resolvedFeature = resolveFeatureRefStrict(features, ref);
  if (!resolvedFeature.ok) return text(resolvedFeature.error);
  const feature = resolvedFeature.feature;
  if (full) markFeatureReadForSessionId(plannerSessionId, feature.id);
  const phases = (await st.loadAllPhases()).filter((phase) => phase.featureId === feature.id);
    const summary = `${feature.name} — ${formatFeatureRef(feature.number)}${feature.shortId ? ` · ${feature.shortId}` : ""} (${feature.status}; ${phases.length} phases)`;
    return text(full ? `${summary}\n\n${feature.description || ""}` : summary);
});

server.registerTool("planner-feature-discuss", {
  description: "Persist feature discovery/governance fields and mark the feature context as ready.",
  inputSchema: {
    feature: z.string().min(1).describe("Feature ref. Accepts F00x, shortId, UUID, or title."),
    description: z.string().optional().describe("Current implementation state, scope, and goals for this feature."),
    workDone: z.string().optional().describe("What is already implemented / decided."),
    workRemaining: z.string().optional().describe("What still needs to be done."),
    dependencies: z.array(z.string()).optional().describe("Cross-feature or external dependencies."),
  },
}, async ({ feature: ref, description, workDone, workRemaining, dependencies }) => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const resolvedFeature = resolveFeatureRefStrict(features, ref);
  if (!resolvedFeature.ok) return text(resolvedFeature.error);
  const feature = resolvedFeature.feature;
  const updated = await st.updateFeatures((doc) => {
    const target = doc.features.find((entry) => entry.id === feature.id);
    if (!target) return doc;
    if (description !== undefined) target.description = description.trim();
    if (workDone !== undefined) target.workDone = workDone.trim();
    if (workRemaining !== undefined) target.workRemaining = workRemaining.trim();
    if (dependencies !== undefined) target.dependsOn = dependencies.map((item) => item.trim()).filter(Boolean);
    target.discussedAt = nowISO();
    target.contextReady = true;
    target.contextReadyReason = "Updated through planner-feature-discuss MCP tool.";
    target.updatedAt = nowISO();
    return doc;
  });
  const result = updated.features.find((entry) => entry.id === feature.id)!;
  return writeAndSummarize(st, `✅ Feature discussed/updated: ${formatFeatureRef(result.number)} — ${result.name}${result.shortId ? ` · ${result.shortId}` : ""}`);
});

server.registerTool("planner-feature-update", {
  description: "Update a feature.",
  inputSchema: {
    feature: z.string().min(1).describe("Feature ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."),
    name: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(STATUS_VALUES).optional(),
    workDone: z.string().optional(),
    workRemaining: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    priority: z.number().int().nonnegative().optional().describe("Display order within the project (lower = higher). Tiebreak by number then createdAt."),
  },
}, async ({ feature: ref, ...updates }) => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const resolvedFeature = resolveFeatureRefStrict(features, ref);
  if (!resolvedFeature.ok) return text(resolvedFeature.error);
  const feature = resolvedFeature.feature;
  const updated = await st.updateFeatures((doc) => {
    const target = doc.features.find((entry) => entry.id === feature.id);
    if (!target) return doc;
    if (updates.name !== undefined) target.name = updates.name.trim();
    if (updates.description !== undefined) target.description = updates.description.trim();
    if (updates.status !== undefined) target.status = updates.status;
    if (updates.workDone !== undefined) target.workDone = updates.workDone.trim();
    if (updates.workRemaining !== undefined) target.workRemaining = updates.workRemaining.trim();
    if (updates.startDate !== undefined) target.startDate = updates.startDate.trim();
    if (updates.endDate !== undefined) target.endDate = updates.endDate.trim();
    if (updates.priority !== undefined) target.priority = updates.priority;
    target.updatedAt = nowISO();
    return doc;
  });
  const result = updated.features.find((entry) => entry.id === feature.id)!;
  return writeAndSummarize(st, `✅ Feature updated: ${formatFeatureRef(result.number)} — ${result.name}${result.shortId ? ` · ${result.shortId}` : ""}`);
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
  const feature = resolvedFeature.feature;
  const phases = (await st.loadAllPhases()).filter((phase) => phase.featureId === feature.id);
  await st.updateFeatures((doc) => {
    doc.features = doc.features.filter((entry) => entry.id !== feature.id);
    return doc;
  });
  for (const phase of phases) {
    if (cascade) {
      await st.deletePhase(phase.id);
    } else {
      phase.featureId = undefined;
      phase.updatedAt = nowISO();
      await st.savePhase(phase);
    }
  }
  return writeAndSummarize(st, `Feature deleted: ${feature.id}${cascade ? `; deleted ${phases.length} phases` : `; unlinked ${phases.length} phases`}`, { deleted: feature.id, affectedPhases: phases.length, cascade: Boolean(cascade) });
});

server.registerTool("planner-phase-add", {
  description: "Create a phase linked to a feature with a rich description. REQUIRED: feature ref and description. The description must include code references (file:line), current implementation state, dependencies, specific files/systems to modify, and behaviors to preserve. The description is the primary context for future agents; one-liners cause misalignment.",
  inputSchema: {
    title: z.string().min(1),
    feature: z.string().min(1).optional().describe("Feature ref (required). Accepts F00x/P00x/T00x composite, bare F00x (global), 5-char shortId, UUID, or title."),
    summary: z.string().optional().describe("One-line summary of the phase"),
    description: z.string().min(50, "Description must be at least 50 characters — include code references (file:line), current state, structs/traits involved, concrete work items, behaviors to preserve. Prefix with 'design-only' for pre-implementation design tasks.").describe("Required code references (file:line), current state, structs/traits involved, concrete work items, behaviors to preserve. Not a one-liner."),
  },
}, async ({ title, feature: featureRef, summary, description }) => {
  const st = await requireStore();
  if (!featureRef?.trim()) return text("feature is required: a phase must belong to a feature.");
  const featuresDoc = await st.loadFeatures();
  const resolvedFeature = resolveFeatureRefStrict(featuresDoc.features, featureRef);
  if (!resolvedFeature.ok) return text(resolvedFeature.error);
  const featureValidation = await validateResolvedTarget("feature", resolvedFeature.feature.id, () => st.loadFeatures().then((doc) => doc.features.find((f) => f.id === resolvedFeature.feature.id)).catch(() => undefined));
  if (!featureValidation.ok) return text(featureValidation.error);
  const feature = resolvedFeature.feature;
  if (!feature) return text(`Resolved feature ${featureRef} no longer exists. Refusing to create phase.`);
  const lockKey = feature?.id ?? "__unscoped__";
  let phase: Phase | undefined;
  await withFeatureLock(lockKey, async () => {
    const phases = await st.loadAllPhases();
    const featurePhases = feature ? phases.filter((phase) => phase.featureId === feature.id) : phases;
    const timestamp = nowISO();
    const id = createPhaseId();
    const identity = await st.allocateEntityIdentity("phase", id);
    const priority = await st.nextPriority("phase", feature?.id);
    phase = {
      id,
      number: identity.number,
      shortId: identity.shortId,
      priority,
      slug: normalizeSlug(title),
      title: title.trim(),
      featureId: feature?.id,
      status: "draft",
      discussedAt: "",
      contextReady: false,
      contextReadyReason: "",
      summary: summary?.trim() ?? "",
      description: description?.trim() ?? "",
      descriptionUpdatedAt: timestamp,
      notes: "",
      goals: [],
      nonGoals: [],
      dependencies: [],
      dependsOn: [],
      risks: [],
      openQuestions: [],
      decisions: [],
      acceptedDecisions: [],
      completionCriteria: [],
      taskIds: [],
      tasks: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      handoff: "",
      handoffUpdatedAt: "",
      handoffReadAt: "",
      handoffHistory: [],
      statusLog: [],
      sessionInfo: [],
    };
    await st.savePhase(phase);
    if (feature) {
      await st.updateFeatures((doc) => {
        const target = doc.features.find((entry) => entry.id === feature.id);
        if (target && !target.phaseIds.includes(phase!.id)) target.phaseIds.push(phase!.id);
        return doc;
      });
    }
    await st.writeGenerated();
  });
  if (!phase) return text("Phase creation failed.");
  return writeAndSummarize(st, `✅ Phase created: ${formatPhaseRef(phase.number, feature?.number)} — ${phase.title}${phase.shortId ? ` · ${phase.shortId}` : ""}`);
});

server.registerTool("planner-phase-show", {
  description: "Show a phase by id or name, including derived linked requirements in the full view.",
    inputSchema: { phase: z.string().min(1).describe("Phase ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."), full: z.boolean().optional().describe("If true, include the phase description. Default: compact identity only (saves tokens).") },
  }, async ({ phase: ref, full }) => {
  const st = await requireStore();
    const features = (await st.loadFeatures()).features;
    const phase = findPhaseByRef(await st.loadAllPhases(), features, ref);
  if (!phase) return text(`Phase not found: ${ref}`);
    if (full) markPhaseReadForSessionId(plannerSessionId, phase.id);
    const linkedRequirements = await st.linkedRequirementsForPhase(phase.id);
    const reqCount = linkedRequirements.length;
    const summary = `${phase.title} — ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, features))}${phase.shortId ? ` · ${phase.shortId}` : ""} (${phase.status}; ${phase.tasks.length} tasks${reqCount ? `; ${reqCount} linked requirement${reqCount === 1 ? "" : "s"}` : ""})`;
    const requirementsBlock = reqCount > 0
      ? `\n\nLinked requirements:\n${linkedRequirements.map((requirement) => `- ${requirement.title} (${requirement.status})`).join("\n")}`
      : "";
    return text(full ? `${summary}\n\n${phase.description || ""}${requirementsBlock}` : summary, {
      phase: {
        ref: formatPhaseRef(phase.number, featureNumberOfPhase(phase, features)),
        shortId: phase.shortId,
        title: phase.title,
        summary: phase.summary,
        status: phase.status,
        taskCount: phase.tasks.length,
        ...(full ? { description: phase.description } : {}),
      },
      linkedRequirements,
    });
});

server.registerTool("planner-phase-discuss", {
  description: "Persist phase discovery fields and mark phase planned.",
  inputSchema: {
    phase: z.string().min(1).describe("Phase ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."),
    goal: z.string().optional(),
    summary: z.string().optional(),
    scope: z.string().optional(),
    nonGoals: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
    risks: z.array(z.string()).optional(),
    completionCriteria: z.array(z.string()).optional(),
  },
}, async ({ phase: ref, ...updates }) => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const found = findPhaseByRef(await st.loadAllPhases(), features, ref);
  if (!found) return text(`Phase not found: ${ref}`);
  const phase = await st.updatePhase(found.id, (entry) => {
    if (updates.goal !== undefined) entry.goals = [updates.goal.trim()].filter(Boolean);
    if (updates.summary !== undefined) entry.summary = updates.summary.trim();
    if (updates.scope !== undefined) entry.description = updates.scope.trim();
    if (updates.nonGoals !== undefined) entry.nonGoals = updates.nonGoals.map((item) => item.trim()).filter(Boolean);
    if (updates.dependencies !== undefined) entry.dependencies = updates.dependencies.map((item) => item.trim()).filter(Boolean);
    if (updates.risks !== undefined) entry.risks = updates.risks.map((item) => item.trim()).filter(Boolean);
    if (updates.completionCriteria !== undefined) entry.completionCriteria = updates.completionCriteria.map((item) => item.trim()).filter(Boolean);
    entry.status = "planned";
    entry.discussedAt = nowISO();
    entry.contextReady = true;
    entry.contextReadyReason = "Updated through planner-phase-discuss MCP tool.";
    entry.updatedAt = nowISO();
    return entry;
  });
  return writeAndSummarize(st, `✅ Phase discussed/planned: ${formatPhaseRef(found.number, featureNumberOfPhase(found, features))} — ${phase.title}${phase.shortId ? ` · ${phase.shortId}` : ""}`);
});

server.registerTool("planner-phase-update", {
  description: "Update phase fields.",
  inputSchema: {
    phase: z.string().min(1),
    title: z.string().optional(),
    status: z.enum(PHASE_STATUS_VALUES).optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    priority: z.number().int().nonnegative().optional().describe("Display order within the feature (lower = higher)."),
  },
}, async ({ phase: ref, ...updates }) => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const found = findPhaseByRef(await st.loadAllPhases(), features, ref);
  if (!found) return text(`Phase not found: ${ref}`);
  const phase = await st.updatePhase(found.id, (entry) => {
    if (updates.title !== undefined) entry.title = updates.title.trim();
    if (updates.status !== undefined) entry.status = updates.status;
    if (updates.summary !== undefined) entry.summary = updates.summary.trim();
    if (updates.description !== undefined) entry.description = updates.description.trim();
    if (updates.priority !== undefined) entry.priority = updates.priority;
    entry.updatedAt = nowISO();
    return entry;
  });
  return writeAndSummarize(st, `✅ Phase updated: ${formatPhaseRef(found.number, featureNumberOfPhase(found, features))} — ${phase.title}${phase.shortId ? ` · ${phase.shortId}` : ""}`);
});

server.registerTool("planner-phase-delete", {
  description: "Delete a phase and unlink it from features.",
  inputSchema: { phase: z.string().min(1) },
}, async ({ phase: ref }) => {
  const st = await requireStore();
  const phase = findPhaseByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!phase) return text(`Phase not found: ${ref}`);
  await st.deletePhase(phase.id);
  await st.updateFeatures((doc) => {
    for (const feature of doc.features) feature.phaseIds = feature.phaseIds.filter((id) => id !== phase.id);
    return doc;
  });
    const dFeat = (await st.loadFeatures()).features.find((f) => f.id === phase.featureId);
    return writeAndSummarize(st, `Phase deleted: ${formatPhaseRef(phase.number, dFeat?.number)}${phase.shortId ? ` · ${phase.shortId}` : ""}`, { deleted: phase.id });
});

server.registerTool("planner-task-add", {
  description: "Create a task with a rich description. REQUIRED: description must include code references (file:line), what already exists vs what needs to be built, specific structs/traits/systems to modify, concrete implementation steps, and edge cases to handle. The description is the execution context for agents; one-liners cause misalignment.",
  inputSchema: {
    feature: z.string().min(1).optional().describe("Feature ref the task's phase belongs to. Accepts F00x/P00x/T00x composite, bare F00x (global), 5-char shortId, UUID, or title. REQUIRED."),
    phase: z.string().min(1).describe("Phase ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."),
    title: z.string().min(1),
    description: z.string().min(50, "Description must be at least 50 characters — include code references (file:line), current state vs desired state, structs/traits to modify, concrete implementation steps, edge cases. Prefix with 'design-only' for pre-implementation design tasks.").describe("Required code references (file:line), current state vs desired state, structs/traits to modify, concrete implementation steps, edge cases. Not a one-liner."),
    checklist: z.array(z.string()).optional(),
  },
}, async ({ feature: featureRef, phase: ref, title, description, checklist }) => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  if (!featureRef?.trim()) return text("feature is required: a task must belong to a feature.");
  const resolvedFeature = resolveFeatureRefStrict(features, featureRef);
  if (!resolvedFeature.ok) return text(resolvedFeature.error);
  const featureValidation = await validateResolvedTarget("feature", resolvedFeature.feature.id, () => st.loadFeatures().then((doc) => doc.features.find((f) => f.id === resolvedFeature.feature.id)).catch(() => undefined));
  if (!featureValidation.ok) return text(featureValidation.error);
  const feature = resolvedFeature.feature;
  if (!feature) return text(`Resolved feature ${featureRef} no longer exists. Refusing to create task.`);
  const found = findPhaseByRef(await st.loadAllPhases(), features, ref);
  if (!found) return text(`Phase not found: ${ref}`);
  if (found.featureId !== feature.id) return text(`Phase ${formatPhaseRef(found.number, featureNumberOfPhase(found, features))} does not belong to feature ${formatFeatureRef(feature.number)}. Refusing to create task.`);
  const phaseValidation = await validateResolvedTarget("phase", found.id, () => st.loadPhase(found.id).catch(() => undefined));
  if (!phaseValidation.ok) return text(phaseValidation.error);
  const existingPhase = await st.loadPhase(found.id);
  if (!existingPhase) return text(`Resolved phase ${found.id} no longer exists. Refusing to create task.`);
  const timestamp = nowISO();
  const taskId = createTaskId();
  const identity = await st.allocateEntityIdentity("task", taskId);
  const priority = await st.nextPriority("task", found.id);
  const task: Task = {
    id: taskId,
    phaseId: found.id,
    number: identity.number,
    shortId: identity.shortId,
    priority,
    shortName: clampSlug(title, 30, `task-${Date.now().toString(36)}`),
    title: title.trim(),
    status: "planned",
    description: description?.trim() ?? "",
    descriptionUpdatedAt: timestamp,
    notes: "",
    statusLog: [],
    sessionInfo: [],
    decisions: [],
    acceptedDecisions: [],
    checklist: (checklist ?? []).map((item, index) => ({ id: createChecklistItemId(taskId, index + 1, item), number: index + 1, title: item, checked: false })),
    subtasks: [],
    dependsOn: [],
    pauseSnapshot: null,
    pauseHistory: [],
    startedAt: "",
    completedAt: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await st.updatePhase(found.id, (entry) => {
    entry.tasks.push(task);
    entry.taskIds.push(task.id);
    entry.updatedAt = timestamp;
    return entry;
  });
  const finalFeatures = (await st.loadFeatures()).features;
  return writeAndSummarize(st, `✅ Task created: ${taskCompositeRef(task, found, finalFeatures)} — ${task.title} (planned)${task.shortId ? ` · ${task.shortId}` : ""}`);
});

server.registerTool("planner-task-show", {
  description: "Show a task by id or name.",
    inputSchema: { task: z.string().min(1).describe("Task ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."), full: z.boolean().optional().describe("If true, include the task description, resume checkpoint/advisory, and statusLog. Default: compact identity only (saves tokens).") },
  }, async ({ task: ref, full }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
    if (full) markTaskReadForSessionId(plannerSessionId, found.task.id);
    const features = (await st.loadFeatures()).features;
    const summary = `${found.task.title} — ${taskCompositeRef(found.task, found.phase, features)}${found.task.shortId ? ` · ${found.task.shortId}` : ""} (${found.task.status}; phase ${formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features))})`;
    if (!full) return text(summary);
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
    return text(sections.join("\n\n"));
});

server.registerTool("planner-task-discuss", {
  description: "Persist task execution notes/checklist.",
  inputSchema: {
    task: z.string().min(1),
    description: z.string().optional(),
    checklist: z.array(z.string()).optional(),
  },
}, async ({ task: ref, description, checklist }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
  let updatedTask: Task | undefined;
  await st.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) return phase;
    if (description !== undefined) task.description = description.trim();
    if (checklist !== undefined) task.checklist = checklist.map((item, index) => ({ id: createChecklistItemId(task.id, index + 1, item), number: index + 1, title: item, checked: false }));
    if (checklist !== undefined) task.checklist = checklist.map((item, index) => ({ id: createChecklistItemId(task.id, index + 1, item), number: index + 1, title: item, checked: false }));
    task.updatedAt = nowISO();
    phase.updatedAt = task.updatedAt;
    updatedTask = task;
    return phase;
  });
  const features = (await st.loadFeatures()).features;
  const t = updatedTask ?? found.task;
  return writeAndSummarize(st, `✅ Task discussed/updated: ${taskCompositeRef(t, found.phase, features)} — ${t.title} (${t.status})${t.shortId ? ` · ${t.shortId}` : ""}`);
});

server.registerTool("planner-task-update", {
  description: "Update task fields. A motivation is REQUIRED when changing to blocked, canceled, deferred, rejected, waiting, or back to planned from another status.",
  inputSchema: {
    task: z.string().min(1),
    title: z.string().optional(),
    status: z.enum(STATUS_VALUES).optional(),
    description: z.string().optional(),
    motivation: z.string().optional(),
    priority: z.number().int().nonnegative().optional().describe("Display order within the phase (lower = higher)."),
    checklist: z.array(z.string()).optional().describe("Replace the task checklist (implementation steps, plain strings). Agents should tick steps via planner-task-checklist-toggle, not write DONE in titles."),
  },
}, async ({ task: ref, title, status, description, motivation, priority, checklist }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);

  if (status === "in-progress" && status !== found.task.status) {
    return text("Task start/resume transitions require planner-task-start so lifecycle state, checkpoints, and return stacks remain consistent.");
  }
  if (status === "done" && status !== found.task.status) {
    return text("Task completion transitions require planner-task-complete with durable completion and verification evidence.");
  }

  // Validate motivation requirement for status transitions.
  if (status !== undefined && needsMotivation(found.task.status, status)) {
    if (!motivation || !motivation.trim()) {
      return text(
        `Status transition \"${found.task.status} → ${status}\" requires a motivation. ` +
        `Provide the \"motivation\" parameter with a detailed explanation of why this change is needed.`
      );
    }
  }

  let updatedTask: Task | undefined;
  const timestamp = nowISO();
  await st.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) return phase;
    if (title !== undefined) task.title = title.trim();
    if (priority !== undefined) task.priority = priority;
    if (description !== undefined) task.description = description.trim();
    if (status !== undefined && status !== task.status) {
      // Record status change in the incremental statusLog.
      const entry: StatusLogEntry = {
        id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${task.status}-${status}`),
        date: timestamp,
        fromStatus: task.status as any,
        toStatus: status as any,
        title: motivation?.split("\n")[0]?.trim() || `${task.status} → ${status}`,
        description: motivation?.trim() || "",
      };
      task.statusLog = [...(task.statusLog ?? []), entry];
      applyTaskLifecycleDates(task, status, timestamp);
    }
    task.updatedAt = timestamp;
    phase.updatedAt = timestamp;
    updatedTask = task;
    return phase;
  });
  await st.syncTaskStatusRollup(found.phase.id);
  const features = (await st.loadFeatures()).features;
  const t = updatedTask ?? found.task;
  let resumeNotice = "";
  let resumeRequired: Record<string, unknown> | undefined;
  if (status && status !== "in-progress" && status !== found.task.status) {
    const deviation = (await st.loadProject()).workDeviations
      .filter((entry) => (entry.state === "approved" || entry.state === "active") && entry.temporaryTaskId === found.task.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (deviation) {
      await st.setWorkDeviationState(deviation.id, "resume-required", timestamp);
      const resume = findTaskByRef(await st.loadAllPhases(), features, deviation.resumeTaskId);
      if (resume) {
        resumeNotice = `\n↩️ RESUME REQUIRED: ${taskCompositeRef(resume.task, resume.phase, features)} — ${resume.task.title}`;
        resumeRequired = { taskId: resume.task.id, phaseId: resume.phase.id, snapshot: resume.task.pauseSnapshot ?? deviation.snapshot };
      }
    }
  }
  return writeAndSummarize(st, `✅ Task updated: ${taskCompositeRef(t, found.phase, features)} — ${t.title} (${t.status})${t.shortId ? ` · ${t.shortId}` : ""}${resumeNotice}`, resumeRequired ? { resumeRequired } : undefined);
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
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
  let result = "";
  await st.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) { result = `Task not found: ${ref}`; return phase; }
    const ck = task.checklist ?? [];
    if (ck.length === 0) { result = `Task "${found.task.title}" has no checklist.`; return phase; }
    const target = toggleChecklistItem(ck, item, checked);
    if (!target) { result = `No checklist item matching "${item}".`; return phase; }
    task.updatedAt = nowISO();
    phase.updatedAt = nowISO();
    const doneCount = ck.filter((i) => i.checked).length;
    result = `C${target.number} "${target.title}" → ${target.checked ? "done" : "open"} (${doneCount}/${ck.length} checked)`;
    return phase;
  });
  return writeAndSummarize(st, `✅ ${result}`);
});

server.registerTool("planner-task-checklist-add", {
  description: "Add a single checklist item (a 'step') to a task without rewriting the list. The new item is appended as C{n} (next progressive number, stable id, unchecked). Use this to subdivide a task into smaller steps INSTEAD of spawning sub-tasks — the checklist keeps description, notes, statusLog and steps concentrated in one task (sub-tasks disperse context). Also use for granular adds instead of replacing the whole checklist via planner-task-update.",
  inputSchema: {
    task: z.string().min(1).describe("Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title"),
    title: z.string().min(1).describe("Checklist item text (a single step)"),
  },
}, async ({ task: ref, title }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
  let result = "";
  await st.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) { result = `Task not found: ${ref}`; return phase; }
    const ck = task.checklist ?? [];
    const item = addChecklistItem(ck, task.id, title);
    ck.push(item);
    task.checklist = ck;
    task.updatedAt = nowISO();
    phase.updatedAt = nowISO();
    result = `Added C${item.number} "${item.title}" (${ck.length} items)`;
    return phase;
  });
  return writeAndSummarize(st, `✅ ${result}`);
});

server.registerTool("planner-task-checklist-remove", {
  description: "Remove a single checklist item (a 'step') from a task by C{n} (e.g. C2), item id, or title (case-insensitive). Remaining items are renumbered C1..Cn for readability; their stable ids are preserved. Use this for granular removes instead of replacing the whole checklist via planner-task-update.",
  inputSchema: {
    task: z.string().min(1).describe("Task ref: F00x/P00x/T00x, bare T00x (global), 5-char shortId, UUID, or title"),
    item: z.string().min(1).describe("Checklist item selector: C{n} (e.g. C2), item id, or title (case-insensitive)"),
  },
}, async ({ task: ref, item }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
  let result = "";
  await st.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) { result = `Task not found: ${ref}`; return phase; }
    const ck = task.checklist ?? [];
    if (ck.length === 0) { result = `Task "${found.task.title}" has no checklist.`; return phase; }
    const removed = removeChecklistItem(ck, item);
    if (!removed) { result = `No checklist item matching "${item}".`; return phase; }
    task.updatedAt = nowISO();
    phase.updatedAt = nowISO();
    result = `Removed C${removed.number} "${removed.title}" (${ck.length} items left)`;
    return phase;
  });
  return writeAndSummarize(st, `✅ ${result}`);
});

server.registerTool("planner-task-delete", {
  description: "Delete a task.",
  inputSchema: { task: z.string().min(1) },
}, async ({ task: ref }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
  await st.updatePhase(found.phase.id, (phase) => {
    phase.tasks = phase.tasks.filter((task) => task.id !== found.task.id);
    phase.taskIds = phase.taskIds.filter((id) => id !== found.task.id);
    phase.updatedAt = nowISO();
    return phase;
  });
  await st.syncTaskStatusRollup(found.phase.id);
    const tdFeatures = (await st.loadFeatures()).features;
    return writeAndSummarize(st, `Task deleted: ${taskCompositeRef(found.task, found.phase, tdFeatures)}${found.task.shortId ? ` · ${found.task.shortId}` : ""}`, { deleted: found.task.id });
});

server.registerTool("planner-task-recommend", {
  description: "Return the harness-agnostic recommended task: continue one active task or the current phase, otherwise choose ready work by feature → phase → task priority. Reports dependency, availability, and approved deviation/resume context without starting or blocking work.",
  inputSchema: {},
}, async () => {
  const st = await requireStore();
  const [features, phases, project, resume] = await Promise.all([st.loadFeatures(), st.loadAllPhases(), st.loadProject(), st.loadResume()]);
  const result = recommendNextTask(features.features, phases, project.workDeviations, resume?.currentPhaseId);
  if (!result.candidate) return text(`No task recommendation: ${result.reason}`, { kind: result.kind, reason: result.reason, activeTaskIds: result.activeCandidates?.map((candidate) => candidate.task.id) ?? [] });
  const { candidate } = result;
  const ref = taskCompositeRef(candidate.task, candidate.phase, features.features);
  return text(`Recommended (${result.kind}): ${ref} — ${candidate.task.title}\n${result.reason}${result.deviation ? `\nDeviation: ${result.deviation.id}; resume target ${result.deviation.resumeTaskId}.` : ""}`, {
    kind: result.kind, taskId: candidate.task.id, phaseId: candidate.phase.id, featureId: candidate.feature?.id, deviation: result.deviation,
  });
});

server.registerTool("planner-task-deviation", {
  description: "Record a user-approved temporary task deviation. It preserves the recommended/resume task and never starts, pauses, or blocks work; use normal lifecycle tools for those transitions.",
  inputSchema: { temporary_task: z.string().min(1), resume_task: z.string().min(1).optional(), reason: z.string().min(1) },
}, async ({ temporary_task, resume_task, reason }) => {
  const st = await requireStore();
  const [features, phases, project, focus] = await Promise.all([st.loadFeatures(), st.loadAllPhases(), st.loadProject(), st.loadResume()]);
  const temporary = findTaskByRef(phases, features.features, temporary_task);
  if (!temporary) return text(`Task not found: ${temporary_task}`);
  const selected = recommendNextTask(features.features, phases, project.workDeviations, focus?.currentPhaseId);
  const resume = resume_task ? findTaskByRef(phases, features.features, resume_task) : selected.candidate;
  if (!resume) return text(`No resume task is available. Provide resume_task explicitly. ${selected.reason}`);
  if (temporary.task.id === resume.task.id) return text("A temporary task must differ from its resume target.");
  if (temporary.task.status !== "planned") return text(`Temporary task is not startable: ${temporary.task.status}.`);
  const timestamp = nowISO();
  const record = {
    id: crypto.randomUUID(), recommendedTaskId: selected.candidate?.task.id ?? resume.task.id,
    temporaryTaskId: temporary.task.id, resumeTaskId: resume.task.id, reason, snapshot: null,
    requestedBy: "user" as const, approvedBy: "user", state: "approved" as const,
    createdAt: timestamp, activatedAt: "", resumeRequiredAt: "", resolvedAt: "", resumedAt: "",
  };
  await st.addWorkDeviation(record);
  return writeAndSummarize(st, `✅ Approved deviation: ${taskCompositeRef(temporary.task, temporary.phase, features.features)} temporarily overrides ${taskCompositeRef(resume.task, resume.phase, features.features)}. Resume target retained.`, { deviation: record });
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
}, async ({ task: ref, reason, what_was_being_done, resume_location, how_to_resume, paused_by }) => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const found = findTaskByRef(await st.loadAllPhases(), features, ref);
  if (!found) return text(`Task not found: ${ref}`);
  if (found.task.status !== "in-progress") return text(`Task pause denied: ${taskCompositeRef(found.task, found.phase, features)} is ${found.task.status}, not in-progress.`);
  const snapshot = {
    id: crypto.randomUUID(), reason, whatWasBeingDone: what_was_being_done,
    resumeLocation: resume_location, howToResume: how_to_resume, relatedTaskId: "",
    pausedAt: nowISO(), pausedBy: paused_by?.trim() ?? "",
  };
  invalidateReads(plannerSessionId);
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
  const resumeNotice = resume
    ? `\n↩️ RESUME REQUIRED: ${taskCompositeRef(resume.task, resume.phase, features)} — ${resume.task.title}`
    : "";
  return writeAndSummarize(st, [
    `💾 Resume checkpoint saved: ${taskCompositeRef(checkpointed, found.phase, features)} — ${checkpointed.title}`,
    `Why: ${snapshot.reason}`,
    `Checkpoint: ${snapshot.whatWasBeingDone}`,
    `Resume from: ${snapshot.resumeLocation}`,
    `How to resume: ${snapshot.howToResume}${resumeNotice}`,
  ].join("\n"), { task: checkpointed, snapshot, ...(resume ? { resumeRequired: { taskId: resume.task.id } } : {}) });
});

server.registerTool("planner-task-switch", {
  description: "Atomically switch from active work to a temporary task, even outside normal priority order. Reuse the target's valid sessionInfo context or require the exact full tree when missing or stale. Pause the source with a mandatory snapshot, start the target, and push a durable LIFO return target.",
  inputSchema: {
    from_task: z.string().min(1),
    to_task: z.string().min(1),
    reason: z.string().min(1),
    what_was_being_done: z.string().min(1),
    resume_location: z.string().min(1),
    how_to_resume: z.string().min(1),
    switched_by: z.string().optional(),
  },
}, async ({ from_task, to_task, reason, what_was_being_done, resume_location, how_to_resume, switched_by }) => {
  const st = await requireStore();
  const [featuresDoc, phases, project, focus] = await Promise.all([st.loadFeatures(), st.loadAllPhases(), st.loadProject(), st.loadResume()]);
  const features = featuresDoc.features;
  const source = findTaskByRef(phases, features, from_task);
  const target = findTaskByRef(phases, features, to_task);
  if (!source) return text(`Task not found: ${from_task}`);
  if (!target) return text(`Task not found: ${to_task}`);
  if (source.task.id === target.task.id) return text("Source and temporary task must differ.");
  if (source.task.status !== "in-progress" && !source.task.pauseSnapshot) {
    return text(`Task switch denied: source is ${source.task.status}; only in-progress or checkpointed work can be switched.`);
  }
  const targetFeature = target.phase.featureId ? features.find((feature) => feature.id === target.phase.featureId) : undefined;
  const linkedRequirements = [
    ...(await st.linkedRequirementsForPhase(target.phase.id)),
    ...(target.phase.featureId ? await st.linkedRequirementsForFeature(target.phase.featureId) : []),
  ].filter((requirement, index, all) => all.findIndex((candidate) => candidate.id === requirement.id) === index);
  const linkedRequirementIds = linkedRequirements.map((requirement) => requirement.id);
  const contextInput = {
    sessionId: plannerSessionId,
    taskId: target.task.id,
    phaseId: target.phase.id,
    ...(target.phase.featureId ? { featureId: target.phase.featureId } : {}),
    task: target.task,
    phase: target.phase,
    ...(targetFeature ? { feature: targetFeature } : {}),
    requirements: linkedRequirements,
    requirementIds: linkedRequirementIds,
  };
  const contextEligibility = contextReadEligibilityForSession(contextInput);
  if (!contextEligibility.eligible) return text(`Task switch denied: context reads required. ${contextEligibility.reason}`, contextEligibility);
  if (!hasReadRequirementsForSession(plannerSessionId, linkedRequirementIds, linkedRequirements)) {
    return text("Task switch denied: read the requirements linked to the target phase and feature before switching.", { requirementIds: linkedRequirementIds });
  }
  if (!hasValidSessionAttestation(contextInput)) {
    await st.recordContextRead({ sessionId: plannerSessionId, phaseId: target.phase.id, taskId: target.task.id, ...(target.phase.featureId ? { featureId: target.phase.featureId } : {}), requirementIds: linkedRequirementIds });
  }
  const eligibility = checkExplicitTaskStart(features, phases, target.task.id, project.workDeviations);
  if (!eligibility.eligible) return text(`Task switch denied: ${eligibility.reason}`);

  const timestamp = nowISO();
  const snapshot = {
    id: crypto.randomUUID(), reason, whatWasBeingDone: what_was_being_done,
    resumeLocation: resume_location, howToResume: how_to_resume,
    relatedTaskId: target.task.id, pausedAt: timestamp, pausedBy: switched_by?.trim() ?? "",
  };
  const selection = recommendNextTask(features, phases, project.workDeviations, focus?.currentPhaseId);
  const record = {
    id: crypto.randomUUID(), recommendedTaskId: selection.candidate?.task.id ?? source.task.id,
    temporaryTaskId: target.task.id, resumeTaskId: source.task.id, reason, snapshot,
    requestedBy: "agent" as const, approvedBy: switched_by?.trim() || "explicit task_switch",
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
        if (!task) throw new Error(`Checkpointed source task disappeared: ${from_task}`);
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
        if (!task) throw new Error(`Temporary task disappeared: ${to_task}`);
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
  invalidateReads(plannerSessionId);
  return writeAndSummarize(st, [
    `🔀 Task switched: ${taskCompositeRef(source.task, source.phase, features)} → ${taskCompositeRef(target.task, target.phase, features)}`,
    `Resume checkpoint: ${snapshot.whatWasBeingDone}`,
    `Return target: ${taskCompositeRef(source.task, source.phase, features)} from ${snapshot.resumeLocation}`,
    `Normal priority was deliberately overridden; completing the temporary task will emit RESUME REQUIRED.`,
  ].join("\n"), { deviation: record, snapshot, resumeTaskId: source.task.id, temporaryTaskId: target.task.id });
});

server.registerTool("planner-task-start", {
  description: "Set a task to in-progress or resume checkpointed work. Read the exact full task → phase → feature tree and linked requirements once per harness session; subsequent starts reuse persisted sessionInfo while entity updatedAt values remain unchanged. Every stale or denied start is an MCP isError result with started=false and exact retry actions; NEVER claim work started unless structuredContent.started is true. Success is returned only after persisted in-progress state is verified.",
  inputSchema: { task: z.string().min(1) },
}, async ({ task: ref }) => {
  let st: PlanStore;
  try {
    st = await requireStore();
  } catch {
    return taskStartError(taskStartDenied("PLAN_NOT_FOUND", "No .planner/ found.", ["Initialize or load the planner, then retry planner-task-start."]));
  }

  const features = (await st.loadFeatures()).features;
  const found = findTaskByRef(await st.loadAllPhases(), features, ref);
  if (!found) return taskStartError(taskStartDenied("TASK_NOT_FOUND", `Task not found: ${ref}`, ["Resolve the task with planner-task-list or planner-task-show, then retry planner-task-start."]));
  const taskRef = taskCompositeRef(found.task, found.phase, features);
  const phaseRef = formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features));
  const parentFeature = found.phase.featureId ? features.find((candidate) => candidate.id === found.phase.featureId) : undefined;
  const featureRef = parentFeature ? formatFeatureRef(parentFeature.number) : "";
  if (found.task.status === "in-progress") {
    const outcome = taskStartSucceeded(found.task.id, true);
    return text(`✅ Task already started: ${taskRef} — ${found.task.title} (in-progress)\nstarted: true`, { ...outcome, task: found.task });
  }
  if (found.task.status === "done") return taskStartError(taskStartDenied(
    "TASK_DONE",
    `Task ${taskRef} is done and was not reopened.`,
    [`Use planner-task-update with status=planned and a motivation to reopen ${taskRef}.`, `Repeat the required full context reads, then retry planner-task-start ${taskRef}.`],
    { taskId: found.task.id },
  ));
  const linkedRequirements = [
    ...(await st.linkedRequirementsForPhase(found.phase.id)),
    ...(found.phase.featureId ? await st.linkedRequirementsForFeature(found.phase.featureId) : []),
  ].filter((requirement, index, all) => all.findIndex((candidate) => candidate.id === requirement.id) === index);
  const linkedRequirementIds = linkedRequirements.map((requirement) => requirement.id);
  const contextInput = {
    sessionId: plannerSessionId,
    taskId: found.task.id,
    phaseId: found.phase.id,
    ...(found.phase.featureId ? { featureId: found.phase.featureId } : {}),
    task: found.task,
    phase: found.phase,
    ...(parentFeature ? { feature: parentFeature } : {}),
    requirements: linkedRequirements,
    requirementIds: linkedRequirementIds,
  };
  const contextEligibility = contextReadEligibilityForSession(contextInput);
  if (!contextEligibility.eligible) return taskStartError(taskStartDenied(
    "CONTEXT_READ_REQUIRED",
    `Required context reads are incomplete or stale. ${contextEligibility.reason}`,
    [
      `planner-task-show ${taskRef} with full=true`,
      `planner-phase-show ${phaseRef} with full=true`,
      ...(featureRef ? [`planner-feature-show ${featureRef} with full=true`] : []),
      ...(linkedRequirementIds.length > 0 ? ["planner-requirement-list"] : []),
      `Retry planner-task-start ${taskRef}`,
    ],
    { taskId: found.task.id },
  ), { contextEligibility });
  if (!hasReadRequirementsForSession(plannerSessionId, linkedRequirementIds, linkedRequirements)) {
    return taskStartError(taskStartDenied(
      "REQUIREMENTS_READ_REQUIRED",
      "Linked requirements were not read; the task remains unchanged.",
      ["planner-requirement-list", `Retry planner-task-start ${taskRef}`],
      { taskId: found.task.id, requirementIds: linkedRequirementIds },
    ));
  }
  if (!hasValidSessionAttestation(contextInput)) {
    await st.recordContextRead({ sessionId: plannerSessionId, phaseId: found.phase.id, taskId: found.task.id, ...(found.phase.featureId ? { featureId: found.phase.featureId } : {}), requirementIds: linkedRequirementIds });
  }
  const [project, phases, focus] = await Promise.all([st.loadProject(), st.loadAllPhases(), st.loadResume()]);
  const eligibility = checkExplicitTaskStart(features, phases, found.task.id, project.workDeviations);
  if (!eligibility.eligible) return taskStartError(taskStartDenied(
    "START_NOT_ALLOWED",
    eligibility.reason,
    ["Resolve the reported task readiness condition, then retry planner-task-start."],
    { taskId: found.task.id },
  ), { eligibility });
  const selection = recommendNextTask(features, phases, project.workDeviations, focus?.currentPhaseId);
  if (selection.kind === "conflict") {
    return taskStartError(taskStartDenied(
      "ACTIVE_TASK_CONFLICT",
      selection.reason,
      ["Pause or reconcile the active tasks.", `Retry planner-task-start ${taskRef}.`],
      { taskId: found.task.id },
    ), { selection });
  }
  if (selection.kind === "active" && selection.candidate?.task.id !== found.task.id) {
    const activeRef = taskCompositeRef(selection.candidate!.task, selection.candidate!.phase, features);
    return taskStartError(taskStartDenied(
      "ACTIVE_TASK_CONFLICT",
      `${activeRef} is active; ${taskRef} was not started.`,
      [`Use planner-task-switch to snapshot and pause ${activeRef}.`, `Retry planner-task-start ${taskRef}.`],
      { taskId: found.task.id },
    ), { selection });
  }
  let resumeProposal:
    | { text: string; structured: { taskId: string; phaseId: string; snapshot: { reason: string; resumeLocation: string; howToResume: string } | null } }
    | undefined;
  if (selection.kind === "resume" && selection.candidate && selection.candidate.task.id !== found.task.id) {
    // Advisory only: a pending resume must be surfaced loudly, but it must
    // not hard-block an explicit start of a different task. Capture a
    // structured proposal so the resume-first guidance is explicit and
    // machine-readable for the host/agent.
    const resumeTask = selection.candidate;
    const resumeSnapshot = resumeTask.task.pauseSnapshot
      ?? project.workDeviations.find((deviation) =>
        deviation.resumeTaskId === resumeTask.task.id
        && (deviation.state === "resume-required" || deviation.state === "resolved"))?.snapshot
      ?? null;
    resumeProposal = buildResumeRequiredProposal({
      ref: taskCompositeRef(resumeTask.task, resumeTask.phase, features),
      title: resumeTask.task.title,
      taskId: resumeTask.task.id,
      phaseId: resumeTask.phase.id,
      snapshot: resumeSnapshot
        ? { reason: resumeSnapshot.reason, resumeLocation: resumeSnapshot.resumeLocation, howToResume: resumeSnapshot.howToResume }
        : null,
    });
  }
  // Assemble the mandatory parent context before changing task lifecycle state.
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

  // A pending handoff is context, not a lock: task start RETAINS it. It is
  // archived only when the phase completes (auto) or the user explicitly
  // clears it.
  const advisory = selection.candidate && selection.candidate.task.id !== found.task.id
    ? selection.kind === "resume"
      ? `\n\n${(() => {
          if (resumeProposal) return resumeProposal.text;
          return `⚠️ Resume advisory: ${taskCompositeRef(selection.candidate!.task, selection.candidate!.phase, features)} has a saved checkpoint. Evaluate its resume context before continuing with this explicit task request. Explicit task request honored.`;
        })()}`
      : `\n\n⚠️ Priority advisory: ${taskCompositeRef(selection.candidate.task, selection.candidate.phase, features)} is the automatic recommendation. Explicit task request honored.`
    : "";
  const timestamp = nowISO();

  let updatedTask: Task | undefined;
  if (found.task.pauseSnapshot) {
    updatedTask = await st.resumeTask(found.phase.id, found.task.id, timestamp);
  } else {
    await st.updatePhase(found.phase.id, (phase) => {
      const task = phase.tasks.find((entry) => entry.id === found.task.id);
      if (!task) return phase;
      const previousStatus = task.status;
      applyTaskLifecycleDates(task, "in-progress", timestamp);
      const entry: StatusLogEntry = {
        id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${previousStatus}-in-progress`),
        date: timestamp,
        fromStatus: previousStatus,
        toStatus: "in-progress",
        title: `${previousStatus} → in-progress`,
        description: "",
      };
      task.statusLog = [...(task.statusLog ?? []), entry];
      task.updatedAt = timestamp;
      phase.updatedAt = timestamp;
      updatedTask = task;
      return phase;
    });
  }
  await st.syncTaskStatusRollup(found.phase.id);
  const approvedDeviation = project.workDeviations.find((deviation) =>
    deviation.temporaryTaskId === found.task.id && deviation.state === "approved",
  );
  if (approvedDeviation) await st.setWorkDeviationState(approvedDeviation.id, "active", timestamp);
  const resumedDeviation = project.workDeviations
    .filter((deviation) => deviation.resumeTaskId === found.task.id
      && (deviation.state === "resume-required" || deviation.state === "resolved"))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (resumedDeviation) await st.setWorkDeviationState(resumedDeviation.id, "resumed", timestamp);
  await st.writeGenerated();
  const persistedTask = (await st.loadPhase(found.phase.id)).tasks.find((candidate) => candidate.id === found.task.id);
  if (!updatedTask || persistedTask?.status !== "in-progress") {
    return taskStartError(taskStartDenied(
      "PERSISTENCE_VERIFICATION_FAILED",
      `The lifecycle write could not be verified as in-progress for ${taskRef}.`,
      ["Inspect planner-task-show for the persisted state and retry only after resolving the persistence failure."],
      { taskId: found.task.id },
    ));
  }
  const outcome = taskStartSucceeded(persistedTask.id);
  return text(`✅ Task started: ${taskRef} — ${persistedTask.title} (in-progress)${persistedTask.shortId ? ` · ${persistedTask.shortId}` : ""}\nstarted: true${phaseContext}${advisory}`, {
    ...outcome,
    task: persistedTask,
    ...(resumeProposal ? { resumeRequired: resumeProposal.structured } : {}),
  });
});

server.registerTool("planner-task-complete", {
  description: "Set a task to done with mandatory durable completion and verification evidence. Fails if checklist is incomplete unless force=true.",
  inputSchema: {
    task: z.string().min(1),
    force: z.boolean().optional(),
    description_update: z.string().min(10).describe("Required evidence: shipped work, verification level including partial verification, remaining/unverified work, files, decisions, and updated code references."),
  },
}, async ({ task: ref, force, description_update }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
  const completionSummary = description_update.trim();
  if (completionSummary.length < 10) return text("Task completion denied: provide at least 10 characters of durable completion and verification evidence.");
  if (found.task.pauseSnapshot) return text("Task completion denied: resume checkpointed work with planner-task-start before completing it, or cancel it explicitly with motivation.");
  const unchecked = found.task.checklist.filter((item) => !item.checked);
  if (unchecked.length > 0 && !force) return text(`${unchecked.length} checklist item(s) not done. Re-run with force=true to complete anyway.`);
  const timestamp = nowISO();
  let updatedTask: Task | undefined;
  await st.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) return phase;
    const previousStatus = task.status;
    applyTaskLifecycleDates(task, "done", timestamp);
    const entry: StatusLogEntry = {
      id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${previousStatus}-done`),
      date: timestamp,
      fromStatus: previousStatus,
      toStatus: "done",
      title: `${previousStatus} → done`,
      description: completionSummary,
    };
    task.statusLog = [...(task.statusLog ?? []), entry];
    const sep = task.description ? "\n\n---\n**Completion summary:**\n" : "**Completion summary:**\n";
    task.description = task.description + sep + completionSummary;
    task.descriptionUpdatedAt = timestamp;
    task.updatedAt = timestamp;
    phase.updatedAt = timestamp;
    updatedTask = task;
    return phase;
  });
  const clearedRef = await st.syncTaskStatusRollup(found.phase.id);
  const completedDeviation = (await st.loadProject()).workDeviations
    .filter((deviation) => (deviation.state === "approved" || deviation.state === "active") && deviation.temporaryTaskId === found.task.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (completedDeviation) await st.setWorkDeviationState(completedDeviation.id, "resume-required", timestamp);
  const features = (await st.loadFeatures()).features;
  const t = updatedTask ?? found.task;
  let resumeNotice = "";
  let resumeRequired: Record<string, unknown> | undefined;
  if (completedDeviation) {
    const resume = findTaskByRef(await st.loadAllPhases(), features, completedDeviation.resumeTaskId);
    if (resume) {
      const snapshot = resume.task.pauseSnapshot ?? completedDeviation.snapshot;
      resumeNotice = [
        "",
        `↩️ RESUME REQUIRED: ${taskCompositeRef(resume.task, resume.phase, features)} — ${resume.task.title}`,
        snapshot ? `Checkpoint reason: ${snapshot.reason}` : "Return to the preserved task before selecting new priority work.",
        snapshot ? `Resume from: ${snapshot.resumeLocation}` : "",
        snapshot ? `How to resume: ${snapshot.howToResume}` : "",
        `Next action: planner-task-start ${taskCompositeRef(resume.task, resume.phase, features)}`,
      ].filter(Boolean).join("\n");
      resumeRequired = { taskId: resume.task.id, phaseId: resume.phase.id, snapshot };
    }
  }
  return writeAndSummarize(st, `✅ Task completed: ${taskCompositeRef(t, found.phase, features)} — ${t.title} (done)${t.shortId ? ` · ${t.shortId}` : ""}${clearedRef ? ` — phase handoff auto-cleared (${clearedRef})` : ""}${resumeNotice}`, resumeRequired ? { resumeRequired } : undefined);
});

server.registerTool("planner-handoff-list", {
  description: "List all phases with a non-empty entity-scoped handoff (phase.handoff field). Returns composite refs (P00x / P00x(F00x)) with the first line and last-updated time.",
}, async () => {
  const st = await requireStore();
  const list = await st.listHandoffs();
  if (list.length === 0) return text("No phase handoffs set.");
  const lines = list.map((e) => `- ${e.compositeRef} — ${e.firstLine} (updated ${e.updatedAt})`);
  return text(`Phase handoffs (${list.length}):\n${lines.join("\n")}`, { count: list.length, handoffs: list });
});

server.registerTool("planner-handoff-show", {
  description: "Read the entity-scoped handoff of a phase. phaseRef is required; never infer a phase from in-progress status or stale context.",
  inputSchema: { phaseRef: z.string().min(1).describe("Exact phase ref: P00x | P00x(F00x) | UUID | title. Ask the user when ambiguous.") },
}, async ({ phaseRef }) => {
  const st = await requireStore();
  const r = await resolvePhaseForHandoff(st, phaseRef);
  if (!r.ok) return text(`❌ ${r.error}`);
  const content = await st.getPhaseHandoff(r.phase.id);
  if (!content.trim()) return text(`No handoff set on ${r.compositeRef}.`, { phaseRef: r.compositeRef, empty: true });
  return text(`Handoff for ${r.compositeRef}:\n\n${content}`, { phaseRef: r.compositeRef, phaseId: r.phase.id });
});

server.registerTool("planner-requirement-list", {
  description: "List all top-level requirements in requirements.json. Reading this list records the requirements as read for the start/resume read-enforcement (explicit requirement read, required alongside feature/phase reads).",
  inputSchema: {},
}, async () => {
  const st = await requireStore();
  const requirements = await st.loadRequirements();
  requirements.requirements.forEach((req) => markRequirementReadForSessionId(plannerSessionId, req.id));
  return text(requirements.requirements.map((req) => `- ${req.id} — ${req.title} (${req.status})`).join("\n") || "No requirements", { requirements });
});

server.registerTool("planner-handoff-write", {
  description: "Reconcile and refresh the single active phase handoff while synchronizing durable task, phase, and feature context. Run planner-handoff-prepare with the confirmed phaseRef first and pass its exact handoffUpdatedAt token.",
  inputSchema: {
    phaseRef: z.string().min(1).describe("Exact confirmed phase ref: P00x | P00x(F00x) | UUID | title."),
    title: z.string().min(3).optional().describe("Meaningful handoff title summarizing the work."),
    confirmed: z.boolean().describe("Set true only after the user explicitly confirms the proposed feature+phase target."),
    content: z.string().min(1).describe("Full reconciled handoff text (markdown)."),
    expectedHandoffUpdatedAt: z.string().optional().describe("Exact token returned by planner-handoff-prepare; empty when no handoff exists."),
    reconciledExistingHandoff: z.boolean().optional().describe("Confirm that still-relevant existing handoff information was retained."),
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
}, async ({ phaseRef, title, confirmed, content, expectedHandoffUpdatedAt, reconciledExistingHandoff, taskUpdates, phaseUpdate, phaseNoUpdateReason, featureUpdate, featureNoUpdateReason }) => {
  const st = await requireStore();
  let body = content.trim();
  const firstLine = body.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const firstHeadingText = firstLine.replace(/^#+\s*/, "").trim();
  const effectiveHeadingText = title?.trim() || firstHeadingText;
  if (!effectiveHeadingText || /^(handoff|canonical handoff|session handoff)$/i.test(effectiveHeadingText)) {
    return text("❌ Generic handoff title. Provide a meaningful title summarizing the work.");
  }
  if (title?.trim()) {
    const lines = body.split(/\r?\n/);
    const firstIdx = lines.findIndex((line) => line.trim().length > 0);
    if (firstIdx !== -1 && /^#+\s/.test(lines[firstIdx] ?? "")) lines[firstIdx] = `# ${title.trim()}`;
    else lines.unshift(`# ${title.trim()}`, "");
    body = lines.join("\n");
  }
  const r = await resolvePhaseForHandoff(st, phaseRef);
  if (!r.ok) return text(`❌ ${r.error}`);
  if (!confirmed) return text(`Proposal only: I would refresh this handoff on ${r.compositeRef}. Ask the user to confirm, then run planner-handoff-prepare with the exact phaseRef.`, { phaseRef: r.compositeRef, confirmationRequired: true });
  if (expectedHandoffUpdatedAt === undefined) return text("❌ Run planner-handoff-prepare first and pass expectedHandoffUpdatedAt.");

  const phases = await st.loadAllPhases();
  const features = (await st.loadFeatures()).features;
  const resolvedTaskUpdates = [];
  for (const update of taskUpdates ?? []) {
    const found = findTaskByRef(phases, features, update.taskRef.trim());
    if (!found || found.phase.id !== r.phase.id) return text(`❌ Task ${update.taskRef} does not belong to ${r.compositeRef}.`);
    resolvedTaskUpdates.push({
      taskId: found.task.id,
      completionSummary: update.completionSummary,
      verification: update.verification,
      remainingWork: update.remainingWork,
      ...(update.filesTouched ? { filesTouched: update.filesTouched } : {}),
      ...(update.decisions ? { decisions: update.decisions } : {}),
    });
  }
  try {
    const result = await st.refreshPhaseHandoff(r.phase.id, {
      content: body,
      expectedHandoffUpdatedAt,
      reconciledExistingHandoff: reconciledExistingHandoff === true,
      contextSync: {
        taskUpdates: resolvedTaskUpdates,
        ...(phaseUpdate ? { phaseUpdate: {
          progressSummary: phaseUpdate.progressSummary,
          remainingWork: phaseUpdate.remainingWork,
          ...(phaseUpdate.decisions ? { decisions: phaseUpdate.decisions } : {}),
        } } : {}),
        ...(phaseNoUpdateReason ? { phaseNoUpdateReason } : {}),
        ...(featureUpdate ? { featureUpdate } : {}),
        ...(featureNoUpdateReason ? { featureNoUpdateReason } : {}),
      },
    });
    await st.writeGenerated();
    return text(`✅ Reconciled handoff and durable context on ${r.compositeRef}; updated ${result.updatedTaskIds.length} task(s).`, { phaseRef: r.compositeRef, phaseId: r.phase.id, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return text(`❌ Handoff refresh denied: ${message}`, { error: message });
  }
});

server.registerTool("planner-handoff-prepare", {
  description: "Identify or audit the exact handoff target. Without phaseRef, returns the confirmation workflow. With a confirmed phaseRef, returns the current handoff/version and done tasks missing durable completion evidence.",
  inputSchema: { phaseRef: z.string().min(1).optional() },
}, async ({ phaseRef }) => {
  if (!phaseRef) return text([
    "First identify the exact feature and phase actually discussed/worked on in this session. Do not use a stale resume pointer or target a phase that just became done.",
    "Tell the user: 'I propose writing this handoff on P00x(F00x) — <phase title>. Confirm?' Wait for explicit confirmation.",
    "After confirmation, call planner-handoff-prepare again with that exact phaseRef, then reconcile its current handoff and missing task evidence through planner-handoff-write.",
  ].join("\n"));
  const st = await requireStore();
  const r = await resolvePhaseForHandoff(st, phaseRef);
  if (!r.ok) return text(`❌ ${r.error}`);
  try {
    const audit = await st.preparePhaseHandoff(r.phase.id);
    const missing = audit.missingCompletionTasks.map((task) => `- T${String(task.number).padStart(3, "0")} — ${task.title}`).join("\n") || "- None";
    return text([
      `Handoff preparation audit for ${r.compositeRef}`,
      `Base handoffUpdatedAt: ${audit.handoffUpdatedAt || "(empty)"}`,
      "Done tasks missing durable completion/verification evidence:",
      missing,
      "",
      "Existing active handoff (reconcile all still-relevant content):",
      audit.handoff.trim() || "(none)",
    ].join("\n"), { phaseRef: r.compositeRef, ...audit });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return text(`❌ Handoff preparation failed: ${message}`, { error: message });
  }
});

server.registerTool("planner-handoff-clear", {
  description: "Clear/archive the entity-scoped handoff of a phase. phaseRef is required; never infer a phase automatically.",
  inputSchema: { phaseRef: z.string().min(1).describe("Exact phase ref: P00x | P00x(F00x) | UUID | title.") },
}, async ({ phaseRef }) => {
  const st = await requireStore();
  const r = await resolvePhaseForHandoff(st, phaseRef);
  if (!r.ok) return text(`❌ ${r.error}`);
  await st.clearPhaseHandoff(r.phase.id, "manual");
  return text(`✅ Cleared handoff on ${r.compositeRef} (handoffUpdatedAt preserved as audit; archived to .planner/.local/handoff-archive/).`, { phaseRef: r.compositeRef, phaseId: r.phase.id });
});

server.registerTool("planner-web", {
  description: "Manage the planner web dashboard (start/status/stop) from MCP stdio. Runs an in-process HTTP+WS server bound to LAN; it lives as long as this MCP process. plan-root comes from AGENT_PLAN_ROOT or cwd()/.planner.",
  inputSchema: {
    action: z.enum(["start", "stop", "status"]).default("status"),
  },
}, async ({ action }) => {
  if (action === "start") {
    if (webHandle) {
      return text(`planner-web already running: ${webHandle.localUrl}${webHandle.lanUrl ? ` — LAN: ${webHandle.lanUrl}` : ""} (mode: ${webHandle.mode})`);
    }
    const root = planRoot();
    const storeCheck = new PlanStore(root);
    if (!(await storeCheck.exists())) {
      return text(`planner-web start: no .planner/ found at ${root}. Run planner-init first.`);
    }
    try {
      // port: 0 → OS assigns a free port (no conflict with plan-server CLI / Pi).
      // host: 0.0.0.0 → bind LAN (reachable from other devices), like Pi /planner load.
      webHandle = await serve({ planRoot: root, host: "0.0.0.0", port: 0, quiet: true });
      return text(`planner-web started: ${webHandle.localUrl}${webHandle.lanUrl ? ` — LAN: ${webHandle.lanUrl}` : ""} (mode: ${webHandle.mode})`);
    } catch (err) {
      webHandle = null;
      return text(`planner-web start failed: ${(err as Error).message}`);
    }
  }
  if (action === "stop") {
    if (!webHandle) return text("planner-web not running.");
    const stoppedUrl = webHandle.localUrl;
    await webHandle.close().catch(() => {});
    webHandle = null;
    return text(`planner-web stopped (was ${stoppedUrl}).`);
  }
  // status
  if (webHandle) {
    return text(`planner-web running: ${webHandle.localUrl}${webHandle.lanUrl ? ` — LAN: ${webHandle.lanUrl}` : ""} (mode: ${webHandle.mode}, bindHost: ${webHandle.bindHost})`);
  }
  return text("planner-web not running. Use planner-web with action=start to start the dashboard.");
});

server.registerTool("planner-load", {
  description: "Load/refresh the planner on explicit user request (NOT automatic): starts the web dashboard on LAN and returns a consolidated recap (project state, active task, pending handoff, web URL). This is the MCP equivalent of Pi /planner load. Call it ONLY when the user runs /planner load or /planner recap (or asks to load the planner). Present the recap verbatim in that reply, including its final prominent Web UI line. A pending handoff is read-only context: NEVER call planner-handoff-show or planner-handoff-clear as part of load/recap. Archive it only when every phase task is done/canceled, when replacing it with a new handoff, or after an explicit user handoff-clear request. Do NOT start the planner/web or show the web URL unless the user explicitly asks (load/recap/web status).",
}, async () => {
  const st = store();
  if (!(await st.exists())) return text("No .planner/ found at " + planRoot() + ". Run planner-init first.");
  const web = await ensureWebStarted();
  const recap = await buildRecap(st, web, { harness: "mcp" });
  return text(recap);
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
