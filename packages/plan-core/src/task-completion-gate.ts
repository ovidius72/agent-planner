/**
 * Whether a task may complete, given its checklist and a `force` override —
 * the decision `planner-task-complete` (MCP) and `task_complete` (Pi) each
 * re-implemented, with two different refusal messages, neither of which
 * named the way to satisfy the gate.
 *
 * P104(F005)/T428: 26 tasks in this project are `done` with every checklist
 * item still unticked — never some, always every one. The uniformity is the
 * tell. An agent reported the mechanism directly: `task_complete` warned
 * that items were open, and the only route the refusal named was
 * `force=true`. Neither adapter's message mentioned
 * `planner-task-checklist-toggle` / `task_checklist_toggle`, which is how an
 * agent satisfies the gate rather than evades it. Handing over the escape
 * hatch and never the way through is the same defect shape P104(F005)/T420
 * fixed for task start: the denial was the documented path.
 *
 * So the refusal here leads with the toggle command, not `force`. Forcing
 * remains possible — a task's checklist can stop matching the work it turned
 * out to need — but it now costs a motivation (the same convention
 * `needsMotivation` already applies to blocked/canceled/deferred/rejected/
 * waiting, extended with its `forced` parameter rather than duplicated) and
 * records exactly what it overrode.
 *
 * What this never does: tick an item for the caller. An unticked item after
 * a forced completion is information — a step that was skipped, not one
 * that was done — and overwriting that is precisely the mistake T413 fixed
 * for checklist replacement. `overriddenItems` below is for the caller to
 * *record*, never to check off.
 *
 * Placed in plan-core per AGENTS.md rule 4: both `planner-task-complete` and
 * `task_complete` call this once and render its result, rather than each
 * re-deciding it.
 */
import type { ChecklistItem, TaskStatus } from "./schema.js";
import { needsMotivation } from "./schema.js";

export type TaskCompletionGateErrorCode = "CHECKLIST_INCOMPLETE" | "FORCE_MOTIVATION_REQUIRED";

export interface TaskCompletionGateDecision {
  allowed: boolean;
  errorCode?: TaskCompletionGateErrorCode;
  /** Every checklist item still unchecked at the time of the decision. */
  uncheckedItems: ChecklistItem[];
  /** The unchecked items a forced completion is about to override. Empty
   * unless `allowed` is true because of `force` — an ordinary completion
   * with nothing open overrides nothing. Callers record these; they must
   * never mark them checked (see module doc, and T413). */
  overriddenItems: ChecklistItem[];
}

/**
 * Decide whether `planner-task-complete` / `task_complete` may proceed.
 * Pure: takes the task's own checklist plus the caller's `force` and
 * `motivation` inputs, returns the decision and what a forced completion
 * would override. No store access, no I/O — the adapter owns persisting
 * whatever this approves.
 */
export function evaluateTaskCompletionGate(
  checklist: readonly ChecklistItem[],
  force: boolean,
  motivation: string | undefined,
): TaskCompletionGateDecision {
  const uncheckedItems = checklist.filter((item) => !item.checked);
  if (uncheckedItems.length === 0) {
    return { allowed: true, uncheckedItems, overriddenItems: [] };
  }
  if (!force) {
    return { allowed: false, errorCode: "CHECKLIST_INCOMPLETE", uncheckedItems, overriddenItems: [] };
  }
  if (needsMotivation("in-progress", "done", true) && (!motivation || !motivation.trim())) {
    return { allowed: false, errorCode: "FORCE_MOTIVATION_REQUIRED", uncheckedItems, overriddenItems: [] };
  }
  return { allowed: true, uncheckedItems, overriddenItems: uncheckedItems };
}

/**
 * The refusal an agent sees with open checklist items and no `force`. Leads
 * with the way through — tick what was actually done — before naming the
 * exception. `toggleCommandExample` is the adapter's own invocation shape
 * (e.g. `planner-task-checklist-toggle <task> <item>` for MCP,
 * `task_checklist_toggle` for Pi) so the message names a command the caller
 * can run as written, not a tool name it has to guess the shape of.
 */
export function taskCompletionChecklistRefusal(uncheckedItems: readonly ChecklistItem[], toggleCommandExample: string): string {
  const titles = uncheckedItems.map((item) => item.title).join(", ");
  return `${uncheckedItems.length} checklist item(s) not done: ${titles}. `
    + `Tick the ones you actually completed with ${toggleCommandExample}, then retry. `
    + `If the checklist itself no longer matches the work, complete with force=true and a "motivation" explaining why — the override is recorded, not silent.`;
}

/** The refusal when `force=true` is given with open items but no motivation. */
export function taskCompletionForceMotivationRequired(uncheckedItems: readonly ChecklistItem[]): string {
  return `Forcing completion past ${uncheckedItems.length} unchecked checklist item(s) requires a motivation. `
    + `Provide the "motivation" parameter explaining why the checklist no longer matches the work.`;
}

/**
 * The line appended to completion evidence and the status-log entry when a
 * forced completion overrides open items — so the record of what was
 * skipped survives independently of the checklist (which can itself be
 * replaced later). Empty string when nothing was overridden.
 */
export function taskCompletionOverrideNote(overriddenItems: readonly ChecklistItem[], motivation: string | undefined): string {
  if (overriddenItems.length === 0) return "";
  const titles = overriddenItems.map((item) => item.title).join(", ");
  const motivationLine = motivation?.trim() ? ` Motivation: ${motivation.trim()}` : "";
  return `Forced completion overrode ${overriddenItems.length} unchecked checklist item(s): ${titles}.${motivationLine}`;
}

/**
 * The fact a full task view must surface next to its status: a task
 * recorded `done` while its checklist still has open items. This is exactly
 * the contradiction a human reading the Web UI's generated markdown already
 * sees directly (a `Status: done` line above unchecked boxes) — made
 * legible here too, at the same read T421 already annotates with order
 * context, rather than left for a reader to notice by comparing two fields
 * themselves. Computed from live checklist state, not a stored flag, so it
 * reflects reality even if items were ticked after a forced completion.
 */
export function taskCompletionMismatchLine(status: TaskStatus, checklist: readonly ChecklistItem[]): string {
  if (status !== "done") return "";
  const uncheckedItems = checklist.filter((item) => !item.checked);
  if (uncheckedItems.length === 0) return "";
  const titles = uncheckedItems.map((item) => item.title).join(", ");
  return `⚠️ Marked done with ${uncheckedItems.length} of ${checklist.length} checklist item(s) still open: ${titles}.`;
}
