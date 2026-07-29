#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PlanStore, ExportService, withFeatureLock, needsMotivation, findPhaseByRef, findTaskByRef, buildRecap, migrateToGlobalSequence } from "@agent-plan/core";
import { serve } from "@agent-plan/server";
import type { ServeHandle } from "@agent-plan/server";
import { createChecklistItemId, createFeatureId, createPhaseId, createShortId, createTaskId, clampSlug, normalizeSlug, formatPhaseRef, formatFeatureRef } from "@agent-plan/core/naming";
import type { Feature, Phase, Task, StatusLogEntry } from "@agent-plan/core/schema";

const STATUS_VALUES = ["planned", "in-progress", "done", "blocked", "canceled", "rejected", "deferred", "waiting"] as const;
const PHASE_STATUS_VALUES = ["draft", "discovery", ...STATUS_VALUES] as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown> };

function text(textValue: string, structuredContent?: Record<string, unknown>): ToolResult {
  return structuredContent ? { content: [{ type: "text", text: textValue }], structuredContent } : { content: [{ type: "text", text: textValue }] };
}

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
  // One-time idempotent backfill of shortId + priority (safe, best-effort).
  if (!planBackfillDone) {
    planBackfillDone = true;
    await st.ensureShortIdsAndPriority().catch(() => {});
    await migrateToGlobalSequence(st).catch(() => {});
  }
  return st;
}

let planBackfillDone = false;

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
  return features.find((feature) => feature.id.toLowerCase() === normalized)
    ?? features.find((feature) => feature.name.toLowerCase() === normalized)
    ?? features.find((feature) => feature.name.toLowerCase().includes(normalized));
}


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
  version: "0.1.0",
});

// Resolve a phase for entity-scoped handoff tools. ref = P00x | P00x(F00x) |
// UUID | title; omitted -> current in-progress phase.
type PhaseHandoffResolve =
  | { ok: true; phase: Phase; compositeRef: string }
  | { ok: false; error: string };

async function resolvePhaseForHandoff(st: PlanStore, ref: string | undefined): Promise<PhaseHandoffResolve> {
  const phases = await st.loadAllPhases();
  const features = (await st.loadFeatures()).features;
  let phase: Phase | undefined;
  if (ref && ref.trim()) {
    phase = findPhaseByRef(phases, features, ref.trim());
  } else {
    phase = phases.find((p) => p.status === "in-progress")
      ?? phases.find((p) => p.tasks.some((t) => t.status === "in-progress"));
  }
  if (!phase) {
    return {
      ok: false,
      error: ref && ref.trim()
        ? `Phase not found: "${ref.trim()}". Use P00x, P00x(F00x), UUID, or title.`
        : "No in-progress phase. Specify a phaseRef (P00x or P00x(F00x)).",
    };
  }
  const feat = phase.featureId ? features.find((f) => f.id === phase.featureId) : undefined;
  return { ok: true, phase, compositeRef: formatPhaseRef(phase.number, feat?.number) };
}

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

  return text(`Project export generated. Summary results:\n\n${markdown.slice(0, 1000)}${markdown.length > 1000 ? "... (full report in .planner/EXPORT.md)" : ""}`, { markdown });
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
  description: "Show the current planner overview.",
}, async () => {
  const st = await requireStore();
  const plan = await st.loadAll();
  return text([
    `📋 ${plan.project.name}`,
    `Description: ${plan.project.description || "(not set)"}`,
    `Goal: ${plan.project.goal || "(not set)"}`,
    `Features: ${plan.features.features.length}`,
    `Phases: ${plan.phases.length}`,
    `Tasks: ${plan.phases.reduce((total, phase) => total + phase.tasks.length, 0)}`,
    `Updated: ${plan.manifest.updatedAt}`,
  ].join("\n"), { plan });
});

