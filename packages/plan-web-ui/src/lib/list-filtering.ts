export type DetailFilterValue = {
  query: string;
  status: string;
  hideDone: boolean;
  hidePlanned: boolean;
  onlyActive: boolean;
};

// Whether an entity (phase or task) passes the detail-page filter bar. `activeStatuses`
// are the statuses that count as "active" for the Only active toggle — for tasks that is
// ["in-progress"], for phases ["in-progress", "discovery"].
export function passesDetailFilters(
  entity: { status: string },
  filters: DetailFilterValue,
  activeStatuses: string[],
): boolean {
  if (filters.status && entity.status !== filters.status) return false;
  if (filters.onlyActive) return activeStatuses.includes(entity.status);
  if (filters.hideDone && entity.status === "done") return false;
  if (filters.hidePlanned && entity.status === "planned") return false;
  return true;
}

export function matchesListQuery(query: string, values: Array<string | undefined>): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}
