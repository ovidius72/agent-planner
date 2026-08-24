import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Form, Link, useFetcher } from "react-router-dom";
import { taskStatuses, taskTransitionStatuses } from "../../lib/statuses";
import { formatStatusSummary, summarizeSubtaskStatuses } from "../../lib/status-summary";
import { toDisplayStatus } from "../../lib/display-status-tokens";
import type { Task } from "../../lib/types";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { CopyableBadge, EntityPathBadge, ShortIdBadge, formatEntityPath } from "../ui/badges";
import { StatusItem } from "../ui/status-item";
import { LastUpdated, formatDateTime } from "../ui/last-updated";

export function TaskRow({ featureId, featureNum, phaseId, phaseNum, task }: { featureId: string; featureNum?: number; phaseId: string; phaseNum?: number; task: Task }) {
  const statusFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const optimisticStatus = statusFetcher.formData?.get("status") as Task["status"] | null;
  const status = optimisticStatus ?? task.status;
  const isUpdatingStatus = statusFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";
  const subtaskStatusText = formatStatusSummary(summarizeSubtaskStatuses(task.subtasks));

  const displayStatus = toDisplayStatus(status);

  return (
    <StatusItem variant="surface" status={displayStatus} className="px-4 py-2">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,168px)_124px_44px_44px] lg:items-center">
        <div className="flex min-w-0 flex-col items-start gap-1 lg:contents">
          <div className="flex min-w-0 flex-col items-start gap-1">
            <div className="flex items-center gap-2">
              <EntityPathBadge featureNum={featureNum} phaseNum={phaseNum} taskNum={task.number} featureId={featureId} phaseId={phaseId} taskId={task.id} />
              <CopyableBadge id={formatEntityPath({ featureNum, phaseNum, taskNum: task.number })}>
                <span className="sr-only">Copy task path</span>
              </CopyableBadge>
              {task.shortId ? <ShortIdBadge shortId={task.shortId} /> : null}
              <span className="shrink-0"><StatusBadge status={status} /></span>
            </div>
            <Link to={`/features/${featureId}/phases/${phaseId}/tasks/${task.id}`} className="entity-link--task min-w-0 w-full break-words text-sm font-semibold underline-offset-4 hover:underline [overflow-wrap:anywhere]">
              {task.title}
            </Link>
          </div>

          <div className="flex items-center gap-2 self-end lg:hidden">
            <Link to={`/features/${featureId}/phases/${phaseId}/tasks/${task.id}/edit`} aria-label={`Edit task ${task.title}`}>
              <Button type="button" variant="secondary" className="min-h-8 w-8 rounded-[10px] px-0 text-[var(--text-muted)] hover:text-[var(--text)]">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </Link>

            <deleteFetcher.Form method="post" action={`/features/${featureId}/phases/${phaseId}/tasks/${task.id}/delete`} onSubmit={(event) => {
              if (!window.confirm(`Delete task “${task.title}”? This cannot be undone.`)) event.preventDefault();
            }}>
              <Button type="submit" variant="danger" disabled={isDeleting || isUpdatingStatus} className="min-h-8 w-8 rounded-[10px] px-0" aria-label={`Delete task ${task.title}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </deleteFetcher.Form>
          </div>
        </div>

        <div className="text-[11px] text-[var(--text-muted)]">
          <div className="font-semibold text-[var(--text)]">{task.subtasks.length} subtasks · {task.checklist.length} checklist</div>
          {subtaskStatusText ? <div className="mt-0.5 break-words">{subtaskStatusText}</div> : <div className="mt-0.5 break-words">No subtask statuses yet</div>}
        </div>

        <statusFetcher.Form method="post" action={`/features/${featureId}/phases/${phaseId}/tasks/${task.id}/status`} className="w-full lg:w-auto">
          <div className="relative">
            <select name="status" value={status} disabled={isUpdatingStatus || isDeleting || Boolean(task.pauseSnapshot)} aria-busy={isUpdatingStatus} title={task.pauseSnapshot ? "Resume checkpointed work through task_start so its checkpoint is preserved." : undefined} className="field-control min-h-8 appearance-none py-1 pr-8 text-[11px]" onChange={(event) => statusFetcher.submit(event.currentTarget.form)}>
              {taskTransitionStatuses.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-muted)]" />
          </div>
        </statusFetcher.Form>

        <Link to={`/features/${featureId}/phases/${phaseId}/tasks/${task.id}/edit`} aria-label={`Edit task ${task.title}`} className="hidden lg:block">
          <Button type="button" variant="secondary" className="min-h-8 w-8 rounded-[10px] px-0 text-[var(--text-muted)] hover:text-[var(--text)]">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </Link>

        <deleteFetcher.Form method="post" action={`/features/${featureId}/phases/${phaseId}/tasks/${task.id}/delete`} className="hidden lg:block" onSubmit={(event) => {
          if (!window.confirm(`Delete task “${task.title}”? This cannot be undone.`)) event.preventDefault();
        }}>
          <Button type="submit" variant="danger" disabled={isDeleting || isUpdatingStatus} className="min-h-8 w-8 rounded-[10px] px-0" aria-label={`Delete task ${task.title}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </deleteFetcher.Form>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-subtle)]">
        <LastUpdated value={task.updatedAt} />
        {task.startedAt ? <span>Started {formatDateTime(task.startedAt)}</span> : null}
        {task.completedAt ? <span>Completed {formatDateTime(task.completedAt)}</span> : null}
      </div>
      {task.description ? <div className="mt-1 min-w-0 break-words line-clamp-2 text-[11px] text-[var(--text-muted)]">{task.description}</div> : null}
    </StatusItem>
  );
}
