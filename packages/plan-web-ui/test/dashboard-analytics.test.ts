import { describe, expect, it } from "vitest";
import {
  AGING_BUCKETS,
  collectTasks,
  computeDashboardAnalytics,
  isOpenStatus,
  isTerminalStatus,
} from "../src/lib/dashboard-analytics";
import type { Phase, Task, TaskStatus } from "../src/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? "task-1",
    phaseId: "phase-1",
    number: overrides.number ?? 1,
    shortId: "",
    priority: 0,
    shortName: "example",
    title: "Example task",
    status: overrides.status ?? "planned",
    description: "",
    descriptionUpdatedAt: "",
    notes: "",
    statusLog: overrides.statusLog ?? [],
    decisions: [],
    acceptedDecisions: [],
    checklist: [],
    subtasks: [],
    dependsOn: [],
    pauseSnapshot: null,
    pauseHistory: [],
    startedAt: overrides.startedAt ?? "",
    completedAt: overrides.completedAt ?? "",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePhase(tasks: Task[]): Phase {
  return {
    id: "phase-1",
    featureId: "feature-1",
    number: 1,
    shortId: "PHS01",
    priority: 1,
    slug: "example",
    title: "Example phase",
    status: "planned",
    discussedAt: "",
    contextReady: false,
    contextReadyReason: "",
    summary: "",
    description: "",
    notes: "",
    goals: [],
    nonGoals: [],
    dependencies: [],
    dependsOn: [],
    risks: [],
    openQuestions: [],
    decisions: [],
    acceptedDecisions: [],
    completionCriteria: [],
    taskIds: tasks.map((task) => task.id),
    tasks,
    linkedRequirements: [],
    handoff: "",
    handoffUpdatedAt: "",
    statusLog: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function calendarDayDiff(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS);
}

describe("computeDashboardAnalytics", () => {
  it("returns an empty, self-consistent result for an empty plan", () => {
    const result = computeDashboardAnalytics([]);
    expect(result.summary.currentTotal).toBe(0);
    expect(result.summary.currentOpen).toBe(0);
    expect(result.summary.addedTotal).toBe(0);
    expect(result.summary.closedTotal).toBe(0);
    expect(result.summary.reopenedTotal).toBe(0);
    expect(result.summary.netBacklog).toBe(0);
    expect(result.allTime.addedTotal).toBe(0);
    expect(result.dailyPoints).toEqual([]);
    expect(result.cumulativePoints).toEqual([]);
    expect(result.calendarRange).toBeNull();
    expect(result.asOf).toBeNull();
    expect(result.limitations.deletedTasksNotRepresented).toBe(true);
    expect(result.limitations.legacyHistoryFallbackUsed).toBe(false);
    expect(result.agingBuckets.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("keeps current-open drill-down IDs when malformed timestamps yield no events", () => {
    const tasks = [
      makeTask({ id: "zeta", createdAt: "invalid" }),
      makeTask({ id: "alpha", createdAt: "invalid", status: "waiting" }),
      makeTask({ id: "done", createdAt: "invalid", updatedAt: "invalid", completedAt: "invalid", status: "done" }),
    ];

    const result = computeDashboardAnalytics(tasks);

    expect(result.dailyPoints).toEqual([]);
    expect(result.summary.currentOpen).toBe(2);
    expect(result.currentOpenIds).toEqual(["alpha", "zeta"]);
  });

  it("keeps current open/total counts independently verifiable from current status", () => {
    const statuses: TaskStatus[] = [
      "done", "canceled", "rejected", "planned", "in-progress", "blocked", "waiting", "deferred",
    ];
    const tasks = statuses.map((status, index) =>
      makeTask({ id: `task-${index}`, status, createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    const result = computeDashboardAnalytics(tasks);

    const expectedOpen = tasks.filter((task) => isOpenStatus(task.status)).length;
    const expectedTerminal = tasks.filter((task) => isTerminalStatus(task.status)).length;

    expect(result.summary.currentTotal).toBe(tasks.length);
    expect(result.summary.currentOpen).toBe(expectedOpen);
    expect(result.summary.currentOpen + expectedTerminal).toBe(tasks.length);
    expect(result.summary.currentDone).toBe(1);
    expect(result.summary.currentCanceled).toBe(1);
    expect(result.summary.currentRejected).toBe(1);
    // The window summary's current counts must equal a direct re-derivation.
    expect(result.summary.currentOpen).toBe(tasks.filter((task) => isOpenStatus(task.status)).length);
  });

  it("selects the last N distinct active days and scopes the summary to the window", () => {
    const tasks: Task[] = [];
    for (let index = 0; index < 30; index += 1) {
      const day = String(index + 1).padStart(2, "0");
      tasks.push(makeTask({ id: `t${index}`, createdAt: `2026-01-${day}T00:00:00.000Z` }));
    }

    const windows: Array<7 | 21 | 60> = [7, 21, 60];
    const results = windows.map((windowDays) => computeDashboardAnalytics(tasks, { windowDays }));

    // Full-range cumulative points are identical regardless of window.
    for (const result of results) {
      expect(result.cumulativePoints.length).toBe(30);
    }
    const lastNetBacklog = results.map((result) => result.cumulativePoints[29].netBacklog);
    expect(new Set(lastNetBacklog).size).toBe(1);

    // Windowed daily points count distinct active days, and the summary is scoped to the window.
    expect(results[0].dailyPoints.length).toBe(7);
    expect(results[0].summary.addedTotal).toBe(7);
    expect(results[0].allTime.addedTotal).toBe(30);
    expect(results[1].dailyPoints.length).toBe(21);
    expect(results[1].summary.addedTotal).toBe(21);
    expect(results[1].allTime.addedTotal).toBe(30);
    expect(results[2].dailyPoints.length).toBe(30); // clamped: only 30 active days exist
    expect(results[2].summary.addedTotal).toBe(30);
    expect(results[2].allTime.addedTotal).toBe(30);

    // The window summary's activeDays equals the number of selected active days.
    expect(results[0].summary.activeDays).toBe(7);
    expect(results[0].allTime.activeDays).toBe(30);
  });

  it("proves a 21-active-day window can span far more than 21 calendar days", () => {
    // One active day per month for 21 months: 21 active days, ~20 months apart.
    const tasks: Task[] = [];
    for (let month = 0; month < 21; month += 1) {
      const year = 2024 + Math.floor(month / 12);
      const m = (month % 12) + 1;
      tasks.push(makeTask({ id: `t${month}`, createdAt: `${year}-${String(m).padStart(2, "0")}-15T00:00:00.000Z` }));
    }
    const result = computeDashboardAnalytics(tasks, { windowDays: 21 });

    // 21 DISTINCT active days, regardless of the huge calendar span.
    expect(result.dailyPoints.length).toBe(21);
    expect(result.summary.activeDays).toBe(21);
    expect(result.calendarRange).not.toBeNull();
    const span = calendarDayDiff(result.calendarRange!.start, result.calendarRange!.end);
    expect(span).toBeGreaterThan(21);
    // Every daily point is a real active day (non-zero additions).
    expect(result.dailyPoints.every((point) => point.added > 0)).toBe(true);
  });

  it("counts reopened tasks and keeps net backlog = added + reopened - closed", () => {
    const tasks = [
      makeTask({
        id: "r",
        status: "planned",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-01-05T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
          { id: "s2", date: "2026-01-10T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "t", description: "" },
        ],
      }),
    ];
    const result = computeDashboardAnalytics(tasks);

    expect(result.summary.addedTotal).toBe(1);
    expect(result.summary.closedTotal).toBe(1);
    expect(result.summary.reopenedTotal).toBe(1);
    expect(result.summary.netBacklog).toBe(1);
    expect(result.summary.currentOpen).toBe(1);

    const closeDay = result.cumulativePoints.find((point) => point.date === "2026-01-05");
    const reopenDay = result.cumulativePoints.find((point) => point.date === "2026-01-10");
    expect(closeDay?.closed).toBe(1);
    expect(reopenDay?.reopened).toBe(1);
    expect(result.cumulativePoints[result.cumulativePoints.length - 1].netBacklog).toBe(1);
  });

  it("ignores terminal-to-terminal transitions for added/closed/reopened accounting", () => {
    const tasks = [
      makeTask({
        id: "tt",
        status: "canceled",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-01-05T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
          { id: "s2", date: "2026-01-08T00:00:00.000Z", fromStatus: "done", toStatus: "canceled", title: "t", description: "" },
        ],
      }),
    ];
    const result = computeDashboardAnalytics(tasks);

    expect(result.summary.addedTotal).toBe(1);
    expect(result.summary.closedTotal).toBe(1);
    expect(result.summary.reopenedTotal).toBe(0);
    expect(result.summary.netBacklog).toBe(0);
    expect(result.summary.currentCanceled).toBe(1);
    expect(result.summary.currentOpen).toBe(0);
  });

  it("falls back to completedAt when a terminal task has no closure in its statusLog", () => {
    const tasks = [
      makeTask({
        id: "legacy",
        status: "done",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [],
        completedAt: "2026-01-05T00:00:00.000Z",
      }),
    ];
    const result = computeDashboardAnalytics(tasks);

    expect(result.limitations.legacyHistoryFallbackUsed).toBe(true);
    expect(result.summary.closedTotal).toBe(1);
    expect(result.summary.addedTotal).toBe(1);
    expect(result.summary.netBacklog).toBe(0);
    const closeDay = result.cumulativePoints.find((point) => point.date === "2026-01-05");
    expect(closeDay?.closed).toBe(1);
  });

  it("falls back through completedAt -> updatedAt when statusLog is empty", () => {
    const tasks = [
      makeTask({
        id: "legacy2",
        status: "rejected",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [],
        completedAt: "",
        updatedAt: "2026-01-09T00:00:00.000Z",
      }),
    ];
    const result = computeDashboardAnalytics(tasks);
    expect(result.limitations.legacyHistoryFallbackUsed).toBe(true);
    expect(result.summary.closedTotal).toBe(1);
    const closeDay = result.cumulativePoints.find((point) => point.date === "2026-01-09");
    expect(closeDay?.closed).toBe(1);
  });

  it("uses deterministic UTC day buckets at the day boundary", () => {
    const tasks = [
      makeTask({ id: "late", createdAt: "2026-01-01T23:59:59.999Z" }),
      makeTask({ id: "early", createdAt: "2026-01-02T00:00:00.000Z" }),
      makeTask({ id: "dateonly", createdAt: "2026-01-02" }),
    ];
    const result = computeDashboardAnalytics(tasks);
    expect(result.calendarRange).toEqual({ start: "2026-01-01", end: "2026-01-02" });
    const day1 = result.cumulativePoints.find((point) => point.date === "2026-01-01");
    const day2 = result.cumulativePoints.find((point) => point.date === "2026-01-02");
    expect(day1?.added).toBe(1);
    expect(day2?.added).toBe(2);
  });

  it("buckets open-task aging by whole UTC days since the task became open", () => {
    const tasks = [
      makeTask({ id: "a", status: "in-progress", createdAt: "2026-04-01T00:00:00.000Z" }), // 0d -> 0-7d
      makeTask({ id: "b", status: "planned", createdAt: "2026-03-20T00:00:00.000Z" }), // 12d -> 8-14d
      makeTask({ id: "c", status: "blocked", createdAt: "2026-02-01T00:00:00.000Z" }), // 59d -> 31-60d
      makeTask({ id: "d", status: "waiting", createdAt: "2025-12-01T00:00:00.000Z" }), // 121d -> 61+d
      makeTask({ id: "e", status: "deferred", createdAt: "2024-01-01T00:00:00.000Z" }), // 821d -> 61+d
    ];
    const result = computeDashboardAnalytics(tasks);
    expect(result.asOf).toBe("2026-04-01");

    const byLabel = new Map(result.agingBuckets.map((bucket) => [bucket.label, bucket.count]));
    expect(byLabel.get("0-7d")).toBe(1);
    expect(byLabel.get("8-14d")).toBe(1);
    expect(byLabel.get("15-30d")).toBe(0);
    expect(byLabel.get("31-60d")).toBe(1);
    expect(byLabel.get("61+d")).toBe(2);
    const total = result.agingBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBe(tasks.length);
  });

  it("ages an idle project correctly when an explicit asOf is later than its last event", () => {
    // Last event is 2026-01-01, but the clock is 2026-06-01: tasks must age.
    const tasks = [
      makeTask({ id: "idle", status: "planned", createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const result = computeDashboardAnalytics(tasks, { asOf: "2026-06-01" });

    expect(result.asOf).toBe("2026-06-01");
    // The single active day (2026-01-01) is at or before asOf, so it is included.
    expect(result.dailyPoints.length).toBe(1);
    expect(result.dailyPoints[0].date).toBe("2026-01-01");
    // Age = 151 days -> 61+d bucket.
    const byLabel = new Map(result.agingBuckets.map((bucket) => [bucket.label, bucket.count]));
    expect(byLabel.get("61+d")).toBe(1);
    expect(result.summary.currentOpen).toBe(1);
  });

  it("excludes events after asOf from the window and aging cutoff", () => {
    const tasks = [
      makeTask({ id: "early", createdAt: "2026-01-01T00:00:00.000Z" }),
      makeTask({ id: "late", createdAt: "2026-01-10T00:00:00.000Z" }),
    ];
    const result = computeDashboardAnalytics(tasks, { asOf: "2026-01-05" });

    expect(result.dailyPoints.length).toBe(1);
    expect(result.dailyPoints[0].date).toBe("2026-01-01");
    expect(result.summary.addedTotal).toBe(1);
    expect(result.allTime.addedTotal).toBe(1);
    expect(result.cumulativePoints.length).toBe(1);
  });

  it("reconciles partial history: log ends open but current status is terminal (synthetic close)", () => {
    const tasks = [
      makeTask({
        id: "partial",
        status: "done",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-01-02T00:00:00.000Z", fromStatus: "planned", toStatus: "in-progress", title: "t", description: "" },
        ],
        completedAt: "2026-01-05T00:00:00.000Z",
      }),
    ];
    const result = computeDashboardAnalytics(tasks);

    expect(result.limitations.legacyHistoryFallbackUsed).toBe(true);
    expect(result.summary.closedTotal).toBe(1);
    expect(result.summary.addedTotal).toBe(1);
    expect(result.summary.netBacklog).toBe(0);
    expect(result.summary.currentDone).toBe(1);
    const closeDay = result.cumulativePoints.find((point) => point.date === "2026-01-05");
    expect(closeDay?.closed).toBe(1);
  });

  it("reconciles partial history: log ends terminal but current status is open (synthetic reopen)", () => {
    const tasks = [
      makeTask({
        id: "partial2",
        status: "planned",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-01-02T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
        ],
        updatedAt: "2026-01-03T00:00:00.000Z",
      }),
    ];
    const result = computeDashboardAnalytics(tasks);

    expect(result.limitations.legacyHistoryFallbackUsed).toBe(true);
    expect(result.summary.reopenedTotal).toBe(1);
    expect(result.summary.closedTotal).toBe(1);
    expect(result.summary.netBacklog).toBe(1);
    expect(result.summary.currentOpen).toBe(1);
    const reopenDay = result.cumulativePoints.find((point) => point.date === "2026-01-03");
    expect(reopenDay?.reopened).toBe(1);
  });

  it("keeps burn-up consistency across close -> reopen -> close", () => {
    const tasks = [
      makeTask({
        id: "flip",
        status: "done",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-01-02T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
          { id: "s2", date: "2026-01-03T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "t", description: "" },
          { id: "s3", date: "2026-01-04T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
        ],
      }),
    ];
    const result = computeDashboardAnalytics(tasks);

    expect(result.summary.closedTotal).toBe(2);
    expect(result.summary.reopenedTotal).toBe(1);

    for (const point of result.cumulativePoints) {
      // Cumulative scope minus the closed balance must equal net backlog everywhere.
      expect(point.cumulativeScope - point.cumulativeCompletion).toBe(point.netBacklog);
    }
    const last = result.cumulativePoints[result.cumulativePoints.length - 1];
    expect(last.cumulativeCompletion).toBe(1); // closed(2) - reopened(1)
    expect(last.netBacklog).toBe(0);
  });

  it("derives the same analytics from phases via collectTasks", () => {
    const tasks = [
      makeTask({ id: "a", status: "done", createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-02T00:00:00.000Z" }),
      makeTask({ id: "b", status: "planned", createdAt: "2026-01-03T00:00:00.000Z" }),
    ];
    const fromTasks = computeDashboardAnalytics(tasks);
    const fromPhases = computeDashboardAnalytics(collectTasks([makePhase(tasks)]));
    expect(fromPhases.summary).toEqual(fromTasks.summary);
    expect(fromPhases.cumulativePoints).toEqual(fromTasks.cumulativePoints);
    expect(fromPhases.allTime).toEqual(fromTasks.allTime);
  });

  it("is deterministic across repeated calls", () => {
    const tasks = [
      makeTask({
        id: "r",
        status: "planned",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-01-05T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
          { id: "s2", date: "2026-01-10T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "t", description: "" },
        ],
      }),
    ];
    const first = computeDashboardAnalytics(tasks);
    const second = computeDashboardAnalytics(tasks);
    expect(second).toEqual(first);
  });

  it("reconciles partial history: close->reopen log but current status terminal (missing final close)", () => {
    const tasks = [
      makeTask({
        id: "partial3",
        status: "done",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-01-05T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
          { id: "s2", date: "2026-01-06T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "t", description: "" },
        ],
        completedAt: "2026-01-08T00:00:00.000Z",
      }),
    ];
    const result = computeDashboardAnalytics(tasks);

    expect(result.limitations.legacyHistoryFallbackUsed).toBe(true);
    // Log closed once and reopened once; current is terminal -> a synthetic close is added
    // even though a close occurred earlier in the log.
    expect(result.summary.closedTotal).toBe(2);
    expect(result.summary.reopenedTotal).toBe(1);
    expect(result.summary.netBacklog).toBe(0);
    expect(result.summary.currentDone).toBe(1);
    const syntheticCloseDay = result.cumulativePoints.find((point) => point.date === "2026-01-08");
    expect(syntheticCloseDay?.closedTaskIds).toContain("partial3");
  });

  it("reconciles partial history: close->reopen->close log but current status open (missing final reopen)", () => {
    const tasks = [
      makeTask({
        id: "partial4",
        status: "planned",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-01-05T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
          { id: "s2", date: "2026-01-06T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "t", description: "" },
          { id: "s3", date: "2026-01-07T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
        ],
        updatedAt: "2026-01-09T00:00:00.000Z",
      }),
    ];
    const result = computeDashboardAnalytics(tasks);

    expect(result.limitations.legacyHistoryFallbackUsed).toBe(true);
    // Log closed twice; current is open -> a synthetic reopen is added even though a reopen
    // occurred earlier in the log.
    expect(result.summary.closedTotal).toBe(2);
    expect(result.summary.reopenedTotal).toBe(2);
    expect(result.summary.netBacklog).toBe(1);
    expect(result.summary.currentOpen).toBe(1);
    const syntheticReopenDay = result.cumulativePoints.find((point) => point.date === "2026-01-09");
    expect(syntheticReopenDay?.reopenedTaskIds).toContain("partial4");
  });

  it("keeps the original creation age for an open task with a recent open->open transition", () => {
    const tasks = [
      makeTask({
        id: "old",
        status: "planned",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-03-01T00:00:00.000Z", fromStatus: "planned", toStatus: "in-progress", title: "t", description: "" },
        ],
      }),
    ];
    const result = computeDashboardAnalytics(tasks, { asOf: "2026-06-01" });

    expect(result.asOf).toBe("2026-06-01");
    // planned->in-progress is open->open and must NOT reset the age (creation 2026-01-01). 151 days.
    const byLabel = new Map(result.agingBuckets.map((bucket) => [bucket.label, bucket.count]));
    expect(byLabel.get("61+d")).toBe(1);
  });

  it("resets the age on a real terminal->open reopen", () => {
    const tasks = [
      makeTask({
        id: "reopened",
        status: "planned",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-02-01T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
          { id: "s2", date: "2026-05-01T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "t", description: "" },
        ],
      }),
    ];
    const result = computeDashboardAnalytics(tasks, { asOf: "2026-06-01" });

    // Age resets to the reopen date 2026-05-01 -> 31 days as of 2026-06-01.
    const byLabel = new Map(result.agingBuckets.map((bucket) => [bucket.label, bucket.count]));
    expect(byLabel.get("31-60d")).toBe(1);
    expect(byLabel.get("61+d")).toBe(0);
    expect(result.summary.currentOpen).toBe(1);
  });

  it("excludes tasks created after asOf from aging and ignores future reopens for the anchor", () => {
    const tasks = [
      makeTask({ id: "after", status: "planned", createdAt: "2026-02-05T00:00:00.000Z", statusLog: [] }),
      makeTask({
        id: "futureReopen",
        status: "planned",
        createdAt: "2026-01-01T00:00:00.000Z",
        statusLog: [
          { id: "s1", date: "2026-01-05T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
          { id: "s2", date: "2026-03-01T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "t", description: "" },
        ],
      }),
    ];
    const result = computeDashboardAnalytics(tasks, { asOf: "2026-02-01" });

    // "after" is created after asOf -> excluded from aging but still counts as open.
    // "futureReopen" anchors at creation (2026-01-01); its reopen (2026-03-01) is after asOf
    // and ignored -> 31 days -> 31-60d.
    const byLabel = new Map(result.agingBuckets.map((bucket) => [bucket.label, bucket.count]));
    expect(byLabel.get("31-60d")).toBe(1);
    expect(byLabel.get("0-7d")).toBe(0);
    expect(result.summary.currentOpen).toBe(2);
    // The reopen dated after asOf is excluded from the flow counts.
    expect(result.summary.reopenedTotal).toBe(0);
    expect(result.summary.addedTotal).toBe(1);
  });

  it("emits deterministic, deduplicated task-ID sets for drill-down", () => {
    const multitask = makeTask({
      id: "multi",
      status: "planned",
      createdAt: "2026-01-01T00:00:00.000Z",
      statusLog: [
        { id: "s1", date: "2026-01-05T00:00:00.000Z", fromStatus: "planned", toStatus: "done", title: "t", description: "" },
        { id: "s2", date: "2026-01-10T00:00:00.000Z", fromStatus: "done", toStatus: "planned", title: "t", description: "" },
      ],
    });
    const zetaOpen = makeTask({ id: "zeta-open", status: "blocked", createdAt: "2026-01-02T00:00:00.000Z" });
    const alphaOpen = makeTask({ id: "alpha-open", status: "waiting", createdAt: "2026-01-03T00:00:00.000Z" });
    const tasks = [multitask, zetaOpen, alphaOpen];
    const result = computeDashboardAnalytics(tasks);

    const addedDay = result.cumulativePoints.find((point) => point.date === "2026-01-01");
    const closedDay = result.cumulativePoints.find((point) => point.date === "2026-01-05");
    const reopenedDay = result.cumulativePoints.find((point) => point.date === "2026-01-10");
    expect(addedDay?.addedTaskIds).toEqual(["multi"]);
    expect(closedDay?.closedTaskIds).toEqual(["multi"]);
    expect(reopenedDay?.reopenedTaskIds).toEqual(["multi"]);
    // Every task-ID set is sorted ascending and the current-open set is complete.
    expect(result.currentOpenIds).toEqual(["alpha-open", "multi", "zeta-open"]);
    // Event counts remain event counts (not unique task counts).
    expect(result.summary.addedTotal).toBe(3);
    expect(result.summary.closedTotal).toBe(1);
    expect(result.summary.reopenedTotal).toBe(1);
    // Window ID sets are deduplicated and sorted.
    expect(result.windowAddedIds).toEqual(["alpha-open", "multi", "zeta-open"]);
    expect(result.windowClosedIds).toEqual(["multi"]);
    expect(result.windowReopenedIds).toEqual(["multi"]);
    expect(result.agingBuckets.every((bucket) => bucket.taskIds.every((id) => typeof id === "string"))).toBe(true);
  });
});

describe("dashboard-analytics constants", () => {
  it("exposes stable terminal and open status sets", () => {
    expect(isTerminalStatus("done")).toBe(true);
    expect(isTerminalStatus("canceled")).toBe(true);
    expect(isTerminalStatus("rejected")).toBe(true);
    expect(isTerminalStatus("planned")).toBe(false);
    expect(isOpenStatus("planned")).toBe(true);
    expect(isOpenStatus("in-progress")).toBe(true);
    expect(isOpenStatus("blocked")).toBe(true);
    expect(isOpenStatus("waiting")).toBe(true);
    expect(isOpenStatus("deferred")).toBe(true);
    expect(isOpenStatus("done")).toBe(false);
  });

  it("exposes five non-overlapping aging buckets ending in 61+", () => {
    expect(AGING_BUCKETS).toHaveLength(5);
    expect(AGING_BUCKETS[AGING_BUCKETS.length - 1].maxDays).toBeNull();
    // Boundaries are contiguous and non-overlapping.
    const bounds = AGING_BUCKETS.map((bucket) => [bucket.minDays, bucket.maxDays] as const);
    expect(bounds[0]).toEqual([0, 7]);
    expect(bounds[1]).toEqual([8, 14]);
    expect(bounds[2]).toEqual([15, 30]);
    expect(bounds[3]).toEqual([31, 60]);
    expect(bounds[4]).toEqual([61, null]);
    for (let i = 1; i < bounds.length; i += 1) {
      const prevMax = bounds[i - 1][1] as number;
      expect(bounds[i][0]).toBe(prevMax + 1);
    }
  });
});
