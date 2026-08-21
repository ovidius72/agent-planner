import { PauseCircle, RotateCcw } from "lucide-react";
import { useId } from "react";
import type { TaskPauseSnapshot } from "../../lib/types";
import { formatDateTime } from "../ui/last-updated";

export function ResumeSnapshot({
  snapshot,
  pendingResume = false,
  compact = false,
}: {
  snapshot: TaskPauseSnapshot;
  pendingResume?: boolean;
  compact?: boolean;
}) {
  const headingId = useId();
  const Icon = pendingResume ? RotateCcw : PauseCircle;
  return (
    <section
      aria-labelledby={headingId}
      aria-live={pendingResume ? "polite" : undefined}
      className={`rounded-[14px] border px-4 py-3 ${pendingResume
        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
        : "border-[var(--border)] bg-[var(--surface-elevated)]"}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <h3 id={headingId} className="text-sm font-bold text-[var(--text)]">
          {pendingResume ? "Resume checkpoint" : "Paused work snapshot"}
        </h3>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">
          {formatDateTime(snapshot.pausedAt)}
        </span>
      </div>
      <dl className={`mt-3 grid ${compact ? "gap-2" : "gap-3 sm:grid-cols-2"}`}>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">Why paused</dt>
          <dd className="mt-1 text-sm text-[var(--text-muted)] [overflow-wrap:anywhere]">{snapshot.reason}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">Work checkpoint</dt>
          <dd className="mt-1 text-sm text-[var(--text-muted)] [overflow-wrap:anywhere]">{snapshot.whatWasBeingDone}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">Resume from</dt>
          <dd className="mt-1 font-mono text-xs text-[var(--text)] [overflow-wrap:anywhere]">{snapshot.resumeLocation}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">How to resume</dt>
          <dd className="mt-1 text-sm text-[var(--text-muted)] [overflow-wrap:anywhere]">{snapshot.howToResume}</dd>
        </div>
      </dl>
    </section>
  );
}
