import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimePackageVersion {
  name: string;
  version: string;
  /** Absolute path to the loaded package manifest used as the version source. */
  packageJsonPath?: string;
}

interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

function modulePath(moduleUrlOrPath: string): string {
  return moduleUrlOrPath.startsWith("file:")
    ? fileURLToPath(moduleUrlOrPath)
    : moduleUrlOrPath;
}

/** Find the nearest matching package manifest above a loaded module. */
export function packageVersionFromModule(
  moduleUrlOrPath: string,
  expectedName: string,
): RuntimePackageVersion {
  let current = dirname(modulePath(moduleUrlOrPath));

  while (true) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PackageManifest;
      if (manifest.name === expectedName) {
        if (typeof manifest.version !== "string" || !manifest.version.trim()) {
          throw new Error(`Package ${expectedName} has no valid version in ${manifestPath}.`);
        }
        return { name: expectedName, version: manifest.version, packageJsonPath: manifestPath };
      }
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Could not locate package.json for ${expectedName} from ${moduleUrlOrPath}.`);
}

/** Resolve a dependency exactly as the caller loaded it, then read its manifest. */
export function resolvedPackageVersion(
  packageName: string,
  fromModuleUrl: string,
): RuntimePackageVersion {
  const entryPath = createRequire(fromModuleUrl).resolve(packageName);
  return packageVersionFromModule(entryPath, packageName);
}

/**
 * A long-lived process (an MCP server a session started, a Pi extension)
 * keeps running the code it loaded. After an upgrade it silently runs old
 * code, so an already-fixed bug looks like it came back. This returns a
 * checker that re-reads the loaded package's manifest — one small file, at
 * most once per `intervalMs` — and returns a one-line notice while the
 * version on disk differs from the one loaded. It never throws: an
 * unreadable manifest means no notice.
 */
export function createStaleProcessCheck(
  loaded: RuntimePackageVersion,
  { intervalMs = 10 * 60_000, now = () => Date.now() }: { intervalMs?: number; now?: () => number } = {},
): () => string | undefined {
  let checkedAt = Number.NEGATIVE_INFINITY;
  let notice: string | undefined;
  return () => {
    if (!loaded.packageJsonPath) return undefined;
    const time = now();
    if (time - checkedAt < intervalMs) return notice;
    checkedAt = time;
    notice = undefined;
    try {
      const manifest = JSON.parse(readFileSync(loaded.packageJsonPath, "utf-8")) as PackageManifest;
      if (typeof manifest.version === "string" && manifest.version.trim() && manifest.version !== loaded.version) {
        notice = `⚠️ This session is running ${loaded.name} ${loaded.version}, but ${manifest.version} is now installed. Restart the session (in Claude Code: /mcp, then reconnect agent-plan) to use it; until then, fixes made after ${loaded.version} are not active here.`;
      }
    } catch {
      notice = undefined;
    }
    return notice;
  };
}
