import { ListTodo } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Compact, accessible phase → requirements navigation affordance.
 * Render nothing for phases without requirements so list/tree rows stay quiet.
 */
export function PhaseRequirementLink({
  phaseId,
  phaseTitle,
  count,
  className = "",
}: {
  phaseId: string;
  phaseTitle: string;
  count: number;
  className?: string;
}) {
  if (count < 1) return null;

  const label = `${count} linked requirement${count === 1 ? "" : "s"} for phase ${phaseTitle}`;
  return (
    <Link
      to={`/requirements#phase-${phaseId}`}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 text-xs font-semibold text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
    >
      <ListTodo aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span aria-hidden="true">{count}</span>
    </Link>
  );
}
