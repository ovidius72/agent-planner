import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, Outlet, useLoaderData, useNavigate, useSearchParams } from "react-router-dom";
import { TaskRow } from "../../components/tasks/task-row";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { DetailEntityBar } from "../../components/detail/detail-entity-bar";
import { DetailMetricsRow } from "../../components/detail/detail-metrics-row";
import { EntityDetailIdentity } from "../../components/detail/entity-detail-identity";
import { formatDateTime, LastUpdated } from "../../components/ui/last-updated";
import { HandoffBadge } from "../../components/ui/badges";
import { FormattedText } from "../../components/ui/formatted-text";
import { Accordion } from "../../components/ui/accordion";
import { DetailFilters } from "../../components/ui/detail-filters";
import { SortControl } from "../../components/ui/sort-control";
import { AcceptedDecisionsList } from "../../components/ui/accepted-decisions-list";
import { DisplayStatusBadge } from "../../components/ui/status-badge";
import { StatusCardStepper } from "../../components/ui/status-card-stepper";
import { StatusHistoryAccordion } from "../../components/ui/status-history-accordion";
import { clearPhaseHandoff } from "../../lib/api";
import { replaceUrlSearchParams } from "../../lib/browser-url";
import { compareEntities, type WorkTreeSortConfig } from "../../lib/dashboard-tree";
import { matchesListQuery, passesDetailFilters, type DetailFilterValue } from "../../lib/list-filtering";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const sortParam = searchParams.get("sort")?.trim() ?? "priority";
  const dirParam = searchParams.get("dir")?.trim() ?? "asc";
  const [filters, setFilters] = useState<DetailFilterValue>(() => ({
    query: searchParams.get("q")?.trim() ?? "",
    status: searchParams.get("status")?.trim() ?? "",
    hideDone: searchParams.get("hideDone") === "1",
    hidePlanned: searchParams.get("hidePlanned") === "1",
    onlyActive: searchParams.get("onlyActive") === "1",
  }));
  // See replaceUrlSearchParams's doc comment for why this avoids a router
  // navigation, and why these params must never be read back through
  // useSearchParams.
  useEffect(() => {
    replaceUrlSearchParams((params) => {
      const sync = (key: string, on: boolean, val = "1") => {
        if (on) params.set(key, val);
        else params.delete(key);
      };
      sync("q", filters.query.trim() !== "", filters.query.trim());
      sync("status", filters.status !== "", filters.status);
      sync("hideDone", filters.hideDone);
      sync("hidePlanned", filters.hidePlanned);
      sync("onlyActive", filters.onlyActive);
    });
  }, [filters]);
  const sort: WorkTreeSortConfig = {
    key: sortParam === "priority" || sortParam === "number" || sortParam === "createdAt" || sortParam === "updatedAt" || sortParam === "title" || sortParam === "shortId" || sortParam === "status" || sortParam === "startedAt" || sortParam === "completedAt"
      ? sortParam
      : "priority",
    direction: dirParam === "desc" ? "desc" : "asc",
  };
  const sortedTasks = useMemo(() => [...phase.tasks].sort((a, b) => compareEntities(a, b, sort.key, sort.direction)), [phase.tasks, sort]);
  const filteredTasks = useMemo(
    () =>
      sortedTasks.filter(
        (task) =>
          passesDetailFilters(task, filters, ["in-progress"])
          && matchesListQuery(filters.query, [task.title, String(task.number), task.shortId]),
      ),
    [sortedTasks, filters],
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
        <DetailEntityBar
          featureNum={feature.number}
          phaseNum={phase.number}
          featureId={feature.id}
          phaseId={phase.id}
          shortId={phase.shortId}
        >
          {handoffContent ? <HandoffBadge phaseId={phase.id} updatedAt={phase.handoffUpdatedAt} /> : null}
          <DisplayStatusBadge status={phaseDisplay.displayStatus} breakdown={phaseDisplay.breakdown} />
        </DetailEntityBar>
        </div>
        <EntityDetailIdentity
          kind="phase"
          title={phase.title}
          reference={`P${String(phase.number).padStart(3, "0")}`}
          subtitle={phase.summary}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link to="edit"><Button type="button" shortcut="edit">Edit phase</Button></Link>
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
        {phase.description ? (
          <div className="mt-4">
            <Accordion title={<><span>Description</span><LastUpdated value={phase.descriptionUpdatedAt} /></>}>
              <FormattedText text={phase.description} className="plan-description" />
            </Accordion>
          </div>
        ) : null}
        <div className="mt-4">
          <StatusCardStepper statusLog={phase.statusLog ?? []} currentStatus={phase.status} backbone={["draft", "discovery", "planned", "in-progress", "done"]} createdAt={phase.createdAt} updatedAt={phase.updatedAt} />
        </div>
      </div>

      <Card className="grid gap-3">
        <StatusHistoryAccordion statusLog={phase.statusLog ?? []} currentStatus={phase.status} backbone={["draft", "discovery", "planned", "in-progress", "done"]} />
        <AcceptedDecisionsList decisions={acceptedDecisions} targetType="phase" targetRef={phase.id} />
      </Card>

      <Card className="grid gap-4">
        <DetailMetricsRow
          label="Phase metrics"
          items={[
            { label: "Tasks", value: phase.tasks.length },
            { label: "Active", value: taskSummary.inProgress },
            { label: "Remaining", value: taskSummary.remaining },
            { label: "Done", value: taskSummary.done },
            { label: "Blocked", value: taskSummary.blocked },
            { label: "Goals", value: phase.goals.length },
            { label: "Dependencies", value: phase.dependencies.length },
            { label: "Criteria", value: phase.completionCriteria.length },
            { label: "Requirements", value: linkedRequirements.length },
            { label: "Risks", value: phase.risks.length },
            { label: "Questions", value: phase.openQuestions.length },
            { label: "Priority", value: `P${phase.priority}` },
            { label: "Updated", value: formatDateTime(phase.updatedAt), visible: Boolean(phase.updatedAt) },
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
                      {requirement.macroTasks.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{requirement.macroTasks.length} macro task{requirement.macroTasks.length === 1 ? "" : "s"}</span>
                        </div>
                      ) : null}
                      <h3 className="mt-2 text-lg font-black tracking-tight text-[var(--text)] [overflow-wrap:anywhere]">{requirement.title}</h3>
                      {requirement.description ? <p className="mt-2 text-sm text-[var(--text-muted)] [overflow-wrap:anywhere]">{requirement.description}</p> : null}
                    </div>
                    <Link to={`/requirements#phase-${phase.id}`} className="text-sm font-semibold text-[var(--accent)] hover:underline sm:shrink-0">
                      Open phase requirements →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">No linked requirements yet.</p>
          )}
        </Accordion>
        {phaseDecisions.length > 0 ? (
          <Accordion title="Decisions" count={phaseDecisions.length} defaultOpen={false}>
            <div className="grid gap-2 border-l-2 border-[var(--border)] pl-4 ml-1">
              {phaseDecisions.map((decision, idx) => (
                <div key={idx} className="text-sm text-[var(--text-muted)]">
                  <FormattedText text={decision} />
                </div>
              ))}
            </div>
          </Accordion>
        ) : null}
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
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Tasks ({phase.tasks.length})</p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Filter and sort this phase's tasks.
            </p>
          </div>
          <Link to="tasks/new"><Button type="button" variant="primary" shortcut="create">Create task</Button></Link>
        </div>

        <DetailFilters
          entityKind="task"
          statusOptions={taskStatuses}
          value={filters}
          onChange={setFilters}
          sortSlot={<SortControl sort={sort} onChange={(next) => setSearchParams((prev) => {
            prev.set("sort", next.key);
            prev.set("dir", next.direction);
            return prev;
          })} />}
        />

        <div className="grid gap-3">
          {phase.tasks.length === 0 ? (
            <Card className="p-4 text-sm text-[var(--text-muted)]">No tasks yet. <Link to="tasks/new" className="font-semibold text-[var(--accent)] hover:underline">Add a task</Link></Card>
          ) : filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <TaskRow key={task.id} featureId={feature.id} featureNum={feature.number} phaseId={phase.id} phaseNum={phase.number} task={task} />
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
