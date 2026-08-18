import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown } from "lucide-react";
import type { WorkTreeSortConfig, WorkTreeSortKey } from "../../lib/dashboard-tree";

export const SORT_OPTIONS: { value: WorkTreeSortKey; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "number", label: "Number" },
  { value: "createdAt", label: "Created date" },
  { value: "updatedAt", label: "Updated date" },
  { value: "title", label: "Title" },
  { value: "shortId", label: "Short ID" },
  { value: "status", label: "Status" },
  { value: "startedAt", label: "Started" },
  { value: "completedAt", label: "Completed" },
];

export interface SortControlProps {
  sort: WorkTreeSortConfig;
  onChange: (sort: WorkTreeSortConfig) => void;
  label?: string;
}

export function SortControl({ sort, onChange, label = "Sort by" }: SortControlProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort-control" className="hidden text-xs text-[var(--text-muted)] sm:inline">
        {label}
      </label>
      <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 shadow-sm">
        <div className="relative">
          <select
            id="sort-control"
            value={sort.key}
            onChange={(e) => onChange({ key: e.target.value as WorkTreeSortKey, direction: sort.direction })}
            className="h-7 w-full min-w-[7.5rem] cursor-pointer appearance-none border-0 bg-transparent pr-6 pl-1 text-xs font-medium text-[var(--text)] outline-none hover:text-[var(--accent)] sm:w-auto"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden="true"
          />
        </div>
        <button
          type="button"
          onClick={() => onChange({ key: sort.key, direction: sort.direction === "asc" ? "desc" : "asc" })}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--text)]"
          aria-label={`Sort direction: ${sort.direction}`}
          title={`Sort direction: ${sort.direction}`}
        >
          {sort.direction === "asc" ? (
            <ArrowUpNarrowWide className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