server.registerTool("planner-repair", {
  description: "Repair dangling feature→phase references, rebuild phase containment from each task's own phaseId (heals the migrateToGlobalSequence task-shuffle bug where tasks land in the wrong phase file), and report integrity.",
}, async () => {
  const st = await requireStore();
  const report = await st.repair();
  return text(`Repair done: renamed ${report.migrated.renamed}, repaired ${report.migrated.repaired} refs, inferred ${report.migrated.inferred}. Containment: ${report.containment.changed} phase files rewritten (${report.containment.tasks} tasks scanned, ${report.containment.orphan} orphan). Integrity: ${report.integrity.duplicatePhaseIds.length} duplicate, ${report.integrity.danglingPhaseIds.length} dangling.`, { report });
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
  const shortId = createShortId(await st.assignedShortIds());
  const priority = await st.nextPriority("feature");
  const feature: Feature = {
    id: createFeatureId(),
    number: await st.allocFeatureNumber(),
    shortId,
    priority,
    name: name.trim(),
    description: description?.trim() ?? "",
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
  const feature = findFeatureByRef(features, ref);
  if (!feature) return text(`Feature not found: ${ref}`);
  const phases = (await st.loadAllPhases()).filter((phase) => phase.featureId === feature.id);
    const summary = `${feature.name} — ${formatFeatureRef(feature.number)}${feature.shortId ? ` · ${feature.shortId}` : ""} (${feature.status}; ${phases.length} phases)`;
    return text(full ? `${summary}\n\n${feature.description || ""}` : summary);
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
  const feature = findFeatureByRef(features, ref);
  if (!feature) return text(`Feature not found: ${ref}`);
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
  const feature = findFeatureByRef(features, ref);
  if (!feature) return text(`Feature not found: ${ref}`);
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
  description: "Create a phase with a rich description. REQUIRED: description must include code references (file:line), current implementation state, dependencies, specific files/systems to modify, and behaviors to preserve. The description is the primary context for future agents; one-liners cause misalignment.",
  inputSchema: {
    title: z.string().min(1),
    feature: z.string().optional().describe("Feature ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."),
    summary: z.string().optional().describe("One-line summary of the phase"),
    description: z.string().min(50, "Description must be at least 50 characters — include code references (file:line), current state, structs/traits involved, concrete work items, behaviors to preserve. Prefix with 'design-only' for pre-implementation design tasks.").describe("Required code references (file:line), current state, structs/traits involved, concrete work items, behaviors to preserve. Not a one-liner."),
  },
}, async ({ title, feature: featureRef, summary, description }) => {
  const st = await requireStore();
  const featuresDoc = await st.loadFeatures();
  const feature = featureRef ? findFeatureByRef(featuresDoc.features, featureRef) : featuresDoc.features[0];
  if (featureRef && !feature) return text(`Feature not found: ${featureRef}`);
  const lockKey = feature?.id ?? "__unscoped__";
  let phase: Phase | undefined;
  await withFeatureLock(lockKey, async () => {
    const phases = await st.loadAllPhases();
    const featurePhases = feature ? phases.filter((phase) => phase.featureId === feature.id) : phases;
    const timestamp = nowISO();
    const shortId = createShortId(await st.assignedShortIds());
    const priority = await st.nextPriority("phase", feature?.id);
    phase = {
      id: createPhaseId(),
      number: await st.allocPhaseNumber(),
      shortId,
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
  description: "Show a phase by id or name.",
    inputSchema: { phase: z.string().min(1).describe("Phase ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."), full: z.boolean().optional().describe("If true, include the phase description. Default: compact identity only (saves tokens).") },
  }, async ({ phase: ref, full }) => {
  const st = await requireStore();
    const features = (await st.loadFeatures()).features;
    const phase = findPhaseByRef(await st.loadAllPhases(), features, ref);
  if (!phase) return text(`Phase not found: ${ref}`);
    const summary = `${phase.title} — ${formatPhaseRef(phase.number, featureNumberOfPhase(phase, features))}${phase.shortId ? ` · ${phase.shortId}` : ""} (${phase.status}; ${phase.tasks.length} tasks)`;
    return text(full ? `${summary}\n\n${phase.description || ""}` : summary);
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
    phase: z.string().min(1).describe("Phase ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."),
    title: z.string().min(1),
    description: z.string().min(50, "Description must be at least 50 characters — include code references (file:line), current state vs desired state, structs/traits to modify, concrete implementation steps, edge cases. Prefix with 'design-only' for pre-implementation design tasks.").describe("Required code references (file:line), current state vs desired state, structs/traits to modify, concrete implementation steps, edge cases. Not a one-liner."),
    checklist: z.array(z.string()).optional(),
  },
}, async ({ phase: ref, title, description, checklist }) => {
  const st = await requireStore();
  const found = findPhaseByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Phase not found: ${ref}`);
  const timestamp = nowISO();
  const taskId = createTaskId();
  const shortId = createShortId(await st.assignedShortIds());
  const priority = await st.nextPriority("task", found.id);
  const task: Task = {
    id: taskId,
    phaseId: found.id,
    number: await st.allocTaskNumber(),
    shortId,
    priority,
    shortName: clampSlug(title, 30, `task-${Date.now().toString(36)}`),
    title: title.trim(),
    status: "planned",
    description: description?.trim() ?? "",
    notes: "",
    statusLog: [],
    decisions: [],
    acceptedDecisions: [],
    checklist: (checklist ?? []).map((item, index) => ({ id: createChecklistItemId(taskId, index + 1, item), title: item, checked: false })),
    subtasks: [],
    dependsOn: [],
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
  const features = (await st.loadFeatures()).features;
  return writeAndSummarize(st, `✅ Task created: ${taskCompositeRef(task, found, features)} — ${task.title} (planned)${task.shortId ? ` · ${task.shortId}` : ""}`);
});

server.registerTool("planner-task-show", {
  description: "Show a task by id or name.",
    inputSchema: { task: z.string().min(1).describe("Task ref. Accepts F00x/P00x/T00x composite, bare P00x/T00x (global), 5-char shortId, UUID, or title."), full: z.boolean().optional().describe("If true, include the task description + statusLog. Default: compact identity only (saves tokens).") },
  }, async ({ task: ref, full }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
    const features = (await st.loadFeatures()).features;
    const summary = `${found.task.title} — ${taskCompositeRef(found.task, found.phase, features)}${found.task.shortId ? ` · ${found.task.shortId}` : ""} (${found.task.status}; phase ${formatPhaseRef(found.phase.number, featureNumberOfPhase(found.phase, features))})`;
    if (!full) return text(summary);
    const log = (found.task.statusLog ?? []).map((e) => `  - ${e.date.slice(0,10)} ${e.title}`).join("\n");
    return text(`${summary}\n\n${found.task.description || ""}${log ? `\n\nStatus log:\n${log}` : ""}`);
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
    if (checklist !== undefined) task.checklist = checklist.map((item, index) => ({ id: createChecklistItemId(task.id, index + 1, item), title: item, checked: false }));
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
  },
}, async ({ task: ref, title, status, description, motivation, priority }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);

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
  return writeAndSummarize(st, `✅ Task updated: ${taskCompositeRef(t, found.phase, features)} — ${t.title} (${t.status})${t.shortId ? ` · ${t.shortId}` : ""}`);
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

server.registerTool("planner-task-start", {
  description: "Set a task to in-progress.",
  inputSchema: { task: z.string().min(1) },
}, async ({ task: ref }) => {
  const st = await requireStore();

  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
  // Auto-archive the handoff on THIS task's phase (reason: task-started) — the
  // agent is now actively working, so the captured context is consumed. Other
  // phases' handoffs are left untouched (informational, non-blocking).
  const allHandoffs = await st.listHandoffs();
  let handoffNotice = "";
  if ((found.phase.handoff ?? "") !== "") {
    await st.clearPhaseHandoff(found.phase.id, "task-started").catch(() => {});
    handoffNotice = "📦 Archived handoff for this phase (task started) — recover via planner-handoff-list + .planner/handoff-archive/.\n";
  }
  const _otherHandoffs = allHandoffs.filter((h) => h.phaseId !== found.phase.id);
  if (_otherHandoffs.length > 0) {
    handoffNotice += `ℹ️  ${_otherHandoffs.length} other phase handoff(s) pending — review with planner-handoff-list if relevant.\n`;
  }
  const timestamp = nowISO();

  let updatedTask: Task | undefined;
  await st.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) return phase;
    applyTaskLifecycleDates(task, "in-progress", timestamp);
    if (task.status !== "in-progress") {
      const entry: StatusLogEntry = {
        id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${task.status}-in-progress`),
        date: timestamp,
        fromStatus: task.status as any,
        toStatus: "in-progress" as any,
        title: task.status === "done" ? "Reopened" : `→ in-progress`,
        description: task.status === "done" ? "Task reopened from done status." : "",
      };
      task.statusLog = [...(task.statusLog ?? []), entry];
    }
    task.updatedAt = timestamp;
    phase.updatedAt = timestamp;
    updatedTask = task;
    return phase;
  });
  await st.syncTaskStatusRollup(found.phase.id);
  const features = (await st.loadFeatures()).features;
  const t = updatedTask ?? found.task;
  return writeAndSummarize(st, `${handoffNotice}✅ Task started: ${taskCompositeRef(t, found.phase, features)} — ${t.title} (in-progress)${t.shortId ? ` · ${t.shortId}` : ""}`);
});

