// Pure search logic for the Work Tree search bar. Parses a structured query
// like `feature:1 task:10,12,3 title:auth id:UUXD1 status:in-progress auth`
// into typed filters, and matches tasks/features/phases against them.
//
// Supported keys: feature (number), phase (number), task (number),
// id (shortId), status (enum), title (text). Bare tokens become title/text
// substring matches (full-text when no field scope is selected).
// Comma-lists are supported for number/shortId fields.
// Quoted values are supported (e.g. title:"my task").
//
// Boolean combination:
//   - Multiple clauses of the SAME field combine as a UNION (OR). E.g.
//     `feature:1 AND feature:2` → features 1 OR 2 (both appear). Repeating a
//     field no longer overwrites — it adds to the set.
//   - Different fields combine as an INTERSECTION (AND). E.g.
//     `feature:1 status:in-progress` → feature 1 AND in-progress.
//   - The keywords `AND` / `OR` (case-insensitive) act as clause separators
//     only — they are ignored, not treated as text. So `feature:1 AND feature:2`
//     is equivalent to `feature:1 feature:2`.
//   - `key: value` with a space after the colon is tolerated (the next token is
//     used as the value), so `feature: 001` works like `feature:001`.

import type { Feature, Phase, Task } from "./types";

export interface SearchFilters {
  featureNumbers: Set<number> | null;
  phaseNumbers: Set<number> | null;
  taskNumbers: Set<number> | null;
  shortIds: Set<string> | null;
  status: string | null;
  featureStatus: string | null;
  phaseStatus: string | null;
  text: string | null;
}

export const EMPTY_FILTERS: SearchFilters = {
  featureNumbers: null,
  phaseNumbers: null,
  taskNumbers: null,
  shortIds: null,
  status: null,
  featureStatus: null,
  phaseStatus: null,
  text: null,
};

const KEY_PATTERN = /^(feature-status|phase-status|feature|phase|task|id|status|title):(.*)$/i;

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

/** Boolean keywords act as clause separators only (ignored, not text). */
function isBooleanKeyword(token: string): boolean {
  const up = token.toUpperCase();
  return up === "AND" || up === "OR";
}

/** Merge a comma-list of numbers into an accumulating set (UNION). */
function addNumbers(set: Set<number> | null, raw: string): Set<number> {
  const next = set ?? new Set<number>();
  for (const n of toNumberSet(raw)) next.add(n);
  return next;
}

/** Merge a comma-list of short ids into an accumulating set (UNION). */
function addShortIds(set: Set<string> | null, raw: string): Set<string> {
  const next = set ?? new Set<string>();
  for (const s of splitCommaList(raw).map((x) => x.toUpperCase())) next.add(s);
  return next;
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

  let idx = 0;
  while (idx < tokens.length) {
    const token = tokens[idx]!;
    if (isBooleanKeyword(token)) {
      idx += 1;
      continue;
    }
    const keyMatch = token.match(KEY_PATTERN);
    if (keyMatch) {
      const key = (keyMatch[1] ?? "").toLowerCase();
      let value = keyMatch[2] ?? "";
      // `feature: 001` (space after colon) → value is empty; peek the next
      // non-boolean token as the value (but don't consume another `key:` token).
      if (value.trim() === "" && idx + 1 < tokens.length) {
        let nextIdx = idx + 1;
        while (nextIdx < tokens.length && isBooleanKeyword(tokens[nextIdx]!)) nextIdx += 1;
        if (nextIdx < tokens.length && !tokens[nextIdx]!.match(KEY_PATTERN)) {
          value = tokens[nextIdx]!;
          idx = nextIdx; // consume the value token; the trailing idx+=1 moves past it
        }
      }
      if (key === "feature") {
        const set = addNumbers(filters.featureNumbers, value); if (set.size) filters.featureNumbers = set;
      } else if (key === "phase") {
        const set = addNumbers(filters.phaseNumbers, value); if (set.size) filters.phaseNumbers = set;
      } else if (key === "task") {
        const set = addNumbers(filters.taskNumbers, value); if (set.size) filters.taskNumbers = set;
      } else if (key === "id") {
        const set = addShortIds(filters.shortIds, value); if (set.size) filters.shortIds = set;
      } else if (key === "status") {
        if (value.trim()) filters.status = value.toLowerCase();
      } else if (key === "feature-status") {
        if (value.trim()) filters.featureStatus = value.toLowerCase();
      } else if (key === "phase-status") {
        if (value.trim()) filters.phaseStatus = value.toLowerCase();
      } else if (key === "title") {
        if (value.trim()) filters.text = value.toLowerCase();
      }
    } else {
      bareText.push(token.toLowerCase());
    }
    idx += 1;
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
      || filters.featureStatus
      || filters.phaseStatus
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
  if (filters.featureStatus && ctx.feature.status !== filters.featureStatus) return false;
  if (filters.phaseStatus && ctx.phase.status !== filters.phaseStatus) return false;
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