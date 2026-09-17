import type { ReactNode } from "react";

export interface DetailMetric {
  label: string;
  value: ReactNode;
  wide?: boolean | undefined;
  visible?: boolean | undefined;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** A dense, single-line summary. It scrolls horizontally instead of wrapping on narrow viewports. */
export function DetailMetricsRow({ items, label = "Entity summary" }: { items: DetailMetric[]; label?: string }) {
  const visibleItems = items.filter((item) => item.visible !== false);
  if (visibleItems.length === 0) return null;

  return (
    <div className="detail-metrics-row" aria-label={label}>
      {visibleItems.map((item) => (
        <div key={item.label} className={cx("detail-metric", item.wide && "detail-metric--wide")}>
          <span className="detail-metric-label">{item.label}</span>
          <span className="detail-metric-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
