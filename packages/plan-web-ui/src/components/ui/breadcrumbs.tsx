import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface BreadcrumbItem {
  label: string;
  to?: string;
  /** Optional kind prefix shown in stacked mode (e.g. "Feature", "Phase", "Task"). */
  kind?: string;
}

export function Breadcrumbs({ items, className = "", stacked = false }: { items: BreadcrumbItem[]; className?: string; stacked?: boolean }) {
  if (stacked) {
    return (
      <nav aria-label="Breadcrumb" className={`grid gap-1 text-sm ${className}`}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const content: ReactNode = item.to && !isLast
            ? <Link to={item.to} className="font-semibold text-[var(--accent)] hover:underline break-words min-w-0">{item.label}</Link>
            : <span className={`break-words min-w-0 ${isLast ? "text-[var(--text)] font-semibold" : "text-[var(--text-muted)]"}`}>{item.label}</span>;
          return (
            <div key={`${item.label}-${index}`} className="flex items-baseline gap-2 min-w-0">
              {item.kind ? <span className="shrink-0 text-[var(--text-subtle)] font-medium">{item.kind}:</span> : null}
              <span className="min-w-0">{content}</span>
            </div>
          );
        })}
      </nav>
    );
  }
  return (
    <nav aria-label="Breadcrumb" className={`flex flex-wrap items-center gap-2 text-sm ${className}`}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const content: ReactNode = item.to && !isLast
          ? <Link to={item.to} className="font-semibold text-[var(--accent)] hover:underline">{item.label}</Link>
          : <span className={isLast ? "text-[var(--text)]" : "text-[var(--text-muted)]"}>{item.label}</span>;

        return (
          <span key={`${item.label}-${index}`} className="inline-flex min-w-0 items-center gap-2">
            {index > 0 ? <span className="text-[var(--text-subtle)]">/</span> : null}
            <span className="min-w-0 break-words">{content}</span>
          </span>
        );
      })}
    </nav>
  );
}