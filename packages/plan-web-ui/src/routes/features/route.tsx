import { useCallback, useMemo } from "react";
import { Link, Outlet, useLoaderData, useNavigate, useSearchParams } from "react-router-dom";
import { FeatureRow } from "../../components/features/feature-row";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { EntityBadge } from "../../components/ui/entity-badge";
import { ListFilters } from "../../components/ui/list-filters";
import { matchesListQuery } from "../../lib/list-filtering";
import { useShortcut } from "../../lib/shortcuts";
import { createEmptyStatusSummary, summarizePhaseStatuses, summarizeTaskStatuses } from "../../lib/status-summary";
import { featureStatuses } from "../../lib/statuses";
import type { Feature, Phase } from "../../lib/types";

function buildCounts(phases: Phase[]) {
  const phasesByFeature = new Map<string, number>();
  const tasksByFeature = new Map<string, number>();
  const phaseSummaryByFeature = new Map<string, ReturnType<typeof createEmptyStatusSummary>>();
  const taskSummaryByFeature = new Map<string, ReturnType<typeof createEmptyStatusSummary>>();
  const grouped = new Map<string, Phase[]>();

  for (const phase of phases) {
    if (!phase.featureId) continue;
    grouped.set(phase.featureId, [...(grouped.get(phase.featureId) ?? []), phase]);
  }

  for (const [featureId, featurePhases] of grouped) {
    phasesByFeature.set(featureId, featurePhases.length);
    tasksByFeature.set(featureId, featurePhases.reduce((total, phase) => total + phase.tasks.length, 0));
    phaseSummaryByFeature.set(featureId, summarizePhaseStatuses(featurePhases));
    taskSummaryByFeature.set(featureId, summarizeTaskStatuses(featurePhases.flatMap((phase) => phase.tasks)));
  }

  return { phasesByFeature, tasksByFeature, phaseSummaryByFeature, taskSummaryByFeature };
}

export function FeaturesRoute() {
  const { features, phases } = useLoaderData() as { features: Feature[]; phases: Phase[] };
  const { phasesByFeature, tasksByFeature, phaseSummaryByFeature, taskSummaryByFeature } = buildCounts(phases);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "";
  const openCreate = useCallback(() => navigate("new"), [navigate]);
  useShortcut("create", openCreate);

  const filteredFeatures = useMemo(
    () => features.filter((feature) => (
      (!status || feature.status === status)
      && matchesListQuery(query, [feature.name, feature.id, feature.description])
    )),
    [features, query, status],
  );

  return (
    <>
      <div className="grid gap-8">
        <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <EntityBadge kind="feature" label="Features" />
            <p className="mt-2 text-sm text-[var(--text-muted)]">Filter by name or status, then inspect child phases and tasks directly from the rows.</p>
          </div>
          <Link to="new">
            <Button type="button" variant="primary" shortcut="create">Create feature</Button>
          </Link>
        </Card>

        <ListFilters
          query={query}
          status={status}
          statusOptions={featureStatuses}
          placeholder="Search feature name, id, or description"
          clearTo="/features"
          resultsLabel={filteredFeatures.length === features.length ? `${features.length} features` : `${filteredFeatures.length} of ${features.length} features`}
        />

        <div className="grid gap-3">
          {filteredFeatures.length > 0 ? filteredFeatures.map((feature) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              phasesCount={phasesByFeature.get(feature.id) ?? 0}
              tasksCount={tasksByFeature.get(feature.id) ?? 0}
              phaseSummary={phaseSummaryByFeature.get(feature.id) ?? createEmptyStatusSummary()}
              taskSummary={taskSummaryByFeature.get(feature.id) ?? createEmptyStatusSummary()}
            />
          )) : <Card className="p-4 text-sm text-[var(--text-muted)]">No features match the current filters.</Card>}
        </div>
      </div>
      <Outlet />
    </>
  );
}
