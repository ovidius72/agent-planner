import type { AcceptedDecision, Feature, Phase, Project, Requirement, Task } from "./schema.js";
import { formatPhaseRef } from "./naming.js";

export const MAX_ACCEPTED_DECISION_CONTEXT_CHARS = 8_000;

export interface ScopedAcceptedDecisions {
  scope: string;
  decisions: AcceptedDecision[] | undefined;
}

function indentDecisionValue(value: string): string {
  const normalized = value.trim() || "(not provided)";
  return normalized.split(/\r?\n/).map((line) => `    ${line}`).join("\n");
}

/** Render every canonical field needed to understand an Accepted Decision. */
export function renderAcceptedDecisionsSection(label: string, decisions: AcceptedDecision[] | undefined): string {
  const entries = decisions ?? [];
  const lines = [`${label} (${entries.length}):`];
  if (entries.length === 0) return `${lines[0]}\n  - None.`;
  for (const decision of entries) {
    lines.push(`  - ${decision.title}`);
    lines.push(`    ID: ${decision.id}`);
    lines.push(`    Accepted at: ${decision.acceptedAt}`);
    lines.push("    Decision:");
    lines.push(indentDecisionValue(decision.decision));
    lines.push("    Rationale:");
    lines.push(indentDecisionValue(decision.rationale));
    lines.push("    Implementation notes:");
    lines.push(indentDecisionValue(decision.implementationNotes));
  }
  return lines.join("\n");
}

/**
 * Build bounded ambient/load context. This is an orientation summary, not a
 * full-read attestation: truncation is explicit and points to entity full reads.
 */
export function buildBoundedAcceptedDecisionContext(
  scopes: ScopedAcceptedDecisions[],
  maxChars = MAX_ACCEPTED_DECISION_CONTEXT_CHARS,
): { content: string; total: number; truncated: boolean; maxChars: number } {
  const populated = scopes
    .map((scope) => ({ ...scope, decisions: scope.decisions ?? [] }))
    .filter((scope) => scope.decisions.length > 0);
  const total = populated.reduce((count, scope) => count + scope.decisions.length, 0);
  const full = total === 0
    ? "Accepted decisions: none."
    : populated.map((scope) => renderAcceptedDecisionsSection(`Accepted decisions — ${scope.scope}`, scope.decisions)).join("\n\n");
  if (full.length <= maxChars) return { content: full, total, truncated: false, maxChars };
  const suffix = "\n\n[Accepted Decision context truncated for transport safety. Use the relevant full entity read to retrieve every canonical field.]";
  const limit = Math.max(0, maxChars - suffix.length);
  return { content: `${full.slice(0, limit)}${suffix}`.slice(0, maxChars), total, truncated: true, maxChars };
}

/**
 * Build a compact, agent-facing context block that surfaces the PARENT PHASE
 * (and grandparent FEATURE) description when a task is started. The phase
 * description carries the shared design context (file:line refs, architecture,
 * current state, behaviors to preserve) that EVERY task in the phase inherits.
 *
 * Injecting this into the `task_start` tool response guarantees the agent sees
 * the phase-level context in the exact moment it begins work — instead of
 * relying on the agent to voluntarily read it beforehand.
 *
 * Harness-agnostic: returns a plain markdown string. Both the Pi adapter and
 * the MCP server append this to their `task_start` confirmation text.
 */
export function buildPhaseContextBlock(
  phase: Phase,
  feature: Feature | undefined,
  linkedRequirements: Requirement[] = [],
  featureRequirements: Requirement[] = [],
  task?: Pick<Task, "acceptedDecisions">,
  project?: Pick<Project, "acceptedDecisions">,
): string {
  const lines: string[] = [];
  const phaseRef = formatPhaseRef(phase.number, feature?.number);
  const requirementsBlock = (label: string, requirements: Requirement[], empty: string) => {
    lines.push(`\n${label} (${requirements.length}):`);
    if (requirements.length === 0) {
      lines.push(`  - ${empty}`);
    } else {
      for (const requirement of requirements) {
        lines.push(`  - ${requirement.title}${requirement.description?.trim() ? ` — ${requirement.description.trim()}` : ""}`);
      }
    }
  };

  lines.push(`\n📋 Task context — read this BEFORE touching code:`);
  lines.push(`\n${buildBoundedAcceptedDecisionContext([
    ...(project ? [{ scope: "project", decisions: project.acceptedDecisions }] : []),
    ...(feature ? [{ scope: `feature F${String(feature.number).padStart(3, "0")}`, decisions: feature.acceptedDecisions }] : []),
    { scope: `phase ${phaseRef}`, decisions: phase.acceptedDecisions },
    ...(task ? [{ scope: "task", decisions: task.acceptedDecisions }] : []),
  ]).content}`);
  if (feature) {
    lines.push(`Feature F${String(feature.number).padStart(3, "0")} — ${feature.name}`);
    if (feature.description && feature.description.trim()) {
      lines.push(`\nFeature description:\n${feature.description.trim()}`);
    }
    requirementsBlock("Feature linked requirements", featureRequirements, "None linked to this feature.");
  } else {
    lines.push("Feature context: no parent feature linked to this phase.");
    requirementsBlock("Feature linked requirements", [], "None linked to this feature.");
  }

  lines.push(`\nPhase ${phaseRef} — ${phase.title}`);
  if (phase.summary && phase.summary.trim()) {
    lines.push(`Summary: ${phase.summary.trim()}`);
  }
  if (phase.description && phase.description.trim()) {
    lines.push(`\nPhase description:\n${phase.description.trim()}`);
  }
  const bullet = (label: string, items: string[] | undefined) => {
    if (items && items.length > 0) {
      lines.push(`\n${label}:`);
      for (const it of items) lines.push(`  - ${it}`);
    }
  };
  bullet("Goals", phase.goals);
  bullet("Non-goals", phase.nonGoals);
  bullet("Dependencies", phase.dependencies);
  bullet("Risks", phase.risks);
  bullet("Open questions", phase.openQuestions);
  bullet("Decisions", phase.decisions);
  bullet("Completion criteria", phase.completionCriteria);

  requirementsBlock("Phase linked requirements", linkedRequirements, "None linked to this phase.");
  lines.push(`\n(End of phase context. Now proceed with the task.)`);
  return lines.join("\n");
}