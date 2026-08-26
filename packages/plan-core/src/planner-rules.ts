import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Canonical planner extension rules — the agent-behavior contract that applies
 * to EVERY project using the Agent Plan extension (Pi, MCP / Claude Code / Codex,
 * future harnesses). These are STATIC: no timestamps, no dynamic content, so the
 * same text seeds every .planner/ and never diverges across worktrees or
 * branches (no conflict from date/timestamp changes).
 *
 * AGENTS.md governs ONLY the development of the agent-plan extension and must
 * not duplicate these rules.
 */
const DETAIL_WRITING_RULE = "Write relevant points (decisions, constraints, current state, file:line refs, edge cases) into the task/phase/feature description or notes as soon as they emerge. For starting, resuming, or switching, call the lifecycle tool first so valid session attestations can be reused. If it denies the operation, perform only the missing or stale full reads listed in nextActions, in that exact order, then retry; read linked requirements explicitly only when requested. Cite entities with composite IDs, not bare UUIDs.";
const EXPECTED_OPERATIONAL_RULE = "When you begin work, task_start and task_switch enforce session-scoped context reads and return precise missing/stale read actions when needed. Read any relevant phase handoff as additional context, then update the planner before and after significant changes. If you change an architectural decision, document it explicitly.";

const LEGACY_DETAIL_WRITING_RULE = "Write relevant points (decisions, constraints, current state, file:line refs, edge cases) into the task/phase/feature description or notes as soon as they emerge. Before starting, resuming, or switching to a task, read task_get(full=true), then its parent phase_get(full=true), then its parent feature_get(full=true), in that exact order; read linked requirements explicitly when present. Cite entities with composite IDs, not bare UUIDs.";
const LEGACY_EXPECTED_OPERATIONAL_RULE = "When you begin work, task_start and task_switch enforce the required ordered full reads. Read any relevant phase handoff as additional context, then update the planner before and after significant changes. If you change an architectural decision, document it explicitly.";

export const PLANNER_EXTENSION_RULES: string[] = [
  // §1 — source of truth
  "Keep the planner as the single operational source of truth while working: read the relevant planner state before starting; update it when an activity starts, changes state, blocks, or concludes; and record next steps, blockers, and decisions in the relevant planner entities. Never leave work only in the conversation.",
  // §2 — task lifecycle
  "Respect the task lifecycle strictly. Always call task_start before touching code, and task_complete with durable evidence of shipped work, verification (including partial verification), remaining/unverified work, files, and decisions when a deliverable is done. Never enter in-progress or done through task_update. Sync state changes (start/complete/block) to the planner at the exact moment they happen — never batch updates at session end. If task_start is denied, the task remains planned: satisfy the stated read prerequisites and retry, and never claim work started without an explicit successful start result. A task marked in-progress means you are actually working on it; if you stop, close or block it with a motivation in statusLog. Derived feature/phase status is computed from tasks, not stored in JSON.",
  // §3 — markdown not source of truth
  "Do not treat markdown as the source of truth for the plan. The plan's primary source is structured data in .planner/; markdown is a generated, human/agent-readable view.",
  // §5 — plan location
  "The plan lives in .planner/ within the target project. Whether .planner/ is git-tracked is at the project's discretion.",
  // §6 — discuss per phase
  "Discuss the plan per phase: clarify objective, scope, non-scope, dependencies, risks, and outcomes before working a phase; detail implementation when the phase is actually worked, not up front.",
  // §7 — naming
  "Naming: phases and tasks use global project-wide numbering (P001, T001, …) with a slug derived from the title. Numbers are assigned once at creation from a monotonic global counter and never reused (deletes leave gaps).",
  // §8 — status changes & motivation
  "Every task status change is recorded in an incremental statusLog. Motivation is mandatory for blocked/canceled/rejected/deferred/waiting and for returning to planned from a non-planned status; not required for done or for normal in-progress-from-planned. Use task_update (not task_start/task_complete) for non-lifecycle status changes, with an exhaustive motivation.",
  // §10 — references
  "Reference entities with human, unique, composite IDs — Feature 'F001 - Name', Phase 'P001(F001) - Title', Task 'T003 - Number'. Short forms P003/T007 and the 5-char global shortId (e.g. UUXD1) are also valid. Never reference raw UUIDs. To locate an entity, use the compact list tools (feature_list/phase_list/task_list), not by reading .planner/*.json files.",
  // §12 — handoff
  "Handoff is per-phase (phase.handoff), not a file. Write it only on explicit user request and only after the exact feature+phase target is confirmed. Run handoff_prepare for that phase, reconcile all still-relevant existing content into one active handoff, and synchronize durable task/phase/feature context in the same handoff_write operation. A pending handoff never blocks task_start and is archived only when the phase completes or the user explicitly clears it; refreshing it must not create superseded copies.",
  // §12 — operational hygiene
  "Operational hygiene: start the task (task_start) before thinking about implementation; complete it (task_complete) as part of delivering the deliverable, not after; motivate every block so a third party can understand the impediment.",
  // Planner startup
  "The planner and Web UI never start automatically. Do not start the Web UI or show its URL unless the user runs load/recap/web-status. The Web UI URL appears only in the recap after load, or on explicit web status.",
  // Detail-writing rule
  DETAIL_WRITING_RULE,
  // Expected operational behavior
  EXPECTED_OPERATIONAL_RULE,
];

export interface ExtensionRulesFile {
  extensionRules: string[];
}

function normalizeLegacyRules(rules: string[]): string[] {
  return rules.map((rule) => {
    if (rule === LEGACY_DETAIL_WRITING_RULE) return DETAIL_WRITING_RULE;
    if (rule === LEGACY_EXPECTED_OPERATIONAL_RULE) return EXPECTED_OPERATIONAL_RULE;
    return rule;
  });
}

/**
 * Load the effective extension rules for a planner root. Returns the project's
 * own .planner/rules.json (static, user-overridable) when present and non-empty,
 * otherwise the canonical code set. Exact legacy canonical read-protocol rules
 * are upgraded in memory without rewriting the project file; unrelated project
 * overrides remain untouched. Never returns timestamps or dynamic data.
 */
export async function loadExtensionRules(plannerRoot: string): Promise<string[]> {
  try {
    const raw = await readFile(join(plannerRoot, "rules.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<ExtensionRulesFile>;
    if (Array.isArray(parsed.extensionRules) && parsed.extensionRules.length > 0) {
      return normalizeLegacyRules(parsed.extensionRules.filter((r) => typeof r === "string" && r.length > 0));
    }
  } catch {
    // Missing or malformed rules.json → fall back to the canonical code set.
  }
  return PLANNER_EXTENSION_RULES;
}
