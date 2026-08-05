import {
  Circle,
  CircleDashed,
  Search,
  ListTodo,
  PlayCircle,
  CheckCircle2,
  OctagonAlert,
  PauseCircle,
  TimerReset,
  Ban,
  MinusCircle,
} from "lucide-react";

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

export function StatusIcon({ status, className = "" }: { status: string; className?: string }) {
  const Icon = STATUS_ICON[status] ?? Circle;
  return <Icon className={`h-4 w-4 shrink-0 text-[var(--text-muted)] ${className}`.trim()} aria-hidden="true" />;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-chip status-${status}`}>{status}</span>;
}
