import { ArrowLeft } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Form, Link, Outlet, useLoaderData, useNavigate, useSearchParams } from "react-router-dom";
import { TaskRow } from "../../components/tasks/task-row";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { CompactCard } from "../../components/ui/compact-card";
import { DetailMetadataGrid, formatPriority } from "../../components/ui/detail-metadata";
import { CopyableBadge, EntityBadge, EntityPathBadge, HandoffBadge, ShortIdBadge, formatEntityPath } from "../../components/ui/badges";
import { FormattedText } from "../../components/ui/formatted-text";
import { Accordion } from "../../components/ui/accordion";
import { ListFilters } from "../../components/ui/list-filters";
import { AcceptedDecisionsList } from "../../components/ui/accepted-decisions-list";
import { DisplayStatusBadge, StatusBadge } from "../../components/ui/status-badge";
import { StatusCardStepper } from "../../components/ui/status-card-stepper";
import { StatusHistoryAccordion } from "../../components/ui/status-history-accordion";
import { clearPhaseHandoff } from "../../lib/api";
import { matchesListQuery } from "../../lib/list-filtering";
import { useShortcut } from "../../lib/shortcuts";
import { taskStatuses } from "../../lib/statuses";
import { derivePhaseDisplayFromTasks } from "../../lib/derive-display";
import type { Feature, Phase } from "../../lib/types";

function summarizeTasks(phase: Phase) {
  let inProgress = 0;
  let done = 0;
  let blocked = 0;
  let remaining = 0;

  for (const task of phase.tasks) {
    if (task.status === "in-progress") inProgress += 1;
    if (task.status === "done") done += 1;
    if (task.status === "blocked") blocked += 1;
    if (!["done", "canceled"].includes(task.status)) remaining += 1;
  }

  return { inProgress, done, blocked, remaining };
}

