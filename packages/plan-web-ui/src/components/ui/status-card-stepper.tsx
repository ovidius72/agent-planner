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
  /** Canonical happy path, used to infer the next upcoming step. e.g. ["planned","in-progress","done"]. */
  backbone: string[];
}

/**
 * Horizontal status STEPPER showing only the states the entity ACTUALLY
 * traversed (from the statusLog), plus — when the current status is
 * non-terminal — the immediate NEXT backbone step as an "upcoming" node.
 *
 *  - COMPLETED  = a visited state we've moved past (or the current one when
 *                 done/terminal): soft-tinted node with the status color.
 *  - CURRENT    = the active non-terminal status: stronger tint + ring.
 *  - PENDING    = the next upcoming backbone step (only one, only when
 *                 non-terminal): muted dashed outline.
 *
 * A phase that jumped Draft → Done shows only [Draft, Done], not the full
 * backbone — untraversed intermediates are never displayed.
 */
export function StatusCardStepper({ statusLog, currentStatus, backbone }: StatusCardStepperProps) {
  // Build the visited sequence (dedup consecutive).
  const visited: string[] = [];
  if (statusLog.length === 0) {
    // Infer visited from the backbone position of currentStatus.
    const idx = backbone.indexOf(currentStatus);
    if (idx >= 0) {
      for (let i = 0; i <= idx; i++) visited.push(backbone[i]!);
    } else {
      visited.push(currentStatus);
    }
  } else {
    const first = statusLog[0];
    if (first) visited.push(first.fromStatus);
    for (const entry of statusLog) {
      if (visited[visited.length - 1] !== entry.toStatus) visited.push(entry.toStatus);
    }
  }
  // Ensure the current status is the last visited entry.
  if (visited[visited.length - 1] !== currentStatus) visited.push(currentStatus);
  const visitedSet = new Set(visited);

  const isTerminal = currentStatus === "done" || TERMINAL_NON_DONE.has(currentStatus);

  // Append the immediate next backbone step as upcoming (only if non-terminal).
  const display: string[] = [...visited];
  if (!isTerminal) {
    const idx = backbone.indexOf(currentStatus);
    if (idx >= 0 && idx + 1 < backbone.length) {
      const next = backbone[idx + 1]!;
      if (!visitedSet.has(next)) display.push(next);
    }
  }

  const phaseOf = (status: string): "completed" | "current" | "pending" => {
    if (!visitedSet.has(status)) return "pending"; // upcoming next
    if (status === currentStatus && !isTerminal) return "current";
    return "completed";
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
        const isReached = visitedSet.has(status);
        const date = dateFor(status);
        const title = date ? `${prettyStatus(status)} — ${formatCompactDate(date)}` : prettyStatus(status);
        // Connector leading INTO this node: traveled if this step was reached.
        const connectorState = idx === 0 ? null : isReached ? "traveled" : "pending";
        return (
          <li
            key={`${status}-${idx}`}
            className={`status-step status-step--${phase}`}
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
            {date ? <span className="status-step-date">{formatCompactDate(date)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}