import type { Feature } from "../../types";

interface Props {
  feature: Feature;
  phasesCount: number;
  tasksCount: number;
  onStatusChange: (id: string, status: Feature["status"]) => void;
}

export function FeatureRow({ feature, phasesCount, tasksCount, onStatusChange }: Props) {
  return (
    <div className="glass-compact grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-5 px-6 py-4 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{feature.name}</div>
        {feature.description && (
          <div className="truncate text-xs text-[var(--text-muted)]">{feature.description}</div>
        )}
      </div>
      <div className="text-xs text-[var(--text-subtle)]">{feature.id}</div>
      <div className="text-xs text-[var(--text-muted)]">{phasesCount} fasi</div>
      <div className="text-xs text-[var(--text-muted)]">{tasksCount} task</div>
      <select
        value={feature.status}
        onChange={(e) => onStatusChange(feature.id, e.target.value as Feature["status"])}
        className="input-base w-auto px-2 py-1 text-xs"
      >
        {["planned", "in-progress", "done", "blocked", "canceled"].map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}
