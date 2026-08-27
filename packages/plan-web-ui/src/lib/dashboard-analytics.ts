// Pure, deterministic analytics for the dashboard Flow & Backlog section.
//
// This module derives flow/backlog metrics from the task read models already
// consumed by the dashboard route (see packages/plan-web-ui/src/routes/dashboard/route.tsx).
// It has NO side effects, performs NO I/O, and depends only on the task fields
// `createdAt`, `startedAt`, `completedAt`, `status`, and `statusLog`. All time
// bucketing is done in UTC so results are deterministic regardless of the host
// timezone or the current clock (no Date.now() is used for computed values).
//
// Active-day contract (critical):
//  - An "active day" is a UTC day ("YYYY-MM-DD") that carries at least one
//    added/closed/reopened event.
//  - The `windowDays` selector returns the LAST N DISTINCT active days (never a
//    calendar-day span). A 21-active-day window can therefore cover far more
//    than 21 calendar days when activity is sparse.
//  - The activity window is cut off at or before `asOf` (the explicit aging
//    clock). All series, the window summary, and aging are computed "as of" that
//    day. Tasks created after `asOf` are excluded from aging, and log entries
//    dated after `asOf` are ignored when choosing an aging anchor.
//  - Terminal statuses are done | canceled | rejected.
//  - Open statuses are planned | in-progress | blocked | waiting | deferred.
//  - Net backlog (cumulative) = added + reopened - closed.
//  - Current open/total counts are computed independently from current status,
//    so they remain verifiable against the raw task list.
//  - Burn-up consistency: cumulative completion is the CLOSED BALANCE
//    (closed events - reopened events), not the raw close count, so
//    cumulativeScope - cumulativeCompletion == netBacklog at every point.
//  - Open-task AGE starts at creation and resets ONLY on a terminal->open reopen;
//    open->open transitions (planned->in-progress, in-progress->blocked, ...) do
//    not reset it. An explicit `asOf` is required for meaningful aging of an idle
//    project; when omitted, `asOf` falls back to the latest event day (which
//    makes an idle project appear un-aged).
//  - Partial/legacy history is reconciled SOLELY from the last valid logged
//    terminal/open state versus the current status: a synthetic close is added
//    when the last logged state is open/neutral but the current status is
//    terminal, and a synthetic reopen when the last logged state is terminal but
//    the current status is open.
//  - Drill-down (`currentOpenIds`, daily `addedTaskIds`/`closedTaskIds`/
//    `reopenedTaskIds`, `agingBuckets[].taskIds`, and `windowAddedIds`/
//    `windowClosedIds`/`windowReopenedIds`) provides deterministic, deduplicated,
//    stably-sorted task-ID sets so consumers (e.g. T342) can filter the WorkTree
//    without reimplementing analytics. Event COUNTS remain event counts.

import type { Phase, Task, TaskStatus } from "./types";

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["done", "canceled", "rejected"];
export const OPEN_STATUSES: readonly TaskStatus[] = ["planned", "in-progress", "blocked", "waiting", "deferred"];

/** Trailing active-day window sizes exposed by the dashboard selector. */
export type WindowDays = 7 | 21 | 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const UTC_DAY_LENGTH = 10; // "YYYY-MM-DD"

export function isTerminalStatus(status: TaskStatus): boolean {
  return (TERMINAL_STATUSES as readonly TaskStatus[]).includes(status);
}

export function isOpenStatus(status: TaskStatus): boolean {
  return (OPEN_STATUSES as readonly TaskStatus[]).includes(status);
}

/** Open-task aging buckets (non-overlapping), measured in whole UTC days. */
export interface AgingBucketDef {
  label: string;
  minDays: number;
  maxDays: number | null;
}

export const AGING_BUCKETS: readonly AgingBucketDef[] = [
  { label: "0-7d", minDays: 0, maxDays: 7 },
  { label: "8-14d", minDays: 8, maxDays: 14 },
  { label: "15-30d", minDays: 15, maxDays: 30 },
  { label: "31-60d", minDays: 31, maxDays: 60 },
  { label: "61+d", minDays: 61, maxDays: null },
];

