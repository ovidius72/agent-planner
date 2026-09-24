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

export interface ChecklistReplacement {
  items: ChecklistItem[];
  /** Titles of previously-ticked items whose tick could not be carried over.
   *  Empty on the common paths. Callers MUST surface a non-empty list: a
   *  success result that drops ticks without saying so is the defect this
   *  function exists to prevent. */
  lostTicks: string[];
}

/**
 * Build the replacement list for a whole-checklist update, carrying tick state
 * across from the items being replaced.
 *
 * The input is plain titles, so item identity has to be reconstructed. Two
 * passes, in this order:
 *
 *  1. Exact trimmed title. Order-independent, so reordering a list keeps every
 *     tick. Each surviving item is consumed at most once, so duplicate titles
 *     carry over one tick each rather than multiplying.
 *  2. Position, but ONLY when the list length is unchanged. This is what makes
 *     renaming an item keep its tick — the reported failure case. Restricting
 *     it to equal-length lists means an insertion or deletion never shifts a
 *     tick onto a neighbour.
 *
 * Anything still unmatched is a new item and starts unchecked; if it displaced
 * a ticked item, that title is reported in `lostTicks` rather than dropped in
 * silence.
 */
export function replaceChecklist(existing: ChecklistItem[], titles: string[], taskId: string): ChecklistReplacement {
  const cleanTitles = titles.map((title) => title.trim()).filter((title) => title.length > 0);
  const consumed = new Set<number>();
  const carried = new Array<boolean>(cleanTitles.length).fill(false);
  // Tracks whether pass 1 found an exact-title match, independent of that
  // match's checked value. `carried[index]` alone cannot stand in for this:
  // an exact match to an unticked item legitimately produces carried=false,
  // and pass 2 must not treat that as "unmatched" and overwrite it with a
  // stray tick from whatever unrelated item previously sat at this position.
  const matchedByTitle = new Array<boolean>(cleanTitles.length).fill(false);

  cleanTitles.forEach((title, index) => {
    const match = existing.findIndex((item, i) => !consumed.has(i) && item.title.trim() === title);
    if (match >= 0) {
      consumed.add(match);
      matchedByTitle[index] = true;
      carried[index] = existing[match]!.checked;
    }
  });

  if (cleanTitles.length === existing.length) {
    cleanTitles.forEach((_title, index) => {
      if (matchedByTitle[index]) return;
      const candidate = existing[index];
      if (!candidate || consumed.has(index)) return;
      consumed.add(index);
      carried[index] = candidate.checked;
    });
  }

  const items = cleanTitles.map((title, index) => ({
    id: createChecklistItemId(taskId, index + 1, title),
    number: index + 1,
    title,
    checked: carried[index] ?? false,
  }));

  const lostTicks = existing
    .filter((item, i) => item.checked && !consumed.has(i))
    .map((item) => item.title);

  return { items, lostTicks };
}