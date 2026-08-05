import React, { useState, type ReactNode } from "react";
import {
  Circle,
  Play,
  PlayCircle,
  Clock,
  OctagonAlert,
  PauseCircle,
  CheckCircle,
  CheckCircle2,
  Ban,
  XCircle,
} from "lucide-react";
import {
  type DisplayStatus,
  type DisplayStatusToken,
  getDisplayToken,
  patternClass,
  statusColorClass,
  buildBreakdownLabel,
  type StatusBreakdown,
} from "../../lib/display-status-tokens";

const DISPLAY_ICONS: Record<DisplayStatusToken["icon"], React.ComponentType<{ className?: string }>> = {
  circle: Circle,
  "play-start": Play,
  play: PlayCircle,
  clock: Clock,
  stop: OctagonAlert,
  pause: PauseCircle,
  check: CheckCircle2,
  "check-mixed": CheckCircle,
  ban: Ban,
  x: XCircle,
};

export function StatusIcon({ status, className = "" }: { status: string; className?: string }) {
  const token = getDisplayToken(status as DisplayStatus);
  const Icon = DISPLAY_ICONS[token.icon] ?? Circle;
  return <Icon className={`h-4 w-4 shrink-0 ${className}`.trim()} aria-hidden="true" />;
}

/** Canonical workflow status chip. Kept for leaf entities and legacy callers. */
export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-chip ${statusColorClass(status as DisplayStatus)}`}>{status}</span>;
}

interface DisplayStatusBadgeProps {
  status: DisplayStatus;
  breakdown?: StatusBreakdown | undefined;
  size?: "sm" | "md";
  children?: ReactNode;
}

/**
 * Reusable badge for the derived display-status layer.
 *
 * Renders icon + label using the token mapping (color, icon, pattern) so that
 * similar states remain distinguishable without relying solely on hue. When a
 * `breakdown` is provided, the badge exposes the full breakdown in an
 * accessible tooltip / aria-label.
 */
export function DisplayStatusBadge({ status, breakdown, size = "md", children }: DisplayStatusBadgeProps) {
  const token = getDisplayToken(status);
  const Icon = DISPLAY_ICONS[token.icon] ?? Circle;
  const pattern = patternClass(status);
  const ariaLabel = breakdown ? buildBreakdownLabel(status, breakdown) : token.description;
  const padding = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";

  return (
    <span
      className={`status-chip ${statusColorClass(status)} ${pattern} ${padding}`}
      title={ariaLabel}
      aria-label={ariaLabel}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{token.label}</span>
      {children}
    </span>
  );
}

/**
 * Inline status cluster for dashboards / rows.
 * Shows a DisplayStatusBadge plus optional counters and an "updated" tag.
 */
export function StatusCluster2({
  status,
  breakdown,
  doneTasks,
  totalTasks,
  recentlyChanged,
  className,
}: {
  status: DisplayStatus;
  breakdown?: StatusBreakdown | undefined;
  doneTasks?: number;
  totalTasks?: number;
  recentlyChanged?: boolean;
  className?: string;
}) {
  const hasCounters = doneTasks != null && totalTasks != null;
  return (
    <div className={className}>
      {recentlyChanged ? (
        <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
          Updated
        </span>
      ) : null}
      {hasCounters ? (
        <span className="text-xs text-[var(--text-muted)]">
          ({doneTasks}/{totalTasks || 0})
        </span>
      ) : null}
      <DisplayStatusBadge status={status} breakdown={breakdown} />
    </div>
  );
}
