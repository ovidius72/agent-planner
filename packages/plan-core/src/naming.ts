import { randomUUID } from "node:crypto";

const SLUG_PATTERN = /[^a-z0-9]+/g;
const MULTI_DASH_PATTERN = /-+/g;

export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(SLUG_PATTERN, "-")
    .replace(MULTI_DASH_PATTERN, "-")
    .replace(/^-|-$/g, "");
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
