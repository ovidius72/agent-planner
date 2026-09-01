import { randomInt, randomUUID } from "node:crypto";

const SLUG_PATTERN = /[^a-z0-9]+/g;
const MULTI_DASH_PATTERN = /-+/g;

/** Crockford Base32 alphabet — excludes ambiguous characters 0/O/1/I/L
 *  to minimize human transcription errors. 32 symbols → 5 chars = 33M combos. */
export const CROCKFORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const SHORT_ID_LENGTH = 5;
export const SHORT_ID_PATTERN = /^[A-Z2-9]{5}$/;

/** Loose UUID v4 regex (case-insensitive). Used for input sanity checks. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Belt-and-suspenders validation: a resolved ref must be a real UUID and the
 *  target must still exist in the store before we allocate numbers or write.
 *  Used by adapter create tools (task_create, phase_create). */
export async function validateResolvedTarget<T extends { id: string }>(
  kind: "feature" | "phase",
  resolvedId: string,
  loader: () => Promise<T | undefined>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(resolvedId)) {
    return { ok: false, error: `Resolved ${kind} id is not a valid UUID: ${resolvedId}` };
  }
  const target = await loader();
  if (!target) {
    return { ok: false, error: `Resolved ${kind} ${resolvedId} no longer exists. Refusing to create child.` };
  }
  return { ok: true };
}


/** Generate a globally-unique short id (5 chars, Crockford Base32, e.g. `UUXD1`-style
 *  but without 0/1/I/O). If `seed` is provided, the id is derived deterministically
 *  from a stable hash of the seed so two worktrees starting from the same commit
 *  produce identical shortIds for the same entity. Retries until the id is not in
 *  `existing` (project-scoped collision guard). Throws only in the impossible
 *  saturation case (~50 retries). */
export function createShortId(existing: Set<string> = new Set(), seed?: string): string {
  if (seed) {
    // Stable string hash -> Crockford encoding.
    let hash = 0;
    for (const c of seed) {
      hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
    }
    const base = Math.abs(hash);
    for (let offset = 0; offset < 64; offset += 1) {
      let id = "";
      let value = base + offset;
      for (let i = 0; i < SHORT_ID_LENGTH; i += 1) {
        id = CROCKFORD_ALPHABET[value % CROCKFORD_ALPHABET.length] + id;
        value = Math.floor(value / CROCKFORD_ALPHABET.length);
      }
      if (!existing.has(id)) return id;
    }
  }
  const max = CROCKFORD_ALPHABET.length;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let id = "";
    for (let i = 0; i < SHORT_ID_LENGTH; i += 1) {
      id += CROCKFORD_ALPHABET[randomInt(0, max)];
    }
    if (!existing.has(id)) return id;
  }
  throw new Error("createShortId: could not generate a unique id after 64 attempts");
}

export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(SLUG_PATTERN, "-")
    .replace(MULTI_DASH_PATTERN, "-")
    .replace(/^-|-$/g, "");
}

/** Normalize, truncate to maxLen, and strip dangling dashes so the result
 * always satisfies SlugSchema (/^[a-z0-9]+(?:-[a-z0-9]+)*$/). Returns fallback
 * when the input yields no usable chars (e.g. emoji-only titles) — prevents
 * the "invalid shortName" rejection caused by slice(maxLen) leaving a trailing
 * dash or an empty string. */
export function clampSlug(input: string, maxLen = 30, fallback = "untitled"): string {
  const slug = normalizeSlug(input).slice(0, maxLen).replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export function formatTwoDigitNumber(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatThreeDigitNumber(value: number): string {
  return String(value).padStart(3, "0");
}

/** Human-readable phase composite ref: `P00x` or `P00x(F00x)` when the parent
 *  feature number is known. Harness-agnostic (used by core handoff listing +
 *  adapters). */
export function formatPhaseRef(phaseNumber: number, featureNumber?: number): string {
  const p = `P${formatThreeDigitNumber(phaseNumber)}`;
  return featureNumber != null ? `${p}(F${formatThreeDigitNumber(featureNumber)})` : p;
}

/** Human-readable feature ref: `F00x`. Harness-agnostic. */
export function formatFeatureRef(featureNumber: number): string {
  return `F${formatThreeDigitNumber(featureNumber)}`;
}

/** Human-readable idea ref: `I00x`. Ideas use an independent global sequence. */
export function formatIdeaRef(ideaNumber: number): string {
  return `I${formatThreeDigitNumber(ideaNumber)}`;
}

/** Find the parent feature's number for a phase (for P00x(F00x) composite refs). */
export function featureNumberOfPhase(
  phase: { featureId?: string | null | undefined },
  features: { id: string; number: number }[]
): number | undefined {
  return phase.featureId ? features.find((f) => f.id === phase.featureId)?.number : undefined;
}

export function createPhaseId(): string {
  return randomUUID();
}

/** True for legacy phase ids that are NOT feature-scoped (e.g. `phase-01-...`). */
export function isLegacyPhaseId(phaseId: string): boolean {
  return phaseId.startsWith("phase-") && !phaseId.startsWith("feature-");
}

/** Compute the feature-scoped id for a legacy phase, preserving featureId/number/slug. */
export function migratePhaseId(featureId: string, number: number, slug: string): string {
  // In UUID world, this is just randomUUID, but we keep signature for compatibility if needed
  return randomUUID();
}

export function createTaskId(): string {
  return randomUUID();
}

export function createRequirementId(): string {
  return randomUUID();
}

export function createIdeaId(): string {
  return randomUUID();
}

export function createMacroTaskId(): string {
  return randomUUID();
}

export function createFeatureId(): string {
  return randomUUID();
}

export function createChecklistItemId(taskId: string, number: number, title: string): string {
  return `${taskId}-check-${formatThreeDigitNumber(number)}-${normalizeSlug(title)}`;
}

export function createStatusLogEntryId(): string {
  return randomUUID();
}
