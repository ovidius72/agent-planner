import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import {
  collectTasks,
  computeDashboardAnalytics,
  type DashboardAnalytics,
  type WindowDays,
} from "../../lib/dashboard-analytics";
import type { Phase } from "../../lib/types";
import { Card } from "../ui/card";
import { AnalyticsCharts, type AnalyticsDrilldown, type AnalyticsDrilldownHandler } from "./analytics-charts";

const WINDOW_OPTIONS: readonly WindowDays[] = [7, 21, 60];

function signedCount(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function rate(value: number): string {
  return value.toFixed(1);
}

function ratio(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function insightFor(analytics: DashboardAnalytics): string {
  const { netBacklog, activeDays } = analytics.summary;
  if (activeDays === 0) return "No task-flow activity is recorded for this period.";
  if (netBacklog > 0) return `Backlog grew by ${netBacklog} ${netBacklog === 1 ? "task" : "tasks"} across the selected active days.`;
  if (netBacklog < 0) {
    const amount = Math.abs(netBacklog);
    return `Backlog shrank by ${amount} ${amount === 1 ? "task" : "tasks"} across the selected active days.`;
  }
  return "Backlog stayed level across the selected active days.";
}

function NetIcon({ value }: { value: number }) {
  if (value > 0) return <ArrowUpRight className="h-4 w-4" aria-hidden="true" />;
  if (value < 0) return <ArrowDownRight className="h-4 w-4" aria-hidden="true" />;
  return <Minus className="h-4 w-4" aria-hidden="true" />;
}

function Kpi({ label, value, detail, valueClassName = "text-[var(--text)]", onSelect, selected }: {
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
  onSelect: (() => void) | null;
  selected: boolean;
}) {
  return (
    <div className={`min-w-28 rounded-xl border bg-[var(--surface-elevated)] px-3 py-2.5 ${selected ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--border)]"}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{label}</dt>
      <dd className={`mt-1 text-xl font-black tracking-tight ${valueClassName}`}>
        {onSelect ? (
          <button
            type="button"
            aria-pressed={selected}
            aria-label={`Filter Work Tree by ${label}`}
            onClick={onSelect}
            className="rounded-md underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >{value}</button>
        ) : value}
      </dd>
      {detail ? <p className="mt-0.5 text-xs text-[var(--text-muted)]">{detail}</p> : null}
    </div>
  );
}

export function FlowBacklogAnalytics({ phases, asOf, activeDrilldown, onDrilldown, onClearDrilldown }: {
  phases: Phase[];
  asOf?: string;
  activeDrilldown?: AnalyticsDrilldown | null;
  onDrilldown?: AnalyticsDrilldownHandler;
  onClearDrilldown?: () => void;
}) {
  const [windowDays, setWindowDays] = useState<WindowDays>(21);
  const tasks = useMemo(() => collectTasks(phases), [phases]);
  const resolvedAsOf = asOf ?? new Date().toISOString().slice(0, 10);
  const analytics = useMemo(
    () => computeDashboardAnalytics(tasks, { windowDays, asOf: resolvedAsOf }),
    [resolvedAsOf, tasks, windowDays],
  );
  const netValueClass = analytics.summary.netBacklog > 0
    ? "text-rose-600 dark:text-rose-400"
    : analytics.summary.netBacklog < 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-[var(--text)]";
  const limitationText = analytics.limitations.notes.join(" ");
  const actionFor = (key: string, label: string, taskIds: string[]): (() => void) | null =>
    onDrilldown && taskIds.length > 0 ? () => onDrilldown({ key, label, taskIds }) : null;

  return (
    <Card className="min-w-0 overflow-hidden [contain:inline-size]">
      <section aria-labelledby="flow-backlog-heading" className="grid min-w-0 max-w-full gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
              <h2 id="flow-backlog-heading" className="text-lg font-bold text-[var(--text)]">Flow &amp; Backlog</h2>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]" aria-live="polite">{insightFor(analytics)}</p>
          </div>

          <div
            role="group"
            aria-label="Active-day period"
            className="flex w-full min-w-0 items-center gap-1 overflow-x-auto [contain:inline-size] sm:w-auto sm:max-w-full sm:shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5"
          >
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`${option} active days`}
                aria-pressed={windowDays === option}
                onClick={() => setWindowDays(option)}
                className={`h-8 shrink-0 rounded-lg px-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface)] ${
                  windowDays === option
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
                }`}
              >
                <span>{option}</span><span className="hidden sm:inline"> active days</span>
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-[var(--text-subtle)]">
          {analytics.calendarRange
            ? <><span>UTC range </span><time dateTime={analytics.calendarRange.start}>{analytics.calendarRange.start}</time><span> – </span><time dateTime={analytics.calendarRange.end}>{analytics.calendarRange.end}</time><span> · {analytics.summary.activeDays} active {analytics.summary.activeDays === 1 ? "day" : "days"}</span></>
            : "No UTC activity range is available."}
        </p>

        <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi
            label="Added"
            value={String(analytics.summary.addedTotal)}
            detail={`${rate(analytics.summary.addRatePerActiveDay)} / active day`}
            onSelect={actionFor("window-added", `${analytics.windowAddedIds.length} ${analytics.windowAddedIds.length === 1 ? "task" : "tasks"} added in the selected window`, analytics.windowAddedIds)}
            selected={activeDrilldown?.key === "window-added"}
          />
          <Kpi
            label="Closed"
            value={String(analytics.summary.closedTotal)}
            detail={`${rate(analytics.summary.closeRatePerActiveDay)} / active day`}
            onSelect={actionFor("window-closed", `${analytics.windowClosedIds.length} ${analytics.windowClosedIds.length === 1 ? "task" : "tasks"} closed in the selected window`, analytics.windowClosedIds)}
            selected={activeDrilldown?.key === "window-closed"}
          />
          {analytics.summary.reopenedTotal > 0
            ? <Kpi
                label="Reopened"
                value={String(analytics.summary.reopenedTotal)}
                onSelect={actionFor("window-reopened", `${analytics.windowReopenedIds.length} ${analytics.windowReopenedIds.length === 1 ? "task" : "tasks"} reopened in the selected window`, analytics.windowReopenedIds)}
                selected={activeDrilldown?.key === "window-reopened"}
              />
            : null}
          <div className="min-w-28 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">Net change</dt>
            <dd className={`mt-1 flex items-center gap-1 text-xl font-black tracking-tight ${netValueClass}`}>
              <NetIcon value={analytics.summary.netBacklog} />
              {signedCount(analytics.summary.netBacklog)}
            </dd>
          </div>
          <Kpi
            label="Open now"
            value={String(analytics.summary.currentOpen)}
            detail={`${analytics.summary.currentTotal} total`}
            onSelect={actionFor("current-open", `${analytics.currentOpenIds.length} currently open ${analytics.currentOpenIds.length === 1 ? "task" : "tasks"}`, analytics.currentOpenIds)}
            selected={activeDrilldown?.key === "current-open"}
          />
          <Kpi label="Add rate" value={rate(analytics.summary.addRatePerActiveDay)} detail="per active day" onSelect={null} selected={false} />
          <Kpi label="Close rate" value={rate(analytics.summary.closeRatePerActiveDay)} detail="per active day" onSelect={null} selected={false} />
          <Kpi label="Closure ratio" value={ratio(analytics.summary.closureRatio)} detail="closed / added" onSelect={null} selected={false} />
        </dl>

        <AnalyticsCharts analytics={analytics} {...(onDrilldown ? { onSelect: onDrilldown } : {})} />

        {activeDrilldown ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm" role="status">
            <span className="font-semibold text-[var(--text)]">Work Tree filter: {activeDrilldown.label}</span>
            {onClearDrilldown ? <button type="button" onClick={onClearDrilldown} className="rounded-lg px-2 py-1 text-xs font-bold text-[var(--accent)] underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Clear analytics filter</button> : null}
          </div>
        ) : null}

        <p className="text-xs text-[var(--text-subtle)]" title={limitationText}>
          Current planner files exclude deleted tasks; legacy gaps are inferred from available timestamps.
        </p>
      </section>
    </Card>
  );
}
