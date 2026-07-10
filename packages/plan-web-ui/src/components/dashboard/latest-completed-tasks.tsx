import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card } from "../ui/card";
import { EntityBadge, ParentBadge } from "../ui/badges";
import { StatusBadge } from "../ui/status-badge";
import type { Feature, Phase } from "../../lib/types";

function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

interface CompletedTaskRow {
  task: Phase["tasks"][number];
  phase: Phase;
  feature: Feature | undefined;
  featureName: string;
  completedAt: string;
}

/**
 * The "Latest completed tasks" card: the three most recently completed tasks
 * across the whole plan, ordered by completion timestamp (falling back to
 * updatedAt when completedAt is missing).
 */
export function LatestCompletedTasks({ features, phases }: { features: Feature[]; phases: Phase[] }) {
  const rows = useMemo<CompletedTaskRow[]>(() => {
    const featureNameById = new Map(features.map((feature) => [feature.id, feature.name]));
    return phases
      .flatMap((phase) => phase.tasks
        .filter((task) => task.status === "done")
        .map((task) => ({
          task,
          phase,
          feature: features.find((f) => f.id === phase.featureId),
          featureName: phase.featureId ? (featureNameById.get(phase.featureId) ?? phase.featureId) : "Unlinked feature",
          completedAt: task.completedAt || task.updatedAt,
        })))
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
      .slice(0, 3);
  }, [features, phases]);

  return (
    <Card className="grid gap-4">
      <div>
        <h2 className="text-lg font-bold text-[var(--text)]">Latest completed tasks</h2>
        <p className="text-sm text-[var(--text-muted)]">Most recently completed tasks, ordered by completion timestamp.</p>
      </div>

      <div className="grid gap-3">
        {rows.length > 0 ? rows.map(({ task, phase, feature, featureName, completedAt }) => (
          <Link
            key={task.id}
            to={phase.featureId ? `/features/${phase.featureId}/phases/${phase.id}/tasks/${task.id}` : "/features"}
            className="surface-card grid gap-1 px-4 py-3 transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <EntityBadge type="task" number={task.number} />
                <ParentBadge type="task" phaseNum={phase.number} featureNum={feature?.number} />
                <span className="entity-link--task truncate text-sm font-semibold underline-offset-4 hover:underline">{task.title}</span>
              </div>
              <StatusBadge status={task.status} />
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <ParentBadge type="phase" featureNum={feature?.number} />
              <span>{featureName} · {phase.title}</span>
            </div>
            <div className="text-[11px] text-[var(--text-subtle)]">Completed {formatDateTime(completedAt)}</div>
          </Link>
        )) : (
          <p className="py-4 text-center text-sm text-[var(--text-muted)]">No completed tasks yet.</p>
        )}
      </div>
    </Card>
  );
}
