import { BarChart3, CheckCircle2, Layers, ListTodo } from "lucide-react";
import type { Feature, Phase } from "../../lib/types";
import { countDoneTasks, countTasks } from "../../lib/dashboard-tree";
import { StatCard } from "./stat-card";

function completionValueClassName(completion: number): string {
  if (completion >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (completion >= 30) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export function StatCards({ features, phases }: { features: Feature[]; phases: Phase[] }) {
  const doneFeatures = features.filter((feature) => feature.status === "done").length;
  const remainingFeatures = Math.max(features.length - doneFeatures, 0);
  const donePhases = phases.filter((phase) => phase.status === "done").length;
  const remainingPhases = Math.max(phases.length - donePhases, 0);
  const totalTasks = countTasks(phases);
  const doneTasks = countDoneTasks(phases);
  const remainingTasks = Math.max(totalTasks - doneTasks, 0);
  const completion = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <StatCard
        title="Features"
        value={String(features.length)}
        valueSuffix="total"
        subtitle={<><span className="font-semibold text-emerald-600 dark:text-emerald-400">{doneFeatures} done</span><span> · </span><span className="font-semibold text-amber-600 dark:text-amber-400">{remainingFeatures} left</span></>}
        icon={<Layers className="h-4 w-4" />}
      />
      <StatCard
        title="Phases"
        value={String(phases.length)}
        valueSuffix="total"
        subtitle={<><span className="font-semibold text-emerald-600 dark:text-emerald-400">{donePhases} done</span><span> · </span><span className="font-semibold text-amber-600 dark:text-amber-400">{remainingPhases} left</span></>}
        icon={<BarChart3 className="h-4 w-4" />}
      />
      <StatCard
        title="Tasks"
        value={String(totalTasks)}
        valueSuffix="total"
        subtitle={<><span className="font-semibold text-emerald-600 dark:text-emerald-400">{doneTasks} done</span><span> · </span><span className="font-semibold text-amber-600 dark:text-amber-400">{remainingTasks} left</span></>}
        icon={<ListTodo className="h-4 w-4" />}
      />
      <StatCard
        title="Completion"
        value={`${completion}%`}
        subtitle="Task completion rate"
        valueClassName={completionValueClassName(completion)}
        iconClassName={completionValueClassName(completion)}
        icon={<CheckCircle2 className="h-4 w-4" />}
      />
    </div>
  );
}
