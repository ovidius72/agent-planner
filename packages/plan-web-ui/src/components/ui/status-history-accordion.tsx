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

/** Build a chronological list of transitions. Uses the real statusLog when present;
 *  otherwise INFERS transitions from the backbone position of currentStatus
 *  (a "done" task must have transited planned→in-progress→done), using
 *  startedAt / completedAt as transition dates. */
function buildTransitions(
  statusLog: StatusLogEntryLike[],
  currentStatus: string,
  backbone: string[],
  startedAt?: string,
  completedAt?: string,
): { date: string; fromStatus: string; toStatus: string; title: string; description: string; inferred: boolean }[] {
  if (statusLog.length > 0) {
    return statusLog.map((e) => ({ date: e.date, fromStatus: e.fromStatus, toStatus: e.toStatus, title: e.title, description: e.description, inferred: false }));
  }
  // Infer from backbone.
  const idx = backbone.indexOf(currentStatus);
  if (idx < 0) return [];
  const out: { date: string; fromStatus: string; toStatus: string; title: string; description: string; inferred: boolean }[] = [];
  for (let i = 1; i <= idx; i++) {
    const from = backbone[i - 1]!;
    const to = backbone[i]!;
    const date = to === "in-progress" ? (startedAt ?? "") : to === "done" ? (completedAt ?? "") : "";
    out.push({ date, fromStatus: from, toStatus: to, title: `→ ${prettyStatus(to)}`, description: "", inferred: true });
  }
  return out;
}

export interface StatusHistoryAccordionProps {
  statusLog: StatusLogEntryLike[];
  currentStatus?: string;
  backbone?: string[];
  startedAt?: string;
  completedAt?: string;
}

/**
 * Collapsible "Status history" accordion: the chronological list of status
 * transitions (from → to, date, motivation). Uses the recorded statusLog; when
 * that is empty, transitions are inferred from the backbone progression of the
 * current status (so a "done" task always shows planned→in-progress→done).
 */
export function StatusHistoryAccordion({ statusLog, currentStatus, backbone, startedAt, completedAt }: StatusHistoryAccordionProps) {
  const transitions = buildTransitions(statusLog ?? [], currentStatus ?? "", backbone ?? [], startedAt, completedAt);
  const open = transitions.length > 0;
  return (
    <details className="group mt-4 border border-[var(--border)] rounded-lg overflow-hidden" open={open}>
      <summary className="flex items-center justify-between p-3 cursor-pointer font-semibold text-[var(--text)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-strong)] transition-colors select-none">
        <span className="text-sm">Status history ({transitions.length})</span>
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-[var(--text-muted)]" />
      </summary>
      <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)] grid gap-2.5">
        {transitions.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] italic">No status changes recorded.</p>
        ) : (
          transitions.map((entry, i) => (
            <div key={i} className="grid gap-0.5 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-[var(--text)]">
                <span className="text-xs font-mono text-[var(--text-subtle)]">{formatCompactDate(entry.date)}</span>
                <span className="font-semibold text-[var(--text-muted)]">{prettyStatus(entry.fromStatus)}</span>
                <span className="text-[var(--text-subtle)]">→</span>
                <span className="font-semibold text-[var(--text)]">{prettyStatus(entry.toStatus)}</span>
                {entry.inferred ? <span className="text-[0.6rem] uppercase tracking-wider text-[var(--text-subtle)] border border-[var(--border)] rounded px-1 py-0.5">inferred</span> : null}
              </div>
              {entry.title ? <p className="font-semibold text-[var(--text)]">{entry.title}</p> : null}
              {entry.description ? <p className="text-[var(--text-muted)] whitespace-pre-wrap">{entry.description}</p> : null}
            </div>
          ))
        )}
      </div>
    </details>
  );
}