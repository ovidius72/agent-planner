import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CopyableBadge, EntityPathBadge, HandoffBadge, ShortIdBadge, formatEntityPath } from "../ui/badges";
import { StatusBadge } from "../ui/status-badge";
import { DragHandle, SortableItem } from "./sortable";
import type { WorkTreeFeature, WorkTreePhase } from "../../lib/dashboard-tree";
import type { Feature, Phase, Task } from "../../lib/types";

/**
 * Presentational rows for the Work Tree. Pure functions of props (expansion
 * and recent-change state are owned by the WorkTree component).
 *
 * Layout — identical responsive shape for all three rows:
 *
 *   mobile (column)        desktop (>= sm)
 *   ───────────────        ───────────────
 *   ▸ F00x/P00x            ▸ F00x/P00x    Title wrapping…     ● status (3/5)
 *     ● status
 *     Title wrapping…
 *
 * Mobile order is deliberately: entity badge → status → title (the title is
 * fluid and always wraps, never overflows). On desktop the status moves to
 * the far right and the title grows to fill.
 *
 * Indentation is minimal on small screens (ml-1.5 pl-3, ~18px per level) so
 * deep feature→phase→task nesting doesn't steal horizontal space; it widens
 * to the comfortable ml-4 pl-4 at >= sm. The in-progress dot lives inline in
 * the badge row (tasks have no gutter). Overflow safety: min-w-0 is propagated
 * through the whole chain and list containers use grid-cols-1.
 */

const TITLE_CLASS =
  "mt-1 block min-w-0 break-words font-mono text-sm font-semibold leading-snug [overflow-wrap:anywhere]";

function UpdatedTag() {
  return (
    <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
      Updated
    </span>
  );
}

