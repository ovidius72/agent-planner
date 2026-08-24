export function formatDateTime(value: string | undefined): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

/**
 * The planner's persisted entity-level mutation timestamp. Status transitions
 * retain their individual dates in status history; this value covers any
 * mutation, including descriptions, notes, priorities, and lifecycle changes.
 */
export function LastUpdated({
  value,
  className = "",
}: {
  value: string | undefined;
  className?: string;
}) {
  if (!value) return null;
  const label = `Last updated ${formatDateTime(value)}`;
  return (
    <time
      dateTime={value}
      title={label}
      aria-label={label}
      className={`text-[11px] text-[var(--text-subtle)] ${className}`.trim()}
    >
      {label}
    </time>
  );
}
