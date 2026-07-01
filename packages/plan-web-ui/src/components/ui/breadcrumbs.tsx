import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items, className = "" }: { items: BreadcrumbItem[]; className?: string }) {
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
