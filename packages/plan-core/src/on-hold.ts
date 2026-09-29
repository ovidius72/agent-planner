import type { Feature, Phase, Task } from "./schema.js";
import { featureNumberOfPhase, formatPhaseRef } from "./naming.js";

/**
 * On-hold work that may be ready to resume.
 *
 * A task parked as deferred, waiting or blocked keeps its reason in the
 * status log ("Resume once P097 lands"). Nothing used to look at those
 * reasons again, so work whose blocker had finished stayed parked until a
 * person noticed. This module is the one place that lists on-hold tasks
 * with their reasons and checks the ones whose reason names planner refs:
 * the recommendation and the load recap both read it, so they cannot
 * disagree.
 */

export const ON_HOLD_STATUSES = new Set(["deferred", "waiting", "blocked"]);
const FINISHED = new Set(["done", "canceled", "rejected"]);

export interface OnHoldRef {
  /** The ref as written in the reason, normalized (e.g. `P097(F003)`, `T468`). */
  ref: string;
  /** Whether the named phase or task exists and is finished. */
  finished: boolean;
  /** False when the ref names nothing in this plan. */
  found: boolean;
}

export interface OnHoldTask {
  taskId: string;
  ref: string;
  title: string;
  status: string;
  phaseId: string;
  phaseRef: string;
  /** Why it was put on hold: the motivation of the status change that parked it. */
  reason: string;
  heldSince: string;
  /** Planner refs the task is actually waiting on: refs named in the hold
   *  reason, plus its own dependsOn edges (by composite ref) — deduplicated,
   *  so a dependency already spelled out in the reason is not double-listed.
   *  Each is checked against the plan. */
  namedRefs: OnHoldRef[];
  /** True when there is at least one ref to wait on (named in the reason or
   *  a dependsOn edge) and every one of them is finished. */
  readyToResume: boolean;
}

// A phase ref with optional feature and task, in either spelling
// (`P097`, `P097(F003)`, `F003/P097`, `P094(F011)/T449`, `F011/P094/T449`),
// or a bare task ref (`T468`). Word-bounded so prose like "HTTP2" or
// "T-shirt" never matches.
const REF_IN_TEXT = /\b(?:F(\d{1,4})\/)?P(\d{1,4})(?:\(F(\d{1,4})\))?(?:\/T(\d{1,4}))?(?!\w)|\bT(\d{1,4})(?!\w)/g;

const pad = (n: number) => String(n).padStart(3, "0");

function holdEntry(task: Task): { reason: string; at: string } {
  const entry = [...(task.statusLog ?? [])].reverse().find((log) => log.toStatus === task.status);
  const reason = (entry?.description ?? "").replace(/^Motivation:\s*/i, "").trim();
  return { reason, at: entry?.date ?? task.updatedAt ?? "" };
}

/** Resolve every planner ref named in `text`, by number only (never by title). */
export function refsNamedIn(text: string, phases: Phase[], features: Feature[], selfTaskId = ""): OnHoldRef[] {
  const phaseByNumber = new Map(phases.map((phase) => [phase.number, phase]));
  const taskByNumber = new Map(phases.flatMap((phase) => phase.tasks.map((task) => [task.number, { phase, task }] as const)));
  const featureByNumber = new Map(features.map((feature) => [feature.number, feature]));
  const seen = new Map<string, OnHoldRef>();

  for (const match of text.matchAll(REF_IN_TEXT)) {
    const [, leadingFeatureNum, phaseNum, trailingFeatureNum, phaseTaskNum, bareTaskNum] = match;
    const featureNum = trailingFeatureNum ?? leadingFeatureNum;
    if (bareTaskNum || phaseTaskNum) {
      const taskNum = Number(bareTaskNum ?? phaseTaskNum);
      const hit = taskByNumber.get(taskNum);
      const parentOk = !phaseNum || hit?.phase.number === Number(phaseNum);
      const featureOk = !featureNum || (hit && hit.phase.featureId === featureByNumber.get(Number(featureNum))?.id);
      const ref = phaseNum
        ? `P${pad(Number(phaseNum))}${featureNum ? `(F${pad(Number(featureNum))})` : ""}/T${pad(taskNum)}`
        : `T${pad(taskNum)}`;
      if (hit?.task.id === selfTaskId) continue;
      const found = Boolean(hit && parentOk && featureOk);
      seen.set(ref, { ref, found, finished: found && FINISHED.has(hit!.task.status) });
      continue;
    }
    const phase = phaseByNumber.get(Number(phaseNum));
    const featureOk = !featureNum || (phase && phase.featureId === featureByNumber.get(Number(featureNum))?.id);
    const ref = `P${pad(Number(phaseNum))}${featureNum ? `(F${pad(Number(featureNum))})` : ""}`;
    const found = Boolean(phase && featureOk);
    const finished = found && phase!.tasks.length > 0 && phase!.tasks.every((task) => FINISHED.has(task.status));
    seen.set(ref, { ref, found, finished });
  }
  return [...seen.values()];
}