/** Status + optional counters + updated tag. Rendered once for mobile, once for desktop. */
function StatusCluster({
  status,
  doneTasks,
  totalTasks,
  recentlyChanged,
  className,
}: {
  status: string;
  doneTasks?: number;
  totalTasks?: number;
  recentlyChanged?: boolean;
  className?: string;
}) {
  const hasCounters = doneTasks != null && totalTasks != null;
  return (
    <div className={className}>
      {recentlyChanged ? <UpdatedTag /> : null}
      {hasCounters ? (
        <span className="text-xs text-[var(--text-muted)]">
          ({doneTasks}/{totalTasks || 0})
        </span>
      ) : null}
      <span className="shrink-0">
        <StatusBadge status={status} />
      </span>
    </div>
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
  highlightedTaskIds,
}: {
  entry: WorkTreeFeature;
  expanded: boolean;
  recentlyChanged: boolean;
  onToggle: () => void;
  isPhaseExpanded: (phaseId: string) => boolean;
  onTogglePhase: (phaseId: string) => void;
  isPhaseRecentlyChanged: (phaseId: string) => boolean;
  isTaskRecentlyChanged: (taskId: string) => boolean;
  highlightedTaskIds: Set<string> | undefined;
}) {
  const { feature, totalTasks, doneTasks, allPhases, hasActiveTask } = entry;

  return (
    <div
      className={`surface-card min-w-0 px-3 py-3 transition-colors sm:px-4 ${feature.status === "in-progress" ? "ap-in-progress" : hasActiveTask ? "border-[color:var(--color-status-in-progress)]/40 bg-[color:color-mix(in_srgb,var(--color-status-in-progress)_7%,transparent)]" : ""} ${feature.status === "done" ? "!opacity-70 !bg-[color:color-mix(in_srgb,var(--color-status-done)_10%,transparent)] !border-[color:color-mix(in_srgb,var(--color-status-done)_35%,transparent)]" : ""} ${recentlyChanged ? "ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]" : ""}`}
    >
      <div
        className={`flex min-w-0 flex-col gap-1.5 rounded-[12px] px-1 py-1 transition-colors hover:bg-[var(--accent-soft)] sm:flex-row sm:items-start sm:justify-between sm:gap-3 ${recentlyChanged ? "bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)]" : ""}`}
      >
        <div className="flex min-w-0 items-start gap-2 sm:flex-1">
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
            aria-label={
              expanded
                ? `Collapse feature ${feature.name}`
                : `Expand feature ${feature.name}`
            }
            aria-expanded={expanded}
          >
            <ChevronRight
              className={`h-4 w-4 transition ${expanded ? "rotate-90" : "rotate-0"}`}
            />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <DragHandle />
              <CopyableBadge
                id={formatEntityPath({ featureNum: feature.number })}
              >
                <EntityPathBadge featureNum={feature.number} />
              </CopyableBadge>
              {feature.shortId ? <ShortIdBadge shortId={feature.shortId} /> : null}
              {hasActiveTask ? (
                <span aria-hidden="true" className="ap-progress-dot" />
              ) : null}
            </div>
            <StatusCluster
              status={feature.status}
              doneTasks={doneTasks}
              totalTasks={totalTasks}
              recentlyChanged={recentlyChanged}
              className="mt-1 flex flex-wrap items-center gap-2 sm:hidden"
            />
            <Link
              to={`/features/${feature.id}`}
              className={`entity-link--feature ${TITLE_CLASS} underline-offset-4 hover:underline`}
            >
              {feature.name}
            </Link>
          </div>
        </div>
        <StatusCluster
          status={feature.status}
          doneTasks={doneTasks}
          totalTasks={totalTasks}
          recentlyChanged={recentlyChanged}
          className="hidden shrink-0 items-center gap-2 sm:flex"
        />
      </div>

      {expanded && allPhases.length > 0 ? (
        <div className="mt-2 ml-1.5 grid grid-cols-1 gap-2 border-l border-[var(--border)] pl-3 sm:ml-4 sm:pl-4">
          <SortableContext items={allPhases.map((p) => p.phase.id)} strategy={verticalListSortingStrategy}>
            {allPhases.map((phaseEntry) => (
              <SortableItem key={phaseEntry.phase.id} id={phaseEntry.phase.id}>
                <PhaseTreeRow
                  feature={feature}
                  phaseEntry={phaseEntry}
                  expanded={isPhaseExpanded(phaseEntry.phase.id)}
                  recentlyChanged={isPhaseRecentlyChanged(phaseEntry.phase.id)}
                  onToggle={() => onTogglePhase(phaseEntry.phase.id)}
                  isTaskRecentlyChanged={isTaskRecentlyChanged}
                  highlightedTaskIds={highlightedTaskIds}
                />
              </SortableItem>
            ))}
          </SortableContext>
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
  highlightedTaskIds,
}: {
  feature: Feature;
  phaseEntry: WorkTreePhase;
  expanded: boolean;
  recentlyChanged: boolean;
  onToggle: () => void;
  isTaskRecentlyChanged: (taskId: string) => boolean;
  highlightedTaskIds: Set<string> | undefined;
}) {
  const { phase, totalTasks, doneTasks, allTasks, hasActiveTask } = phaseEntry;

  return (
    <div
      className={`work-tree-row grid min-w-0 grid-cols-1 gap-2 rounded-[12px] p-3 transition-colors ${phase.status === "in-progress" ? "ap-in-progress" : hasActiveTask ? "border border-[color:color-mix(in_srgb,var(--color-status-in-progress)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--color-status-in-progress)_6%,transparent)]" : ""} ${phase.status === "done" ? "opacity-70 bg-[color:color-mix(in_srgb,var(--color-status-done)_6%,transparent)]" : ""} ${recentlyChanged ? "ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]" : ""}`}
    >
      <div
        className={`flex min-w-0 flex-col gap-1.5 rounded-[10px] px-1 py-1 transition-colors hover:bg-[var(--accent-soft)] sm:flex-row sm:items-start sm:justify-between sm:gap-3 ${recentlyChanged ? "bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]" : ""}`}
      >
        <div className="flex min-w-0 items-start gap-2 sm:flex-1">
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
            aria-label={
              expanded
                ? `Collapse phase ${phase.title}`
                : `Expand phase ${phase.title}`
            }
            aria-expanded={expanded}
          >
            <ChevronRight
              className={`h-4 w-4 transition ${expanded ? "rotate-90" : "rotate-0"}`}
            />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <DragHandle />
              <CopyableBadge
                id={formatEntityPath({
                  featureNum: feature?.number,
                  phaseNum: phase.number,
                })}
              >
                <EntityPathBadge
                  featureNum={feature?.number}
                  phaseNum={phase.number}
                />
              </CopyableBadge>
              {phase.shortId ? <ShortIdBadge shortId={phase.shortId} /> : null}
              {phase.handoff ? <HandoffBadge updatedAt={phase.handoffUpdatedAt} /> : null}
              {hasActiveTask ? (
                <span aria-hidden="true" className="ap-progress-dot" />
              ) : null}
            </div>
            <StatusCluster
              status={phase.status}
              doneTasks={doneTasks}
              totalTasks={totalTasks}
              recentlyChanged={recentlyChanged}
              className="mt-1 flex flex-wrap items-center gap-2 sm:hidden"
            />
            <Link
              to={`/features/${feature.id}/phases/${phase.id}`}
              className={`entity-link--phase ${TITLE_CLASS} underline-offset-4 hover:underline`}
            >
              {phase.title}
            </Link>
          </div>
        </div>
        <StatusCluster
          status={phase.status}
          doneTasks={doneTasks}
          totalTasks={totalTasks}
          recentlyChanged={recentlyChanged}
          className="hidden shrink-0 items-center gap-2 sm:flex"
        />
      </div>

      {expanded ? (
        allTasks.length > 0 ? (
          <div className="ml-1.5 grid grid-cols-1 gap-1 border-l border-[var(--border)] pl-3 sm:ml-4 sm:pl-4">
            <SortableContext items={allTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {allTasks.map((task) => (
                <SortableItem key={task.id} id={task.id}>
                  <TaskTreeRow
                    feature={feature}
                    phase={phase}
                    task={task}
                    recentlyChanged={isTaskRecentlyChanged(task.id)}
                    highlighted={highlightedTaskIds?.has(task.id)}
                  />
                </SortableItem>
              ))}
            </SortableContext>
          </div>
        ) : (
          <p className="ml-1.5 text-xs italic text-[var(--text-subtle)] sm:ml-4">
            No tasks
          </p>
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
  highlighted,
}: {
  feature: Feature;
  phase: Phase;
  task: Task;
  recentlyChanged: boolean;
  highlighted: boolean | undefined;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-[10px] px-2 py-2 transition-colors hover:bg-[var(--accent-soft)] sm:flex-row sm:items-start sm:justify-between sm:gap-3 ${task.status === "in-progress" ? "ap-in-progress" : ""} ${task.status === "done" ? "opacity-60 bg-[color:color-mix(in_srgb,var(--color-status-done)_6%,transparent)] text-[var(--text-muted)]" : ""} ${recentlyChanged ? "ring-1 ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]" : ""} ${highlighted ? "ap-search-hit" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <DragHandle />
          <CopyableBadge
            id={formatEntityPath({
              featureNum: feature?.number,
              phaseNum: phase.number,
              taskNum: task.number,
            })}
          >
            <EntityPathBadge
              featureNum={feature?.number}
              phaseNum={phase.number}
              taskNum={task.number}
            />
          </CopyableBadge>
          {task.shortId ? <ShortIdBadge shortId={task.shortId} /> : null}
          {task.status === "in-progress" ? (
            <span aria-hidden="true" className="ap-progress-dot" />
          ) : null}
        </div>
        <StatusCluster
          status={task.status}
          recentlyChanged={recentlyChanged}
          className="mt-1 flex flex-wrap items-center gap-2 sm:hidden"
        />
        <Link
          to={`/features/${feature.id}/phases/${phase.id}/tasks/${task.id}`}
          className={`entity-link--task ${TITLE_CLASS} underline-offset-4 hover:underline`}
        >
          {task.title}
        </Link>
      </div>
      <StatusCluster
        status={task.status}
        recentlyChanged={recentlyChanged}
        className="hidden shrink-0 items-center gap-2 sm:flex"
      />
    </div>
  );
}
