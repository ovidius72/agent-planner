/**
 * Shared list-pagination primitive. Both adapters defined an identical
 * `boundedPage` (page list tools: feature/phase/task/requirement listing,
 * idea listing) with the same 1-25 page-size clamp and the same
 * page-out-of-range clamp. One copy here so the bound is a single decision,
 * not something each adapter must independently re-derive and keep in sync.
 */
export interface BoundedPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Slice `items` into a bounded page. `pageSize` is clamped to [1, 25];
 *  `page` is clamped to [1, totalPages] so an out-of-range request degrades
 *  to the nearest valid page instead of an empty result. */
export function boundedPage<T>(items: T[], page: number, pageSize: number): BoundedPage<T> {
  const size = Math.min(25, Math.max(1, Math.trunc(pageSize)));
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const currentPage = Math.min(totalPages, Math.max(1, Math.trunc(page)));
  return {
    items: items.slice((currentPage - 1) * size, currentPage * size),
    page: currentPage,
    pageSize: size,
    total: items.length,
    totalPages,
  };
}
