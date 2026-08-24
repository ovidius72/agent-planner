/**
 * Shared pagination helpers for the Pi planner list commands.
 *
 * Pi's `ctx.ui.select` primitive exposes no max-height / scroll-containment
 * option (ExtensionUIDialogOptions only carries signal/timeout). Long option
 * lists (every feature / phase / task) therefore overflow the TUI viewport and
 * the selection cursor can escape the list at the bottom.
 *
 * These helpers keep every page within a bounded size (default 10) so the list
 * always stays inside its scroll area, and show an explicit next/prev navigation
 * row in the TUI. Short lists fall through to the original single-call behavior
 * (no regression on small projects).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const NEXT = "› Next page";
const PREV = "‹ Prev page";

export interface PaginatedSelectOptions<T> {
  title: string;
  items: T[];
  render: (item: T) => string;
  pageSize?: number;
  allowPrev?: boolean;
}

export async function paginatedSelect<T>(
  ctx: ExtensionContext,
  { title, items, render, pageSize = 10, allowPrev = true }: PaginatedSelectOptions<T>,
): Promise<T | null> {
  if (items.length === 0) return null;
  const labels = items.map(render);
  if (labels.length <= pageSize) {
    const chosen = await ctx.ui.select(title, labels);
    if (chosen == null) return null;
    const idx = labels.indexOf(chosen);
    return idx >= 0 ? items[idx]! : null;
  }
  const totalPages = Math.ceil(labels.length / pageSize);
  let page = 0;
  for (;;) {
    const start = page * pageSize;
    const pageOpts: string[] = labels.slice(start, start + pageSize);
    if (allowPrev && page > 0) pageOpts.push(PREV);
    if (page < totalPages - 1) pageOpts.push(`${NEXT} (${page + 2}/${totalPages})`);
    const pageTitle = totalPages > 1 ? `${title} — page ${page + 1}/${totalPages}` : title;
    const chosen = await ctx.ui.select(pageTitle, pageOpts);
    if (chosen == null) return null;
    if (chosen === PREV) {
      page = Math.max(0, page - 1);
      continue;
    }
    if (chosen.startsWith(NEXT)) {
      page = Math.min(totalPages - 1, page + 1);
      continue;
    }
    const idx = labels.indexOf(chosen);
    return idx >= 0 ? items[idx]! : null;
  }
}

export interface PaginatedNotifyOptions {
  title: string;
  lines: string[];
  pageSize?: number;
}

export async function paginatedNotify(
  ctx: ExtensionContext,
  { title, lines, pageSize = 10 }: PaginatedNotifyOptions,
): Promise<void> {
  if (lines.length === 0) {
    ctx.ui.notify(`(no ${title})`, "info");
    return;
  }
  if (lines.length <= pageSize) {
    ctx.ui.notify(lines.join("\n"), "info");
    return;
  }
  const totalPages = Math.ceil(lines.length / pageSize);
  for (let page = 0; page < totalPages; page++) {
    const start = page * pageSize;
    const slice = lines.slice(start, start + pageSize);
    const header = `— ${title} — page ${page + 1}/${totalPages} —`;
    ctx.ui.notify([header, ...slice].join("\n"), "info");
    if (page >= totalPages - 1) break;
    const ans = await ctx.ui.input(`Enter = next page (${page + 2}/${totalPages}) · q = quit`);
    if (ans == null || ans.trim().toLowerCase() === "q") break;
  }
}