export function PhaseDetailRoute() {
  const { feature, phase } = useLoaderData() as { feature: Feature; phase: Phase };
  const phaseDecisions = phase.decisions ?? [];
  const acceptedDecisions = phase.acceptedDecisions ?? [];
  const linkedRequirements = phase.linkedRequirements ?? [];
  const taskSummary = summarizeTasks(phase);
  const phaseDisplay = derivePhaseDisplayFromTasks(phase.tasks);
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "";
  const filteredTasks = useMemo(
    () =>
      phase.tasks.filter(
        (task) =>
          (!status || task.status === status) &&
          matchesListQuery(query, [task.title, task.id, task.description, task.shortName]),
      ),
    [phase.tasks, query, status],
  );
  const navigate = useNavigate();
  const deleteFormRef = useRef<HTMLFormElement>(null);
  // Local handoff state so Clear updates the UI without a full route refetch.
  const [handoffContent, setHandoffContent] = useState<string>(phase.handoff ?? "");
  const [clearing, setClearing] = useState(false);
  const openEdit = useCallback(() => navigate("edit"), [navigate]);
  const openCreateTask = useCallback(() => navigate("tasks/new"), [navigate]);
  const deletePhase = useCallback(() => {
    deleteFormRef.current?.requestSubmit();
  }, []);
  const clearHandoff = useCallback(async () => {
    if (!window.confirm("Clear this phase's handoff?")) return;
    setClearing(true);
    try {
      await clearPhaseHandoff(phase.id);
      setHandoffContent("");
    } catch {
      // keep content on failure
    } finally {
      setClearing(false);
    }
  }, [phase.id]);
  useShortcut("edit", openEdit);
  useShortcut("create", openCreateTask);
  useShortcut("delete", deletePhase);

  return (
    <div className="grid gap-8">
      <Link
        to={`/features/${feature.id}`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to feature
      </Link>

      <div className="min-w-0">
        <Breadcrumbs
          stacked
          items={[
            { label: feature.name, to: `/features/${feature.id}`, kind: "Feature" },
            { label: phase.title, kind: "Phase" },
          ]}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyableBadge id={formatEntityPath({ featureNum: feature.number, phaseNum: phase.number })}>
            <EntityPathBadge featureNum={feature.number} phaseNum={phase.number} />
          </CopyableBadge>
          {phase.shortId ? <ShortIdBadge shortId={phase.shortId} /> : null}
          {handoffContent ? <HandoffBadge phaseId={phase.id} updatedAt={phase.handoffUpdatedAt} /> : null}
          <DisplayStatusBadge status={phaseDisplay.displayStatus} breakdown={phaseDisplay.breakdown} />
        </div>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text)] min-w-0 break-words [overflow-wrap:anywhere] sm:text-3xl">
          {phase.title}
        </h2>
        {phase.summary ? <FormattedText text={phase.summary} className="mt-3 max-w-4xl" /> : null}
        <StatusCardStepper statusLog={phase.statusLog ?? []} currentStatus={phase.status} backbone={["draft", "discovery", "planned", "in-progress", "done"]} createdAt={phase.createdAt} updatedAt={phase.updatedAt} />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link to="edit"><Button type="button" shortcut="edit">Edit phase</Button></Link>
          <Link to="tasks/new"><Button type="button" variant="primary" shortcut="create">Create task</Button></Link>
          <Form
            ref={deleteFormRef}
            method="post"
            action={`/features/${feature.id}/phases/${phase.id}/delete`}
            className="inline-flex"
            onSubmit={(event) => {
              if (!window.confirm(`Delete phase \"${phase.title}\"?`)) event.preventDefault();
            }}
          >
            <Button type="submit" variant="danger" shortcut="delete">Delete phase</Button>
          </Form>
        </div>
      </div>

      <Card className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CompactCard>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Tasks
            </p>
            <p className="mt-2 text-3xl font-black text-[var(--text)]">{phase.tasks.length}</p>
          </CompactCard>
          <CompactCard>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              In progress
            </p>
            <p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.inProgress}</p>
          </CompactCard>
          <CompactCard>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Remaining
            </p>
            <p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.remaining}</p>
          </CompactCard>
          <CompactCard>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Done
            </p>
            <p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.done}</p>
          </CompactCard>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CompactCard>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Blocked
            </p>
            <p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.blocked}</p>
          </CompactCard>
          <CompactCard>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Goals
            </p>
            <p className="mt-2 text-2xl font-black text-[var(--text)]">{phase.goals.length}</p>
          </CompactCard>
          <CompactCard>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Dependencies
            </p>
            <p className="mt-2 text-2xl font-black text-[var(--text)]">
              {phase.dependencies.length}
            </p>
          </CompactCard>
          <CompactCard>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Completion criteria
            </p>
            <p className="mt-2 text-2xl font-black text-[var(--text)]">
              {phase.completionCriteria.length}
            </p>
          </CompactCard>
        </div>

        <DetailMetadataGrid
          items={[
            { label: "Priority", value: formatPriority(phase.priority), visible: phase.priority > 0 },
            { label: "Linked requirements", value: linkedRequirements.length, visible: linkedRequirements.length > 0, valueClassName: "text-2xl font-black" },
            { label: "Risks", value: phase.risks.length, visible: phase.risks.length > 0, valueClassName: "text-2xl font-black" },
            { label: "Open questions", value: phase.openQuestions.length, visible: phase.openQuestions.length > 0, valueClassName: "text-2xl font-black" },
          ]}
        />

        {phase.notes ? (
          <Accordion title="Notes" defaultOpen={false}>
            <FormattedText text={phase.notes} className="plan-description" />
          </Accordion>
        ) : null}

        <Accordion title="Linked requirements" count={linkedRequirements.length} defaultOpen={false}>
          {linkedRequirements.length > 0 ? (
            <div className="grid gap-3">
              {linkedRequirements.map((requirement) => (
                <div key={requirement.id} className="min-w-0 rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={requirement.status} />
                        {requirement.macroTasks.length > 0 ? <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{requirement.macroTasks.length} macro task{requirement.macroTasks.length === 1 ? "" : "s"}</span> : null}
                      </div>
                      <h3 className="mt-2 text-lg font-black tracking-tight text-[var(--text)] [overflow-wrap:anywhere]">{requirement.title}</h3>
                      {requirement.description ? <p className="mt-2 text-sm text-[var(--text-muted)] [overflow-wrap:anywhere]">{requirement.description}</p> : null}
                    </div>
                    <Link to={`/requirements?q=${encodeURIComponent(requirement.title)}`} className="text-sm font-semibold text-[var(--accent)] hover:underline sm:shrink-0">
                      Open in requirements →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">No linked requirements yet.</p>
          )}
        </Accordion>
        {phase.description ? (
          <Accordion title="Description">
            <FormattedText text={phase.description} className="plan-description" />
          </Accordion>
        ) : null}
        {phaseDecisions.length > 0 ? (
          <details className="group mt-4">
            <summary className="flex items-center gap-2 cursor-pointer font-semibold text-[var(--text)] select-none">
              <span>Decisions ({phaseDecisions.length})</span>
            </summary>
            <div className="mt-2 ml-4 space-y-2 border-l-2 border-[var(--border)] pl-4">
              {phaseDecisions.map((decision, idx) => (
                <div key={idx} className="text-sm text-[var(--text-muted)]">
                  <FormattedText text={decision} />
                </div>
              ))}
            </div>
          </details>
        ) : null}
        {acceptedDecisions.length > 0 ? <AcceptedDecisionsList decisions={acceptedDecisions} /> : null}
        <StatusHistoryAccordion statusLog={phase.statusLog ?? []} currentStatus={phase.status} backbone={["draft", "discovery", "planned", "in-progress", "done"]} />
      </Card>

      {handoffContent ? (
        <Card className="grid gap-4">
          <Accordion
            title="Handoff"
            actions={(
              <button
                type="button"
                onClick={clearHandoff}
                disabled={clearing}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-card)] disabled:opacity-60"
              >
                {clearing ? "Clearing…" : "Clear handoff"}
              </button>
            )}
          >
            <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-5 py-5">
              <FormattedText text={handoffContent} className="formatted-text max-w-none" />
            </div>
          </Accordion>
        </Card>
      ) : null}

      <Card className="grid gap-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Tasks</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Filter this phase's tasks by name or status.
          </p>
        </div>

        <ListFilters
          query={query}
          status={status}
          statusOptions={taskStatuses}
          placeholder="Search task title, id, or description"
          clearTo={`/features/${feature.id}/phases/${phase.id}`}
          resultsLabel={
            filteredTasks.length === phase.tasks.length
              ? `${phase.tasks.length} tasks`
              : `${filteredTasks.length} of ${phase.tasks.length} tasks`
          }
        />

        <div className="grid gap-3">
          {phase.tasks.length === 0 ? (
            <Card className="p-4 text-sm text-[var(--text-muted)]">No tasks yet. <Link to="tasks/new" className="font-semibold text-[var(--accent)] hover:underline">Add a task</Link></Card>
          ) : filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <TaskRow key={task.id} featureId={feature.id} phaseId={phase.id} task={task} />
            ))
          ) : (
            <Card className="p-4 text-sm text-[var(--text-muted)]">
              No tasks match the current filters.
            </Card>
          )}
        </div>
      </Card>
      <Outlet />
    </div>
  );
}
