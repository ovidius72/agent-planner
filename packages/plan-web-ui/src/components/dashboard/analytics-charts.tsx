import type { DashboardAnalytics, DashboardAnalyticsDayPoint } from "../../lib/dashboard-analytics";

export interface AnalyticsDrilldown {
  key: string;
  label: string;
  taskIds: string[];
}

export type AnalyticsDrilldownHandler = (drilldown: AnalyticsDrilldown) => void;

const CHART_HEIGHT = 184;
const TOP = 16;
const RIGHT = 16;
const BOTTOM = 30;
const LEFT = 34;

function chartWidth(_pointCount: number): number {
  // Keep a fixed coordinate system so 7/21/60-point series scale into the
  // available inline size instead of expanding the document on touch layouts.
  return 420;
}

function xFor(index: number, count: number, width: number): number {
  const plotWidth = width - LEFT - RIGHT;
  if (count <= 1) return LEFT + plotWidth / 2;
  return LEFT + (index / (count - 1)) * plotWidth;
}

function yFor(value: number, maxValue: number): number {
  const plotHeight = CHART_HEIGHT - TOP - BOTTOM;
  return TOP + plotHeight - (value / Math.max(maxValue, 1)) * plotHeight;
}

function labelIndexes(count: number): Set<number> {
  if (count <= 3) return new Set(Array.from({ length: count }, (_, index) => index));
  return new Set([0, Math.floor((count - 1) / 2), count - 1]);
}

function shortDate(date: string): string {
  return date.slice(5);
}

function ChartFrame({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <article className="min-w-0 max-w-full overflow-hidden [contain:inline-size] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
      <h3 className="text-sm font-bold text-[var(--text)]">{title}</h3>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>
      <div className="mt-3">{children}</div>
    </article>
  );
}

function eventLabel(kind: "added" | "closed" | "reopened", count: number, date: string): string {
  return `${count} ${count === 1 ? "task" : "tasks"} ${kind} on ${date}`;
}

