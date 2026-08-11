import type { Feature, Phase, Requirement } from "./schema.js";
import { formatPhaseRef } from "./naming.js";

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
): string {
  const lines: string[] = [];
  const phaseRef = formatPhaseRef(phase.number, feature?.number);
  lines.push(`\n📋 Phase context — read this BEFORE touching code:`);
  lines.push(`Phase ${phaseRef} — ${phase.title}`);
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

  lines.push(`\nLinked requirements (${linkedRequirements.length}):`);
  if (linkedRequirements.length === 0) {
    lines.push("  - None linked to this phase.");
  } else {
    for (const requirement of linkedRequirements) {
      lines.push(`  - ${requirement.title}${requirement.description?.trim() ? ` — ${requirement.description.trim()}` : ""}`);
    }
  }

  if (feature) {
    lines.push(`\nFeature F${String(feature.number).padStart(3, "0")} — ${feature.name}`);
    if (feature.description && feature.description.trim()) {
      lines.push(`\nFeature description:\n${feature.description.trim()}`);
    }
  }
  lines.push(`\n(End of phase context. Now proceed with the task.)`);
  return lines.join("\n");
}