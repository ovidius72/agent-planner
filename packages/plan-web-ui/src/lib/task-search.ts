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

/** Recognize compact entity references typed as bare text (for example T003). */
function addBareEntityReference(filters: SearchFilters, token: string): boolean {
  const match = token.match(/^([fpt])(\d+)$/i);
  if (!match) return false;
  const number = Number(match[2]);
  if (!Number.isFinite(number) || number <= 0) return false;
  const kind = match[1]!.toLowerCase();
  if (kind === "f") filters.featureNumbers = addNumbers(filters.featureNumbers, String(number));
  else if (kind === "p") filters.phaseNumbers = addNumbers(filters.phaseNumbers, String(number));
  else filters.taskNumbers = addNumbers(filters.taskNumbers, String(number));
  return true;
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
    } else if (!addBareEntityReference(filters, token)) {
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

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** Lowercased free-text haystack for a feature alone: name, shortId, number,
 *  composite ref and description. Exported so empty features (no phases) can
 *  match free-text searches, and so every consumer shares one definition. */
export function buildFeatureHay(feature: Feature): string {
  return [
    feature.name,
    feature.shortId ?? "",
    String(feature.number),
    `F${pad3(feature.number)}`,
    feature.description ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** Lowercased free-text haystack for a phase alone: title, slug, shortId,
 *  number, composite ref, description, summary and notes. Exported so empty
 *  phases (no tasks) can match free-text searches. */
export function buildPhaseHay(phase: Phase): string {
  return [
    phase.title,
    phase.slug ?? "",
    phase.shortId ?? "",
    String(phase.number),
    `P${pad3(phase.number)}`,
    phase.description ?? "",
    phase.summary ?? "",
    phase.notes ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** Build the lowercased haystack for a task's free-text match: the task's own
 *  fields (number, title, shortName, shortId, description, notes) composed with
 *  its phase and feature hays, so bare queries like `85` or `P085` match and
 *  tasks and parents can never disagree about what their text matches. Exported
 *  so callers can precompute once per data change instead of per keystroke. */
export function buildTaskHay(ctx: { feature: Feature; phase: Phase; task: Task }): string {
  return [
    // task
    ctx.task.title,
    ctx.task.shortName ?? "",
    ctx.task.shortId ?? "",
    String(ctx.task.number),
    `T${pad3(ctx.task.number)}`,
    ctx.task.description ?? "",
    ctx.task.notes ?? "",
    buildPhaseHay(ctx.phase),
    buildFeatureHay(ctx.feature),
  ]
    .join(" ")
    .toLowerCase();
}

/** Task-scoped filters (task numbers, task status) can never be satisfied by a
 *  parent entity without fabricating a matching task, so a feature or phase
 *  only matches independently while none of them is active. */
function hasTaskScopedFilters(filters: SearchFilters): boolean {
  return Boolean(filters.taskNumbers || filters.status);
}

/** Feature-scoped structured filters: number set and feature status. Shared by
 *  feature, phase and task matching so all three agree on these fields. */
function matchesFeatureScope(filters: SearchFilters, feature: Feature): boolean {
  if (filters.featureNumbers && !filters.featureNumbers.has(feature.number)) return false;
  if (filters.featureStatus && feature.status !== filters.featureStatus) return false;
  return true;
}

/** Phase-scoped structured filters: number set and phase status. */
function matchesPhaseScope(filters: SearchFilters, phase: Phase): boolean {
  if (filters.phaseNumbers && !filters.phaseNumbers.has(phase.number)) return false;
  if (filters.phaseStatus && phase.status !== filters.phaseStatus) return false;
  return true;
}

/** Does this feature match the filters on its own — including when it has no
 *  phases or only empty phases? Pass `precomputedHay` (from buildFeatureHay)
 *  to avoid rebuilding the haystack on every keystroke. */
export function matchFeature(
  filters: SearchFilters,
  feature: Feature,
  precomputedHay?: string,
): boolean {
  if (hasTaskScopedFilters(filters)) return false;
  // Phase-scoped filters can only be satisfied by a phase; the feature still
  // appears through a matching descendant phase, but never on its own.
  if (filters.phaseNumbers || filters.phaseStatus) return false;
  if (!matchesFeatureScope(filters, feature)) return false;
  if (filters.shortIds && !filters.shortIds.has(feature.shortId ?? "")) return false;
  if (filters.text) {
    const hay = precomputedHay ?? buildFeatureHay(feature);
    if (!hay.includes(filters.text)) return false;
  }
  return true;
}

/** Does this phase match the filters on its own — including when it has no
 *  tasks? A phase lives inside its feature, so the feature-scoped filters must
 *  match too, and its shortId filter accepts the phase's or the feature's id.
 *  Pass `precomputedHay` (from buildPhaseHay) to avoid rebuilding per keystroke. */
export function matchPhase(
  filters: SearchFilters,
  ctx: { feature: Feature; phase: Phase },
  precomputedHay?: string,
): boolean {
  if (hasTaskScopedFilters(filters)) return false;
  if (!matchesFeatureScope(filters, ctx.feature)) return false;
  if (!matchesPhaseScope(filters, ctx.phase)) return false;
  if (filters.shortIds) {
    const hit =
      filters.shortIds.has(ctx.phase.shortId ?? "")
      || filters.shortIds.has(ctx.feature.shortId ?? "");
    if (!hit) return false;
  }
  if (filters.text) {
    const hay = precomputedHay ?? buildPhaseHay(ctx.phase);
    if (!hay.includes(filters.text)) return false;
  }
  return true;
}

/** Does this task (within its feature/phase) match the filters?
 *  Pass `precomputedHay` (from buildTaskHay) to avoid rebuilding the haystack
 *  on every keystroke for large plans. */
export function matchTask(
  filters: SearchFilters,
  ctx: { feature: Feature; phase: Phase; task: Task },
  precomputedHay?: string,
): boolean {
  if (!matchesFeatureScope(filters, ctx.feature)) return false;
  if (!matchesPhaseScope(filters, ctx.phase)) return false;
  if (filters.taskNumbers && !filters.taskNumbers.has(ctx.task.number)) return false;
  if (filters.status && ctx.task.status !== filters.status) return false;
  if (filters.shortIds) {
    // shortId is global; match if the task OR its phase OR its feature shortId is in the set.
    const hit =
      filters.shortIds.has(ctx.task.shortId ?? "")
      || filters.shortIds.has(ctx.phase.shortId ?? "")
      || filters.shortIds.has(ctx.feature.shortId ?? "");
    if (!hit) return false;
  }
  if (filters.text) {
    const hay = precomputedHay ?? buildTaskHay(ctx);
    if (!hay.includes(filters.text)) return false;
  }
  return true;
}