function FlowChart({ points, onSelect }: { points: DashboardAnalyticsDayPoint[]; onSelect?: AnalyticsDrilldownHandler }) {
  if (points.length === 0) {
    return (
      <ChartFrame title="Added vs Closed" description="Task-flow events by active UTC day.">
        <p className="text-sm text-[var(--text-muted)]">No active-day flow data.</p>
      </ChartFrame>
    );
  }

  const width = chartWidth(points.length);
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.added, point.closed]));
  const plotBottom = CHART_HEIGHT - BOTTOM;
  const groupStep = (width - LEFT - RIGHT) / Math.max(points.length, 1);
  const barWidth = Math.max(1.5, Math.min(10, groupStep * 0.28));
  const labels = labelIndexes(points.length);

  return (
    <ChartFrame title="Added vs Closed" description="Solid bars are additions; striped bars are closures. Reopens and net change are available in the data table.">
      <div className="flex items-center gap-4 text-xs font-semibold text-[var(--text-muted)]" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-[var(--accent)]" />Added (solid)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-[var(--text-muted)] bg-[repeating-linear-gradient(135deg,var(--text-muted)_0_1px,transparent_1px_3px)]" />Closed (striped)</span>
      </div>
      <div className="mt-2 w-full min-w-0 max-w-full overflow-x-auto [contain:inline-size] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5" data-responsive-chart="horizontal-scroll">
        <svg width="100%" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} data-coordinate-width={width} className="block h-auto max-h-[184px] max-w-full" role="img" aria-labelledby="flow-chart-title flow-chart-desc">
          <title id="flow-chart-title">Added versus closed tasks by active UTC day</title>
          <desc id="flow-chart-desc">Grouped bars use solid shapes for additions and striped shapes for closures. Exact values are provided in an accessible table.</desc>
          <defs>
            <pattern id="flow-closed-stripes" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="2" />
            </pattern>
          </defs>
          <line x1={LEFT} y1={TOP} x2={LEFT} y2={plotBottom} stroke="var(--border-strong)" />
          <line x1={LEFT} y1={plotBottom} x2={width - RIGHT} y2={plotBottom} stroke="var(--border-strong)" />
          <text x={LEFT - 6} y={TOP + 4} textAnchor="end" className="fill-[var(--text-subtle)] text-[10px]">{maxValue}</text>
          <text x={LEFT - 6} y={plotBottom + 4} textAnchor="end" className="fill-[var(--text-subtle)] text-[10px]">0</text>
          {points.map((point, index) => {
            const x = LEFT + (index + 0.5) * groupStep;
            const addedY = yFor(point.added, maxValue);
            const closedY = yFor(point.closed, maxValue);
            return (
              <g key={point.date}>
                <title>{`${point.date}: ${point.added} added, ${point.closed} closed, ${point.reopened} reopened, net backlog ${point.netBacklog}`}</title>
                {onSelect && point.addedTaskIds.length > 0 ? (
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`Filter Work Tree to ${eventLabel("added", point.addedTaskIds.length, point.date)}`}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    onClick={() => onSelect({ key: `added:${point.date}`, label: eventLabel("added", point.addedTaskIds.length, point.date), taskIds: point.addedTaskIds })}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSelect({ key: `added:${point.date}`, label: eventLabel("added", point.addedTaskIds.length, point.date), taskIds: point.addedTaskIds });
                    }}
                  >
                    <rect x={x - barWidth - 1} y={addedY} width={barWidth} height={Math.max(2, plotBottom - addedY)} rx="1.5" fill="var(--accent)" />
                  </g>
                ) : <rect x={x - barWidth - 1} y={addedY} width={barWidth} height={Math.max(0, plotBottom - addedY)} rx="1.5" fill="var(--accent)" />}
                {onSelect && point.closedTaskIds.length > 0 ? (
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`Filter Work Tree to ${eventLabel("closed", point.closedTaskIds.length, point.date)}`}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    onClick={() => onSelect({ key: `closed:${point.date}`, label: eventLabel("closed", point.closedTaskIds.length, point.date), taskIds: point.closedTaskIds })}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSelect({ key: `closed:${point.date}`, label: eventLabel("closed", point.closedTaskIds.length, point.date), taskIds: point.closedTaskIds });
                    }}
                  >
                    <rect x={x + 1} y={closedY} width={barWidth} height={Math.max(2, plotBottom - closedY)} rx="1.5" fill="url(#flow-closed-stripes)" stroke="var(--text-muted)" strokeWidth="0.5" />
                  </g>
                ) : <rect x={x + 1} y={closedY} width={barWidth} height={Math.max(0, plotBottom - closedY)} rx="1.5" fill="url(#flow-closed-stripes)" stroke="var(--text-muted)" strokeWidth="0.5" />}
                {labels.has(index) ? <text x={x} y={CHART_HEIGHT - 9} textAnchor="middle" className="fill-[var(--text-subtle)] text-[10px]">{shortDate(point.date)}</text> : null}
              </g>
            );
          })}
        </svg>
      </div>
      <details className="mt-2 min-w-0 max-w-full overflow-hidden [contain:inline-size] text-xs text-[var(--text-muted)]">
        <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">View exact flow data</summary>
        <div className="mt-2 w-full min-w-0 max-w-full overflow-x-auto [contain:inline-size] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5">
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">Exact added, closed, reopened, and net backlog values by active UTC day</caption>
            <thead><tr className="border-b border-[var(--border)]"><th className="px-2 py-1">Date</th><th className="px-2 py-1">Added</th><th className="px-2 py-1">Closed</th><th className="px-2 py-1">Reopened</th><th className="px-2 py-1">Net backlog</th></tr></thead>
            <tbody>{points.map((point) => (
              <tr key={point.date} className="border-b border-[var(--border)] last:border-0">
                <th className="px-2 py-1 font-mono font-medium">{point.date}</th>
                <td className="px-2 py-1">{onSelect && point.addedTaskIds.length > 0 ? <button type="button" className="font-bold underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" onClick={() => onSelect({ key: `added:${point.date}`, label: eventLabel("added", point.addedTaskIds.length, point.date), taskIds: point.addedTaskIds })}>{point.added}</button> : point.added}</td>
                <td className="px-2 py-1">{onSelect && point.closedTaskIds.length > 0 ? <button type="button" className="font-bold underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" onClick={() => onSelect({ key: `closed:${point.date}`, label: eventLabel("closed", point.closedTaskIds.length, point.date), taskIds: point.closedTaskIds })}>{point.closed}</button> : point.closed}</td>
                <td className="px-2 py-1">{onSelect && point.reopenedTaskIds.length > 0 ? <button type="button" className="font-bold underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" onClick={() => onSelect({ key: `reopened:${point.date}`, label: eventLabel("reopened", point.reopenedTaskIds.length, point.date), taskIds: point.reopenedTaskIds })}>{point.reopened}</button> : point.reopened}</td>
                <td className="px-2 py-1">{point.netBacklog}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </ChartFrame>
  );
}

function linePath(points: DashboardAnalyticsDayPoint[], width: number, value: (point: DashboardAnalyticsDayPoint) => number, maxValue: number): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index, points.length, width).toFixed(2)} ${yFor(Math.max(0, value(point)), maxValue).toFixed(2)}`).join(" ");
}

function BurnUpChart({ points }: { points: DashboardAnalyticsDayPoint[] }) {
  if (points.length === 0) {
    return (
      <ChartFrame title="Scope vs Completion" description="Cumulative burn-up across the selected active days.">
        <p className="text-sm text-[var(--text-muted)]">No cumulative flow data.</p>
      </ChartFrame>
    );
  }

  const width = chartWidth(points.length);
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.cumulativeScope, point.cumulativeCompletion]));
  const plotBottom = CHART_HEIGHT - BOTTOM;
  const labels = labelIndexes(points.length);
  const scopePath = linePath(points, width, (point) => point.cumulativeScope, maxValue);
  const completionPath = linePath(points, width, (point) => point.cumulativeCompletion, maxValue);

  return (
    <ChartFrame title="Scope vs Completion" description="The solid scope line and dashed completion line expose the open-backlog gap without relying on color.">
      <div className="flex items-center gap-4 text-xs font-semibold text-[var(--text-muted)]" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 bg-[var(--accent)]" />Scope (solid)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-[var(--color-status-done)]" />Completion (dashed)</span>
      </div>
      <div className="mt-2 w-full min-w-0 max-w-full overflow-x-auto [contain:inline-size] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5" data-responsive-chart="horizontal-scroll">
        <svg width="100%" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} data-coordinate-width={width} className="block h-auto max-h-[184px] max-w-full" role="img" aria-labelledby="burnup-chart-title burnup-chart-desc">
          <title id="burnup-chart-title">Cumulative scope versus completion</title>
          <desc id="burnup-chart-desc">A solid scope line and dashed completion line show the cumulative open-backlog gap. Exact values are provided in an accessible table.</desc>
          <line x1={LEFT} y1={TOP} x2={LEFT} y2={plotBottom} stroke="var(--border-strong)" />
          <line x1={LEFT} y1={plotBottom} x2={width - RIGHT} y2={plotBottom} stroke="var(--border-strong)" />
          <text x={LEFT - 6} y={TOP + 4} textAnchor="end" className="fill-[var(--text-subtle)] text-[10px]">{maxValue}</text>
          <text x={LEFT - 6} y={plotBottom + 4} textAnchor="end" className="fill-[var(--text-subtle)] text-[10px]">0</text>
          <path d={scopePath} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          <path d={completionPath} fill="none" stroke="var(--color-status-done)" strokeWidth="2.5" strokeDasharray="6 4" />
          {points.map((point, index) => {
            const x = xFor(index, points.length, width);
            return (
              <g key={point.date}>
                <title>{`${point.date}: cumulative scope ${point.cumulativeScope}, cumulative completion ${point.cumulativeCompletion}, open backlog ${point.netBacklog}`}</title>
                <circle cx={x} cy={yFor(point.cumulativeScope, maxValue)} r="2.5" fill="var(--accent)" />
                <rect x={x - 2.5} y={yFor(Math.max(0, point.cumulativeCompletion), maxValue) - 2.5} width="5" height="5" fill="var(--color-status-done)" />
                {labels.has(index) ? <text x={x} y={CHART_HEIGHT - 9} textAnchor="middle" className="fill-[var(--text-subtle)] text-[10px]">{shortDate(point.date)}</text> : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="sr-only">
        <table>
          <caption>Exact cumulative scope, completion, and open backlog values by active UTC day</caption>
          <thead><tr><th>Date</th><th>Scope</th><th>Completion</th><th>Open backlog</th></tr></thead>
          <tbody>{points.map((point) => <tr key={point.date}><th>{point.date}</th><td>{point.cumulativeScope}</td><td>{point.cumulativeCompletion}</td><td>{point.netBacklog}</td></tr>)}</tbody>
        </table>
      </div>
    </ChartFrame>
  );
}

function AgingChart({ analytics, onSelect }: { analytics: DashboardAnalytics; onSelect?: AnalyticsDrilldownHandler }) {
  const maxCount = Math.max(1, ...analytics.agingBuckets.map((bucket) => bucket.count));
  const total = analytics.agingBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return (
    <ChartFrame title="Open-task aging" description="Whole UTC days since creation or the latest reopen.">
      {total === 0 ? <p className="mb-3 text-sm text-[var(--text-muted)]">No open tasks have an aging anchor at this cutoff.</p> : null}
      <ul className="grid gap-2" aria-label="Open-task aging buckets">
        {analytics.agingBuckets.map((bucket) => {
          const content = <>
            <span className="font-semibold text-[var(--text-muted)]">{bucket.label}</span>
            <span className="h-3 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-card)]">
              <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${(bucket.count / maxCount) * 100}%` }} />
            </span>
            <span className="text-right font-bold tabular-nums text-[var(--text)]" aria-label={`${bucket.count} tasks`}>{bucket.count}</span>
          </>;
          return (
            <li key={bucket.label}>
              {onSelect && bucket.taskIds.length > 0 ? (
                <button
                  type="button"
                  className="grid w-full grid-cols-[3.75rem_minmax(0,1fr)_2rem] items-center gap-2 rounded-lg text-xs hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  aria-label={`Filter Work Tree to ${bucket.count} ${bucket.count === 1 ? "task" : "tasks"} aged ${bucket.label}`}
                  onClick={() => onSelect({ key: `aging:${bucket.label}`, label: `${bucket.count} ${bucket.count === 1 ? "task" : "tasks"} aged ${bucket.label}`, taskIds: bucket.taskIds })}
                >{content}</button>
              ) : <div className="grid grid-cols-[3.75rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">{content}</div>}
            </li>
          );
        })}
      </ul>
      <div className="sr-only">
        <table>
          <caption>Exact open-task aging bucket counts</caption>
          <thead><tr><th>Age</th><th>Open tasks</th></tr></thead>
          <tbody>{analytics.agingBuckets.map((bucket) => <tr key={bucket.label}><th>{bucket.label}</th><td>{bucket.count}</td></tr>)}</tbody>
        </table>
      </div>
    </ChartFrame>
  );
}

export function AnalyticsCharts({ analytics, onSelect }: { analytics: DashboardAnalytics; onSelect?: AnalyticsDrilldownHandler }) {
  const selectProps = onSelect ? { onSelect } : {};
  return (
    <div className="grid min-w-0 max-w-full overflow-hidden gap-3 xl:grid-cols-2">
      <FlowChart points={analytics.dailyPoints} {...selectProps} />
      <BurnUpChart points={analytics.dailyPoints} />
      <div className="min-w-0 xl:col-span-2">
        <AgingChart analytics={analytics} {...selectProps} />
      </div>
    </div>
  );
}
