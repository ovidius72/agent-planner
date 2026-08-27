import type { ReactNode } from "react";
import { CompactCard } from "./compact-card";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export interface DetailMetadataItem {
  label: string;
  value: ReactNode;
  visible?: boolean;
  valueClassName?: string;
}

export function DetailMetadataGrid({ items, className }: { items: DetailMetadataItem[]; className?: string }) {
  const visibleItems = items.filter((item) => item.visible !== false);
  if (visibleItems.length === 0) return null;

  return (
    <div className={cx("grid gap-4 md:grid-cols-2 xl:grid-cols-4", className)}>
      {visibleItems.map((item) => (
        <CompactCard key={item.label}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">{item.label}</p>
          <div className={cx("mt-2 text-sm font-semibold break-words text-[var(--text)] [overflow-wrap:anywhere]", item.valueClassName)}>
            {item.value}
          </div>
        </CompactCard>
      ))}
    </div>
  );
}

export function formatPriority(priority: number | null | undefined): string {
  return priority && priority > 0 ? `P${priority}` : "";
}

export function PriorityBadge({ priority, className }: { priority: number | null | undefined; className?: string }) {
  const label = formatPriority(priority);
  if (!label) return null;
  const accessibleLabel = `Priority ${priority}`;
  return (
    <span
      className={cx("inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]", className)}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      {label}
    </span>
  );
}

export function formatTimeline(startDate?: string, endDate?: string): string {
  if (!startDate && !endDate) return "";
  return `${startDate || "Start not set"} → ${endDate || "End not set"}`;
}
