import type { AcceptedDecision, Feature, Phase, Project, Requirement, Task } from "./schema.js";
import { formatPhaseRef } from "./naming.js";
import { truncateAtSafeBoundary } from "./text-bounds.js";

export const MAX_ACCEPTED_DECISION_CONTEXT_CHARS = 8_000;
export const MAX_PHASE_WORK_MAP_CHARS = 8_000;

export interface PhaseWorkMapEntry {
  taskId: string;
  ref: string;
  number: number;
  priority: number;
  status: Task["status"];
  title: string;
  conciseGoal: string;
  dependencies: string[];
  remainingCapabilityOwner: boolean;
  current: boolean;
}

export interface PhaseWorkMap {
  content: string;
  /** Mirrors `content`: holds exactly the entries whose rendered block was admitted. Use `total` for the full count. */
  entries: PhaseWorkMapEntry[];
  total: number;
  truncated: boolean;
  maxChars: number;
}

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
  // Cut at a safe boundary (paragraph, then line, then word — see
  // truncateAtSafeBoundary) rather than a raw slice, which previously cut
  // mid-word exactly as the handoff path once did (P104(F005)/T419). The
  // helper still returns something even when the first decision alone
  // exceeds `limit`: it falls back to a hard cut only when no boundary
  // exists before it.
  const suffix = "\n\n[Accepted Decision context truncated for transport safety. Use the relevant full entity read to retrieve every canonical field.]";
  const limit = Math.max(0, maxChars - suffix.length);
  const bounded = truncateAtSafeBoundary(full, limit);
  return { content: `${bounded}${suffix}`.slice(0, maxChars), total, truncated: true, maxChars };
}

function conciseTaskGoal(task: Task): string {
  const source = task.description?.trim() || task.notes?.trim() || task.title;
  const firstParagraph = source.split(/\n\s*\n|\r?\n/).find((line) => line.trim())?.trim() ?? task.title;
  return firstParagraph.length <= 240 ? firstParagraph : `${firstParagraph.slice(0, 237).trimEnd()}...`;
}

/** Build a bounded, priority-ordered map of sibling capability ownership. */
export function buildPhaseWorkMap(
  phase: Phase,
  featureNumber?: number,
  currentTaskId?: string,
  maxChars = MAX_PHASE_WORK_MAP_CHARS,
): PhaseWorkMap {
  const phaseRef = formatPhaseRef(phase.number, featureNumber);
  const tasks = phase.tasks ?? [];
  const refById = new Map(tasks.map((task) => [task.id, `${phaseRef}/T${String(task.number).padStart(3, "0")}`]));
  const entries = [...tasks]
    .sort((left, right) => (left.priority ?? left.number) - (right.priority ?? right.number) || left.number - right.number)
    .map((task): PhaseWorkMapEntry => ({
      taskId: task.id,
      ref: `${phaseRef}/T${String(task.number).padStart(3, "0")}`,
      number: task.number,
      priority: task.priority ?? task.number,
      status: task.status,
      title: task.title,
      conciseGoal: conciseTaskGoal(task),
      dependencies: (task.dependsOn ?? []).map((dependency) => refById.get(dependency) ?? dependency),
      remainingCapabilityOwner: !["done", "canceled", "rejected"].includes(task.status),
      current: task.id === currentTaskId,
    }));
  const header = `Phase work map — canonical sibling capability ownership (${entries.length}, priority order):`;
  const rendered = entries.map((entry) => ({
    entry,
    block: [
      `- ${entry.ref}${entry.current ? " (current)" : ""} — ${entry.title} [priority ${entry.priority}; ${entry.status}]`,
      `  Goal: ${entry.conciseGoal}`,
      `  Depends on: ${entry.dependencies.length > 0 ? entry.dependencies.join(", ") : "None."}`,
      entry.remainingCapabilityOwner
        ? `  Ownership: ${entry.ref} owns this remaining capability; do not duplicate it in another task.`
        : "  Ownership: no remaining capability ownership (terminal task).",
    ].join("\n"),
  }));
  const truncationNotice = (withheldCount: number): string =>
    `[Phase work map truncated for transport safety: ${withheldCount} lower-priority ${withheldCount === 1 ? "entry" : "entries"} withheld. Read the canonical phase and task full views before proposing work; place deeper context under .planner/docs/.]`;
  // Reserve space using the full task count as the withheld-count placeholder: since the
  // eventual withheld count can never exceed it, this reservation is always a safe upper
  // bound on the final notice length, so shrinking it afterward cannot overflow maxChars.
  const reservedSuffixLen = truncationNotice(entries.length).length;
  const included: string[] = [];
  const admittedEntries: PhaseWorkMapEntry[] = [];
  let truncated = false;
  for (const { entry, block } of rendered) {
    const candidate = [header, ...included, block].join("\n");
    if (candidate.length + reservedSuffixLen + 1 > maxChars) {
      truncated = true;
      break;
    }
    included.push(block);
    admittedEntries.push(entry);
  }
  const suffix = truncationNotice(entries.length - admittedEntries.length);
  const content = [header, ...included, ...(truncated ? [suffix] : [])].join("\n").slice(0, maxChars);
  return { content, entries: admittedEntries, total: entries.length, truncated, maxChars };
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
  task?: Pick<Task, "id" | "acceptedDecisions">,
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
    requirementsBlock("Product requirements linked to feature (outcomes, never coding/process rules)", featureRequirements, "None linked to this feature.");
  } else {
    lines.push("Feature context: no parent feature linked to this phase.");
    requirementsBlock("Product requirements linked to feature (outcomes, never coding/process rules)", [], "None linked to this feature.");
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

  requirementsBlock("Product requirements linked to phase (outcomes, never coding/process rules)", linkedRequirements, "None linked to this phase.");
  lines.push(`\n${buildPhaseWorkMap(phase, feature?.number, task?.id).content}`);
  lines.push("Before proposing or creating work, reread this canonical phase work map and the relevant sibling task full view so an already-owned capability is not duplicated.");
  lines.push(`\n(End of phase context. Now proceed with the task.)`);
  return lines.join("\n");
}