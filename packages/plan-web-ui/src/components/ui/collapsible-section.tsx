import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export interface CollapsibleSectionProps {
  title: string;
  /** Optional node rendered on the right of the summary (e.g. a Clear button). */
  actions?: ReactNode;
  /** Default open? Defaults to true. */
  defaultOpen?: boolean;
  /** Count badge shown next to the title (e.g. number of items). */
  count?: number;
  children: ReactNode;
}

/**
 * Collapsible section using a native <details> element. Summary is a clickable
 * header with a chevron; content is the children. Used to collapse long
 * descriptions and handoff blocks on detail pages.
 */
export function CollapsibleSection({ title, actions, defaultOpen = true, count, children }: CollapsibleSectionProps) {
  return (
    <details className="group mt-4 border border-[var(--border)] rounded-lg overflow-hidden" open={defaultOpen}>
      <summary className="flex items-center justify-between gap-2 p-3 cursor-pointer font-semibold text-[var(--text)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-strong)] transition-colors select-none">
        <span className="flex items-center gap-2 text-sm">
          {title}
          {count !== undefined ? <span className="text-[var(--text-subtle)]">({count})</span> : null}
        </span>
        <span className="flex items-center gap-2">
          {actions}
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-[var(--text-muted)]" />
        </span>
      </summary>
      <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)]">
        {children}
      </div>
    </details>
  );
}