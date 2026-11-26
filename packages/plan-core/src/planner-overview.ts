import type { PlannerListSource } from "./list-flow.js";
import type { Project } from "./schema.js";
import { formatFeatureRef, taskCompositeRef } from "./naming.js";
import { buildBoundedAcceptedDecisionContext } from "./task-context.js";
import { boundedOpenPhaseWork, listOpenPhaseWork, openPhaseWorkLines } from "./stranded-phase.js";

/** Bounded planner overview with an explicit active-task state. */
export interface PlannerOverviewSource extends PlannerListSource {
  loadProject(): Promise<Pick<Project, "name" | "description" | "descriptionRef" | "goal" | "acceptedDecisions">>;
  loadManifest(): Promise<{ updatedAt: string }>;
}

export async function readPlannerOverview(st: PlannerOverviewSource) {
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
  return { summary, overview };
}
