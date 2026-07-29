import { CheckCircle2, Circle, Loader2, OctagonAlert, PauseCircle, Ban, TimerReset, CircleDashed, ChevronRight } from "lucide-react";

interface StatusLogEntryLike {
  id: string;
  date: string;
  fromStatus: string;
  toStatus: string;
  title: string;
  description: string;
}

const STATUS_ICON: Record<string, typeof Circle> = {
  "draft": CircleDashed,
  "discovery": CircleDashed,
  "planned": Circle,
  "in-progress": Loader2,
  "done": CheckCircle2,
  "blocked": OctagonAlert,
  "waiting": PauseCircle,
  "deferred": TimerReset,
  "canceled": Ban,
  "rejected": Ban,
};

function formatCompactDate(value: string | undefined): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

/** Terminal non-done statuses — when reached, the "done" card is dropped. */
const TERMINAL_NON_DONE = new Set(["canceled", "rejected"]);

function StatusCard({ status, date, reached, isCurrent }: { status: string; date?: string; reached: boolean; isCurrent: boolean }) {
  const Icon = STATUS_ICON[status] ?? Circle;
  const cls = `status-card status-${status} ${isCurrent ? "status-card-current" : ""} ${reached ? "status-card-reached" : "status-card-future"}`;
  return (
    <div className={cls} title={date ? `${status} — ${formatCompactDate(date)}` : status}>
      <Icon className={`status-card-icon ${isCurrent && status === "in-progress" ? "animate-spin" : ""}`} />
      <span className="status-card-label">{status}</span>
      {reached && date ? (
        <span className="status-card-time">{formatCompactDate(date)}</span>
      ) : reached ? (
        <span className="status-card-time status-card-time-initial">reached</span>
      ) : (
        <span className="status-card-time status-card-time-initial">pending</span>
      )}
    </div>
  );
}

export interface StatusCardStepperProps {
  statusLog: StatusLogEntryLike[];
  currentStatus: string;
  /** Canonical happy path to "done" (always shown). e.g. ["planned","in-progress","done"]. */
  backbone: string[];
}

/**
 * Always-expanded status stepper. Renders the canonical `backbone` path as a
 * row of cards (e.g. [planned] → [in-progress] → [done]); every card is always
 * visible. A card is FILLED (highlighted) once that state has been reached,
 * OUTLINED while pending/future. Intermediate visited statuses (blocked,
 * waiting, …) are inserted in chronological position. Terminal non-done
 * statuses (canceled/rejected) replace the "done" card when reached.
 */
export function StatusCardStepper({ statusLog, currentStatus, backbone }: StatusCardStepperProps) {
  // Visited sequence (chronological): initial fromStatus + each toStatus.
  const seq: string[] = [];
  if (statusLog.length === 0) {
    seq.push(currentStatus);
  } else {
    const first = statusLog[0];
    if (first) seq.push(first.fromStatus);
    for (const entry of statusLog) seq.push(entry.toStatus);
  }
  const reached = new Set(seq);
  // Drop "done" from the backbone if a terminal non-done was reached.
  const hasTerminalNonDone = [...reached].some((s) => TERMINAL_NON_DONE.has(s));
  const base = hasTerminalNonDone ? backbone.filter((s) => s !== "done") : [...backbone];

  // Intermediates = visited statuses not in backbone, first-occurrence order.
  const intermediates: string[] = [];
  const seen = new Set<string>();
  for (const s of seq) {
    if (!base.includes(s) && !seen.has(s)) {
      intermediates.push(s);
      seen.add(s);
    }
  }

  // Build display: backbone with each intermediate inserted after its anchor
  // (the status immediately preceding its first occurrence in the log).
  const display: string[] = [...base];
  for (const inter of intermediates) {
    const idx = seq.indexOf(inter);
    const anchor = idx > 0 ? seq[idx - 1] : undefined;
    const anchorIdx = anchor ? display.lastIndexOf(anchor) : -1;
    if (anchorIdx >= 0) display.splice(anchorIdx + 1, 0, inter);
    else display.unshift(inter);
  }

  // Date when a status was entered: the toStatus entry date, else "".
  const dateFor = (status: string): string => {
    if (statusLog.length === 0) return "";
    if (status === statusLog[0]?.fromStatus) return statusLog[0]?.date ?? "";
    for (const e of statusLog) if (e.toStatus === status) return e.date;
    return "";
  };

  return (
    <div className="status-card-stepper">
      {display.map((status, idx) => {
        const isReached = reached.has(status);
        const isCurrent = status === currentStatus;
        return (
          <div key={`${status}-${idx}`} className="flex items-center gap-1.5 min-w-0">
            {idx > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-subtle)]" /> : null}
            <StatusCard status={status} date={dateFor(status)} reached={isReached} isCurrent={isCurrent} />
          </div>
        );
      })}
    </div>
  );
}