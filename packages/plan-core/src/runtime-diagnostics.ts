import type { RuntimePackageVersion } from "./package-version.js";

export const PLAN_SCHEMA_VERSION = 1;
export const ALLOCATION_REGISTRY_VERSION = 1;
export const SUPPORTED_ALLOCATION_KINDS = ["feature", "phase", "task", "idea"] as const;

export type AllocationKind = typeof SUPPORTED_ALLOCATION_KINDS[number];

export interface RuntimePackageDiagnostic {
  name: string;
  installedVersion: string;
  loadedVersion: string;
  runtimeState: "loaded";
  versionSource: "loaded-package-manifest";
  packageJsonPath?: string | undefined;
}

export interface RuntimeCapabilities {
  planSchema: {
    manifestSchemaVersion: typeof PLAN_SCHEMA_VERSION;
  };
  allocationRegistry: {
    version: typeof ALLOCATION_REGISTRY_VERSION;
    supportedKinds: readonly AllocationKind[];
  };
}

export function runtimePackageDiagnostic(pkg: RuntimePackageVersion): RuntimePackageDiagnostic {
  return {
    name: pkg.name,
    installedVersion: pkg.version,
    loadedVersion: pkg.version,
    runtimeState: "loaded",
    versionSource: "loaded-package-manifest",
    ...(pkg.packageJsonPath ? { packageJsonPath: pkg.packageJsonPath } : {}),
  };
}

export function runtimePackagesDiagnostic(packages: RuntimePackageVersion[]): Record<string, RuntimePackageDiagnostic> {
  return Object.fromEntries(packages.map((pkg) => [pkg.name, runtimePackageDiagnostic(pkg)]));
}

export function runtimeCapabilities(): RuntimeCapabilities {
  return {
    planSchema: {
      manifestSchemaVersion: PLAN_SCHEMA_VERSION,
    },
    allocationRegistry: {
      version: ALLOCATION_REGISTRY_VERSION,
      supportedKinds: SUPPORTED_ALLOCATION_KINDS,
    },
  };
}

export function isSupportedAllocationKind(kind: string): kind is AllocationKind {
  return (SUPPORTED_ALLOCATION_KINDS as readonly string[]).includes(kind);
}

export function unsupportedAllocationKindDetails(kind: string) {
  return {
    errorCode: "PLAN_UNSUPPORTED_ALLOCATION_KIND" as const,
    kind,
    supportedKinds: SUPPORTED_ALLOCATION_KINDS,
    requiredCapability: "allocationRegistry.supportedKinds",
    action: "Upgrade all Agent Plan packages and reload the harness so the loaded runtime supports this allocation kind before retrying the mutation.",
  };
}
