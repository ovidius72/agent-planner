import { Accordion } from "./accordion";

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
): { date: string; fromStatus: string; toStatus: string; motivation: string; inferred: boolean }[] {
  if (statusLog.length > 0) {
    return statusLog.map((e) => ({
      date: e.date,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      motivation: e.description.trim(),
      inferred: false,
    }));
  }
  // Infer from backbone.
  const idx = backbone.indexOf(currentStatus);
  if (idx < 0) return [];
  const out: { date: string; fromStatus: string; toStatus: string; motivation: string; inferred: boolean }[] = [];
  for (let i = 1; i <= idx; i++) {
    const from = backbone[i - 1]!;
    const to = backbone[i]!;
    const date = to === "in-progress" ? (startedAt ?? "") : to === "done" ? (completedAt ?? "") : "";
    out.push({ date, fromStatus: from, toStatus: to, motivation: "", inferred: true });
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
 *
 * Implementation note: this wraps the shared {@link Accordion} primitive instead
 * of re-implementing <details>/<summary>, keeping disclosure behavior and
 * styling consistent across the app.
 */
export function StatusHistoryAccordion({ statusLog, currentStatus, backbone, startedAt, completedAt }: StatusHistoryAccordionProps) {
  const transitions = buildTransitions(statusLog ?? [], currentStatus ?? "", backbone ?? [], startedAt, completedAt);
  return (
    <Accordion
      title="Status history"
      count={transitions.length}
      defaultOpen={transitions.length > 0}
      contentClassName="grid gap-2.5"
    >
      {transitions.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] italic">No status changes recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--text-subtle)]">
                <th scope="col" className="px-2 pb-2 font-medium">Date</th>
                <th scope="col" className="px-2 pb-2 font-medium">From</th>
                <th scope="col" className="px-2 pb-2 font-medium">To</th>
                <th scope="col" className="px-2 pb-2 font-medium">Motivation</th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((entry, i) => (
                <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="px-2 py-2 align-top text-xs font-mono text-[var(--text-subtle)] whitespace-nowrap">
                    {formatCompactDate(entry.date)}
                  </td>
                  <td className="px-2 py-2 align-top font-semibold text-[var(--text-muted)] whitespace-nowrap">
                    {prettyStatus(entry.fromStatus)}
                  </td>
                  <td className="px-2 py-2 align-top font-semibold text-[var(--text)] whitespace-nowrap">
                    {prettyStatus(entry.toStatus)}
                  </td>
                  <td className="px-2 py-2 align-top text-[var(--text-muted)] whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {entry.motivation || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Accordion>
  );
}