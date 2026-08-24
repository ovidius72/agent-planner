import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, Outlet, useLoaderData, useNavigate, useSearchParams } from "react-router-dom";
import { PhaseRow } from "../../components/phases/phase-row";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { DetailEntityBar } from "../../components/detail/detail-entity-bar";
import { CompactCard } from "../../components/ui/compact-card";
import { DetailMetadataGrid, formatPriority, formatTimeline } from "../../components/ui/detail-metadata";
import { formatDateTime, LastUpdated } from "../../components/ui/last-updated";
import { FormattedText } from "../../components/ui/formatted-text";
import { Accordion } from "../../components/ui/accordion";
import { DetailFilters } from "../../components/ui/detail-filters";
import { SortControl } from "../../components/ui/sort-control";
import { AcceptedDecisionsList } from "../../components/ui/accepted-decisions-list";
import { DisplayStatusBadge, StatusBadge } from "../../components/ui/status-badge";
import { StatusCardStepper } from "../../components/ui/status-card-stepper";
import { StatusHistoryAccordion } from "../../components/ui/status-history-accordion";
import { matchesListQuery, passesDetailFilters, type DetailFilterValue } from "../../lib/list-filtering";
import { useShortcut } from "../../lib/shortcuts";
import { phaseStatuses } from "../../lib/statuses";
import { deriveFeatureDisplayFromPhases } from "../../lib/derive-display";
import { compareEntities, type WorkTreeSortConfig } from "../../lib/dashboard-tree";
import type { Feature, Phase } from "../../lib/types";

function countTasks(phases: Phase[]) {
  return phases.reduce((total, phase) => total + phase.tasks.length, 0);
}

function countTasksByStatus(phases: Phase[]) {
  let inProgress = 0;
  let done = 0;
  let blocked = 0;
  let remaining = 0;

  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (task.status === "in-progress") inProgress += 1;
      if (task.status === "done") done += 1;
      if (task.status === "blocked") blocked += 1;
      if (!["done", "canceled"].includes(task.status)) remaining += 1;
    }
  }

  return { inProgress, done, blocked, remaining };
}

function findCurrentPhase(phases: Phase[]) {
  return phases.find((phase) => ["in-progress", "discovery", "planned", "draft"].includes(phase.status));
}