server.registerTool("planner-task-complete", {
  description: "Set a task to done. Fails if checklist is incomplete unless force=true.",
  inputSchema: {
    task: z.string().min(1),
    force: z.boolean().optional(),
    description_update: z.string().min(10).optional().describe("Post-hoc summary of what was done: commit hash(s), files touched, decisions made, updated code references with new line numbers. Keeps the planner alive and traceable."),
  },
}, async ({ task: ref, force, description_update }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), (await st.loadFeatures()).features, ref);
  if (!found) return text(`Task not found: ${ref}`);
  const unchecked = found.task.checklist.filter((item) => !item.checked);
  if (unchecked.length > 0 && !force) return text(`${unchecked.length} checklist item(s) not done. Re-run with force=true to complete anyway.`);
  const timestamp = nowISO();
  let updatedTask: Task | undefined;
  await st.updatePhase(found.phase.id, (phase) => {
    const task = phase.tasks.find((entry) => entry.id === found.task.id);
    if (!task) return phase;
    applyTaskLifecycleDates(task, "done", timestamp);
    if (task.status !== "done") {
      const entry: StatusLogEntry = {
        id: createChecklistItemId(task.id, (task.statusLog?.length ?? 0) + 1, `${task.status}-done`),
        date: timestamp,
        fromStatus: task.status as any,
        toStatus: "done" as any,
        title: `→ done`,
        description: "",
      };
      task.statusLog = [...(task.statusLog ?? []), entry];
    }
    if (description_update) {
      const sep = task.description ? "\n\n---\n**Completion summary:**\n" : "**Completion summary:**\n";
      task.description = task.description + sep + description_update;
    }
    task.updatedAt = timestamp;
    phase.updatedAt = timestamp;
    updatedTask = task;
    return phase;
  });
  const clearedRef = await st.syncTaskStatusRollup(found.phase.id);
  const features = (await st.loadFeatures()).features;
  const t = updatedTask ?? found.task;
  return writeAndSummarize(st, `✅ Task completed: ${taskCompositeRef(t, found.phase, features)} — ${t.title} (done)${t.shortId ? ` · ${t.shortId}` : ""}${clearedRef ? ` — phase handoff auto-cleared (${clearedRef})` : ""}`);
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
  description: "Read the entity-scoped handoff of a phase. phaseRef accepts P00x, P00x(F00x), UUID, or title. Omit to target the current in-progress phase.",
  inputSchema: { phaseRef: z.string().optional().describe("Phase ref: P00x | P00x(F00x) | UUID | title. Default: current in-progress phase.") },
}, async ({ phaseRef }) => {
  const st = await requireStore();
  const r = await resolvePhaseForHandoff(st, phaseRef);
  if (!r.ok) return text(`❌ ${r.error}`);
  const content = await st.getPhaseHandoff(r.phase.id);
  if (!content.trim()) return text(`No handoff set on ${r.compositeRef}.`, { phaseRef: r.compositeRef, empty: true });
  return text(`Handoff for ${r.compositeRef}:\n\n${content}`, { phaseRef: r.compositeRef, phaseId: r.phase.id });
});

