import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Form, Link, useFetcher } from "react-router-dom";
import { phaseStatuses } from "../../lib/statuses";
import { formatStatusSummary, summarizeTaskStatuses } from "../../lib/status-summary";
import type { Feature, Phase } from "../../lib/types";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { EntityBadge, ParentBadge } from "../ui/badges";

export function PhaseRow({ featureId, feature, phase }: { featureId: string; feature: Feature; phase: Phase }) {
  const statusFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const optimisticStatus = statusFetcher.formData?.get("status") as Phase["status"] | null;
  const status = optimisticStatus ?? phase.status;
  const isUpdatingStatus = statusFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";
  const taskStatusText = formatStatusSummary(summarizeTaskStatuses(phase.tasks));

  return (
    <div className="surface-card px-4 py-2">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,150px)_124px_44px_44px] lg:items-center">
        <div className="flex min-w-0 flex-col items-start gap-1 lg:contents">
          <div className="flex min-w-0 flex-col items-start gap-1 lg:flex-row lg:items-center lg:gap-2">
            <div className="flex items-center gap-2">
              <EntityBadge type="phase" number={phase.number} />
              <ParentBadge type="phase" featureNum={feature.number} />
              <span className="shrink-0"><StatusBadge status={status} /></span>
            </div>
            <Link to={`/features/${featureId}/phases/${phase.id}`} className="entity-link--phase min-w-0 w-full break-words text-sm font-semibold underline-offset-4 hover:underline lg:w-auto lg:truncate">
              {phase.title}
            </Link>
          </div>

          <div className="flex items-center gap-2 self-end lg:hidden">
            <Link to={`/features/${featureId}/phases/${phase.id}/edit`} aria-label={`Edit phase ${phase.title}`}>
              <Button type="button" variant="secondary" className="min-h-8 w-8 rounded-[10px] px-0 text-[var(--text-muted)] hover:text-[var(--text)]">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </Link>

            <deleteFetcher.Form method="post" action={`/features/${featureId}/phases/${phase.id}/delete`} onSubmit={(event) => {
              if (!window.confirm(`Delete phase “${phase.title}”? This cannot be undone.`)) event.preventDefault();
            }}>
              <Button type="submit" variant="danger" disabled={isDeleting || isUpdatingStatus} className="min-h-8 w-8 rounded-[10px] px-0" aria-label={`Delete phase ${phase.title}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </deleteFetcher.Form>
          </div>
        </div>

        <div className="text-[11px] text-[var(--text-muted)]">
          <div className="font-semibold text-[var(--text)]">{phase.tasks.length} tasks</div>
          {taskStatusText ? <div className="mt-0.5 break-words">{taskStatusText}</div> : null}
        </div>

        <statusFetcher.Form method="post" action={`/features/${featureId}/phases/${phase.id}/status`} className="w-full lg:w-auto">
          <div className="relative">
            <select name="status" value={status} disabled={isUpdatingStatus || isDeleting} aria-busy={isUpdatingStatus} className="field-control min-h-8 appearance-none py-1 pr-8 text-[11px]" onChange={(event) => statusFetcher.submit(event.currentTarget.form)}>
              {phaseStatuses.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-muted)]" />
          </div>
        </statusFetcher.Form>

        <Link to={`/features/${featureId}/phases/${phase.id}/edit`} aria-label={`Edit phase ${phase.title}`} className="hidden lg:block">
          <Button type="button" variant="secondary" className="min-h-8 w-8 rounded-[10px] px-0 text-[var(--text-muted)] hover:text-[var(--text)]">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </Link>

        <deleteFetcher.Form method="post" action={`/features/${featureId}/phases/${phase.id}/delete`} className="hidden lg:block" onSubmit={(event) => {
          if (!window.confirm(`Delete phase “${phase.title}”? This cannot be undone.`)) event.preventDefault();
        }}>
          <Button type="submit" variant="danger" disabled={isDeleting || isUpdatingStatus} className="min-h-8 w-8 rounded-[10px] px-0" aria-label={`Delete phase ${phase.title}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </deleteFetcher.Form>
      </div>

      {phase.summary ? <div className="mt-1 min-w-0 break-words line-clamp-2 text-[11px] text-[var(--text-muted)]">{phase.summary}</div> : null}
    </div>
  );
}
