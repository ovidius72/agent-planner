import { useCallback, useMemo } from "react";
import { Form, Link, Outlet, useLoaderData, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Accordion } from "../../components/ui/accordion";
import { EntityBadge } from "../../components/ui/entity-badge";
import { ListFilters } from "../../components/ui/list-filters";
import { StatusBadge } from "../../components/ui/status-badge";
import { matchesListQuery } from "../../lib/list-filtering";
import { useShortcut } from "../../lib/shortcuts";
import { requirementStatuses } from "../../lib/statuses";
import type { Phase, Requirement } from "../../lib/types";

function formatPhaseRef(phase: Phase) {
  return `P${String(phase.number ?? 0).padStart(3, "0")}`;
}

export function RequirementsRoute() {
  const { requirements, phases } = useLoaderData() as { requirements: Requirement[]; phases: Phase[] };
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "";
  const openCreate = useCallback(() => navigate("new"), [navigate]);
  useShortcut("create", openCreate);

  const phasesById = useMemo(() => new Map(phases.map((phase) => [phase.id, phase] as const)), [phases]);
  const filteredRequirements = useMemo(
    () => requirements.filter((requirement) => {
      const linkedLabels = requirement.linkedPhaseIds.map((phaseId) => {
        const phase = phasesById.get(phaseId);
        return phase ? `${formatPhaseRef(phase)} ${phase.title} ${phase.summary}` : phaseId;
      });
      return (!status || requirement.status === status)
        && matchesListQuery(query, [requirement.title, requirement.description, requirement.id, ...linkedLabels]);
    }),
    [requirements, phasesById, query, status],
  );

  return (
    <>
      <div className="grid gap-8">
        <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <EntityBadge kind="requirement" label="Requirements" />
            <p className="mt-2 text-sm text-[var(--text-muted)]">Track top-level outcomes independently from features, then link them to the phases that deliver them.</p>
          </div>
          <Link to="new">
            <Button type="button" variant="primary" shortcut="create">Create requirement</Button>
          </Link>
        </Card>

        <ListFilters
          query={query}
          status={status}
          statusOptions={requirementStatuses}
          placeholder="Search requirement title, description, id, or linked phase"
          clearTo="/requirements"
          resultsLabel={filteredRequirements.length === requirements.length ? `${requirements.length} requirements` : `${filteredRequirements.length} of ${requirements.length} requirements`}
        />

        <div className="grid gap-3">
          {requirements.length === 0 ? (
            <Card className="p-4 text-sm text-[var(--text-muted)]">No requirements yet. <Link to="/requirements/new" className="font-semibold text-[var(--accent)] hover:underline">Create your first requirement</Link></Card>
          ) : filteredRequirements.length > 0 ? filteredRequirements.map((requirement) => {
            const linkedPhases = requirement.linkedPhaseIds.map((phaseId) => phasesById.get(phaseId)).filter(Boolean) as Phase[];
            return (
              <Card key={requirement.id} className="overflow-hidden p-0">
                <Accordion
                  defaultOpen={false}
                  leading={<StatusBadge status={requirement.status} />}
                  title={<h2 className="min-w-0 text-lg font-black tracking-tight text-[var(--text)] [overflow-wrap:anywhere]">{requirement.title}</h2>}
                  count={linkedPhases.length}
                  contentClassName="grid gap-4"
                  subtitle={(
                    <>
                      {linkedPhases.length > 0 ? <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{linkedPhases.length} linked phase{linkedPhases.length === 1 ? "" : "s"}</span> : null}
                      {linkedPhases.length > 0 && requirement.macroTasks.length > 0 ? <span className="mx-2 text-[var(--text-subtle)]">•</span> : null}
                      {requirement.macroTasks.length > 0 ? <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{requirement.macroTasks.length} macro task{requirement.macroTasks.length === 1 ? "" : "s"}</span> : null}
                    </>
                  )}
                  summaryClassName="hover:bg-[var(--surface-elevated)]/65"
                >
                  <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      {requirement.description ? <p className="min-w-0 text-sm text-[var(--text-muted)] [overflow-wrap:anywhere]">{requirement.description}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      <Link to={`${requirement.id}/edit`}>
                        <Button type="button" variant="secondary">Edit</Button>
                      </Link>
                      <Form
                        method="post"
                        action={`/requirements/${requirement.id}/delete`}
                        onSubmit={(event) => {
                          if (!window.confirm(`Delete requirement \"${requirement.title}\"?`)) event.preventDefault();
                        }}
                      >
                        <Button type="submit" variant="danger">Delete</Button>
                      </Form>
                    </div>
                  </div>

                  {linkedPhases.length > 0 ? (
                    <div className="grid gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">Linked phases</p>
                      <div className="flex flex-wrap gap-2">
                        {linkedPhases.map((phase) => {
                          const href = phase.featureId ? `/features/${phase.featureId}/phases/${phase.id}` : "/features";
                          return (
                            <Link key={phase.id} to={href} className="inline-flex max-w-full items-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
                              <span className="[overflow-wrap:anywhere]">{formatPhaseRef(phase)} — {phase.title}</span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--text-muted)]">No linked phases yet.</div>
                  )}
                </Accordion>
              </Card>
            );
          }) : <Card className="p-4 text-sm text-[var(--text-muted)]">No requirements match the current filters.</Card>}
        </div>
      </div>
      <Outlet />
    </>
  );
}
