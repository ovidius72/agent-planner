import { useEffect, useRef, useState, type ReactNode } from "react";
import { Input } from "./input";
import { Select } from "./select";
import type { DetailFilterValue } from "../../lib/list-filtering";

export type { DetailFilterValue };

// Debounce for the free-text search so typing does not re-filter (or navigate)
// on every keystroke. ~250ms keeps it responsive without a per-character reload.
const DEBOUNCE_MS = 250;

function toggleClass(active: boolean): string {
  return `inline-flex h-9 min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-[9px] border px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:h-9 sm:min-h-9 sm:rounded-[10px] sm:px-2.5 ${
    active
      ? "border-transparent bg-[var(--accent)] text-white"
      : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)]"
  }`;
}

// Shared, controlled filter bar for the feature-detail and phase-detail pages.
// Mirrors the WorkTree toggles (Hide Done / Hide Planned / Only active) and adds
// a debounced text search. It is fully controlled (value + onChange) and never
// submits a form, so changing a filter never triggers a router navigation — which
// keeps <ScrollRestoration /> from resetting the window scroll position.
export function DetailFilters({
  entityKind,
  statusOptions,
  value,
  onChange,
  sortSlot,
}: {
  entityKind: "phase" | "task";
  statusOptions?: Array<{ value: string; label: string }>;
  value: DetailFilterValue;
  onChange: (next: DetailFilterValue) => void;
  sortSlot?: ReactNode;
}) {
  const [draft, setDraft] = useState(value.query);
  const timer = useRef<number | null>(null);
  // Latest value, read by the debounced commit so a toggle made during the
  // debounce window is not clobbered when the query timer finally fires.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Keep the input in sync when the value changes externally (e.g. Clear).
  useEffect(() => {
    setDraft(value.query);
  }, [value.query]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const commitQuery = (next: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onChange({ ...valueRef.current, query: next });
    }, DEBOUNCE_MS);
  };

  const onQueryChange = (next: string) => {
    setDraft(next);
    commitQuery(next);
  };

  const toggle = (key: "hideDone" | "hidePlanned" | "onlyActive") => {
    onChange({ ...valueRef.current, [key]: !valueRef.current[key] });
  };

  const onStatusChange = (next: string) => {
    onChange({ ...valueRef.current, status: next });
  };

  const onClear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setDraft("");
    onChange({ query: "", status: "", hideDone: false, hidePlanned: false, onlyActive: false });
  };

  const showsStatus = (statusOptions?.length ?? 0) > 0;

  return (
    <div className="surface-card flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="detail-filter-query" className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">
            Search
          </label>
          <Input
            id="detail-filter-query"
            value={draft}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={entityKind === "task" ? "Search task title, number, or shortId" : "Search phase title, number, or shortId"}
            className="h-9 py-2"
          />
        </div>

        {sortSlot}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {showsStatus ? (
          <div>
            <label htmlFor="detail-filter-status" className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">
              Status
            </label>
            <div className="flex items-center rounded-[12px] border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1.5 sm:rounded-[14px] sm:px-3 sm:py-2">
              <Select
                id="detail-filter-status"
                value={value.status}
                onChange={(event) => onStatusChange(event.target.value)}
                className="h-9 appearance-none border-0 bg-transparent py-0 pr-8"
              >
                <option value="">All statuses</option>
                {statusOptions?.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1.5 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 sm:gap-2 sm:rounded-[14px] sm:px-3 sm:py-2">
          <button type="button" onClick={() => toggle("hideDone")} className={toggleClass(value.hideDone)}>Hide Done</button>
          <button type="button" onClick={() => toggle("hidePlanned")} className={toggleClass(value.hidePlanned)}>Hide Planned</button>
          <button type="button" onClick={() => toggle("onlyActive")} className={toggleClass(value.onlyActive)}>Only active</button>
          <button type="button" onClick={onClear} className={toggleClass(false)}>Clear</button>
        </div>
      </div>
    </div>
  );
}
