// Pure search logic for the Work Tree search bar. Parses a structured query
// like `feature:1 task:10,12,3 title:auth id:UUXD1 status:in-progress auth`
// into typed filters, and matches tasks/features/phases against them.
//
// Supported keys: feature (number), phase (number), task (number),
// id (shortId), status (enum), title (text). Bare tokens become title/text
// substring matches. Comma-lists are supported for number/shortId fields.
// Quoted values are supported (e.g. title:"my task").

import type { Feature, Phase, Task } from "./types";

export interface SearchFilters {
  featureNumbers: Set<number> | null;
  phaseNumbers: Set<number> | null;
  taskNumbers: Set<number> | null;
  shortIds: Set<string> | null;
  status: string | null;
  text: string | null;
}

export const EMPTY_FILTERS: SearchFilters = {
  featureNumbers: null,
  phaseNumbers: null,
  taskNumbers: null,
  shortIds: null,
  status: null,
  text: null,
};

const KEY_PATTERN = /^(feature|phase|task|id|status|title):(.*)$/i;

function splitCommaList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function toNumberSet(raw: string): Set<number> {
  return new Set(
    splitCommaList(raw)
      .map((part) => Number(part))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
}

/** Parse a structured search query into typed filters. Tolerant: unknown
 *  keys are treated as bare text. Returns EMPTY_FILTERS for blank input. */
export function parseSearchQuery(query: string): SearchFilters {
  const trimmed = query.trim();
  if (!trimmed) return { ...EMPTY_FILTERS };

  const filters: SearchFilters = { ...EMPTY_FILTERS };
  const bareText: string[] = [];

  // Tokenize respecting double-quoted strings.
  const tokens: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === '"') {
      const end = trimmed.indexOf('"', i + 1);
      if (end === -1) {
        tokens.push(trimmed.slice(i + 1));
        break;
      }
      tokens.push(trimmed.slice(i + 1, end));
      i = end + 1;
    } else if (ch === " ") {
      i += 1;
    } else {
      let j = i;
      while (j < trimmed.length && trimmed[j] !== " ") j += 1;
      tokens.push(trimmed.slice(i, j));
      i = j;
    }
  }

  for (let token of tokens) {
    const keyMatch = token.match(KEY_PATTERN);
    if (keyMatch) {
      const key = (keyMatch[1] ?? "").toLowerCase();
      const value = keyMatch[2] ?? "";
      if (key === "feature") {
        filters.featureNumbers = toNumberSet(value);
      } else if (key === "phase") {
        filters.phaseNumbers = toNumberSet(value);
      } else if (key === "task") {
        filters.taskNumbers = toNumberSet(value);
      } else if (key === "id") {
        filters.shortIds = new Set(splitCommaList(value).map((s) => s.toUpperCase()));
      } else if (key === "status") {
        filters.status = value.toLowerCase();
      } else if (key === "title") {
        filters.text = value.toLowerCase();
      }
    } else {
      bareText.push(token.toLowerCase());
    }
  }

  if (bareText.length > 0 && !filters.text) {
    filters.text = bareText.join(" ");
  }

  return filters;
}

export function isSearchActive(filters: SearchFilters): boolean {
  return Boolean(
    filters.featureNumbers
      || filters.phaseNumbers
      || filters.taskNumbers
      || filters.shortIds
      || filters.status
      || filters.text,
  );
}

/** Does this task (within its feature/phase) match the filters? */
export function matchTask(
  filters: SearchFilters,
  ctx: { feature: Feature; phase: Phase; task: Task },
): boolean {
  if (filters.featureNumbers && !filters.featureNumbers.has(ctx.feature.number)) return false;
  if (filters.phaseNumbers && !filters.phaseNumbers.has(ctx.phase.number)) return false;
  if (filters.taskNumbers && !filters.taskNumbers.has(ctx.task.number)) return false;
  if (filters.shortIds) {
    // shortId is global; match if the task OR its phase OR its feature shortId is in the set.
    const hit =
      filters.shortIds.has(ctx.task.shortId ?? "")
      || filters.shortIds.has(ctx.phase.shortId ?? "")
      || filters.shortIds.has(ctx.feature.shortId ?? "");
    if (!hit) return false;
  }
  if (filters.status && ctx.task.status !== filters.status) {
    // also allow matching when the filter targets a phase/feature status? Keep task-only for status.
    return false;
  }
  if (filters.text) {
    const t = filters.text;
    const hay = [
      ctx.task.title,
      ctx.task.shortId ?? "",
      ctx.phase.title,
      ctx.phase.shortId ?? "",
      ctx.feature.name,
      ctx.feature.shortId ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(t)) return false;
  }
  return true;
}