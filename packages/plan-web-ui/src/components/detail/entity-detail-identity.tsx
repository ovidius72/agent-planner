import { CheckSquare, GitBranch, Layers, type LucideIcon } from "lucide-react";
import { useEffect, useId } from "react";

export type EntityDetailKind = "feature" | "phase" | "task";

const ENTITY_CONFIG: Record<EntityDetailKind, { label: string; icon: LucideIcon }> = {
  feature: { label: "Feature", icon: Layers },
  phase: { label: "Phase", icon: GitBranch },
  task: { label: "Task", icon: CheckSquare },
};

export interface EntityDetailIdentityProps {
  kind: EntityDetailKind;
  title: string;
  reference: string;
  subtitle?: string | undefined;
}

/**
 * Shared identity block for detail pages. The visible type label deliberately
 * precedes the H1 without becoming a heading itself, keeping the document
 * outline valid while making Feature, Phase, and Task pages unmistakable.
 */
export function EntityDetailIdentity({ kind, title, reference, subtitle }: EntityDetailIdentityProps) {
  const headingId = useId();
  const { label, icon: Icon } = ENTITY_CONFIG[kind];

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${label} ${reference} · ${title}`;
    return () => {
      document.title = previousTitle;
    };
  }, [label, reference, title]);

  return (
    <section className={`entity-detail-identity entity-detail-identity--${kind}`} aria-labelledby={headingId}>
      <p className="entity-detail-kind" data-entity-kind={kind}>
        <Icon className="h-5 w-5" aria-hidden="true" />
        <span>{label}</span>
      </p>
      <h1 id={headingId} className="entity-detail-title">{title}</h1>
      {subtitle ? <p className="entity-detail-subtitle">{subtitle}</p> : null}
    </section>
  );
}
