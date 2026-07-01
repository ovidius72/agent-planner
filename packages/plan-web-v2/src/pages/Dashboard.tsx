import { useQuery } from "@tanstack/react-query";
import { Layers, ListTodo, Gauge, Sparkles } from "lucide-react";
import { useFeatures, useProject } from "../hooks/use-queries";
import { getPhases } from "../api";
import { StatCard } from "../components/charts/StatCard";
import { Card } from "../components/ui/Card";
import { FeatureRow } from "../components/features/FeatureRow";
import { useUpdateFeature } from "../hooks/use-queries";
import type { Feature } from "../types";
import { Link } from "react-router-dom";

function statusColor(status: string): string {
  const map: Record<string, string> = {
    planned: "#0ea5e9",
    "in-progress": "#f59e0b",
    done: "#22c55e",
    blocked: "#ef4444",
    canceled: "#94a3b8",
    draft: "#94a3b8",
    discovery: "#6366f1",
  };
  return map[status] ?? "#94a3b8";
}

function countBy<T>(items: T[], fn: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const k = fn(item);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

const statusOrder = ["draft", "discovery", "planned", "in-progress", "done", "blocked", "canceled"];

export function Dashboard() {
  const { data: project } = useProject();
  const { data: features } = useFeatures();
  const { data: phases } = useQuery({
    queryKey: ["phases-all"],
    queryFn: () => getPhases(),
  });
  const updateFeature = useUpdateFeature();

  const handleStatusChange = (id: string, status: Feature["status"]) => {
    const f = features?.find((x) => x.id === id);
    if (f) updateFeature.mutate({ ...f, status });
  };

  const allTasks = phases?.flatMap((p) => p.tasks) ?? [];
  const doneTasks = allTasks.filter((t) => t.status === "done").length;
  const blockedTasks = allTasks.filter((t) => t.status === "blocked").length;
  const activeFeatures = features?.filter((f) => f.status === "in-progress").length ?? 0;
  const completion = allTasks.length ? Math.round((doneTasks / allTasks.length) * 100) : 0;

  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const velocity7d = allTasks.filter(
    (t) => t.status === "done" && Date.parse(t.updatedAt) >= recentCutoff,
  ).length;

  const phaseStatusCounts = phases ? countBy(phases, (p) => p.status) : {};
  const sortedStatuses = statusOrder.filter((s) => (phaseStatusCounts[s] ?? 0) > 0);

  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight">{project?.name ?? "Dashboard"}</h1>
        {project?.goal && <p className="mt-1 text-[var(--text-muted)]">{project.goal}</p>}
      </div>

      {/* Stat cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Features"
          value={`${features?.length ?? 0}`}
          sub={`Active: ${activeFeatures}`}
          icon={<Layers size={16} />}
        />
        <StatCard
          title="Total tasks"
          value={`${allTasks.length}`}
          sub={`Done: ${doneTasks}`}
          icon={<ListTodo size={16} />}
        />
        <StatCard
          title="Completion"
          value={`${completion}%`}
          sub={`Blocked: ${blockedTasks}`}
          icon={<Gauge size={16} />}
        />
        <StatCard
          title="Velocity (7d)"
          value={`${velocity7d}`}
          sub="Tasks moved to done"
          icon={<Sparkles size={16} />}
        />
      </div>

      {/* Phase distribution */}
      {sortedStatuses.length > 0 && (
        <Card>
          <h2 className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Phase distribution
          </h2>
          <div className="space-y-3">
            {sortedStatuses.map((status) => {
              const count = phaseStatusCounts[status] ?? 0;
              const pct = phases && phases.length ? Math.round((count / phases.length) * 100) : 0;
              return (
                <div
                  key={status}
                  className="grid grid-cols-[100px_minmax(0,1fr)_48px] items-center gap-4"
                >
                  <span className="text-sm capitalize text-[var(--text-muted)]">{status}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: statusColor(status) }}
                    />
                  </div>
                  <span className="mono text-right text-sm text-[var(--text-subtle)]">{count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {features && features.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Active features</h2>
            <Link to="/features" className="text-sm text-[var(--accent)] hover:underline">
              View all
            </Link>
          </div>
          <div className="space-y-2">
            {features.slice(0, 8).map((feature) => (
              <FeatureRow
                key={feature.id}
                feature={feature}
                phasesCount={phases?.filter((p) => p.featureId === feature.id).length ?? 0}
                tasksCount={
                  allTasks.filter((t) => {
                    const phase = phases?.find((p) => p.featureId === feature.id);
                    return phase?.tasks.some((pt) => pt.id === t.id);
                  }).length
                }
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
