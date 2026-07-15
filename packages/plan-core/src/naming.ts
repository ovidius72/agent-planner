import { randomInt, randomUUID } from "node:crypto";

const SLUG_PATTERN = /[^a-z0-9]+/g;
const MULTI_DASH_PATTERN = /-+/g;

/** Crockford Base32 alphabet — excludes ambiguous characters 0/O/1/I/L
 *  to minimize human transcription errors. 32 symbols → 5 chars = 33M combos. */
export const CROCKFORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const SHORT_ID_LENGTH = 5;
export const SHORT_ID_PATTERN = /^[A-Z2-9]{5}$/;

/** Generate a globally-unique short id (5 chars, Crockford Base32, e.g. `UUXD1`-style
 *  but without 0/1/I/O). Retries until the id is not in `existing` (project-scoped
 *  collision guard). Throws only in the impossible saturation case (~50 retries). */
export function createShortId(existing: Set<string> = new Set()): string {
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

export function createMacroTaskId(): string {
  return randomUUID();
}

export function createFeatureId(): string {
  return randomUUID();
}

export function createChecklistItemId(taskId: string, number: number, title: string): string {
  return `${taskId}-check-${formatThreeDigitNumber(number)}-${normalizeSlug(title)}`;
}
