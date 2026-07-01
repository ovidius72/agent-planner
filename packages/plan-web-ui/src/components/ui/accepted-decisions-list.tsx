import { FormattedText } from "./formatted-text";
import type { AcceptedDecision } from "../../lib/types";

export function AcceptedDecisionsList({ decisions }: { decisions: AcceptedDecision[] }) {
  if (decisions.length === 0) return null;

  return (
    <details className="group mt-4">
      <summary className="flex cursor-pointer select-none items-center gap-2 font-semibold text-[var(--text)]">
        <span>Accepted decisions ({decisions.length})</span>
      </summary>
      <div className="mt-2 grid gap-3">
        {decisions.map((entry) => (
          <div key={entry.id} className="surface-card px-4 py-3">
            <p className="text-sm font-semibold text-[var(--text)]">{entry.title}</p>
            {entry.decision ? (
              <div className="mt-2 text-sm text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text)]">Decision:</span>
                <FormattedText text={entry.decision} className="mt-1" />
              </div>
            ) : null}
            {entry.rationale ? (
              <div className="mt-1 text-sm text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text)]">Rationale:</span>
                <FormattedText text={entry.rationale} className="mt-1" />
              </div>
            ) : null}
            {entry.implementationNotes ? (
              <div className="mt-1 text-sm text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text)]">Implementation:</span>
                <FormattedText text={entry.implementationNotes} className="mt-1" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}