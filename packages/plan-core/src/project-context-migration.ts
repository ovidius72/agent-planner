import { createHash } from "node:crypto";
import type { AcceptedDecision, Project, WorkflowRules } from "./schema.js";

export const LEGACY_PROJECT_CONTEXT_MIGRATION_VERSION = 1;

export type LegacyGuidelineSource =
  | "global-rules"
  | "before-phase-start"
  | "before-task-start"
  | "after-phase-complete";

export interface LegacyGuidelineAddition {
  source: LegacyGuidelineSource;
  text: string;
}

export type LegacyDecisionAddition = Omit<AcceptedDecision, "acceptedAt">;

export interface LegacyProjectContextMigrationPreview {
  version: number;
  hasLegacyContext: boolean;
  guidelinesChanged: boolean;
  acceptedDecisionsChanged: boolean;
  guidelineAdditions: LegacyGuidelineAddition[];
  acceptedDecisionAdditions: LegacyDecisionAddition[];
  skippedGuidelineDuplicates: number;
  skippedDecisionDuplicates: number;
  resultingGuidelinesContent: string;
  legacyCounts: {
    globalRules: number;
    workflowRules: number;
    decisions: number;
  };
  fieldsClearedOnApply: Array<"globalRules" | "workflowRules" | "decisions">;
}

export interface LegacyProjectContextMigrationResult {
  applied: boolean;
  preview: LegacyProjectContextMigrationPreview;
  project: Project;
}

export interface PlannerSessionPreparationResult {
  changed: boolean;
  project: Project;
  legacyProjectContext: {
    migrated: boolean;
    version: number;
    guidelinesAdded: number;
    acceptedDecisionsAdded: number;
    duplicatesSkipped: number;
    clearedFields: Array<"globalRules" | "workflowRules" | "decisions">;
    summary: string;
  };
}

export function plannerSessionPreparationResult(
  result: LegacyProjectContextMigrationResult,
): PlannerSessionPreparationResult {
  const guidelinesAdded = result.preview.guidelineAdditions.length;
  const acceptedDecisionsAdded = result.preview.acceptedDecisionAdditions.length;
  const duplicatesSkipped = result.preview.skippedGuidelineDuplicates + result.preview.skippedDecisionDuplicates;
  const summary = result.applied
    ? `Migrated legacy project context: ${guidelinesAdded} guideline${guidelinesAdded === 1 ? "" : "s"}, ${acceptedDecisionsAdded} accepted decision${acceptedDecisionsAdded === 1 ? "" : "s"}, ${duplicatesSkipped} duplicate${duplicatesSkipped === 1 ? "" : "s"} skipped.`
    : "Legacy project context is already canonical; no migration was needed.";
  return {
    changed: result.applied,
    project: result.project,
    legacyProjectContext: {
      migrated: result.applied,
      version: result.preview.version,
      guidelinesAdded,
      acceptedDecisionsAdded,
      duplicatesSkipped,
      clearedFields: result.preview.fieldsClearedOnApply,
      summary,
    },
  };
}

const SOURCE_LABELS: Record<LegacyGuidelineSource, string> = {
  "global-rules": "Global rules",
  "before-phase-start": "Before phase start",
  "before-task-start": "Before task start",
  "after-phase-complete": "After phase complete",
};

