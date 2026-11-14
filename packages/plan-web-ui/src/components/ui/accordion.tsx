import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function AccordionChevron() {
  return (
    <span className="accordion-chevron flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--text)] shadow-sm group-hover:border-[var(--accent)] group-hover:text-[var(--accent)]">
      <ChevronDown className="h-5 w-5" />
    </span>
  );
}

export interface AccordionProps {
  /** Title content. The component owns title typography and heading semantics; pass text (plus optional inline badges), never a styled heading. */
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  count?: number;
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
  subtitleClassName?: string;
  children: ReactNode;
}

/**
 * Generic native <details>/<summary> accordion primitive.
 * Reuse this for toggle/disclosure UI instead of route-local reimplementations.
 * The component owns the title (canonical heading style), the content
 * typography and the chevron state, so every accordion renders identically.
 */
export function Accordion({
  title,
  subtitle,
  leading,
  actions,
  defaultOpen = false,
  count,
  className,
  summaryClassName,
  contentClassName,
  subtitleClassName,
  children,
}: AccordionProps) {
  return (
    <details className={cx("group overflow-hidden rounded-[10px] border border-[var(--border)]", className)} open={defaultOpen}>
      <summary className={cx("flex min-w-0 list-none cursor-pointer items-start justify-between gap-3 bg-[var(--surface-elevated)] p-4 text-left text-[var(--text)] transition-colors select-none hover:bg-[var(--surface-strong)] [&::-webkit-details-marker]:hidden", summaryClassName)}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              {title}
              {count !== undefined ? <span className="text-[var(--text-subtle)]">({count})</span> : null}
            </h3>
            {subtitle ? <div className={cx("mt-2 text-sm text-[var(--text-muted)] [overflow-wrap:anywhere]", subtitleClassName)}>{subtitle}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <AccordionChevron />
        </div>
      </summary>
      {/* Canonical content typography: every accordion body starts from the
          same text size and leading, so plain content and FormattedText render
          identically inside any accordion (no inherited page sizes). */}
      <div className={cx("border-t border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6", contentClassName)}>
        {children}
      </div>
    </details>
  );
}
