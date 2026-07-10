// Local-storage helpers for the dashboard. Pure, no React dependency, so they
// can be unit-tested and reused by any component that needs persisted UI state.

export function dashboardStorageKey(scope: string, suffix: string): string {
  return `agent-plan:dashboard:${scope}:${suffix}`;
}

export function readStoredArray<T extends string>(key: string, fallback: T[], allowed: readonly T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return fallback;
    const schemaKey = `${key}-schema`;
    const currentSchema = allowed.slice().sort().join(",");
    const savedSchema = window.localStorage.getItem(schemaKey);
    if (savedSchema !== currentSchema) {
      window.localStorage.setItem(schemaKey, currentSchema);
      return fallback;
    }
    const valid = parsed.filter((entry): entry is T => typeof entry === "string" && allowed.includes(entry as T));
    return valid.length > 0 ? valid : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredArray<T extends string>(key: string, values: T[], allowed: readonly T[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(values));
  window.localStorage.setItem(`${key}-schema`, allowed.slice().sort().join(","));
}

export function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}