server.registerTool("planner-handoff-write", {
  description: "Write/refresh the entity-scoped handoff on a phase. Pass content (markdown). phaseRef optional (default: current in-progress phase). Captures design context for a resuming agent on that phase.",
  inputSchema: {
    phaseRef: z.string().optional().describe("Phase ref. Default: current in-progress phase."),
    content: z.string().min(1).describe("Handoff text (markdown)."),
  },
}, async ({ phaseRef, content }) => {
  const st = await requireStore();
  const r = await resolvePhaseForHandoff(st, phaseRef);
  if (!r.ok) return text(`❌ ${r.error}`);
  await st.setPhaseHandoff(r.phase.id, content);
  return text(`✅ Wrote handoff on ${r.compositeRef}.`, { phaseRef: r.compositeRef, phaseId: r.phase.id });
});

server.registerTool("planner-handoff-prepare", {
  description: "Return instructions for the agent to prepare a canonical handoff, then call planner-handoff-write (entity-scoped, phase.handoff).",
}, async () => text([
  "Prepare the canonical session handoff and write it on the current in-progress phase with planner-handoff-write (omit phaseRef to target the in-progress phase).",
  "Required sections: Created at, Updated at, Reason, Current focus, What was being done, How to resume, Files touched, Blockers, Next steps, Recent decisions, Reminder.",
  "Stored on the phase.handoff field (entity-scoped). .planner/HANDOFF.md is deprecated.",
].join("\n")));

server.registerTool("planner-handoff-clear", {
  description: "Clear the entity-scoped handoff of a phase (sets handoff to empty, keeps handoffUpdatedAt as an audit trail). phaseRef optional (default: current in-progress phase).",
  inputSchema: { phaseRef: z.string().optional().describe("Phase ref. Default: current in-progress phase.") },
}, async ({ phaseRef }) => {
  const st = await requireStore();
  const r = await resolvePhaseForHandoff(st, phaseRef);
  if (!r.ok) return text(`❌ ${r.error}`);
  await st.clearPhaseHandoff(r.phase.id, "manual");
  return text(`✅ Cleared handoff on ${r.compositeRef} (handoffUpdatedAt preserved as audit; archived to .planner/handoff-archive/).`, { phaseRef: r.compositeRef, phaseId: r.phase.id });
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
  description: "Load/refresh the planner on explicit user request (NOT automatic): starts the web dashboard on LAN and returns a consolidated recap (project state, active task, pending handoff, web URL). This is the MCP equivalent of Pi /planner load. Call it ONLY when the user runs /planner load or /planner recap (or asks to load the planner). Present the recap to the user in that reply, including the web URL on a final prominent line. If a pending handoff is included, read it, summarize it to the user, then call planner-handoff-clear. Do NOT start the planner/web or show the web URL unless the user explicitly asks (load/recap/web status).",
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
