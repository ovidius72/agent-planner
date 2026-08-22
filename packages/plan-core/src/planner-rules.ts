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
export const PLANNER_EXTENSION_RULES: string[] = [
  // §1 — source of truth
  "Keep the planner as the single operational source of truth while working: read the relevant planner state before starting; update it when an activity starts, changes state, blocks, or concludes; and record next steps, blockers, and decisions in the relevant planner entities. Never leave work only in the conversation.",
  // §2 — task lifecycle
  "Respect the task lifecycle strictly. Always call task_start before touching code, and task_complete when a deliverable is done. Sync state changes (start/complete/block) to the planner at the exact moment they happen — never batch updates at session end. If the extension reports 'no active task', immediately start the correct task. A task marked in-progress means you are actually working on it; if you stop, close or block it with a motivation in statusLog. Derived feature/phase status is computed from tasks, not stored in JSON.",
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
  "Handoff is per-phase (phase.handoff), not a file. Write it only on explicit user request; on resume, read it then clear it before starting work. A pending handoff never blocks task_start. Do not leave a handoff stale after processing it.",
  // §12 — operational hygiene
  "Operational hygiene: start the task (task_start) before thinking about implementation; complete it (task_complete) as part of delivering the deliverable, not after; motivate every block so a third party can understand the impediment.",
  // Avvio del planner
  "The planner and Web UI never start automatically. Do not start the Web UI or show its URL unless the user runs load/recap/web-status. The Web UI URL appears only in the recap after load, or on explicit web status.",
  // Regola dettagli
  "Write relevant points (decisions, constraints, current state, file:line refs, edge cases) into the task/phase/feature description or notes as soon as they emerge; read the task description and notes (and parent phase/feature) before starting work; cite entities with composite IDs, not bare UUIDs.",
  // Comportamento atteso 2-5
  "When you begin work: read the relevant planner entities (feature_get/phase_get/task_get/handoff_show), read the relevant documents, and update the planner before and after significant changes. If you change an architectural decision, document it explicitly.",
];

export interface ExtensionRulesFile {
  extensionRules: string[];
}

/**
 * Load the effective extension rules for a planner root. Returns the project's
 * own .planner/rules.json (static, user-overridable) when present and non-empty,
 * otherwise the canonical code set. Never returns timestamps or dynamic data.
 */
export async function loadExtensionRules(plannerRoot: string): Promise<string[]> {
  try {
    const raw = await readFile(join(plannerRoot, "rules.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<ExtensionRulesFile>;
    if (Array.isArray(parsed.extensionRules) && parsed.extensionRules.length > 0) {
      return parsed.extensionRules.filter((r) => typeof r === "string" && r.length > 0);
    }
  } catch {
    // Missing or malformed rules.json → fall back to the canonical code set.
  }
  return PLANNER_EXTENSION_RULES;
}
