#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PlanStore, ExportService, withFeatureLock, needsMotivation } from "@agent-plan/core";
import { createChecklistItemId, createFeatureId, createPhaseId, createTaskId, normalizeSlug } from "@agent-plan/core/naming";
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
  return st;
}

function findFeatureByRef(features: Feature[], ref: string): Feature | undefined {
  const normalized = ref.trim().toLowerCase();
  return features.find((feature) => feature.id.toLowerCase() === normalized)
    ?? features.find((feature) => feature.name.toLowerCase() === normalized)
    ?? features.find((feature) => feature.name.toLowerCase().includes(normalized));
}

function findPhaseByRef(phases: Phase[], ref: string): Phase | undefined {
  const normalized = ref.trim().toLowerCase();
  return phases.find((phase) => phase.id.toLowerCase() === normalized)
    ?? phases.find((phase) => phase.title.toLowerCase() === normalized)
    ?? phases.find((phase) => phase.title.toLowerCase().includes(normalized));
}

function findTaskByRef(phases: Phase[], ref: string): { phase: Phase; task: Task } | undefined {
  const normalized = ref.trim().toLowerCase();
  for (const phase of phases) {
    const task = phase.tasks.find((entry) => entry.id.toLowerCase() === normalized
      || entry.title.toLowerCase() === normalized
      || entry.title.toLowerCase().includes(normalized));
    if (task) return { phase, task };
  }
  return undefined;
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
  return writeAndSummarize(st, `.planner/ initialized for "${project.name}"`, { project });
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
  description: "Repair dangling feature→phase references and report integrity.",
}, async () => {
  const st = await requireStore();
  const report = await st.repair();
  return text(`Repair done: renamed ${report.migrated.renamed}, repaired ${report.migrated.repaired} refs, inferred ${report.migrated.inferred}. Integrity: ${report.integrity.duplicatePhaseIds.length} duplicate, ${report.integrity.danglingPhaseIds.length} dangling.`, { report });
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
  return writeAndSummarize(st, `Saved language preferences: content=${project.contentLanguage || "(unset)"}, chat=${project.chatLanguage || "(unset)"}`, { project });
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
  return writeAndSummarize(st, `Project discussed/updated: ${project.name}`, { project });
});

server.registerTool("planner-feature-list", {
  description: "List features with phase/task counts.",
}, async () => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const phases = await st.loadAllPhases();
  const lines = features.map((feature) => {
    const featurePhases = phases.filter((phase) => phase.featureId === feature.id);
    const taskCount = featurePhases.reduce((total, phase) => total + phase.tasks.length, 0);
    return `- ${feature.id} — ${feature.name} (${feature.status}; ${featurePhases.length} phases, ${taskCount} tasks)`;
  });
  return text(lines.join("\n") || "No features", { features });
});

server.registerTool("planner-feature-add", {
  description: "Create a feature.",
  inputSchema: {
    name: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(STATUS_VALUES).optional(),
  },
}, async ({ name, description, status }) => {
  const st = await requireStore();
  const timestamp = nowISO();
  const effectiveStatus = status ?? "planned";
  const existingFeatures = (await st.loadFeatures()).features;
  const feature: Feature = {
    id: createFeatureId(),
    number: existingFeatures.length + 1,
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await st.updateFeatures((doc) => {
    doc.features.push(feature);
    return doc;
  });
  return writeAndSummarize(st, `Feature created: ${feature.id} — ${feature.name}`, { feature });
});

server.registerTool("planner-feature-show", {
  description: "Show a feature by id or name.",
  inputSchema: { feature: z.string().min(1).describe("Feature id or name") },
}, async ({ feature: ref }) => {
  const st = await requireStore();
  const features = (await st.loadFeatures()).features;
  const feature = findFeatureByRef(features, ref);
  if (!feature) return text(`Feature not found: ${ref}`);
  const phases = (await st.loadAllPhases()).filter((phase) => phase.featureId === feature.id);
  return text(`${feature.name} (${feature.id}) — ${feature.status}; ${phases.length} phases`, { feature, phases });
});

server.registerTool("planner-feature-update", {
  description: "Update a feature.",
  inputSchema: {
    feature: z.string().min(1).describe("Feature id or name"),
    name: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(STATUS_VALUES).optional(),
    workDone: z.string().optional(),
    workRemaining: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
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
    target.updatedAt = nowISO();
    return doc;
  });
  const result = updated.features.find((entry) => entry.id === feature.id)!;
  return writeAndSummarize(st, `Feature updated: ${result.id} — ${result.name}`, { feature: result });
});