function normalizeComparable(value: string): string {
  return value
    .trim()
    .replace(/^[\s#>*+-]+/, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function guidelineKeys(content: string): Set<string> {
  return new Set(content
    .split(/\r?\n/)
    .map(normalizeComparable)
    .filter(Boolean));
}

function workflowEntries(workflowRules: WorkflowRules): LegacyGuidelineAddition[] {
  return [
    ...workflowRules.beforePhaseStart.map((text) => ({ source: "before-phase-start" as const, text })),
    ...workflowRules.beforeTaskStart.map((text) => ({ source: "before-task-start" as const, text })),
    ...workflowRules.afterPhaseComplete.map((text) => ({ source: "after-phase-complete" as const, text })),
  ];
}

function renderGuidelineAdditions(existing: string, additions: LegacyGuidelineAddition[]): string {
  if (additions.length === 0) return existing.trim();
  const lines = ["## Migrated legacy project rules", ""];
  for (const source of Object.keys(SOURCE_LABELS) as LegacyGuidelineSource[]) {
    const entries = additions.filter((entry) => entry.source === source);
    if (entries.length === 0) continue;
    lines.push(`### ${SOURCE_LABELS[source]}`, ...entries.map((entry) => `- ${entry.text}`), "");
  }
  const rendered = lines.join("\n").trim();
  return existing.trim() ? `${existing.trim()}\n\n${rendered}` : rendered;
}

function decisionKey(value: Pick<AcceptedDecision, "title" | "decision"> | string): string {
  if (typeof value === "string") return normalizeComparable(value);
  return normalizeComparable(value.decision || value.title);
}

function legacyDecisionId(decision: string): string {
  return `legacy-project-decision-${createHash("sha256").update(decisionKey(decision), "utf8").digest("hex").slice(0, 16)}`;
}

function legacyDecisionTitle(decision: string): string {
  const firstLine = decision.trim().split(/\r?\n/, 1)[0] ?? decision.trim();
  return firstLine.length <= 100 ? firstLine : `${firstLine.slice(0, 97).trimEnd()}...`;
}

export function previewLegacyProjectContextMigration(project: Project): LegacyProjectContextMigrationPreview {
  const legacyGuidelines: LegacyGuidelineAddition[] = [
    ...project.globalRules.map((text) => ({ source: "global-rules" as const, text })),
    ...workflowEntries(project.workflowRules),
  ];
  const existingGuidelines = guidelineKeys(project.projectGuidelines.content);
  const seenGuidelines = new Set(existingGuidelines);
  const guidelineAdditions: LegacyGuidelineAddition[] = [];
  let skippedGuidelineDuplicates = 0;
  for (const entry of legacyGuidelines) {
    const text = entry.text.trim();
    const key = normalizeComparable(text);
    if (!key || seenGuidelines.has(key)) {
      skippedGuidelineDuplicates += 1;
      continue;
    }
    seenGuidelines.add(key);
    guidelineAdditions.push({ ...entry, text });
  }

  const seenDecisions = new Set(project.acceptedDecisions.map(decisionKey));
  const acceptedDecisionAdditions: LegacyDecisionAddition[] = [];
  let skippedDecisionDuplicates = 0;
  for (const legacyDecision of project.decisions) {
    const decision = legacyDecision.trim();
    const key = decisionKey(decision);
    if (!key || seenDecisions.has(key)) {
      skippedDecisionDuplicates += 1;
      continue;
    }
    seenDecisions.add(key);
    acceptedDecisionAdditions.push({
      id: legacyDecisionId(decision),
      title: legacyDecisionTitle(decision),
      decision,
      rationale: "Migrated from the legacy project decisions collection.",
      implementationNotes: "Review and enrich this structured decision when additional rationale or implementation detail is available.",
    });
  }

  const workflowRuleCount = project.workflowRules.beforePhaseStart.length
    + project.workflowRules.beforeTaskStart.length
    + project.workflowRules.afterPhaseComplete.length;
  const fieldsClearedOnApply: LegacyProjectContextMigrationPreview["fieldsClearedOnApply"] = [];
  if (project.globalRules.length > 0) fieldsClearedOnApply.push("globalRules");
  if (workflowRuleCount > 0) fieldsClearedOnApply.push("workflowRules");
  if (project.decisions.length > 0) fieldsClearedOnApply.push("decisions");

  return {
    version: LEGACY_PROJECT_CONTEXT_MIGRATION_VERSION,
    hasLegacyContext: fieldsClearedOnApply.length > 0,
    guidelinesChanged: guidelineAdditions.length > 0,
    acceptedDecisionsChanged: acceptedDecisionAdditions.length > 0,
    guidelineAdditions,
    acceptedDecisionAdditions,
    skippedGuidelineDuplicates,
    skippedDecisionDuplicates,
    resultingGuidelinesContent: renderGuidelineAdditions(project.projectGuidelines.content, guidelineAdditions),
    legacyCounts: {
      globalRules: project.globalRules.length,
      workflowRules: workflowRuleCount,
      decisions: project.decisions.length,
    },
    fieldsClearedOnApply,
  };
}

export function applyLegacyProjectContextMigration(
  project: Project,
  acceptedAt: string,
): LegacyProjectContextMigrationResult {
  const preview = previewLegacyProjectContextMigration(project);
  if (!preview.hasLegacyContext) return { applied: false, preview, project };
  const acceptedDecisions: AcceptedDecision[] = [
    ...project.acceptedDecisions,
    ...preview.acceptedDecisionAdditions.map((decision) => ({ ...decision, acceptedAt })),
  ];
  return {
    applied: true,
    preview,
    project: {
      ...project,
      projectGuidelines: {
        ...project.projectGuidelines,
        content: preview.resultingGuidelinesContent,
      },
      globalRules: [],
      workflowRules: {
        beforePhaseStart: [],
        beforeTaskStart: [],
        afterPhaseComplete: [],
      },
      decisions: [],
      acceptedDecisions,
    },
  };
}
