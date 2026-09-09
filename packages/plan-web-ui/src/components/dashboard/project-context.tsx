import { Card } from "../ui/card";
import { AcceptedDecisionsList } from "../ui/accepted-decisions-list";
import { FormattedText } from "../ui/formatted-text";
import type { Project } from "../../lib/types";

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">{title}</h3>
      <ul className="mt-2 grid gap-2 pl-5 text-sm text-[var(--text-muted)]">
        {items.map((item) => <li key={item} className="list-disc">{item}</li>)}
      </ul>
    </section>
  );
}

/** Canonical human-authored project metadata. This is intentionally not an
 * AI-generated summary and never renders agent-only SKILL.md or rules.json. */
export function ProjectContext({ project }: { project: Project }) {
  const guidelines = project.projectGuidelines.content.trim();
  const workflowRuleCount = project.workflowRules.beforePhaseStart.length
    + project.workflowRules.beforeTaskStart.length
    + project.workflowRules.afterPhaseComplete.length;
  const legacyCount = project.globalRules.length + workflowRuleCount + project.decisions.length;
  const hasContext = project.scope.length > 0
    || project.outOfScope.length > 0
    || project.technologies.length > 0
    || project.tools.length > 0
    || guidelines.length > 0
    || project.acceptedDecisions.length > 0
    || legacyCount > 0;

  if (!hasContext) return null;

  return (
    <Card className="grid gap-4">
      <details className="group">
        <summary className="cursor-pointer select-none text-lg font-bold text-[var(--text)]">
          Project Context
        </summary>
        <div className="mt-4 grid gap-4">
          <ListSection title="In scope" items={project.scope} />
          <ListSection title="Out of scope" items={project.outOfScope} />
          {(project.technologies.length > 0 || project.tools.length > 0) ? (
            <div className="grid gap-4 md:grid-cols-2">
              <ListSection title="Technologies" items={project.technologies} />
              <ListSection title="Tools" items={project.tools} />
            </div>
          ) : null}
          {guidelines ? (
            <section>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">Project Guidelines</h3>
              <div className="mt-2 text-sm text-[var(--text-muted)]"><FormattedText text={guidelines} /></div>
            </section>
          ) : null}
          <AcceptedDecisionsList decisions={project.acceptedDecisions} targetType="project" />
          {legacyCount > 0 ? (
            <aside className="rounded-[14px] border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-muted)]" aria-label="Legacy project context">
              <span className="font-semibold text-[var(--text)]">Legacy project context remains.</span>{" "}
              {legacyCount} legacy rule or decision {legacyCount === 1 ? "entry will" : "entries will"} migrate automatically on the next explicit planner load.
            </aside>
          ) : null}
        </div>
      </details>
    </Card>
  );
}
