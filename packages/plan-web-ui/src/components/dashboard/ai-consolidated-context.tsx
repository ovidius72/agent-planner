import { Card } from "../ui/card";
import { FormattedText } from "../ui/formatted-text";
import type { AcceptedDecision, Project } from "../../lib/types";

function AcceptedDecisionsBlock({ decisions }: { decisions: AcceptedDecision[] }) {
  if (decisions.length === 0) return null;

  return (
    <details className="group rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4">
      <summary className="cursor-pointer select-none font-semibold text-[var(--text)]">
        Accepted decisions ({decisions.length})
      </summary>
      <div className="mt-4 grid gap-3">
        {decisions.map((entry) => (
          <div key={entry.id} className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--text)]">{entry.title}</p>
            {entry.decision ? <div className="mt-2 text-sm text-[var(--text-muted)]"><span className="font-semibold text-[var(--text)]">Decision:</span> <FormattedText text={entry.decision} /></div> : null}
            {entry.rationale ? <div className="mt-1 text-sm text-[var(--text-muted)]"><span className="font-semibold text-[var(--text)]">Rationale:</span> <FormattedText text={entry.rationale} /></div> : null}
            {entry.implementationNotes ? <div className="mt-1 text-sm text-[var(--text-muted)]"><span className="font-semibold text-[var(--text)]">Implementation:</span> <FormattedText text={entry.implementationNotes} /></div> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * The collapsible "AI Consolidated Context" card: scope, technologies, global
 * rules, workflow rules, legacy + accepted decisions. Renders nothing when the
 * project carries none of these fields.
 */
export function AiConsolidatedContext({ project }: { project: Project }) {
  const scope = project.scope ?? [];
  const outOfScope = project.outOfScope ?? [];
  const technologies = project.technologies ?? [];
  const tools = project.tools ?? [];
  const globalRules = project.globalRules ?? [];
  const decisions = project.decisions ?? [];
  const acceptedDecisions = project.acceptedDecisions ?? [];
  const workflowRules = {
    beforePhaseStart: project.workflowRules?.beforePhaseStart ?? [],
    beforeTaskStart: project.workflowRules?.beforeTaskStart ?? [],
    afterPhaseComplete: project.workflowRules?.afterPhaseComplete ?? [],
  };

  const hasAny =
    scope.length > 0
    || outOfScope.length > 0
    || technologies.length > 0
    || tools.length > 0
    || globalRules.length > 0
    || decisions.length > 0
    || acceptedDecisions.length > 0
    || workflowRules.beforePhaseStart.length > 0
    || workflowRules.beforeTaskStart.length > 0
    || workflowRules.afterPhaseComplete.length > 0;

  if (!hasAny) return null;

  return (
    <Card className="grid gap-4">
      <details className="group">
        <summary className="cursor-pointer select-none text-lg font-bold text-[var(--text)]">
          AI Consolidated Context
        </summary>
        <div className="mt-4 grid gap-4">
          {scope.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">In scope</h3>
              <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                {scope.map((item) => <li key={item} className="list-disc">{item}</li>)}
              </ul>
            </div>
          ) : null}

          {outOfScope.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Out of scope</h3>
              <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                {outOfScope.map((item) => <li key={item} className="list-disc">{item}</li>)}
              </ul>
            </div>
          ) : null}

          {(technologies.length > 0 || tools.length > 0) ? (
            <div className="grid gap-4 md:grid-cols-2">
              {technologies.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Technologies</h3>
                  <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                    {technologies.map((item) => <li key={item} className="list-disc">{item}</li>)}
                  </ul>
                </div>
              ) : null}
              {tools.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Tools</h3>
                  <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                    {tools.map((item) => <li key={item} className="list-disc">{item}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {globalRules.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Global rules</h3>
              <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                {globalRules.map((item) => <li key={item} className="list-disc">{item}</li>)}
              </ul>
            </div>
          ) : null}

          {(workflowRules.beforePhaseStart.length > 0 || workflowRules.beforeTaskStart.length > 0 || workflowRules.afterPhaseComplete.length > 0) ? (
            <details className="group rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4">
              <summary className="cursor-pointer select-none font-semibold text-[var(--text)]">
                Workflow rules
              </summary>
              <div className="mt-4 grid gap-4 text-sm text-[var(--text-muted)]">
                {workflowRules.beforePhaseStart.length > 0 ? (
                  <div>
                    <h3 className="font-semibold text-[var(--text)]">Before phase start</h3>
                    <ul className="mt-2 grid gap-2 pl-5">
                      {workflowRules.beforePhaseStart.map((item) => <li key={item} className="list-disc">{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {workflowRules.beforeTaskStart.length > 0 ? (
                  <div>
                    <h3 className="font-semibold text-[var(--text)]">Before task start</h3>
                    <ul className="mt-2 grid gap-2 pl-5">
                      {workflowRules.beforeTaskStart.map((item) => <li key={item} className="list-disc">{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {workflowRules.afterPhaseComplete.length > 0 ? (
                  <div>
                    <h3 className="font-semibold text-[var(--text)]">After phase complete</h3>
                    <ul className="mt-2 grid gap-2 pl-5">
                      {workflowRules.afterPhaseComplete.map((item) => <li key={item} className="list-disc">{item}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          {decisions.length > 0 ? (
            <details className="group rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4">
              <summary className="cursor-pointer select-none font-semibold text-[var(--text)]">
                Legacy decisions ({decisions.length})
              </summary>
              <ul className="mt-4 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
                {decisions.map((item) => <li key={item} className="list-disc">{item}</li>)}
              </ul>
            </details>
          ) : null}

          <AcceptedDecisionsBlock decisions={acceptedDecisions} />
        </div>
      </details>
    </Card>
  );
}
