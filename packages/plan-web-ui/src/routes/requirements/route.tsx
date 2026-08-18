import { useCallback, useEffect, useMemo } from "react";
import { Form, Link, Outlet, useLoaderData, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Accordion } from "../../components/ui/accordion";
import { EntityBadge } from "../../components/ui/entity-badge";
import { ListFilters } from "../../components/ui/list-filters";
import { matchesListQuery } from "../../lib/list-filtering";
import { groupRequirementsByPhase } from "../../lib/requirement-groups";
import { useShortcut } from "../../lib/shortcuts";
import type { Phase, Requirement } from "../../lib/types";

function formatPhaseRef(phase: Phase) {
  return `P${String(phase.number ?? 0).padStart(3, "0")}`;
}

function RequirementCard({ requirement }: { requirement: Requirement }) {
  return (
    <Card className="overflow-hidden p-0">
      <Accordion
        defaultOpen={false}
        title={<h2 className="min-w-0 text-lg font-black tracking-tight text-[var(--text)] [overflow-wrap:anywhere]">{requirement.title}</h2>}
        count={requirement.linkedPhaseIds.length}
        subtitle={(
          <>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{requirement.linkedPhaseIds.length} linked phase{requirement.linkedPhaseIds.length === 1 ? "" : "s"}</span>
            {requirement.linkedPhaseIds.length > 0 && requirement.macroTasks.length > 0 ? <span className="mx-2 text-[var(--text-subtle)]">•</span> : null}
            {requirement.macroTasks.length > 0 ? <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{requirement.macroTasks.length} macro task{requirement.macroTasks.length === 1 ? "" : "s"}</span> : null}
          </>
        )}
        contentClassName="grid gap-4"
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
      </Accordion>
    </Card>
  );
}

export function RequirementsRoute() {
  const { requirements, phases } = useLoaderData() as { requirements: Requirement[]; phases: Phase[] };
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const openCreate = useCallback(() => navigate("new"), [navigate]);
  useShortcut("create", openCreate);

  const phasesById = useMemo(() => new Map(phases.map((phase) => [phase.id, phase] as const)), [phases]);
  const filteredRequirements = useMemo(
    () => requirements.filter((requirement) => {
      const linkedLabels = requirement.linkedPhaseIds.map((phaseId) => {
        const phase = phasesById.get(phaseId);
        return phase ? `${formatPhaseRef(phase)} ${phase.title} ${phase.summary}` : phaseId;
      });
      return matchesListQuery(query, [requirement.title, requirement.description, requirement.id, ...linkedLabels]);
    }),
    [requirements, phasesById, query],
  );

  const { phaseGroups, unlinkedRequirements } = useMemo(
    () => groupRequirementsByPhase(filteredRequirements, phases),
    [filteredRequirements, phases],
  );

  // Browser hash navigation happens before async route data finishes; retry once
  // the phase sections exist so Work Tree phase icons reliably land here.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (!target) return;
    requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "start" }));
  }, [phaseGroups]);

  return (
    <>
      <div className="grid gap-8">
        <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <EntityBadge kind="requirement" label="Requirements" />
            <p className="mt-2 text-sm text-[var(--text-muted)]">Track top-level outcomes independently from features, grouped below by the phases that deliver them.</p>
          </div>
          <Link to="new">
            <Button type="button" variant="primary" shortcut="create">Create requirement</Button>
          </Link>
        </Card>

        <ListFilters
          query={query}
          placeholder="Search requirement title, description, id, or linked phase"
          clearTo="/requirements"
          resultsLabel={filteredRequirements.length === requirements.length ? `${requirements.length} requirements` : `${filteredRequirements.length} of ${requirements.length} requirements`}
        />

        <div className="grid gap-6">
          {requirements.length === 0 ? (
            <Card className="p-4 text-sm text-[var(--text-muted)]">No requirements yet. <Link to="/requirements/new" className="font-semibold text-[var(--accent)] hover:underline">Create your first requirement</Link></Card>
          ) : filteredRequirements.length > 0 ? (
            <>
              {phaseGroups.map(({ phase, requirements: phaseRequirements }) => {
                const href = phase.featureId ? `/features/${phase.featureId}/phases/${phase.id}` : "/features";
                return (
                  <section key={phase.id} id={`phase-${phase.id}`} className="scroll-mt-28" aria-labelledby={`phase-${phase.id}-heading`}>
                    <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">Linked phase</p>
                        <Link id={`phase-${phase.id}-heading`} to={href} className="min-w-0 break-words text-base font-black text-[var(--text)] underline-offset-4 hover:text-[var(--accent)] hover:underline [overflow-wrap:anywhere]">
                          {formatPhaseRef(phase)} — {phase.title}
                        </Link>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)]">
                        {phaseRequirements.length} requirement{phaseRequirements.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="grid gap-3">
                      {phaseRequirements.map((requirement) => <RequirementCard key={requirement.id} requirement={requirement} />)}
                    </div>
                  </section>
                );
              })}

              {unlinkedRequirements.length > 0 ? (
                <section id="unlinked-requirements" className="scroll-mt-28" aria-labelledby="unlinked-requirements-heading">
                  <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">Unlinked</p>
                      <h2 id="unlinked-requirements-heading" className="text-base font-black text-[var(--text)]">Requirements without a valid phase</h2>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--surface-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)]">{unlinkedRequirements.length}</span>
                  </div>
                  <div className="grid gap-3">
                    {unlinkedRequirements.map((requirement) => <RequirementCard key={requirement.id} requirement={requirement} />)}
                  </div>
                </section>
              ) : null}
            </>
          ) : <Card className="p-4 text-sm text-[var(--text-muted)]">No requirements match the current filters.</Card>}
        </div>
      </div>
      <Outlet />
    </>
  );
}
