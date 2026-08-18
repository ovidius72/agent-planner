import { ArrowLeft } from "lucide-react";
import { useCallback, useRef } from "react";
import { Form, Link, Outlet, useFetcher, useLoaderData, useNavigate } from "react-router-dom";
import { DetailEntityBar } from "../../components/detail/detail-entity-bar";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { CompactCard } from "../../components/ui/compact-card";
import { DetailMetadataGrid, formatPriority } from "../../components/ui/detail-metadata";
import { formatDateTime, LastUpdated } from "../../components/ui/last-updated";
import { FormattedText } from "../../components/ui/formatted-text";
import { Accordion } from "../../components/ui/accordion";
import { AcceptedDecisionsList } from "../../components/ui/accepted-decisions-list";
import { StatusBadge } from "../../components/ui/status-badge";
import { StatusCardStepper } from "../../components/ui/status-card-stepper";
import { StatusHistoryAccordion } from "../../components/ui/status-history-accordion";
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
        <span className="checklist-num">{item.number}</span>{" "}
        <span className={`text-sm ${optimisticChecked ? "text-[var(--text-muted)] line-through" : "font-medium text-[var(--text)]"}`}>
          {item.title}
        </span>
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

      <div className="min-w-0">
        <Breadcrumbs
          stacked
          items={[
            { label: feature.name, to: `/features/${feature.id}`, kind: "Feature" },
            { label: phase.title, to: `/features/${feature.id}/phases/${phase.id}`, kind: "Phase" },
            { label: task.title, kind: "Task" },
          ]}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
        <DetailEntityBar
          featureNum={feature.number}
          phaseNum={phase.number}
          taskNum={task.number}
          featureId={feature.id}
          phaseId={phase.id}
          taskId={task.id}
          shortId={task.shortId}
        >
          <StatusBadge status={task.status} />
        </DetailEntityBar>
        </div>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text)] min-w-0 break-words [overflow-wrap:anywhere] sm:text-3xl">{task.title}</h2>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link to="edit"><Button type="button" shortcut="edit">Edit task</Button></Link>
          <Form ref={deleteFormRef} method="post" action={`/features/${feature.id}/phases/${phase.id}/tasks/${task.id}/delete`} className="inline-flex" onSubmit={(event) => {
            if (!window.confirm(`Delete task \"${task.title}\"?`)) event.preventDefault();
          }}>
            <Button type="submit" variant="danger" shortcut="delete">Delete task</Button>
          </Form>
        </div>
      </div>

      <StatusCardStepper statusLog={task.statusLog ?? []} currentStatus={task.status} backbone={["planned", "in-progress", "done"]} createdAt={task.createdAt} updatedAt={task.updatedAt} startedAt={task.startedAt} completedAt={task.completedAt} />

      <Card className="grid gap-4">
        {task.description ? (
          <Accordion title={<><span>Description</span><LastUpdated value={task.descriptionUpdatedAt} /></>}>
            <FormattedText text={task.description} className="plan-description" />
          </Accordion>
        ) : null}
        {task.notes ? (
          <Accordion title="Notes" defaultOpen={false}>
            <FormattedText text={task.notes} />
          </Accordion>
        ) : null}
        <StatusHistoryAccordion statusLog={task.statusLog ?? []} currentStatus={task.status} backbone={["planned", "in-progress", "done"]} startedAt={task.startedAt} completedAt={task.completedAt} />
        {taskDecisions.length > 0 ? (
          <Accordion title="Decisions" count={taskDecisions.length} defaultOpen={false}>
            <div className="grid gap-2 border-l-2 border-[var(--border)] pl-4 ml-1">
              {taskDecisions.map((decision, idx) => (
                <div key={idx} className="text-sm text-[var(--text-muted)]">
                  <FormattedText text={decision} />
                </div>
              ))}
            </div>
          </Accordion>
        ) : null}
        {acceptedDecisions.length > 0 ? <AcceptedDecisionsList decisions={acceptedDecisions} /> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Checklist items</p><p className="mt-2 text-3xl font-black text-[var(--text)]">{checklist.length}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Subtasks</p><p className="mt-2 text-3xl font-black text-[var(--text)]">{task.subtasks?.length ?? 0}</p></CompactCard>
        </div>

        <DetailMetadataGrid
          items={[
            { label: "Entity last updated", value: formatDateTime(task.updatedAt), visible: Boolean(task.updatedAt) },
            { label: "Priority", value: formatPriority(task.priority), visible: task.priority > 0 },
            { label: "Short name", value: task.shortName, visible: Boolean(task.shortName) },
            { label: "Started", value: formatDateTime(task.startedAt), visible: Boolean(task.startedAt) },
            { label: "Completed", value: formatDateTime(task.completedAt), visible: Boolean(task.completedAt) },
            { label: "Phase", value: phase.title },
          ]}
        />

        <div className="grid gap-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--text)]">Steps ({checklist.length})</h3>
          </div>
          {checklist.length ? (
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
          ) : (
            <p className="text-sm text-[var(--text-muted)] italic">No steps defined.</p>
          )}
        </div>

        {task.subtasks?.length ? (
          <Accordion title="Subtasks" count={task.subtasks.length} defaultOpen={false} contentClassName="grid gap-2">
            {task.subtasks.map((subtask) => (
              <div key={subtask.id} className="surface-card flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">{subtask.title}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{subtask.id}</p>
                </div>
                <StatusBadge status={subtask.status} />
              </div>
            ))}
          </Accordion>
        ) : null}
      </Card>
      <Outlet />
    </div>
  );
}
