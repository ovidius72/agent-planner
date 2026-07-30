import {
  Circle, PlayCircle, OctagonAlert, PauseCircle, Ban, TimerReset,
  CircleDashed, Search, ListTodo, CheckCircle2, MinusCircle,
} from "lucide-react";
import type { CSSProperties } from "react";

interface StatusLogEntryLike {
  id: string;
  date: string;
  fromStatus: string;
  toStatus: string;
  title: string;
  description: string;
}

/** Icon per status (static — no spinners). Completed steps override with <Check/>. */
const STATUS_ICON: Record<string, typeof Circle> = {
  draft: CircleDashed,
  discovery: Search,
  planned: ListTodo,
  "in-progress": PlayCircle,
  done: CheckCircle2,
  blocked: OctagonAlert,
  waiting: PauseCircle,
  deferred: TimerReset,
  canceled: Ban,
  rejected: MinusCircle,
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
 * Horizontal status STEPPER: circle nodes connected by a line.
 *  - COMPLETED  = status reached and we've moved past it (or everything when the
 *                 task is done): solid GREEN node with a check, solid green connector.
 *  - CURRENT    = the active status (not done): solid node in its status color,
 *                 ring highlight, static status icon.
 *  - PENDING    = not yet reached: outlined muted node, dashed gray connector.
 *
 * Intermediates (blocked, waiting, deferred, …) are inserted chronologically.
 * Terminal non-done (canceled/rejected) replace "done" when reached.
 *
 * When the statusLog is empty, "reached" is inferred from the backbone position
 * of currentStatus (everything up to and including it is reached) — so a "done"
 * task with no log still shows all steps completed.
 */
export function StatusCardStepper({ statusLog, currentStatus, backbone }: StatusCardStepperProps) {
  // Build the chronological sequence of entered statuses.
  const seq: string[] = [];
  if (statusLog.length === 0) {
    seq.push(currentStatus);
  } else {
    const first = statusLog[0];
    if (first) seq.push(first.fromStatus);
    for (const entry of statusLog) seq.push(entry.toStatus);
  }
  const reached = new Set(seq);

  // If the log is empty, infer reached from the backbone (passed-through stages).
  if (statusLog.length === 0) {
    const idx = backbone.indexOf(currentStatus);
    if (idx >= 0) {
      for (let i = 0; i <= idx; i++) reached.add(backbone[i]!);
    } else {
      reached.add(currentStatus);
    }
  }

  const hasTerminalNonDone = [...reached].some((s) => TERMINAL_NON_DONE.has(s));
  const base = hasTerminalNonDone ? backbone.filter((s) => s !== "done") : [...backbone];

  // Insert intermediates in chronological position.
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

  const isDoneState = currentStatus === "done";

  // Per-step phase: completed | current | pending.
  const phaseOf = (status: string): "completed" | "current" | "pending" => {
    const isReached = reached.has(status);
    if (isReached && (status !== currentStatus || isDoneState)) return "completed";
    if (status === currentStatus && !isDoneState) return "current";
    return "pending";
  };

  const dateFor = (status: string): string => {
    if (statusLog.length === 0) return "";
    if (status === statusLog[0]?.fromStatus) return statusLog[0]?.date ?? "";
    for (const e of statusLog) if (e.toStatus === status) return e.date;
    return "";
  };

  return (
    <ol className="status-stepper" role="list" aria-label="Status progress">
      {display.map((status, idx) => {
        const phase = phaseOf(status);
        const Icon = STATUS_ICON[status] ?? Circle;
        const isReached = reached.has(status);
        const date = dateFor(status);
        const title = date ? `${prettyStatus(status)} — ${formatCompactDate(date)}` : prettyStatus(status);
        // Connector leading INTO this node (traveled if this step is reached).
        const connectorState = idx === 0 ? null : isReached ? "traveled" : "pending";
        return (
          <li
            key={`${status}-${idx}`}
            className={`status-step status-step--${phase} status-${status}`}
            role="listitem"
            aria-current={phase === "current" ? "step" : undefined}
            style={{ "--step-color": `var(--color-status-${status})` } as CSSProperties}
          >
            {connectorState ? (
              <span className={`status-connector status-connector--${connectorState}`} aria-hidden="true" />
            ) : null}
            <span className="status-node" title={title}>
              <Icon className="status-node-icon" />
            </span>
            <span className="status-step-label">{prettyStatus(status)}</span>
          </li>
        );
      })}
    </ol>
  );
}