import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimePackageVersion {
  name: string;
  version: string;
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
        return { name: expectedName, version: manifest.version };
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
