import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Form, Link, useFetcher } from "react-router-dom";
import { featureStatuses } from "../../lib/statuses";
import { formatStatusSummary, type StatusSummary } from "../../lib/status-summary";
import type { Feature } from "../../lib/types";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { EntityBadge } from "../ui/badges";

export interface FeatureActivitySummary {
  currentPhase: string | undefined;
  activeTasks: string[];
  remainingTasks: number;
  doneTasks: number;
  blockedTasks: number;
}

export function FeatureRow({
  feature,
  phasesCount,
  tasksCount,
  phaseSummary,
  taskSummary,
  activity,
}: {
  feature: Feature;
  phasesCount: number;
  tasksCount: number;
  phaseSummary: StatusSummary;
  taskSummary: StatusSummary;
  activity?: FeatureActivitySummary | undefined;
}) {
  const statusFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const optimisticStatus = statusFetcher.formData?.get("status") as Feature["status"] | null;
  const status = optimisticStatus ?? feature.status;
  const isUpdatingStatus = statusFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";
  const phaseStatusText = formatStatusSummary(phaseSummary);
  const taskStatusText = formatStatusSummary(taskSummary);

  const shortDescription = feature.description || (activity
    ? `${activity.doneTasks}/${tasksCount} done · ${activity.remainingTasks} left${activity.blockedTasks ? ` · ${activity.blockedTasks} blocked` : ""}`
    : "");

  return (
    <div className="surface-card px-4 py-2">
      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,132px)_minmax(0,152px)_124px_44px_44px] xl:items-center">
        <div className="flex min-w-0 items-start justify-between gap-3 xl:contents">
          <div className="flex min-w-0 flex-col items-start gap-1 lg:flex-row lg:items-center lg:gap-2">
            <div className="flex items-center gap-2">
              <EntityBadge type="feature" number={feature.number} />
              <span className="shrink-0"><StatusBadge status={status} /></span>
            </div>
            <Link to={`/features/${feature.id}`} className="entity-link--feature min-w-0 w-full truncate text-sm font-semibold underline-offset-4 hover:underline lg:w-auto">
              {feature.name}
            </Link>
          </div>

          <div className="flex items-center gap-2 xl:hidden">
            <Link to={`/features/${feature.id}/edit`} aria-label={`Edit feature ${feature.name}`}>
              <Button type="button" variant="secondary" className="min-h-8 w-8 rounded-[10px] px-0 text-[var(--text-muted)] hover:text-[var(--text)]">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </Link>

            <deleteFetcher.Form method="post" action={`/features/${feature.id}/delete`} onSubmit={(event) => {
              if (!window.confirm(`Delete feature “${feature.name}”? This cannot be undone.`)) event.preventDefault();
            }}>
              <Button type="submit" variant="danger" disabled={isDeleting || isUpdatingStatus} className="min-h-8 w-8 rounded-[10px] px-0" aria-label={`Delete feature ${feature.name}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </deleteFetcher.Form>
          </div>
        </div>

        <div className="text-[11px] text-[var(--text-muted)]">
          <div className="font-semibold text-[var(--text)]">{phasesCount} phases</div>
          {phaseStatusText ? <div className="mt-0.5 break-words">{phaseStatusText}</div> : null}
        </div>

        <div className="text-[11px] text-[var(--text-muted)]">
          <div className="font-semibold text-[var(--text)]">{tasksCount} tasks</div>
          {taskStatusText ? <div className="mt-0.5 break-words">{taskStatusText}</div> : null}
        </div>

        <statusFetcher.Form method="post" action={`/features/${feature.id}/status`} className="w-full xl:w-auto">
          <div className="relative">
            <select
              name="status"
              value={status}
              disabled={isUpdatingStatus || isDeleting}
              aria-busy={isUpdatingStatus}
              className="field-control min-h-8 appearance-none py-1 pr-8 text-[11px]"
              onChange={(event) => statusFetcher.submit(event.currentTarget.form)}
            >
              {featureStatuses.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-muted)]" />
          </div>
        </statusFetcher.Form>

        <Link to={`/features/${feature.id}/edit`} aria-label={`Edit feature ${feature.name}`} className="hidden xl:block">
          <Button type="button" variant="secondary" className="min-h-8 w-8 rounded-[10px] px-0 text-[var(--text-muted)] hover:text-[var(--text)]">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </Link>

        <deleteFetcher.Form method="post" action={`/features/${feature.id}/delete`} className="hidden xl:block" onSubmit={(event) => {
          if (!window.confirm(`Delete feature “${feature.name}”? This cannot be undone.`)) event.preventDefault();
        }}>
          <Button type="submit" variant="danger" disabled={isDeleting || isUpdatingStatus} className="min-h-8 w-8 rounded-[10px] px-0" aria-label={`Delete feature ${feature.name}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </deleteFetcher.Form>
      </div>

      {shortDescription ? <div className="mt-1 min-w-0 break-words line-clamp-2 text-[11px] text-[var(--text-muted)]">{shortDescription}</div> : null}
    </div>
  );
}