/** Resolve a task's dependsOn edges to composite refs, checked against the
 *  plan the same way refsNamedIn checks a ref found in text. A dependsOn id
 *  always resolves (dependencies are validated at creation — see
 *  PlanStore.addTaskDependency), but a defensive `found: false` covers a
 *  dangling edge from an older plan rather than throwing. */
function dependencyRefsFor(task: Task, phases: Phase[], features: Feature[]): OnHoldRef[] {
  return (task.dependsOn ?? []).map((dependencyId) => {
    for (const phase of phases) {
      const dependency = phase.tasks.find((candidate) => candidate.id === dependencyId);
      if (dependency) {
        const ref = `${formatPhaseRef(phase.number, featureNumberOfPhase(phase, features))}/T${pad(dependency.number)}`;
        return { ref, found: true, finished: FINISHED.has(dependency.status) };
      }
    }
    return { ref: dependencyId, found: false, finished: false };
  });
}

/**
 * Every on-hold task, ready-to-resume ones first. Pass `phaseIds` to limit
 * the list to the phases a caller is about to act on.
 */
export function listOnHoldWork(features: Feature[], phases: Phase[], phaseIds?: Set<string>): OnHoldTask[] {
  const items: OnHoldTask[] = [];
  for (const phase of phases) {
    if (phaseIds && !phaseIds.has(phase.id)) continue;
    const phaseRef = formatPhaseRef(phase.number, featureNumberOfPhase(phase, features));
    for (const task of phase.tasks) {
      if (!ON_HOLD_STATUSES.has(task.status)) continue;
      const { reason, at } = holdEntry(task);
      // A parked task waits on whatever its reason names AND whatever it
      // depends on — merged by ref so a dependency already spelled out in
      // the reason is not counted, or shown, twice.
      const namedRefs = refsNamedIn(reason, phases, features, task.id);
      const seenRefs = new Set(namedRefs.map((named) => named.ref));
      for (const dependencyRef of dependencyRefsFor(task, phases, features)) {
        if (seenRefs.has(dependencyRef.ref)) continue;
        seenRefs.add(dependencyRef.ref);
        namedRefs.push(dependencyRef);
      }
      items.push({
        taskId: task.id,
        ref: `${phaseRef}/T${pad(task.number)}`,
        title: task.title,
        status: task.status,
        phaseId: phase.id,
        phaseRef,
        reason,
        heldSince: at,
        namedRefs,
        readyToResume: namedRefs.length > 0 && namedRefs.every((named) => named.finished),
      });
    }
  }
  return items.sort((left, right) => Number(right.readyToResume) - Number(left.readyToResume));
}

/**
 * The phases whose on-hold work matters now: phases where work has started
 * (some task finished or in progress) but not every task is finished. A
 * phase nobody has started yet keeps its on-hold tasks out of the way.
 */
export function startedOpenPhaseIds(phases: Phase[]): Set<string> {
  return new Set(phases
    .filter((phase) => phase.tasks.some((task) => FINISHED.has(task.status) || task.status === "in-progress"))
    .filter((phase) => phase.tasks.some((task) => !FINISHED.has(task.status)))
    .map((phase) => phase.id));
}

const REASON_PREVIEW_CHARS = 160;

/**
 * One bounded text block for any reply. Ready-to-resume tasks first; each
 * line carries the reason so the agent can re-check it against the plan.
 */
export function renderOnHoldWork(items: OnHoldTask[], limit = 8): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, limit);
  const lines = shown.map((item) => {
    const reason = item.reason
      ? item.reason.length > REASON_PREVIEW_CHARS ? `${item.reason.slice(0, REASON_PREVIEW_CHARS).trimEnd()}…` : item.reason
      : "(no reason recorded)";
    const check = item.readyToResume
      ? ` — MAY BE READY: everything its reason names is finished (${item.namedRefs.map((named) => named.ref).join(", ")}); re-check and resume it if nothing else holds it`
      : item.namedRefs.some((named) => !named.finished)
        ? ` — still waiting on ${item.namedRefs.filter((named) => !named.finished).map((named) => named.found ? named.ref : `${named.ref} (not found)`).join(", ")}`
        : "";
    return `- ${item.ref} — ${item.title} [${item.status}]${check}\n  Reason: ${reason}`;
  });
  const more = items.length > shown.length ? `\n(${items.length - shown.length} more on hold; list them with the phase's task list.)` : "";
  const ready = items.filter((item) => item.readyToResume).length;
  return `On hold — check whether these can resume (${items.length} on hold${ready ? `, ${ready} may be ready` : ""}):\n${lines.join("\n")}${more}`;
}