export interface DashboardAnalyticsDayPoint {
  /** UTC active-day bucket, "YYYY-MM-DD". */
  date: string;
  /** Tasks added (created) on this active day. */
  added: number;
  /** Tasks that reached a terminal status on this active day. */
  closed: number;
  /** Tasks reopened (terminal -> open) on this active day. */
  reopened: number;
  /** Cumulative net backlog as of this day (added + reopened - closed). */
  netBacklog: number;
  /** Cumulative scope (added) as of this day. */
  cumulativeScope: number;
  /** Cumulative closed balance (closed events - reopened events) as of this day. */
  cumulativeCompletion: number;
  /** Stable, deduplicated, sorted task IDs added on this day. */
  addedTaskIds: string[];
  /** Stable, deduplicated, sorted task IDs closed on this day. */
  closedTaskIds: string[];
  /** Stable, deduplicated, sorted task IDs reopened on this day. */
  reopenedTaskIds: string[];
}

export interface AgingBucket extends AgingBucketDef {
  /** Number of currently-open tasks whose age falls in this bucket. */
  count: number;
  /** Stable, deduplicated, sorted task IDs in this aging bucket. */
  taskIds: string[];
}

/** Flow totals shared by the selected window summary and the all-time totals. */
export interface FlowTotals {
  addedTotal: number;
  closedTotal: number;
  reopenedTotal: number;
  netBacklog: number;
  activeDays: number;
  addRatePerActiveDay: number;
  closeRatePerActiveDay: number;
  reopenRatePerActiveDay: number;
  /** closedTotal / addedTotal (closure-to-addition ratio). 0 when no additions. */
  closureRatio: number;
}

export interface DashboardAnalyticsSummary extends FlowTotals {
  /** Tasks with a current open status. Independent of the window. */
  currentOpen: number;
  /** Total tasks observed. Independent of the window. */
  currentTotal: number;
  currentDone: number;
  currentCanceled: number;
  currentRejected: number;
}

export interface DataQualityLimitations {
  /** Deleted tasks are never present in the current persisted files, so they
   *  cannot appear in any series, count, or backlog total. Always true here. */
  deletedTasksNotRepresented: boolean;
  /** True when at least one task needed a synthetic close/reopen because its
   *  statusLog and current status disagreed (partial / legacy history). */
  legacyHistoryFallbackUsed: boolean;
  notes: string[];
}

export interface DashboardAnalytics {
  windowDays: WindowDays;
  /** Explicit UTC day used as the aging clock and active-day cutoff. */
  asOf: string | null;
  /** First/last SELECTED active day (the window), or null when empty. */
  calendarRange: { start: string; end: string } | null;
  /** Windowed per-active-day buckets (last `windowDays` active days, <= asOf). */
  dailyPoints: DashboardAnalyticsDayPoint[];
  /** Full-range per-active-day buckets (all active days <= asOf) for the CFD. */
  cumulativePoints: DashboardAnalyticsDayPoint[];
  agingBuckets: AgingBucket[];
  /** Flow totals scoped to the selected active-day window. */
  summary: DashboardAnalyticsSummary;
  /** Flow totals across all active days at or before asOf (all-time). */
  allTime: FlowTotals;
  /** Deterministic, deduplicated, sorted IDs of currently-open tasks. */
  currentOpenIds: string[];
  /** Deterministic, deduplicated, sorted IDs added within the selected window. */
  windowAddedIds: string[];
  /** Deterministic, deduplicated, sorted IDs closed within the selected window. */
  windowClosedIds: string[];
  /** Deterministic, deduplicated, sorted IDs reopened within the selected window. */
  windowReopenedIds: string[];
  limitations: DataQualityLimitations;
}

export interface DashboardAnalyticsOptions {
  windowDays?: WindowDays;
  /**
   * Explicit UTC day ("YYYY-MM-DD") used as the aging clock and the latest
   * active-day cutoff. When omitted, falls back to the latest event day, which
   * for an idle project makes tasks appear un-aged (pass `asOf` for correct aging).
   */
  asOf?: string;
}

type EventKind = "added" | "closed" | "reopened";

interface AnalyticsEvent {
  day: string;
  kind: EventKind;
  taskId: string;
}

/** Flatten the task list out of the phase read models the dashboard already loads. */
export function collectTasks(phases: Phase[]): Task[] {
  const tasks: Task[] = [];
  for (const phase of phases) {
    if (phase.tasks) tasks.push(...phase.tasks);
  }
  return tasks;
}