export function FeatureDetailRoute() {
  const { feature, phases } = useLoaderData() as { feature: Feature; phases: Phase[] };
  const acceptedDecisions = feature.acceptedDecisions ?? [];
  const taskCount = countTasks(phases);
  const taskSummary = countTasksByStatus(phases);
  const currentPhase = findCurrentPhase(phases);
  const featureDisplay = deriveFeatureDisplayFromPhases(phases);
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
  // Keep the URL in sync (deep-link / share) via replaceState — no router
  // navigation, so the window scroll position is preserved while filtering.
  useEffect(() => {
    const url = new URL(window.location.href);
    const sync = (key: string, on: boolean, val = "1") => {
      if (on) url.searchParams.set(key, val);
      else url.searchParams.delete(key);
    };
    sync("q", filters.query.trim() !== "", filters.query.trim());
    sync("status", filters.status !== "", filters.status);
    sync("hideDone", filters.hideDone);
    sync("hidePlanned", filters.hidePlanned);
    sync("onlyActive", filters.onlyActive);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [filters]);
  const sort: WorkTreeSortConfig = {
    key: sortParam === "priority" || sortParam === "number" || sortParam === "createdAt" || sortParam === "updatedAt" || sortParam === "title" || sortParam === "shortId" || sortParam === "status" || sortParam === "startedAt" || sortParam === "completedAt"
      ? sortParam
      : "priority",
    direction: dirParam === "desc" ? "desc" : "asc",
  };
  const sortedPhases = useMemo(() => [...phases].sort((a, b) => compareEntities(a, b, sort.key, sort.direction)), [phases, sort]);
  const filteredPhases = useMemo(
    () => sortedPhases.filter(
      (phase) => passesDetailFilters(phase, filters, ["in-progress", "discovery"])
        && matchesListQuery(filters.query, [phase.title, String(phase.number), phase.shortId]),
    ),
    [sortedPhases, filters],
  );
  const navigate = useNavigate();
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const openEdit = useCallback(() => navigate("edit"), [navigate]);
  const openCreatePhase = useCallback(() => navigate("phases/new"), [navigate]);
  const deleteFeature = useCallback(() => {
    deleteFormRef.current?.requestSubmit();
  }, []);
  useShortcut("edit", openEdit);
  useShortcut("create", openCreatePhase);
  useShortcut("delete", deleteFeature);

  return (
    <div className="grid gap-8">
      <Link to="/features" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to features
      </Link>

      <div className="min-w-0">
        <Breadcrumbs stacked items={[{ label: feature.name, kind: "Feature" }]} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
        <DetailEntityBar
          featureNum={feature.number}
          featureId={feature.id}
          shortId={feature.shortId}
        >
          <DisplayStatusBadge status={featureDisplay.displayStatus} breakdown={featureDisplay.breakdown} />
        </DetailEntityBar>
        </div>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text)] min-w-0 break-words [overflow-wrap:anywhere] sm:text-3xl">{feature.name}</h2>
        {feature.description ? (
          <Accordion title={<><span>Description</span><LastUpdated value={feature.descriptionUpdatedAt} /></>}>
            <FormattedText text={feature.description} className="plan-description max-w-4xl" />
          </Accordion>
        ) : null}
        <div className="mt-4">
          <StatusCardStepper statusLog={feature.statusLog ?? []} currentStatus={feature.status} backbone={["planned", "in-progress", "done"]} createdAt={feature.createdAt} updatedAt={feature.updatedAt} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link to="edit"><Button type="button" shortcut="edit">Edit feature</Button></Link>
          <Form ref={deleteFormRef} method="post" action={`/features/${feature.id}/delete`} className="inline-flex" onSubmit={(event) => {
            if (!window.confirm(`Delete feature \"${feature.name}\"?`)) event.preventDefault();
          }}>
            <Button type="submit" variant="danger" shortcut="delete">Delete feature</Button>
          </Form>
        </div>
      </div>

      <Card className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Current phase</p><p className="mt-2 text-sm font-semibold text-[var(--text)] break-words">{currentPhase?.title || "No active phase"}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Phases</p><p className="mt-2 text-3xl font-black text-[var(--text)]">{phases.length}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Tasks</p><p className="mt-2 text-3xl font-black text-[var(--text)]">{taskCount}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Current phase</p><p className="mt-2 text-sm font-semibold text-[var(--text)] break-words">{currentPhase?.title || "No active phase"}</p></CompactCard>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">In progress</p><p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.inProgress}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Remaining</p><p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.remaining}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Done</p><p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.done}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Blocked</p><p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.blocked}</p></CompactCard>
        </div>

        <DetailMetadataGrid
          items={[
            { label: "Entity last updated", value: formatDateTime(feature.updatedAt), visible: Boolean(feature.updatedAt) },
            { label: "Priority", value: formatPriority(feature.priority), visible: feature.priority > 0 },
            { label: "Timeline", value: formatTimeline(feature.startDate, feature.endDate), visible: Boolean(feature.startDate || feature.endDate) },
          ]}
        />

        {(feature.workDone || feature.workRemaining) ? (
          <Accordion title="Planning notes" defaultOpen={false}>
            <div className="grid gap-4 md:grid-cols-2">
              {feature.workDone ? <div><span className="font-semibold text-[var(--text)]">Work done</span><FormattedText text={feature.workDone} className="mt-2" /></div> : null}
              {feature.workRemaining ? <div><span className="font-semibold text-[var(--text)]">Work remaining</span><FormattedText text={feature.workRemaining} className="mt-2" /></div> : null}
            </div>
          </Accordion>
        ) : null}
        {acceptedDecisions.length > 0 ? <AcceptedDecisionsList decisions={acceptedDecisions} /> : null}
        <StatusHistoryAccordion statusLog={feature.statusLog ?? []} currentStatus={feature.status} backbone={["planned", "in-progress", "done"]} />
      </Card>

      <Card className="grid gap-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Phases ({phases.length})</p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Filter and sort this feature's phases.</p>
          </div>
          <Link to="phases/new"><Button type="button" variant="primary" shortcut="create">Create phase</Button></Link>
        </div>

        <DetailFilters
          entityKind="phase"
          statusOptions={phaseStatuses}
          value={filters}
          onChange={setFilters}
          sortSlot={<SortControl sort={sort} onChange={(next) => setSearchParams((prev) => {
            prev.set("sort", next.key);
            prev.set("dir", next.direction);
            return prev;
          })} />}
        />

        <div className="grid gap-3">
          {phases.length === 0 ? (
            <Card className="p-4 text-sm text-[var(--text-muted)]">No phases yet. <Link to={`/features/${feature.id}/phases/new`} className="font-semibold text-[var(--accent)] hover:underline">Add a phase</Link></Card>
          ) : filteredPhases.length > 0 ? filteredPhases.map((phase) => <PhaseRow key={phase.id} featureId={feature.id} feature={feature} phase={phase} />) : <Card className="p-4 text-sm text-[var(--text-muted)]">No phases match the current filters.</Card>}
        </div>
      </Card>
      <Outlet />
    </div>
  );
}
