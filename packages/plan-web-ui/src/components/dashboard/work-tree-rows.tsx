import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { EntityPathBadge } from "../ui/badges";
import { StatusBadge } from "../ui/status-badge";
import type { WorkTreeFeature, WorkTreePhase } from "../../lib/dashboard-tree";
import type { Feature, Phase, Task } from "../../lib/types";

/**
 * Presentational rows for the Work Tree. Each is a pure function of its props:
 * expansion and recent-change state are passed down from the WorkTree
 * component (which owns them via useDashboardTree), so the rows have no hooks
 * of their own and stay trivial to read.
 *
 * Layout (all three rows share it): a fixed-width gutter (chevron for
 * expandable rows, progress dot for tasks), then a flex-1 column with the
 * unified entity-path badge (F00x[/P00x][/T00x], color-coded) on top and the
 * title below it, wrapping freely instead of overflowing. Status + counters
 * sit on the right and stack vertically on phones.
 */

const TITLE_CLASS =
  "mt-1 block break-words font-mono text-sm font-semibold leading-snug [overflow-wrap:anywhere]";

function UpdatedTag() {
  return (
    <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
      Updated
    </span>
  );
}

export function FeatureTreeRow({
  entry,
  expanded,
  recentlyChanged,
  onToggle,
  isPhaseExpanded,
  onTogglePhase,
  isPhaseRecentlyChanged,
  isTaskRecentlyChanged,
}: {
  entry: WorkTreeFeature;
  expanded: boolean;
  recentlyChanged: boolean;
  onToggle: () => void;
  isPhaseExpanded: (phaseId: string) => boolean;
  onTogglePhase: (phaseId: string) => void;
  isPhaseRecentlyChanged: (phaseId: string) => boolean;
  isTaskRecentlyChanged: (taskId: string) => boolean;
}) {
  const { feature, totalTasks, doneTasks, allPhases, hasActiveTask } = entry;

  return (
    <div className={`surface-card px-4 py-3 transition-colors ${feature.status === "in-progress" ? "ap-in-progress" : hasActiveTask ? "border-[color:var(--color-status-in-progress)]/40 bg-[color:color-mix(in_srgb,var(--color-status-in-progress)_7%,transparent)]" : ""} ${feature.status === "done" ? "!opacity-70 !bg-[color:color-mix(in_srgb,var(--color-status-done)_10%,transparent)] !border-[color:color-mix(in_srgb,var(--color-status-done)_35%,transparent)]" : ""} ${recentlyChanged ? "ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]" : ""}`}>
      <div className={`flex items-start justify-between gap-3 rounded-[12px] px-1 py-1 transition-colors hover:bg-[var(--accent-soft)] ${recentlyChanged ? "bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)]" : ""}`}>
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
            aria-label={expanded ? `Collapse feature ${feature.name}` : `Expand feature ${feature.name}`}
            aria-expanded={expanded}
          >
            <ChevronRight className={`h-4 w-4 transition ${expanded ? "rotate-90" : "rotate-0"}`} />
          </button>
          <Link to={`/features/${feature.id}`} className="entity-link--feature min-w-0 flex-1 underline-offset-4 hover:underline">
            <div className="flex flex-wrap items-center gap-2">
              <EntityPathBadge featureNum={feature.number} />
              {hasActiveTask ? (
                <span aria-hidden="true" className="ap-progress-dot" />
              ) : null}
            </div>
            <div className={TITLE_CLASS}>{feature.name}</div>
          </Link>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          {recentlyChanged ? <UpdatedTag /> : null}
          <span className="text-xs text-[var(--text-muted)]">({doneTasks}/{totalTasks || 0})</span>
          <StatusBadge status={feature.status} />
        </div>
      </div>

      {expanded && allPhases.length > 0 ? (
        <div className="mt-3 ml-4 grid gap-2 border-l border-[var(--border)] pl-4">
          {allPhases.map((phaseEntry) => (
            <PhaseTreeRow
              key={phaseEntry.phase.id}
              feature={feature}
              phaseEntry={phaseEntry}
              expanded={isPhaseExpanded(phaseEntry.phase.id)}
              recentlyChanged={isPhaseRecentlyChanged(phaseEntry.phase.id)}
              onToggle={() => onTogglePhase(phaseEntry.phase.id)}
              isTaskRecentlyChanged={isTaskRecentlyChanged}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PhaseTreeRow({
  feature,
  phaseEntry,
  expanded,
  recentlyChanged,
  onToggle,
  isTaskRecentlyChanged,
}: {
  feature: Feature;
  phaseEntry: WorkTreePhase;
  expanded: boolean;
  recentlyChanged: boolean;
  onToggle: () => void;
  isTaskRecentlyChanged: (taskId: string) => boolean;
}) {
  const { phase, totalTasks, doneTasks, allTasks, hasActiveTask } = phaseEntry;

  return (
    <div className={`grid gap-2 transition-colors ${phase.status === "in-progress" ? "ap-in-progress rounded-[12px]" : hasActiveTask ? "rounded-[12px] border border-[color:color-mix(in_srgb,var(--color-status-in-progress)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--color-status-in-progress)_6%,transparent)] px-2 py-2" : ""} ${phase.status === "done" ? "rounded-[12px] opacity-70 bg-[color:color-mix(in_srgb,var(--color-status-done)_6%,transparent)] px-2 py-2" : ""} ${recentlyChanged ? "rounded-[12px] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-2" : ""}`}>
      <div className={`flex items-start justify-between gap-3 rounded-[10px] px-1 py-1 transition-colors hover:bg-[var(--accent-soft)] ${recentlyChanged ? "bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]" : ""}`}>
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
            aria-label={expanded ? `Collapse phase ${phase.title}` : `Expand phase ${phase.title}`}
            aria-expanded={expanded}
          >
            <ChevronRight className={`h-4 w-4 transition ${expanded ? "rotate-90" : "rotate-0"}`} />
          </button>
          <Link to={`/features/${feature.id}/phases/${phase.id}`} className="entity-link--phase min-w-0 flex-1 underline-offset-4 hover:underline">
            <div className="flex flex-wrap items-center gap-2">
              <EntityPathBadge featureNum={feature?.number} phaseNum={phase.number} />
              {hasActiveTask ? (
                <span aria-hidden="true" className="ap-progress-dot" />
              ) : null}
            </div>
            <div className={TITLE_CLASS}>{phase.title}</div>
          </Link>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          {recentlyChanged ? <UpdatedTag /> : null}
          <span className="text-xs text-[var(--text-muted)]">({doneTasks}/{totalTasks || 0})</span>
          <StatusBadge status={phase.status} />
        </div>
      </div>

      {expanded ? (
        allTasks.length > 0 ? (
          <div className="ml-4 grid gap-1 border-l border-[var(--border)] pl-4">
            {allTasks.map((task) => (
              <TaskTreeRow
                key={task.id}
                feature={feature}
                phase={phase}
                task={task}
                recentlyChanged={isTaskRecentlyChanged(task.id)}
              />
            ))}
          </div>
        ) : (
          <p className="ml-4 text-xs italic text-[var(--text-subtle)]">No tasks</p>
        )
      ) : null}
    </div>
  );
}

export function TaskTreeRow({
  feature,
  phase,
  task,
  recentlyChanged,
}: {
  feature: Feature;
  phase: Phase;
  task: Task;
  recentlyChanged: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 rounded-[10px] px-1 py-1 transition-colors hover:bg-[var(--accent-soft)] ${task.status === "in-progress" ? "ap-in-progress" : ""} ${task.status === "done" ? "opacity-60 bg-[color:color-mix(in_srgb,var(--color-status-done)_6%,transparent)] text-[var(--text-muted)]" : ""} ${recentlyChanged ? "ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]" : ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center">
          {task.status === "in-progress" ? (
            <span aria-hidden="true" className="ap-progress-dot" />
          ) : null}
        </span>
        <Link
          to={`/features/${feature.id}/phases/${phase.id}/tasks/${task.id}`}
          className="entity-link--task min-w-0 flex-1 underline-offset-4 hover:underline"
        >
          <div className="flex flex-wrap items-center gap-2">
            <EntityPathBadge featureNum={feature?.number} phaseNum={phase.number} taskNum={task.number} />
          </div>
          <div className={TITLE_CLASS}>{task.title}</div>
        </Link>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
        {recentlyChanged ? <UpdatedTag /> : null}
        <span className="shrink-0"><StatusBadge status={task.status} /></span>
      </div>
    </div>
  );
}
