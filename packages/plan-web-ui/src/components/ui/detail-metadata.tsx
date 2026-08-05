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

export function formatTimeline(startDate?: string, endDate?: string): string {
  if (!startDate && !endDate) return "";
  return `${startDate || "Start not set"} → ${endDate || "End not set"}`;
}
