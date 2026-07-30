import { ChevronDown } from "lucide-react";

interface StatusLogEntryLike {
  id: string;
  date: string;
  fromStatus: string;
  toStatus: string;
  title: string;
  description: string;
}

function prettyStatus(status: string): string {
  return status
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => (w === "and" ? "and" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function formatCompactDate(value: string | undefined): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export interface StatusHistoryAccordionProps {
  statusLog: StatusLogEntryLike[];
}

/**
 * Collapsible "Status history" accordion: a chronological list of status
 * changes with the reason (title + description). This is the audit trail —
 * the compact filled/outlined stepper lives separately, prominent.
 */
export function StatusHistoryAccordion({ statusLog }: StatusHistoryAccordionProps) {
  const log = statusLog ?? [];
  if (log.length === 0) {
    return (
      <details className="group mt-4 border border-[var(--border)] rounded-lg overflow-hidden">
        <summary className="flex items-center justify-between p-3 cursor-pointer font-semibold text-[var(--text)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-strong)] transition-colors select-none">
          <span className="text-sm">Status history</span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-[var(--text-muted)]" />
        </summary>
        <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)]">
          <p className="text-sm text-[var(--text-muted)] italic">No status changes recorded.</p>
        </div>
      </details>
    );
  }
  return (
    <details className="group mt-4 border border-[var(--border)] rounded-lg overflow-hidden">
      <summary className="flex items-center justify-between p-3 cursor-pointer font-semibold text-[var(--text)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-strong)] transition-colors select-none">
        <span className="text-sm">Status history ({log.length})</span>
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-[var(--text-muted)]" />
      </summary>
      <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)] grid gap-2.5">
        {log.map((entry) => (
          <div key={entry.id} className="grid gap-0.5 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-[var(--text)]">
              <span className="text-xs font-mono text-[var(--text-subtle)]">{formatCompactDate(entry.date)}</span>
              <span className="font-semibold text-[var(--text-muted)]">{prettyStatus(entry.fromStatus)}</span>
              <span className="text-[var(--text-subtle)]">→</span>
              <span className="font-semibold text-[var(--text)]">{prettyStatus(entry.toStatus)}</span>
            </div>
            {entry.title ? <p className="font-semibold text-[var(--text)]">{entry.title}</p> : null}
            {entry.description ? <p className="text-[var(--text-muted)] whitespace-pre-wrap">{entry.description}</p> : null}
          </div>
        ))}
      </div>
    </details>
  );
}