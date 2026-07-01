import { GitBranch, Layers3, ListTodo } from "lucide-react";

const entityConfig = {
  feature: { label: "Feature", Icon: Layers3 },
  phase: { label: "Phase", Icon: GitBranch },
  task: { label: "Task", Icon: ListTodo },
} as const;

export function EntityBadge({ kind, label }: { kind: keyof typeof entityConfig; label?: string }) {
  const { Icon, label: defaultLabel } = entityConfig[kind];

  return (
    <span className={`entity-badge entity-badge--${kind}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{label ?? defaultLabel}</span>
    </span>
  );
}
