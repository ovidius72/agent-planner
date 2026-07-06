import { ArrowLeft } from "lucide-react";
import { useCallback, useRef } from "react";

function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}
import { Form, Link, Outlet, useFetcher, useLoaderData, useNavigate } from "react-router-dom";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { CompactCard } from "../../components/ui/compact-card";
import { EntityBadge, ParentBadge } from "../../components/ui/badges";
import { FormattedText } from "../../components/ui/formatted-text";
import { AcceptedDecisionsList } from "../../components/ui/accepted-decisions-list";
import { StatusBadge } from "../../components/ui/status-badge";
import { useShortcut } from "../../lib/shortcuts";
import type { Feature, Phase, Task, ChecklistItem } from "../../lib/types";

function ChecklistItemToggle({
  featureId,
  phaseId,
  taskId,
  item,
}: {
  featureId: string;
  phaseId: string;
  taskId: string;
  item: ChecklistItem;
}) {
  const fetcher = useFetcher();
  const optimisticChecked = fetcher.formData
    ? fetcher.formData.get("checked") === "true"
    : item.checked;
  const isSubmitting = fetcher.state !== "idle";

  return (
    <div className="surface-card flex items-start gap-3 px-4 py-3">
      <input
        type="checkbox"
        checked={optimisticChecked}
        onChange={() => fetcher.submit(
          { checked: item.checked ? "false" : "true" },
          {
            method: "post",
            action: `/features/${featureId}/phases/${phaseId}/tasks/${taskId}/checklist/${item.id}/toggle`,
          },
        )}
        disabled={isSubmitting}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
        aria-label={`Toggle checklist item ${item.title}`}
      />
      <div className="min-w-0">
        <p className={`text-sm ${optimisticChecked ? "text-[var(--text-muted)] line-through" : "font-medium text-[var(--text)]"}`}>
          {item.title}
        </p>
      </div>
    </div>
  );
}

export function TaskDetailRoute() {
  const { feature, phase, task } = useLoaderData() as { feature: Feature; phase: Phase; task: Task };
  const taskDecisions = task.decisions ?? [];
  const acceptedDecisions = task.acceptedDecisions ?? [];
  const checklist = task.checklist ?? [];
  const navigate = useNavigate();
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const openEdit = useCallback(() => navigate("edit"), [navigate]);
  const deleteTask = useCallback(() => {
    deleteFormRef.current?.requestSubmit();
  }, []);
  useShortcut("edit", openEdit);
  useShortcut("delete", deleteTask);

  return (
    <div className="grid gap-8">
      <Link to={`/features/${feature.id}/phases/${phase.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to phase
      </Link>

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Breadcrumbs items={[{ label: "Features", to: "/features" }, { label: feature.name, to: `/features/${feature.id}` }, { label: phase.title, to: `/features/${feature.id}/phases/${phase.id}` }, { label: task.title }]} />
          <div className="mt-2 flex items-center gap-2">
            <EntityBadge type="task" number={task.number} />
            <ParentBadge type="task" phaseNum={phase.number} featureNum={feature.number} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black tracking-tight text-[var(--text)] break-words">{task.title}</h2>
            <StatusBadge status={task.status} />
          </div>
        </div>

        <Form ref={deleteFormRef} method="post" action={`/features/${feature.id}/phases/${phase.id}/tasks/${task.id}/delete`} onSubmit={(event) => {
          if (!window.confirm(`Delete task \"${task.title}\"?`)) event.preventDefault();
        }}>
          <Button type="submit" variant="danger" shortcut="delete">Delete task</Button>
        </Form>
      </div>

      <Card className="grid gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <EntityBadge type="task" number={task.number} />
            <p className="mt-2 text-sm text-[var(--text-muted)]">Single-focus task view. Editing opens in a modal route.</p>
          </div>
          <Link to="edit"><Button type="button" shortcut="edit">Edit task</Button></Link>
        </div>

        {task.description ? <FormattedText text={task.description} className="plan-description" /> : null}
        {task.notes ? (
          <details className="group mt-4">
            <summary className="flex items-center gap-2 cursor-pointer font-semibold text-[var(--text)] select-none">
              <span>Notes</span>
            </summary>
            <div className="mt-2">
              <FormattedText text={task.notes} />
            </div>
          </details>
        ) : null}
        {taskDecisions.length > 0 ? (
          <details className="group mt-4">
            <summary className="flex items-center gap-2 cursor-pointer font-semibold text-[var(--text)] select-none">
              <span>Decisions ({taskDecisions.length})</span>
            </summary>
            <div className="mt-2 ml-4 space-y-2 border-l-2 border-[var(--border)] pl-4">
              {taskDecisions.map((decision, idx) => (
                <div key={idx} className="text-sm text-[var(--text-muted)]">
                  <FormattedText text={decision} />
                </div>
              ))}
            </div>
          </details>
        ) : null}
        {acceptedDecisions.length > 0 ? <AcceptedDecisionsList decisions={acceptedDecisions} /> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Checklist items</p><p className="mt-2 text-3xl font-black text-[var(--text)]">{checklist.length}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Subtasks</p><p className="mt-2 text-3xl font-black text-[var(--text)]">{task.subtasks?.length ?? 0}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Started</p><p className="mt-2 text-sm font-semibold text-[var(--text)] break-words">{task.startedAt ? formatDateTime(task.startedAt) : "—"}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Completed</p><p className="mt-2 text-sm font-semibold text-[var(--text)] break-words">{task.completedAt ? formatDateTime(task.completedAt) : "—"}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Phase</p><p className="mt-2 text-sm font-semibold text-[var(--text)] break-words">{phase.title}</p></CompactCard>
        </div>

        {checklist.length ? (
          <div className="grid gap-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--text)]">Checklist</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Always visible and linked to the real task checklist.</p>
            </div>
            <div className="grid gap-2">
              {checklist.map((item) => (
                <ChecklistItemToggle
                  key={item.id}
                  featureId={feature.id}
                  phaseId={phase.id}
                  taskId={task.id}
                  item={item}
                />
              ))}
            </div>
          </div>
        ) : null}

        {task.subtasks?.length ? (
          <details className="surface-card px-4 py-4">
            <summary className="cursor-pointer list-none text-sm font-bold text-[var(--text)]">Subtasks</summary>
            <div className="mt-3 grid gap-2">
              {task.subtasks.map((subtask) => (
                <div key={subtask.id} className="surface-card flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">{subtask.title}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{subtask.id}</p>
                  </div>
                  <StatusBadge status={subtask.status} />
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </Card>
      <Outlet />
    </div>
  );
}
