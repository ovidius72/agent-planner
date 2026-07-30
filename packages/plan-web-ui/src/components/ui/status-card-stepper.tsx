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
  draft: CircleDashed,
  discovery: CircleDashed,
  planned: Circle,
  "in-progress": Loader2,
  done: CheckCircle2,
  blocked: OctagonAlert,
  waiting: PauseCircle,
  deferred: TimerReset,
  canceled: Ban,
  rejected: Ban,
};

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

const TERMINAL_NON_DONE = new Set(["canceled", "rejected"]);

export interface StatusCardStepperProps {
  statusLog: StatusLogEntryLike[];
  currentStatus: string;
  /** Canonical happy path (always shown). e.g. ["planned","in-progress","done"]. */
  backbone: string[];
}

/**
 * Compact status STEPPER: a row of pills `[Planned] → [In Progress] → [Done]`.
 * Each pill = icon + status label.
 * - FILLED (solid) pill = status has been REACHED.
 * - OUTLINED (empty) pill = status is PENDING (not yet reached).
 * - The CURRENT status gets a ring.
 * - Intermediate visited statuses (blocked, waiting, deferred, …) are inserted
 *   in chronological position. Terminal non-done (canceled/rejected) replace
 *   "done" when reached.
 */
export function StatusCardStepper({ statusLog, currentStatus, backbone }: StatusCardStepperProps) {
  const seq: string[] = [];
  if (statusLog.length === 0) {
    seq.push(currentStatus);
  } else {
    const first = statusLog[0];
    if (first) seq.push(first.fromStatus);
    for (const entry of statusLog) seq.push(entry.toStatus);
  }
  const reached = new Set(seq);

  const hasTerminalNonDone = [...reached].some((s) => TERMINAL_NON_DONE.has(s));
  const base = hasTerminalNonDone ? backbone.filter((s) => s !== "done") : [...backbone];

  const intermediates: string[] = [];
  const seen = new Set<string>();
  for (const s of seq) {
    if (!base.includes(s) && !seen.has(s)) {
      intermediates.push(s);
      seen.add(s);
    }
  }

  const display: string[] = [...base];
  for (const inter of intermediates) {
    const idx = seq.indexOf(inter);
    const anchor = idx > 0 ? seq[idx - 1] : undefined;
    const anchorIdx = anchor ? display.lastIndexOf(anchor) : -1;
    if (anchorIdx >= 0) display.splice(anchorIdx + 1, 0, inter);
    else display.unshift(inter);
  }

  const dateFor = (status: string): string => {
    if (statusLog.length === 0) return "";
    if (status === statusLog[0]?.fromStatus) return statusLog[0]?.date ?? "";
    for (const e of statusLog) if (e.toStatus === status) return e.date;
    return "";
  };

  return (
    <div className="status-stepper" role="list" aria-label="Status progress">
      {display.map((status, idx) => {
        const Icon = STATUS_ICON[status] ?? Circle;
        const isReached = reached.has(status);
        const isCurrent = status === currentStatus;
        const date = dateFor(status);
        const cls = `status-pill ${isReached ? "status-pill-reached" : "status-pill-pending"} ${
          isCurrent ? "status-pill-current" : ""
        } status-${status}`;
        const title = date ? `${prettyStatus(status)} — ${formatCompactDate(date)}` : prettyStatus(status);
        return (
          <div key={`${status}-${idx}`} className="flex items-center gap-1.5 min-w-0" role="listitem">
            {idx > 0 ? <ChevronRight className="status-stepper-arrow h-3.5 w-3.5 shrink-0 text-[var(--text-subtle)]" /> : null}
            <span className={cls} title={title} aria-current={isCurrent ? "step" : undefined}>
              <Icon className={`status-pill-icon h-3.5 w-3.5 shrink-0 ${isCurrent && status === "in-progress" ? "animate-spin" : ""}`} />
              {prettyStatus(status)}
            </span>
          </div>
        );
      })}
    </div>
  );
}