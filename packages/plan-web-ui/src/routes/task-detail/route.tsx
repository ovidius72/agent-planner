import { ArrowLeft } from "lucide-react";
import { useCallback, useRef } from "react";
import { Form, Link, Outlet, useFetcher, useLoaderData, useNavigate } from "react-router-dom";
import { DetailEntityBar } from "../../components/detail/detail-entity-bar";
import { DetailMetricsRow } from "../../components/detail/detail-metrics-row";
import { EntityDetailIdentity } from "../../components/detail/entity-detail-identity";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { formatDateTime, LastUpdated } from "../../components/ui/last-updated";
import { FormattedText } from "../../components/ui/formatted-text";
import { Accordion } from "../../components/ui/accordion";
import { AcceptedDecisionsList } from "../../components/ui/accepted-decisions-list";
import { StatusBadge } from "../../components/ui/status-badge";
import { StatusCardStepper } from "../../components/ui/status-card-stepper";
import { StatusHistoryAccordion } from "../../components/ui/status-history-accordion";
import { ResumeSnapshot } from "../../components/task/resume-snapshot";
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
  const { feature, phase, task, pendingResume } = useLoaderData() as { feature: Feature; phase: Phase; task: Task; pendingResume: boolean };
  const canStart = task.status === "planned" || task.status === "waiting";
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
        <EntityDetailIdentity kind="task" title={task.title} reference={`T${String(task.number).padStart(3, "0")}`} />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canStart ? (
            <Form method="post" action={`/features/${feature.id}/phases/${phase.id}/tasks/${task.id}/start`} className="inline-flex">
              <Button type="submit" variant="primary">{task.pauseSnapshot || pendingResume ? "Resume task" : "Start task"}</Button>
            </Form>
          ) : null}
          {task.status === "done" ? (
            <Form method="post" action={`/features/${feature.id}/phases/${phase.id}/tasks/${task.id}/reopen`} className="inline-flex" onSubmit={(event) => {
              if (!window.confirm(`Reopen task “${task.title}”? Its completion history will be retained.`)) event.preventDefault();
            }}>
              <Button type="submit" variant="primary">Reopen task</Button>
            </Form>
          ) : null}
          <Link to="edit"><Button type="button" shortcut="edit">Edit task</Button></Link>
          <Form ref={deleteFormRef} method="post" action={`/features/${feature.id}/phases/${phase.id}/tasks/${task.id}/delete`} className="inline-flex" onSubmit={(event) => {
            if (!window.confirm(`Delete task \"${task.title}\"?`)) event.preventDefault();
          }}>
            <Button type="submit" variant="danger" shortcut="delete">Delete task</Button>
          </Form>
        </div>
        {task.description ? (
          <div className="mt-4">
            <Accordion title={<><span>Description</span><LastUpdated value={task.descriptionUpdatedAt} /></>}>
              <FormattedText text={task.description} className="plan-description" />
            </Accordion>
          </div>
        ) : null}
        <div className="mt-4">
          <StatusCardStepper statusLog={task.statusLog ?? []} currentStatus={task.status} backbone={["planned", "in-progress", "done"]} createdAt={task.createdAt} updatedAt={task.updatedAt} startedAt={task.startedAt} completedAt={task.completedAt} />
        </div>
      </div>

      {task.pauseSnapshot ? <ResumeSnapshot snapshot={task.pauseSnapshot} pendingResume={pendingResume} /> : null}

      <Card className="grid gap-3">
        <StatusHistoryAccordion statusLog={task.statusLog ?? []} currentStatus={task.status} backbone={["planned", "in-progress", "done"]} startedAt={task.startedAt} completedAt={task.completedAt} />
        <AcceptedDecisionsList decisions={acceptedDecisions} targetType="task" targetRef={task.id} />
      </Card>

      <Card className="grid gap-4">
        <DetailMetricsRow
          label="Task metrics"
          items={[
            { label: "Steps", value: checklist.length },
            { label: "Subtasks", value: task.subtasks?.length ?? 0 },
            { label: "Dependencies", value: task.dependsOn?.length ?? 0 },
            { label: "Priority", value: `P${task.priority}` },
            { label: "Short name", value: task.shortName, visible: Boolean(task.shortName), wide: true },
            { label: "Started", value: formatDateTime(task.startedAt), visible: Boolean(task.startedAt), wide: true },
            { label: "Completed", value: formatDateTime(task.completedAt), visible: Boolean(task.completedAt), wide: true },
            { label: "Updated", value: formatDateTime(task.updatedAt), visible: Boolean(task.updatedAt), wide: true },
          ]}
        />

        {task.notes ? (
          <Accordion title="Notes" defaultOpen={false}>
            <FormattedText text={task.notes} />
          </Accordion>
        ) : null}
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

        <Accordion title="Dependencies" count={task.dependsOn?.length ?? 0} defaultOpen={false} contentClassName="grid gap-2">
          {task.dependsOn?.map((dependency) => <p key={dependency} className="surface-card px-4 py-3 text-sm font-mono text-[var(--text)]">{dependency}</p>)}
          <Form method="post" action="dependencies/add" className="flex gap-2 rounded-xl border border-dashed border-[var(--border-strong)] p-3">
            <input name="dependsOn" required placeholder="Task ref or ID" aria-label="Dependency task" className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" />
            <Button type="submit" className="h-9">Add dependency</Button>
          </Form>
        </Accordion>
        <Accordion title="Subtasks" count={task.subtasks?.length ?? 0} defaultOpen={false} contentClassName="grid gap-2">
          {task.subtasks?.map((subtask) => (
            <div key={subtask.id} className="surface-card flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text)]">{subtask.title}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{subtask.description || subtask.id}</p>
              </div>
              <StatusBadge status={subtask.status} />
            </div>
          ))}
          <Form method="post" action="subtasks/new" className="grid gap-2 rounded-xl border border-dashed border-[var(--border-strong)] p-3 sm:grid-cols-[1fr_1fr_auto]">
            <input name="title" required placeholder="New subtask title" aria-label="New subtask title" className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" />
            <input name="description" placeholder="Description (optional)" aria-label="New subtask description" className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" />
            <Button type="submit" className="h-9">Add subtask</Button>
          </Form>
        </Accordion>
      </Card>
      <Outlet />
    </div>
  );
}
