import type { Feature, Phase, Task } from "./schema.js";

export const COMPLETION_SUMMARY_HEADING = "**Completion summary:**";

export interface HandoffTaskContextUpdate {
  taskId: string;
  completionSummary: string;
  verification: string;
  remainingWork: string;
  filesTouched?: string[];
  decisions?: string[];
}

export interface HandoffPhaseContextUpdate {
  progressSummary: string;
  remainingWork: string;
  decisions?: string[];
}

export interface HandoffFeatureContextUpdate {
  workDone: string;
  workRemaining: string;
}

export interface PhaseHandoffContextSync {
  taskUpdates: HandoffTaskContextUpdate[];
  phaseUpdate?: HandoffPhaseContextUpdate;
  phaseNoUpdateReason?: string;
  featureUpdate?: HandoffFeatureContextUpdate;
  featureNoUpdateReason?: string;
}

export interface PhaseHandoffAudit {
  phaseId: string;
  featureId: string;
  handoff: string;
  handoffUpdatedAt: string;
  missingCompletionTaskIds: string[];
  missingCompletionTasks: Array<{ id: string; number: number; title: string }>;
}

export interface RefreshPhaseHandoffInput {
  content: string;
  expectedHandoffUpdatedAt: string;
  reconciledExistingHandoff: boolean;
  contextSync: PhaseHandoffContextSync;
}

export interface RefreshPhaseHandoffResult {
  phase: Phase;
  feature: Feature;
  updatedTaskIds: string[];
  handoffUpdatedAt: string;
}

export function hasTaskCompletionEvidence(task: Task): boolean {
  if (task.status !== "done") return true;
  if (task.description.includes(COMPLETION_SUMMARY_HEADING)) return true;
  return task.statusLog.some((entry) => entry.toStatus === "done" && entry.description.trim().length > 0);
}

export function auditPhaseHandoff(phase: Phase, feature: Feature): PhaseHandoffAudit {
  const missingCompletionTasks = phase.tasks
    .filter((task) => task.status === "done" && !hasTaskCompletionEvidence(task))
    .map((task) => ({ id: task.id, number: task.number, title: task.title }));
  return {
    phaseId: phase.id,
    featureId: feature.id,
    handoff: phase.handoff,
    handoffUpdatedAt: phase.handoffUpdatedAt,
    missingCompletionTaskIds: missingCompletionTasks.map((task) => task.id),
    missingCompletionTasks,
  };
}

