import { createChecklistItemId } from "./naming.js";
import type { ChecklistItem } from "./schema.js";

/**
 * Granular per-task checklist helpers. Each item has a stable unique `id`
 * (the robust handle for add/remove/toggle) plus a progressive `number`
 * (C1..Cn display label, renumbered on remove for readability). Selectors
 * accept C{n} (e.g. C2), the item id, or a title (case-insensitive, first
 * exact then partial match).
 */

export function findChecklistItem(items: ChecklistItem[], selector: string): ChecklistItem | undefined {
  const s = selector.trim();
  if (!s) return undefined;
  const cMatch = /^C(\d+)$/i.exec(s);
  if (cMatch) {
    const n = parseInt(cMatch[1]!, 10);
    return items.find((i) => i.number === n);
  }
  const byId = items.find((i) => i.id === s);
  if (byId) return byId;
  const needle = s.toLowerCase();
  return (
    items.find((i) => i.title.trim().toLowerCase() === needle) ??
    items.find((i) => i.title.trim().toLowerCase().includes(needle))
  );
}

/** Append a new item. number = max(existing)+1 (stable, never reused). Mutates nothing; returns the new item. */
export function addChecklistItem(items: ChecklistItem[], taskId: string, title: string): ChecklistItem {
  const clean = title.trim();
  const number = items.length === 0 ? 1 : Math.max(...items.map((i) => i.number)) + 1;
  const id = createChecklistItemId(taskId, number, clean);
  return { id, number, title: clean, checked: false };
}

/** Remove the matched item in place (splice) and renumber the rest 1..n. Returns the removed item, or undefined. */
export function removeChecklistItem(items: ChecklistItem[], selector: string): ChecklistItem | undefined {
  const found = findChecklistItem(items, selector);
  if (!found) return undefined;
  const idx = items.findIndex((i) => i.id === found.id);
  if (idx >= 0) items.splice(idx, 1);
  items.forEach((i, n) => {
    i.number = n + 1;
  });
  return found;
}

/** Tick/untick the matched item in place. checked omitted → toggle. Returns the item, or undefined. */
export function toggleChecklistItem(items: ChecklistItem[], selector: string, checked?: boolean): ChecklistItem | undefined {
  const found = findChecklistItem(items, selector);
  if (!found) return undefined;
  found.checked = checked ?? !found.checked;
  return found;
}