server.registerTool("planner-feature-delete", {
  description: "Delete a feature. By default, phases are unlinked rather than deleted.",
  inputSchema: {
    feature: z.string().min(1).describe("Feature id or name"),
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
  description: "Create a phase, optionally attached to a feature.",
  inputSchema: {
    title: z.string().min(1),
    feature: z.string().optional().describe("Feature id or name"),
    summary: z.string().optional(),
    description: z.string().optional(),
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
    phase = {
      id: createPhaseId(),
      number: featurePhases.reduce((max, entry) => Math.max(max, entry.number), 0) + 1,
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
  return writeAndSummarize(st, `Phase created: ${phase.id} — ${phase.title}`, { phase });
});

server.registerTool("planner-phase-show", {
  description: "Show a phase by id or name.",
  inputSchema: { phase: z.string().min(1).describe("Phase id or name") },
}, async ({ phase: ref }) => {
  const st = await requireStore();
  const phase = findPhaseByRef(await st.loadAllPhases(), ref);
  if (!phase) return text(`Phase not found: ${ref}`);
  return text(`${phase.title} (${phase.id}) — ${phase.status}; ${phase.tasks.length} tasks`, { phase });
});

server.registerTool("planner-phase-discuss", {
  description: "Persist phase discovery fields and mark phase planned.",
  inputSchema: {
    phase: z.string().min(1).describe("Phase id or name"),
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
  const found = findPhaseByRef(await st.loadAllPhases(), ref);
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
  return writeAndSummarize(st, `Phase discussed/planned: ${phase.id} — ${phase.title}`, { phase });
});

server.registerTool("planner-phase-update", {
  description: "Update phase fields.",
  inputSchema: {
    phase: z.string().min(1),
    title: z.string().optional(),
    status: z.enum(PHASE_STATUS_VALUES).optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
  },
}, async ({ phase: ref, ...updates }) => {
  const st = await requireStore();
  const found = findPhaseByRef(await st.loadAllPhases(), ref);
  if (!found) return text(`Phase not found: ${ref}`);
  const phase = await st.updatePhase(found.id, (entry) => {
    if (updates.title !== undefined) entry.title = updates.title.trim();
    if (updates.status !== undefined) entry.status = updates.status;
    if (updates.summary !== undefined) entry.summary = updates.summary.trim();
    if (updates.description !== undefined) entry.description = updates.description.trim();
    entry.updatedAt = nowISO();
    return entry;
  });
  return writeAndSummarize(st, `Phase updated: ${phase.id} — ${phase.title}`, { phase });
});

server.registerTool("planner-phase-delete", {
  description: "Delete a phase and unlink it from features.",
  inputSchema: { phase: z.string().min(1) },
}, async ({ phase: ref }) => {
  const st = await requireStore();
  const phase = findPhaseByRef(await st.loadAllPhases(), ref);
  if (!phase) return text(`Phase not found: ${ref}`);
  await st.deletePhase(phase.id);
  await st.updateFeatures((doc) => {
    for (const feature of doc.features) feature.phaseIds = feature.phaseIds.filter((id) => id !== phase.id);
    return doc;
  });
  return writeAndSummarize(st, `Phase deleted: ${phase.id}`, { deleted: phase.id });
});

server.registerTool("planner-task-add", {
  description: "Create a task in a phase.",
  inputSchema: {
    phase: z.string().min(1).describe("Phase id or name"),
    title: z.string().min(1),
    description: z.string().optional(),
    checklist: z.array(z.string()).optional(),
  },
}, async ({ phase: ref, title, description, checklist }) => {
  const st = await requireStore();
  const found = findPhaseByRef(await st.loadAllPhases(), ref);
  if (!found) return text(`Phase not found: ${ref}`);
  const timestamp = nowISO();
  const taskId = createTaskId();
  const task: Task = {
    id: taskId,
    phaseId: found.id,
    number: found.tasks.length + 1,
    shortName: normalizeSlug(title).slice(0, 30),
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
  const phase = await st.updatePhase(found.id, (entry) => {
    entry.tasks.push(task);
    entry.taskIds.push(task.id);
    entry.updatedAt = timestamp;
    return entry;
  });
  return writeAndSummarize(st, `Task created: ${task.id} — ${task.title}`, { task, phase });
});

server.registerTool("planner-task-show", {
  description: "Show a task by id or name.",
  inputSchema: { task: z.string().min(1).describe("Task id or name") },
}, async ({ task: ref }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), ref);
  if (!found) return text(`Task not found: ${ref}`);
  return text(`${found.task.title} (${found.task.id}) — ${found.task.status}; phase ${found.phase.id}`, { task: found.task, phase: found.phase });
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
  const found = findTaskByRef(await st.loadAllPhases(), ref);
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
  return writeAndSummarize(st, `Task discussed/updated: ${found.task.id}`, { task: updatedTask ?? found.task });
});

server.registerTool("planner-task-update", {
  description: "Update task fields. A motivation is REQUIRED when changing to blocked, canceled, deferred, rejected, waiting, or back to planned from another status.",
  inputSchema: {
    task: z.string().min(1),
    title: z.string().optional(),
    status: z.enum(STATUS_VALUES).optional(),
    description: z.string().optional(),
    motivation: z.string().optional(),
  },
}, async ({ task: ref, title, status, description, motivation }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), ref);
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
  return writeAndSummarize(st, `Task updated: ${found.task.id}`, { task: updatedTask ?? found.task });
});

server.registerTool("planner-task-delete", {
  description: "Delete a task.",
  inputSchema: { task: z.string().min(1) },
}, async ({ task: ref }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), ref);
  if (!found) return text(`Task not found: ${ref}`);
  await st.updatePhase(found.phase.id, (phase) => {
    phase.tasks = phase.tasks.filter((task) => task.id !== found.task.id);
    phase.taskIds = phase.taskIds.filter((id) => id !== found.task.id);
    phase.updatedAt = nowISO();
    return phase;
  });
  await st.syncTaskStatusRollup(found.phase.id);
  return writeAndSummarize(st, `Task deleted: ${found.task.id}`, { deleted: found.task.id });
});