function nonEmpty(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function appendSection(existing: string, section: string): string {
  const normalized = section.trim();
  if (!normalized || existing.includes(normalized)) return existing;
  return existing.trim() ? `${existing.trim()}\n\n---\n${normalized}` : normalized;
}

export function validateCanonicalHandoffContent(content: string): void {
  const body = nonEmpty(content, "Handoff content");
  const required = [
    { label: "Created at", pattern: /^Created at:\s*\S+/im },
    { label: "Updated at", pattern: /^Updated at:\s*\S+/im },
    { label: "Reason", pattern: /^Reason:\s*\S+/im },
    { label: "Current focus", pattern: /^##\s+Current focus\s*$/im },
    { label: "What was being done", pattern: /^##\s+What was being done\s*$/im },
    { label: "How to resume", pattern: /^##\s+How to resume\s*$/im },
    { label: "Files touched", pattern: /^##\s+Files touched\s*$/im },
    { label: "Blockers", pattern: /^##\s+Blockers\s*$/im },
    { label: "Next steps", pattern: /^##\s+Next steps\s*$/im },
    { label: "Recent decisions", pattern: /^##\s+Recent decisions\s*$/im },
  ];
  const missing = required.filter((entry) => !entry.pattern.test(body)).map((entry) => entry.label);
  if (missing.length > 0) throw new Error(`Canonical handoff is missing required sections: ${missing.join(", ")}.`);
}

export function validateHandoffContextSync(
  phase: Phase,
  feature: Feature,
  input: RefreshPhaseHandoffInput,
): void {
  validateCanonicalHandoffContent(input.content);
  if (phase.status === "done" || phase.status === "canceled") {
    throw new Error(`Cannot write a handoff on ${phase.status} phase ${phase.id}; completed phases have no pending handoff.`);
  }
  if (phase.handoffUpdatedAt !== input.expectedHandoffUpdatedAt) {
    throw new Error("Handoff changed after preparation. Run handoff_prepare again and reconcile the latest content before writing.");
  }
  if (phase.handoff.trim() && !input.reconciledExistingHandoff) {
    throw new Error("An active handoff already exists. Reconcile its still-relevant content and set reconciledExistingHandoff=true.");
  }

  const sync = input.contextSync;
  const taskIds = sync.taskUpdates.map((update) => nonEmpty(update.taskId, "Task update taskId"));
  if (new Set(taskIds).size !== taskIds.length) throw new Error("Each task may appear only once in handoff context updates.");
  const phaseTaskIds = new Set(phase.tasks.map((task) => task.id));
  for (const taskId of taskIds) {
    if (!phaseTaskIds.has(taskId)) throw new Error(`Task ${taskId} does not belong to phase ${phase.id}.`);
  }
  for (const update of sync.taskUpdates) {
    nonEmpty(update.completionSummary, `Task ${update.taskId} completionSummary`);
    nonEmpty(update.verification, `Task ${update.taskId} verification`);
    nonEmpty(update.remainingWork, `Task ${update.taskId} remainingWork`);
  }

  const audit = auditPhaseHandoff(phase, feature);
  const covered = new Set(taskIds);
  const uncovered = audit.missingCompletionTaskIds.filter((taskId) => !covered.has(taskId));
  if (uncovered.length > 0) {
    throw new Error(`Done tasks are missing durable completion evidence: ${uncovered.join(", ")}. Include context updates for every listed task.`);
  }

  if (sync.phaseUpdate) {
    nonEmpty(sync.phaseUpdate.progressSummary, "Phase progressSummary");
    nonEmpty(sync.phaseUpdate.remainingWork, "Phase remainingWork");
  } else {
    nonEmpty(sync.phaseNoUpdateReason, "phaseNoUpdateReason");
  }
  if (sync.featureUpdate) {
    nonEmpty(sync.featureUpdate.workDone, "Feature workDone");
    nonEmpty(sync.featureUpdate.workRemaining, "Feature workRemaining");
  } else {
    nonEmpty(sync.featureNoUpdateReason, "featureNoUpdateReason");
  }
}

export function applyHandoffContextSync(
  phase: Phase,
  feature: Feature,
  input: RefreshPhaseHandoffInput,
  timestamp: string,
): { phase: Phase; feature: Feature; updatedTaskIds: string[] } {
  validateHandoffContextSync(phase, feature, input);
  const nextPhase = structuredClone(phase);
  const nextFeature = structuredClone(feature);
  const updatedTaskIds: string[] = [];

  for (const update of input.contextSync.taskUpdates) {
    const task = nextPhase.tasks.find((candidate) => candidate.id === update.taskId)!;
    const files = uniqueStrings(update.filesTouched ?? []);
    const decisions = uniqueStrings(update.decisions ?? []);
    const section = [
      COMPLETION_SUMMARY_HEADING,
      update.completionSummary.trim(),
      "",
      "**Verification:**",
      update.verification.trim(),
      "",
      "**Remaining or unverified:**",
      update.remainingWork.trim(),
      ...(files.length > 0 ? ["", "**Files touched:**", ...files.map((file) => `- ${file}`)] : []),
    ].join("\n");
    task.description = appendSection(task.description, section);
    task.descriptionUpdatedAt = timestamp;
    task.decisions = uniqueStrings([...(task.decisions ?? []), ...decisions]);
    task.updatedAt = timestamp;
    updatedTaskIds.push(task.id);
  }

  const phaseUpdate = input.contextSync.phaseUpdate;
  if (phaseUpdate) {
    const section = [
      "**Handoff context update:**",
      phaseUpdate.progressSummary.trim(),
      "",
      "**Remaining work:**",
      phaseUpdate.remainingWork.trim(),
    ].join("\n");
    nextPhase.notes = appendSection(nextPhase.notes, section);
    nextPhase.decisions = uniqueStrings([...(nextPhase.decisions ?? []), ...(phaseUpdate.decisions ?? [])]);
  }

  const featureUpdate = input.contextSync.featureUpdate;
  if (featureUpdate) {
    nextFeature.workDone = appendSection(nextFeature.workDone, featureUpdate.workDone);
    nextFeature.workRemaining = appendSection(nextFeature.workRemaining, featureUpdate.workRemaining);
  }

  nextPhase.handoff = input.content.trim();
  nextPhase.handoffUpdatedAt = timestamp;
  nextPhase.handoffReadAt = "";
  nextPhase.updatedAt = timestamp;
  nextFeature.updatedAt = timestamp;
  return { phase: nextPhase, feature: nextFeature, updatedTaskIds };
}
