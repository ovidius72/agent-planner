import { ChevronDown } from "lucide-react";
import { Form, Link, useSubmit } from "react-router-dom";
import { Button } from "./button";
import { Input } from "./input";
import { Select } from "./select";

export function ListFilters({
  query,
  status,
  statusOptions,
  placeholder,
  clearTo,
  resultsLabel,
}: {
  query: string;
  status: string;
  statusOptions: Array<{ value: string; label: string }>;
  placeholder: string;
  clearTo: string;
  resultsLabel: string;
}) {
  const submit = useSubmit();

  return (
    <Form method="get" className="surface-card grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_200px_auto_auto] md:items-end">
      <div>
        <label htmlFor="list-filter-query" className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">
          Name
        </label>
        <Input
          id="list-filter-query"
          name="q"
          defaultValue={query}
          placeholder={placeholder}
          className="min-h-10 py-2.5"
          onChange={(event) => submit(event.currentTarget.form)}
        />
      </div>

      <div>
        <label htmlFor="list-filter-status" className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">
          Status
        </label>
        <div className="relative">
          <Select id="list-filter-status" name="status" defaultValue={status} className="min-h-10 appearance-none py-2.5 pr-8">
            <option value="">All statuses</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        </div>
      </div>

      <Button type="submit" variant="secondary" className="min-h-10">Apply filters</Button>
      <Link to={clearTo} className="inline-flex min-h-10 items-center justify-center rounded-[14px] px-3 text-sm font-semibold text-[var(--text-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--text)]">
        Clear
      </Link>

      <div className="text-xs text-[var(--text-muted)] md:col-span-4">{resultsLabel}</div>
    </Form>
  );
}
