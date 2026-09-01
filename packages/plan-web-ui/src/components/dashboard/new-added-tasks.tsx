import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../ui/card";
import { CompositeRef, ParentBadge } from "../ui/badges";
import { StatusBadge } from "../ui/status-badge";
import { PriorityBadge } from "../ui/detail-metadata";
import type { Feature, Phase } from "../../lib/types";

/** A task counts as "new" if it was created within this window of "now". */
const NEW_TASK_WINDOW_MS = 24 * 60 * 60 * 1000;

function formatRelative(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

interface NewTaskRow {
  task: Phase["tasks"][number];
  phase: Phase;
  feature: Feature | undefined;
  featureName: string;
  createdAt: string;
}

/**
 * The "New Added Tasks" card: tasks created within NEW_TASK_WINDOW_MS, newest
 * first. Rendered ONLY when there is at least one new task — this is a transient
 * highlight, not a permanent dashboard section. A single setTimeout scheduled
 * at the soonest expiring task's window end re-renders to drop stale rows (no
 * per-row polling).
 */
export function NewAddedTasks({ features, phases }: { features: Feature[]; phases: Phase[] }) {
  const [, setTick] = useState(0);
  const now = Date.now();

  const rows = useMemo<NewTaskRow[]>(() => {
    const featureNameById = new Map(features.map((feature) => [feature.id, feature.name]));
    return phases
      .flatMap((phase) => phase.tasks.map((task) => ({
        task,
        phase,
        feature: features.find((f) => f.id === phase.featureId),
        featureName: phase.featureId ? (featureNameById.get(phase.featureId) ?? phase.featureId) : "Unlinked feature",
        createdAt: task.createdAt,
      })))
      .filter((row) => {
        const created = new Date(row.createdAt).getTime();
        return (
          Number.isFinite(created) &&
          now - created < NEW_TASK_WINDOW_MS &&
          now - created >= 0 &&
          row.task.status === "planned" &&
          !row.task.startedAt
        );
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 10);
  }, [features, phases, now]);

  // Single timer at the soonest expiry so the card re-renders and stale rows
  // drop. No timer when there is nothing to expire.
  useEffect(() => {
    if (rows.length === 0) return;
    const soonest = rows.reduce((min, row) => {
      const expiresAt = new Date(row.createdAt).getTime() + NEW_TASK_WINDOW_MS - Date.now();
      return Math.min(min, expiresAt);
    }, Infinity);
    if (!Number.isFinite(soonest) || soonest <= 0) return;
    const id = window.setTimeout(() => setTick((n) => n + 1), soonest + 50);
    return () => window.clearTimeout(id);
  }, [rows]);

  if (rows.length === 0) return null;

  return (
    <Card className="grid gap-4">
      <div>
        <h2 className="text-lg font-bold text-[var(--text)]">New Added Tasks</h2>
        <p className="text-sm text-[var(--text-muted)]">Tasks created in the last 24 hours.</p>
      </div>

      <div className="grid gap-3">
        {rows.map(({ task, phase, feature, featureName, createdAt }) => (
          <div
            key={task.id}
            className="surface-card grid min-w-0 grid-cols-1 gap-1 border-[color:color-mix(in_srgb,var(--color-status-done)_0%,transparent)] px-4 py-3 transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <CompositeRef
                featureNum={feature?.number}
                phaseNum={phase.number}
                taskNum={task.number}
                featureId={feature?.id}
                phaseId={phase.id}
                taskId={task.id}
                shortId={task.shortId}
                featureName={feature?.name}
                phaseName={phase.title}
                taskTitle={task.title}
              />
              <PriorityBadge priority={task.priority} />
              <span className="inline-flex items-center rounded-full bg-[color:color-mix(in_srgb,var(--accent)_18%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">New</span>
              <span className="ml-auto shrink-0"><StatusBadge status={task.status} /></span>
            </div>
            <Link
              to={phase.featureId ? `/features/${phase.featureId}/phases/${phase.id}/tasks/${task.id}` : "/features"}
              className="entity-link--task min-w-0 break-words text-sm font-semibold underline-offset-4 [overflow-wrap:anywhere]"
            >
              {task.title}
            </Link>
            <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--text-muted)]">
              <ParentBadge type="phase" featureNum={feature?.number} />
              <span className="min-w-0 truncate">{featureName} · {phase.title}</span>
            </div>
            <div className="text-[11px] text-[var(--text-subtle)]">Added {formatRelative(createdAt)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}