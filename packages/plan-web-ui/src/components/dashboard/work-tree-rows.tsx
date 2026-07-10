import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { EntityBadge, ParentBadge } from "../ui/badges";
import { StatusBadge } from "../ui/status-badge";
import type { WorkTreeFeature, WorkTreePhase } from "../../lib/dashboard-tree";
import type { Feature, Phase, Task } from "../../lib/types";

/**
 * Presentational rows for the Work Tree. Each is a pure function of its props:
 * expansion and recent-change state are passed down from the WorkTree
 * component (which owns them via useDashboardTree), so the rows have no hooks
 * of their own and stay trivial to read.
 */

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
        <div className="flex min-w-0 items-start gap-2 font-mono text-sm font-semibold">
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
            aria-label={expanded ? `Collapse feature ${feature.name}` : `Expand feature ${feature.name}`}
            aria-expanded={expanded}
          >
            <ChevronRight className={`h-4 w-4 transition ${expanded ? "rotate-90" : "rotate-0"}`} />
          </button>
          <span className="text-[var(--text-subtle)]">└─</span>
          <Link to={`/features/${feature.id}`} className="entity-link--feature inline-flex min-w-0 items-center gap-2 truncate underline-offset-4 hover:underline">
            {hasActiveTask ? (
              <span aria-hidden="true" className="ap-progress-dot" />
            ) : null}
            <div className="flex items-center gap-2">
              <EntityBadge type="feature" number={feature.number} />
              <span className="truncate">{feature.name}</span>
            </div>
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {recentlyChanged ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Updated</span> : null}
          <span className="text-xs text-[var(--text-muted)]">({doneTasks}/{totalTasks || 0})</span>
          <StatusBadge status={feature.status} />
        </div>
      </div>

      {expanded && allPhases.length > 0 ? (
        <div className="mt-3 ml-4 grid gap-2 border-l border-[var(--border)] pl-4">
          {allPhases.map((phaseEntry, phaseIndex) => (
            <PhaseTreeRow
              key={phaseEntry.phase.id}
              feature={feature}
              phaseEntry={phaseEntry}
              phaseIndex={phaseIndex}
              phaseCount={allPhases.length}
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
  phaseIndex,
  phaseCount,
  expanded,
  recentlyChanged,
  onToggle,
  isTaskRecentlyChanged,
}: {
  feature: Feature;
  phaseEntry: WorkTreePhase;
  phaseIndex: number;
  phaseCount: number;
  expanded: boolean;
  recentlyChanged: boolean;
  onToggle: () => void;
  isTaskRecentlyChanged: (taskId: string) => boolean;
}) {
  const { phase, totalTasks, doneTasks, allTasks, hasActiveTask } = phaseEntry;
  const phasePrefix = phaseIndex === phaseCount - 1 ? "└─" : "├─";

  return (
    <div className={`grid gap-2 transition-colors ${phase.status === "in-progress" ? "ap-in-progress rounded-[12px]" : hasActiveTask ? "rounded-[12px] border border-[color:color-mix(in_srgb,var(--color-status-in-progress)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--color-status-in-progress)_6%,transparent)] px-2 py-2" : ""} ${phase.status === "done" ? "rounded-[12px] opacity-70 bg-[color:color-mix(in_srgb,var(--color-status-done)_6%,transparent)] px-2 py-2" : ""} ${recentlyChanged ? "rounded-[12px] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-2" : ""}`}>
      <div className={`flex items-start justify-between gap-3 rounded-[10px] px-1 py-1 transition-colors hover:bg-[var(--accent-soft)] ${recentlyChanged ? "bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]" : ""}`}>
        <div className="flex min-w-0 items-start gap-2 font-mono text-sm">
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
            aria-label={expanded ? `Collapse phase ${phase.title}` : `Expand phase ${phase.title}`}
            aria-expanded={expanded}
          >
            <ChevronRight className={`h-4 w-4 transition ${expanded ? "rotate-90" : "rotate-0"}`} />
          </button>
          <span className="text-[var(--text-subtle)]">{phasePrefix}</span>
          <Link to={`/features/${feature.id}/phases/${phase.id}`} className="entity-link--phase inline-flex min-w-0 items-center gap-2 truncate underline-offset-4 hover:underline">
            {hasActiveTask ? (
              <span aria-hidden="true" className="ap-progress-dot" />
            ) : null}
            <div className="flex items-center gap-2">
              <EntityBadge type="phase" number={phase.number} />
              <ParentBadge type="phase" featureNum={feature?.number} />
              <span className="truncate">{phase.title}</span>
            </div>
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {recentlyChanged ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Updated</span> : null}
          <span className="text-xs text-[var(--text-muted)]">({doneTasks}/{totalTasks || 0})</span>
          <StatusBadge status={phase.status} />
        </div>
      </div>

      {expanded ? (
        allTasks.length > 0 ? (
          <div className="ml-4 grid gap-1 border-l border-[var(--border)] pl-4">
            {allTasks.map((task, taskIndex) => (
              <TaskTreeRow
                key={task.id}
                feature={feature}
                phase={phase}
                task={task}
                taskIndex={taskIndex}
                taskCount={allTasks.length}
                recentlyChanged={isTaskRecentlyChanged(task.id)}
              />
            ))}
          </div>
        ) : (
          <p className="ml-4 font-mono text-xs text-[var(--text-subtle)]">│  └─ no tasks</p>
        )
      ) : null}
    </div>
  );
}

export function TaskTreeRow({
  feature,
  phase,
  task,
  taskIndex,
  taskCount,
  recentlyChanged,
}: {
  feature: Feature;
  phase: Phase;
  task: Task;
  taskIndex: number;
  taskCount: number;
  recentlyChanged: boolean;
}) {
  const taskPrefix = taskIndex === taskCount - 1 ? "└─" : "├─";

  return (
    <div className={`flex items-start justify-between gap-3 rounded-[10px] px-1 py-1 font-mono text-sm transition-colors hover:bg-[var(--accent-soft)] ${task.status === "in-progress" ? "ap-in-progress" : ""} ${task.status === "done" ? "opacity-60 bg-[color:color-mix(in_srgb,var(--color-status-done)_6%,transparent)]" : ""} ${task.status === "done" ? "text-[var(--text-muted)]" : ""} ${recentlyChanged ? "ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]" : ""}`}>
      <Link
        to={`/features/${feature.id}/phases/${phase.id}/tasks/${task.id}`}
        className="min-w-0 text-[var(--text-muted)] transition hover:text-[var(--accent)]"
      >
        <span className="text-[var(--text-subtle)]">│  {taskPrefix} </span>
        <span className="inline-flex items-center gap-2">
          {task.status === "in-progress" ? (
            <span aria-hidden="true" className="ap-progress-dot" />
          ) : null}
          <div className="flex items-center gap-2">
            <EntityBadge type="task" number={task.number} />
            <ParentBadge type="task" phaseNum={phase.number} featureNum={feature?.number} />
            <span className="entity-link--task underline-offset-4 hover:underline">{task.title}</span>
          </div>
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {recentlyChanged ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Updated</span> : null}
        <span className="shrink-0"><StatusBadge status={task.status} /></span>
      </div>
    </div>
  );
}