/** Normalize a timestamp to its UTC day bucket, or null when unusable. */
function utcDay(date: string): string | null {
  if (!date) return null;
  const time = Date.parse(date);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, UTC_DAY_LENGTH);
}

function utcDayToTime(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function sortLogEntries(a: Task["statusLog"][number], b: Task["statusLog"][number]): number {
  const ta = Date.parse(a.date);
  const tb = Date.parse(b.date);
  if (ta !== tb && !Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * The UTC day the task started its CURRENT open stretch.
 *
 * Aging begins at creation and resets ONLY on a terminal->open reopen. Open->open
 * transitions (planned->in-progress, in-progress->blocked, ...) do NOT reset it.
 * Log entries dated after `asOf` are ignored when choosing the anchor. Falls back
 * to `createdAt` when there is no qualifying reopen.
 */
function openSinceDay(task: Task, asOf: string): string | null {
  const createdDay = utcDay(task.createdAt);
  const asOfTime = utcDayToTime(asOf);
  const log = [...(task.statusLog ?? [])].sort(sortLogEntries);
  let reopenDay: string | null = null;
  for (const entry of log) {
    const fromTerminal = isTerminalStatus(entry.fromStatus);
    const toTerminal = isTerminalStatus(entry.toStatus);
    if (!toTerminal && fromTerminal) {
      const day = utcDay(entry.date);
      // Ignore future reopens (after asOf) so they cannot reset the anchor.
      if (day && utcDayToTime(day) <= asOfTime) reopenDay = day;
    }
  }
  return reopenDay ?? createdDay;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function baseLimitations(): DataQualityLimitations {
  return {
    deletedTasksNotRepresented: true,
    legacyHistoryFallbackUsed: false,
    notes: [
      "Deleted tasks are absent from the current persisted planner files, so they never appear in any series, count, or backlog total.",
    ],
  };
}

function emptyAgingBuckets(): AgingBucket[] {
  return AGING_BUCKETS.map((bucket) => ({ ...bucket, count: 0, taskIds: [] }));
}

function buildFlowTotals(events: AnalyticsEvent[], activeDays: number): FlowTotals {
  const addedTotal = events.filter((event) => event.kind === "added").length;
  const closedTotal = events.filter((event) => event.kind === "closed").length;
  const reopenedTotal = events.filter((event) => event.kind === "reopened").length;
  return {
    addedTotal,
    closedTotal,
    reopenedTotal,
    netBacklog: addedTotal + reopenedTotal - closedTotal,
    activeDays,
    addRatePerActiveDay: safeRate(addedTotal, activeDays),
    closeRatePerActiveDay: safeRate(closedTotal, activeDays),
    reopenRatePerActiveDay: safeRate(reopenedTotal, activeDays),
    closureRatio: safeRate(closedTotal, addedTotal),
  };
}

function currentCounts(tasks: Task[]) {
  return {
    currentOpen: tasks.filter((task) => isOpenStatus(task.status)).length,
    currentTotal: tasks.length,
    currentDone: tasks.filter((task) => task.status === "done").length,
    currentCanceled: tasks.filter((task) => task.status === "canceled").length,
    currentRejected: tasks.filter((task) => task.status === "rejected").length,
  };
}

function buildEmptyAnalytics(
  windowDays: WindowDays,
  tasks: Task[],
  limitations: DataQualityLimitations,
): DashboardAnalytics {
  const emptyFlow: FlowTotals = {
    addedTotal: 0,
    closedTotal: 0,
    reopenedTotal: 0,
    netBacklog: 0,
    activeDays: 0,
    addRatePerActiveDay: 0,
    closeRatePerActiveDay: 0,
    reopenRatePerActiveDay: 0,
    closureRatio: 0,
  };
  return {
    windowDays,
    asOf: null,
    calendarRange: null,
    dailyPoints: [],
    cumulativePoints: [],
    agingBuckets: emptyAgingBuckets(),
    summary: { ...emptyFlow, ...currentCounts(tasks) },
    allTime: emptyFlow,
    currentOpenIds: tasks
      .filter((task) => isOpenStatus(task.status))
      .map((task) => task.id)
      .sort(),
    windowAddedIds: [],
    windowClosedIds: [],
    windowReopenedIds: [],
    limitations,
  };
}

/**
 * Compute deterministic Flow & Backlog analytics for a list of tasks.
 *
 * @param tasks flat task list (e.g. from `collectTasks(phases)`).
 * @param options.windowDays trailing active-day window for `dailyPoints` (default 21).
 * @param options.asOf explicit UTC day clock / cutoff (default: latest event day).
 */
export function computeDashboardAnalytics(
  tasks: Task[],
  options: DashboardAnalyticsOptions = {},
): DashboardAnalytics {
  const windowDays: WindowDays = options.windowDays ?? 21;
  const limitations = baseLimitations();
  const notes = new Set(limitations.notes);
  const legacyNote = (message: string) => {
    notes.add(message);
    limitations.legacyHistoryFallbackUsed = true;
  };

  const events: AnalyticsEvent[] = [];

  for (const task of tasks) {
    const createdDay = utcDay(task.createdAt);
    if (createdDay) events.push({ day: createdDay, kind: "added", taskId: task.id });

    const log = [...(task.statusLog ?? [])].sort(sortLogEntries);
    let logEndsTerminal: boolean | null = null;
    for (const entry of log) {
      const fromTerminal = isTerminalStatus(entry.fromStatus);
      const toTerminal = isTerminalStatus(entry.toStatus);
      const day = utcDay(entry.date);
      if (!day) continue;
      if (toTerminal && !fromTerminal) {
        events.push({ day, kind: "closed", taskId: task.id });
      } else if (!toTerminal && fromTerminal) {
        events.push({ day, kind: "reopened", taskId: task.id });
      }
      // open -> open and terminal -> terminal transitions do not change the
      // added/closed/reopened accounting.
      logEndsTerminal = toTerminal;
    }

    const currentTerminal = isTerminalStatus(task.status);

    // Partial / legacy history reconciliation: reconcile SOLELY from the last
    // valid logged terminal/open state versus the current status. A synthetic
    // close is added when the log's final state is open/neutral but the current
    // status is terminal; a synthetic reopen when the log's final state is
    // terminal but the current status is open. This does not depend on whether
    // a close/reopen occurred earlier in the log.
    if (currentTerminal && logEndsTerminal !== true) {
      const closeDay = utcDay(task.completedAt) ?? utcDay(task.updatedAt) ?? createdDay;
      if (closeDay) events.push({ day: closeDay, kind: "closed", taskId: task.id });
      legacyNote(
        "A terminal task's history does not record a closure; a close was inferred from completedAt/updatedAt/createdAt.",
      );
    } else if (!currentTerminal && logEndsTerminal === true) {
      const reopenDay = utcDay(task.updatedAt) ?? createdDay;
      if (reopenDay) events.push({ day: reopenDay, kind: "reopened", taskId: task.id });
      legacyNote(
        "A task whose history ends in a terminal status is currently open; a reopen was inferred from updatedAt/createdAt.",
      );
    }
  }

  if (events.length === 0) {
    limitations.notes = [...notes];
    return buildEmptyAnalytics(windowDays, tasks, limitations);
  }

  const maxEventDay = events.map((event) => event.day).reduce((max, day) => (day > max ? day : max));
  const asOfDay = (options.asOf && utcDay(options.asOf)) || maxEventDay;
  const asOfTime = utcDayToTime(asOfDay);

  // Only events at or before asOf participate in the window and aging.
  const inWindowEvents = events.filter((event) => utcDayToTime(event.day) <= asOfTime);

  const activeDaysAll = [...new Set(inWindowEvents.map((event) => event.day))].sort();

  interface DayBucket {
    added: number;
    closed: number;
    reopened: number;
    addedIds: Set<string>;
    closedIds: Set<string>;
    reopenedIds: Set<string>;
  }
  const byDay = new Map<string, DayBucket>();
  for (const event of inWindowEvents) {
    const bucket =
      byDay.get(event.day) ??
      { added: 0, closed: 0, reopened: 0, addedIds: new Set<string>(), closedIds: new Set<string>(), reopenedIds: new Set<string>() };
    if (event.kind === "added") {
      bucket.added += 1;
      bucket.addedIds.add(event.taskId);
    } else if (event.kind === "closed") {
      bucket.closed += 1;
      bucket.closedIds.add(event.taskId);
    } else {
      bucket.reopened += 1;
      bucket.reopenedIds.add(event.taskId);
    }
    byDay.set(event.day, bucket);
  }

  const cumulativePoints: DashboardAnalyticsDayPoint[] = [];
  let cumulativeScope = 0;
  let cumulativeClosedEvents = 0;
  let cumulativeReopenedEvents = 0;
  for (const day of activeDaysAll) {
    const bucket = byDay.get(day) ?? {
      added: 0,
      closed: 0,
      reopened: 0,
      addedIds: new Set<string>(),
      closedIds: new Set<string>(),
      reopenedIds: new Set<string>(),
    };
    cumulativeScope += bucket.added;
    cumulativeClosedEvents += bucket.closed;
    cumulativeReopenedEvents += bucket.reopened;
    const cumulativeCompletion = cumulativeClosedEvents - cumulativeReopenedEvents;
    const netBacklog = cumulativeScope + cumulativeReopenedEvents - cumulativeClosedEvents;
    cumulativePoints.push({
      date: day,
      added: bucket.added,
      closed: bucket.closed,
      reopened: bucket.reopened,
      netBacklog,
      cumulativeScope,
      cumulativeCompletion,
      addedTaskIds: [...bucket.addedIds].sort(),
      closedTaskIds: [...bucket.closedIds].sort(),
      reopenedTaskIds: [...bucket.reopenedIds].sort(),
    });
  }

  // The window is the last `windowDays` DISTINCT active days (never a calendar span).
  const dailyPoints = cumulativePoints.slice(Math.max(0, cumulativePoints.length - windowDays));
  const selectedDaySet = new Set(dailyPoints.map((point) => point.date));
  const windowEventsForSummary = inWindowEvents.filter((event) => selectedDaySet.has(event.day));

  const firstPoint = dailyPoints[0];
  const lastPoint = dailyPoints[dailyPoints.length - 1];
  const calendarRange =
    firstPoint && lastPoint ? { start: firstPoint.date, end: lastPoint.date } : null;

  const agingBuckets: Array<Omit<AgingBucket, "taskIds"> & { taskIds: Set<string> }> = AGING_BUCKETS.map(
    (bucket) => ({ ...bucket, count: 0, taskIds: new Set<string>() }),
  );
  for (const task of tasks) {
    if (!isOpenStatus(task.status)) continue;
    const anchorDay = openSinceDay(task, asOfDay);
    if (!anchorDay) continue;
    // Tasks created (or otherwise anchored) after asOf are not "open as of" that day.
    if (utcDayToTime(anchorDay) > asOfTime) continue;
    const ageDays = Math.max(0, Math.floor((asOfTime - utcDayToTime(anchorDay)) / DAY_MS));
    const bucket = agingBuckets.find(
      (candidate) => ageDays >= candidate.minDays && (candidate.maxDays === null || ageDays <= candidate.maxDays),
    );
    if (bucket) {
      bucket.count += 1;
      bucket.taskIds.add(task.id);
    }
  }
  const agingBucketsOut: AgingBucket[] = agingBuckets.map((bucket) => ({
    ...bucket,
    taskIds: [...bucket.taskIds].sort(),
  }));

  const summary: DashboardAnalyticsSummary = {
    ...buildFlowTotals(windowEventsForSummary, dailyPoints.length),
    ...currentCounts(tasks),
  };

  const allTime = buildFlowTotals(inWindowEvents, activeDaysAll.length);

  const currentOpenIds = tasks
    .filter((task) => isOpenStatus(task.status))
    .map((task) => task.id)
    .sort();
  const windowAddedIds = [...new Set(windowEventsForSummary.filter((event) => event.kind === "added").map((event) => event.taskId))].sort();
  const windowClosedIds = [...new Set(windowEventsForSummary.filter((event) => event.kind === "closed").map((event) => event.taskId))].sort();
  const windowReopenedIds = [...new Set(windowEventsForSummary.filter((event) => event.kind === "reopened").map((event) => event.taskId))].sort();

  if (windowDays > activeDaysAll.length) {
    notes.add(
      `Requested ${windowDays}-active-day window exceeds the ${activeDaysAll.length} active days available at or before asOf; the window was clamped to all available active days.`,
    );
  }
  limitations.notes = [...notes];

  return {
    windowDays,
    asOf: asOfDay,
    calendarRange,
    dailyPoints,
    cumulativePoints,
    agingBuckets: agingBucketsOut,
    summary,
    allTime,
    currentOpenIds,
    windowAddedIds,
    windowClosedIds,
    windowReopenedIds,
    limitations,
  };
}
