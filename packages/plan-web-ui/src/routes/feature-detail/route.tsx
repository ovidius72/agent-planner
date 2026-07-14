import { ArrowLeft } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { Form, Link, Outlet, useLoaderData, useNavigate, useSearchParams } from "react-router-dom";
import { PhaseRow } from "../../components/phases/phase-row";
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
import { phaseStatuses } from "../../lib/statuses";
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
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "";
  const filteredPhases = useMemo(
    () => phases.filter((phase) => (
      (!status || phase.status === status)
      && matchesListQuery(query, [phase.title, phase.id, phase.summary, phase.description])
    )),
    [phases, query, status],
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

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Breadcrumbs items={[{ label: "Features", to: "/features" }, { label: feature.name }]} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <EntityBadge type="feature" number={feature.number} />
            <StatusBadge status={feature.status} />
          </div>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--text)] min-w-0 break-words [overflow-wrap:anywhere] sm:text-3xl">{feature.name}</h2>
          {feature.description ? <FormattedText text={feature.description} className="plan-description mt-3 max-w-4xl" /> : null}
        </div>

        <Form ref={deleteFormRef} method="post" action={`/features/${feature.id}/delete`} onSubmit={(event) => {
          if (!window.confirm(`Delete feature \"${feature.name}\"?`)) event.preventDefault();
        }}>
          <Button type="submit" variant="danger" shortcut="delete">Delete feature</Button>
        </Form>
      </div>

      <Card className="grid gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <EntityBadge type="feature" number={feature.number} />
            </div>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Snapshot of this feature only.</p>
          </div>
          <Link to="edit"><Button type="button" shortcut="edit">Edit feature</Button></Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Current phase</p><p className="mt-2 text-sm font-semibold text-[var(--text)] break-words">{currentPhase?.title || "No active phase"}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Phases</p><p className="mt-2 text-3xl font-black text-[var(--text)]">{phases.length}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Tasks</p><p className="mt-2 text-3xl font-black text-[var(--text)]">{taskCount}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Window</p><p className="mt-2 text-sm font-semibold text-[var(--text)]">{feature.startDate || "Not set"} → {feature.endDate || "Not set"}</p></CompactCard>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">In progress</p><p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.inProgress}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Remaining</p><p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.remaining}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Done</p><p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.done}</p></CompactCard>
          <CompactCard><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">Blocked</p><p className="mt-2 text-2xl font-black text-[var(--text)]">{taskSummary.blocked}</p></CompactCard>
        </div>

        {(feature.workDone || feature.workRemaining) ? (
          <div className="grid gap-4 md:grid-cols-2">
            {feature.workDone ? <div><span className="font-semibold text-[var(--text)]">Work done:</span><FormattedText text={feature.workDone} className="mt-2" /></div> : null}
            {feature.workRemaining ? <div><span className="font-semibold text-[var(--text)]">Work remaining:</span><FormattedText text={feature.workRemaining} className="mt-2" /></div> : null}
          </div>
        ) : null}
        {acceptedDecisions.length > 0 ? <AcceptedDecisionsList decisions={acceptedDecisions} /> : null}
      </Card>

      <Card className="grid gap-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="mt-2 flex items-center gap-2">
            <EntityBadge type="phase" number={0} />
            <p className="mt-2 text-sm text-[var(--text-muted)]">Filter this feature's phases by name or status.</p>
          </div>
          <Link to="phases/new"><Button type="button" variant="primary" shortcut="create">Create phase</Button></Link>
        </div>

        <ListFilters
          query={query}
          status={status}
          statusOptions={phaseStatuses}
          placeholder="Search phase title, id, or summary"
          clearTo={`/features/${feature.id}`}
          resultsLabel={filteredPhases.length === phases.length ? `${phases.length} phases` : `${filteredPhases.length} of ${phases.length} phases`}
        />

        <div className="grid gap-3">
          {filteredPhases.length > 0 ? filteredPhases.map((phase) => <PhaseRow key={phase.id} featureId={feature.id} feature={feature} phase={phase} />) : <Card className="p-4 text-sm text-[var(--text-muted)]">No phases match the current filters.</Card>}
        </div>
      </Card>
      <Outlet />
    </div>
  );
}
