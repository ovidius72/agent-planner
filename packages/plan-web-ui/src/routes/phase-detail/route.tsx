import { ArrowLeft } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { Form, Link, Outlet, useLoaderData, useNavigate, useSearchParams } from "react-router-dom";
import { TaskRow } from "../../components/tasks/task-row";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { CompactCard } from "../../components/ui/compact-card";
import { EntityBadge, ParentBadge } from "../../components/ui/badges";
import { FormattedText } from "../../components/ui/formatted-text";
import { ListFilters } from "../../components/ui/list-filters";
import { AcceptedDecisionsList } from "../../components/ui/accepted-decisions-list";
import { StatusBadge } from "../../components/ui/status-badge";
import { matchesListQuery } from "../../lib/list-filtering";
import { useShortcut } from "../../lib/shortcuts";
import { taskStatuses } from "../../lib/statuses";
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
  const taskSummary = summarizeTasks(phase);
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
  const openEdit = useCallback(() => navigate("edit"), [navigate]);
  const openCreateTask = useCallback(() => navigate("tasks/new"), [navigate]);
  const deletePhase = useCallback(() => {
    deleteFormRef.current?.requestSubmit();
  }, []);
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

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Breadcrumbs
            items={[
              { label: "Features", to: "/features" },
              { label: feature.name, to: `/features/${feature.id}` },
              { label: phase.title },
            ]}
          />
          <div className="mt-2 flex items-center gap-2">
            <EntityBadge type="phase" number={phase.number} />
            <ParentBadge type="phase" featureNum={feature.number} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black tracking-tight text-[var(--text)] break-words">
              {phase.title}
            </h2>
            <StatusBadge status={phase.status} />
          </div>
          {phase.summary ? <FormattedText text={phase.summary} className="mt-3 max-w-4xl" /> : null}
        </div>

        <Form
          ref={deleteFormRef}
          method="post"
          action={`/features/${feature.id}/phases/${phase.id}/delete`}
          onSubmit={(event) => {
            if (!window.confirm(`Delete phase \"${phase.title}\"?`)) event.preventDefault();
          }}
        >
          <Button type="submit" variant="danger" shortcut="delete">
            Delete phase
          </Button>
        </Form>
      </div>

      <Card className="grid gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <EntityBadge type="phase" number={phase.number} />
            <p className="mt-2 text-sm text-[var(--text-muted)]">Snapshot of this phase.</p>
          </div>
          <div className="flex gap-2">
            <Link to="edit">
              <Button type="button" shortcut="edit">
                Edit phase
              </Button>
            </Link>
            <Link to="tasks/new">
              <Button type="button" variant="primary" shortcut="create">
                Create task
              </Button>
            </Link>
          </div>
        </div>

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

        {phase.description ? (
          <div>
            <span className="font-semibold text-[var(--text)]">Description:</span>
            <FormattedText text={phase.description} className="plan-description mt-2" />
          </div>
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
      </Card>

      <Card className="grid gap-5">
        <div>
          <EntityBadge type="task" number={0} />
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
          {filteredTasks.length > 0 ? (
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
