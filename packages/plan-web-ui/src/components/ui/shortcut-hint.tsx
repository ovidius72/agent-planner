import { formatShortcut, type ShortcutTarget, useResolvedShortcut } from "../../lib/shortcuts";

export function ShortcutHint({ shortcut }: { shortcut: ShortcutTarget }) {
  const resolved = useResolvedShortcut(shortcut);
  if (!resolved) return null;

  return (
    <span className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[11px] font-bold tracking-wide text-[var(--text-muted)]">
      {formatShortcut(resolved)}
    </span>
  );
}