server.registerTool("planner-task-start", {
  description: "Set a task to in-progress.",
  inputSchema: { task: z.string().min(1) },
}, async ({ task: ref }) => {
  const st = await requireStore();

  // Hygiene Gate: block starting work if a pending handoff exists.
  if (existsSync(join(st.root, "HANDOFF.md"))) {
    return text(
      `🚨 HYGIENE VIOLATION: A pending handoff file exists at .planner/HANDOFF.md. ` +
      `You MUST read and delete it before you can officially start a task. ` +
      `This is a non-negotiable rule in AGENTS.md.`
    );
  }

  const found = findTaskByRef(await st.loadAllPhases(), ref);
  if (!found) return text(`Task not found: ${ref}`);
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
  return writeAndSummarize(st, `✅ Task started: ${found.task.id}`, { task: updatedTask ?? found.task });
});

server.registerTool("planner-task-complete", {
  description: "Set a task to done. Fails if checklist is incomplete unless force=true.",
  inputSchema: {
    task: z.string().min(1),
    force: z.boolean().optional(),
  },
}, async ({ task: ref, force }) => {
  const st = await requireStore();
  const found = findTaskByRef(await st.loadAllPhases(), ref);
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
    task.updatedAt = timestamp;
    phase.updatedAt = timestamp;
    updatedTask = task;
    return phase;
  });
  await st.syncTaskStatusRollup(found.phase.id);
  return writeAndSummarize(st, `✅ Task completed: ${found.task.id}`, { task: updatedTask ?? found.task });
});

server.registerTool("planner-handoff-show", {
  description: "Show .planner/HANDOFF.md if present.",
}, async () => {
  const st = await requireStore();
  const handoff = await st.loadHandoff();
  return text(handoff?.content ?? "No .planner/HANDOFF.md present.", { handoff: handoff ?? null });
});

server.registerTool("planner-handoff-write", {
  description: "Write .planner/HANDOFF.md content.",
  inputSchema: {
    content: z.string().min(1),
    reason: z.string().optional(),
  },
}, async ({ content, reason }) => {
  const st = await requireStore();
  const finalContent = reason && !content.includes("Reason:") ? `Reason: ${reason}\n\n${content}` : content;
  await st.saveHandoff(finalContent);
  return text("Wrote .planner/HANDOFF.md");
});

server.registerTool("planner-handoff-prepare", {
  description: "Return instructions for the agent to prepare a canonical handoff, then call planner-handoff-write.",
}, async () => text([
  "Prepare the canonical session handoff and write it with planner-handoff-write.",
  "Required sections: Created at, Updated at, Reason, Current focus, What was being done, How to resume, Files touched, Blockers, Next steps, Recent decisions, Reminder.",
  "Canonical path: .planner/HANDOFF.md.",
].join("\n")));

server.registerTool("planner-handoff-clear", {
  description: "Delete .planner/HANDOFF.md.",
}, async () => {
  const st = await requireStore();
  await st.deleteHandoff();
  return text("Deleted .planner/HANDOFF.md");
});

server.registerTool("planner-web", {
  description: "Planner web command placeholder for MCP stdio. Use plan-server CLI directly for now.",
  inputSchema: {
    action: z.enum(["start", "stop", "status"]).default("status"),
  },
}, async ({ action }) => text(`planner-web ${action}: MCP stdio package does not manage the web server yet. Use \`pnpm --filter @agent-plan/server build\` and the plan-server CLI, or Pi /planner web ${action}.`));

server.registerTool("planner-load", {
  description: "MCP no-op equivalent of Pi /planner load. MCP server is already loaded when tools are available.",
}, async () => text("Planner MCP server is loaded."));

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
