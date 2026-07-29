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

function StatusCard({ status, date, isCurrent }: { status: string; date?: string | undefined; isCurrent: boolean }) {
  const Icon = STATUS_ICON[status] ?? Circle;
  return (
    <div
      className={`status-card status-${status} ${isCurrent ? "status-card-current" : ""}`}
      title={date ? `${status} — ${formatCompactDate(date)}` : status}
    >
      <Icon className={`status-card-icon ${status === "in-progress" ? "animate-spin" : ""}`} />
      <span className="status-card-label">{status}</span>
      {date ? <span className="status-card-time">{formatCompactDate(date)}</span> : <span className="status-card-time status-card-time-initial">initial</span>}
    </div>
  );
}

/**
 * Chronological status card stepper. Renders one card per visited state, in
 * order: [initial fromStatus] → toStatus₁ → toStatus₂ → … (full transition
 * sequence, per spec — repeated states appear as their own cards). Each card is
 * filled with its status color; the current (last) card is emphasized.
 */
export function StatusCardStepper({ statusLog, currentStatus }: { statusLog: StatusLogEntryLike[]; currentStatus: string }) {
  // Build the visited-state card list.
  const cards: { status: string; date?: string }[] = [];
  if (statusLog.length === 0) {
    cards.push({ status: currentStatus });
  } else {
    const first = statusLog[0];
    if (first) cards.push({ status: first.fromStatus });
    for (const entry of statusLog) cards.push({ status: entry.toStatus, date: entry.date });
  }
  const currentIndex = cards.length - 1;

  return (
    <div className="status-card-stepper">
      {cards.map((card, idx) => (
        <div key={`${card.status}-${idx}`} className="flex items-center gap-1.5">
          {idx > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-subtle)]" /> : null}
          <StatusCard status={card.status} date={card.date} isCurrent={idx === currentIndex} />
        </div>
      ))}
    </div>
  );
}