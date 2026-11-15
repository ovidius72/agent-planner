/**
 * Portable project descriptor and workspace resolver (P128(F025)/T489).
 *
 * Identity must not depend on where the planner data lives. The descriptor is
 * a small versioned file committed with the project's normal review; the
 * resolver applies one precedence — descriptor, legacy `.planner`,
 * initialization — and never invents a silent substitute. Adapters currently
 * infer `cwd/.planner` (plan-mcp) or a `.planner` constant (pi-adapter, CLI);
 * they adopt this resolver through T490's routing, so the rule lives here
 * exactly once (AGENTS.md rule 4: harness-agnostic core).
 *
 * Binding rules implemented (architecture.md §3, decided 2026-11-02):
 *   - the nearest descriptor walking up from the working directory wins, so
 *     each monorepo sub-project has its own planner;
 *   - the walk never crosses a repository boundary unless the descriptor sits
 *     there;
 *   - worktrees of one clone share `git --git-common-dir` — local clone
 *     evidence only, never a network or remote identity;
 *   - a copied/forked folder carrying a known `projectId` is a deliberate
 *     rebind: the caller asks once (same project vs new project) and stores
 *     the answer in the repository registration (RepositoryRegistration).
 *
 * Deliberately absent: credentials, local endpoints, database paths, live
 * agents. The schema is strict — unknown fields fail parsing, so a future
 * reader cannot silently carry payloads it does not understand.
 */

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

/** Bump only through the contract's explicit version-transition rule (domain-contract.md §0). */
export const PROJECT_DESCRIPTOR_VERSION = 1;
export const PROJECT_DESCRIPTOR_NAME = ".agent-plan.json";
export const LEGACY_PLANNER_DIR_NAME = ".planner";

export const ProjectDescriptorSnapshotSchema = z.object({
  remote: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
});

export const ProjectDescriptorSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_DESCRIPTOR_VERSION),
    projectId: z.string().min(1),
    snapshot: ProjectDescriptorSnapshotSchema.optional(),
  })
  .strict();

export type ProjectDescriptorSnapshot = z.infer<typeof ProjectDescriptorSnapshotSchema>;
export type ProjectDescriptor = z.infer<typeof ProjectDescriptorSchema>;

export type ProjectDescriptorErrorCode = "PROJECT_DESCRIPTOR_INVALID" | "PROJECT_DESCRIPTOR_INCOMPATIBLE";

export class ProjectDescriptorError extends Error {
  readonly code: ProjectDescriptorErrorCode;
  readonly path: string;
  /** Present for INCOMPATIBLE: the schemaVersion the file actually declared. */
  readonly foundSchemaVersion: number | undefined;

  constructor(
    code: ProjectDescriptorErrorCode,
    path: string,
    message: string,
    foundSchemaVersion?: number,
  ) {
    super(message);
    this.name = "ProjectDescriptorError";
    this.code = code;
    this.path = path;
    this.foundSchemaVersion = foundSchemaVersion;
  }
}

/** Parse and validate descriptor content from disk. Typed errors, never a silent fallback. */
export async function readProjectDescriptor(path: string): Promise<ProjectDescriptor> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new ProjectDescriptorError(
      "PROJECT_DESCRIPTOR_INVALID",
      path,
      `Descriptor cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProjectDescriptorError(
      "PROJECT_DESCRIPTOR_INVALID",
      path,
      `Descriptor is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const declaredVersion = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion;
  const result = ProjectDescriptorSchema.safeParse(parsed);
  if (!result.success) {
    if (typeof declaredVersion === "number" && declaredVersion !== PROJECT_DESCRIPTOR_VERSION) {
      throw new ProjectDescriptorError(
        "PROJECT_DESCRIPTOR_INCOMPATIBLE",
        path,
        `Descriptor schemaVersion ${declaredVersion} is not supported (expected ${PROJECT_DESCRIPTOR_VERSION}); never migrated silently.`,
        declaredVersion,
      );
    }
    throw new ProjectDescriptorError(
      "PROJECT_DESCRIPTOR_INVALID",
      path,
      `Descriptor validation failed: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return result.data;
}

/** Canonical serialization for descriptor writes (stable key order, trailing newline). */
export function serializeProjectDescriptor(descriptor: ProjectDescriptor): string {
  return `${JSON.stringify(ProjectDescriptorSchema.parse(descriptor), null, 2)}\n`;
}

/**
 * Create a descriptor file atomically (temp file + rename), so a crash never
 * leaves a half-written descriptor that would poison the resolver.
 */
export async function writeProjectDescriptor(
  dir: string,
  descriptor: ProjectDescriptor,
): Promise<string> {
  const path = join(resolve(dir), PROJECT_DESCRIPTOR_NAME);
  const content = serializeProjectDescriptor(descriptor);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
  return path;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk up from `startDir` without crossing a repository boundary (a directory
 * containing `.git`) — matching architecture.md §3: never cross a repository
 * boundary unless the descriptor sits there. Returns `undefined` when nothing
 * matches inside the reachable scope.
 */
async function findUp(matcher: (dir: string) => Promise<string | undefined>, startDir: string): Promise<string | undefined> {
  let current = resolve(startDir);
  for (;;) {
    const hit = await matcher(current);
    if (hit !== undefined) return hit;
    if (await isDirectory(join(current, ".git"))) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export type WorkspaceResolution =
  | { kind: "descriptor"; root: string; path: string; descriptor: ProjectDescriptor }
  /** A descriptor exists but is unreadable/incompatible: surface the typed error instead of silently falling through. */
  | { kind: "descriptor-error"; root: string; path: string; error: ProjectDescriptorError }
  | { kind: "legacy"; root: string; planRoot: string }
  | { kind: "none"; root: string };

/**
 * One resolver for every client (architecture.md §3 steps 1–5):
 *   1. nearest descriptor wins (including an unreadable one — its typed error
 *      is the answer, never a fallback to a different identity);
 *   2. legacy `.planner` without a descriptor reports the migration-offer state;
 *   3. neither reports `none` (initialization offer, empty folder valid).
 * The caller owns what to offer; the resolver only resolves.
 */
export async function resolvePlannerWorkspace(startDir: string): Promise<WorkspaceResolution> {
  const root = resolve(startDir);
  const descriptorPath = await findUp(
    async (dir) => {
      const candidate = join(dir, PROJECT_DESCRIPTOR_NAME);
      try {
        await stat(candidate);
        return candidate;
      } catch {
        return undefined;
      }
    },
    root,
  );
  if (descriptorPath !== undefined) {
    try {
      const descriptor = await readProjectDescriptor(descriptorPath);
      return { kind: "descriptor", root: dirname(descriptorPath), path: descriptorPath, descriptor };
    } catch (error) {
      return {
        kind: "descriptor-error",
        root: dirname(descriptorPath),
        path: descriptorPath,
        error: error instanceof ProjectDescriptorError ? error : new ProjectDescriptorError("PROJECT_DESCRIPTOR_INVALID", descriptorPath, String(error)),
      };
    }
  }
  const legacyPlanRoot = await findUp(
    async (dir) => (await isDirectory(join(dir, LEGACY_PLANNER_DIR_NAME)) ? join(dir, LEGACY_PLANNER_DIR_NAME) : undefined),
    root,
  );
  if (legacyPlanRoot !== undefined) return { kind: "legacy", root: dirname(legacyPlanRoot), planRoot: legacyPlanRoot };
  return { kind: "none", root };
}

/** The one clone key: git common dir when present, else the folder itself (non-Git planning stays valid). */
export async function cloneKeyFor(dir: string): Promise<string> {
  let current = resolve(dir);
  for (;;) {
    const dotGit = join(current, ".git");
    try {
      const info = await stat(dotGit);
      if (info.isDirectory()) return dotGit;
      const pointer = await readFile(dotGit, "utf8");
      const match = pointer.match(/^gitdir:\s*(.+)\s*$/m);
      if (match?.[1]) {
        const worktreeGitDir = resolve(current, match[1]);
        const commonDirRef = await readFile(join(worktreeGitDir, "commondir"), "utf8").catch(() => "");
        return commonDirRef.trim() ? resolve(worktreeGitDir, commonDirRef.trim()) : worktreeGitDir;
      }
    } catch {
      // Not a git entry here; keep walking.
    }
    const parent = dirname(current);
    if (parent === current) return resolve(dir);
    current = parent;
  }
}

/**
 * Stored answer to the once-asked fork/copy question (architecture.md §3,
 * decided 2026-11-02). Persisted by the service owner (T490) next to the
 * project registration; a later rebind is an explicit action.
 */
export type BindDecision = "same-project" | "new-project";

export interface RepositoryRegistration {
  projectId: string;
  /** `cloneKeyFor(dir)` — git common dir when present, else the folder path. */
  cloneKey: string;
  decision: BindDecision;
  registeredAt: string;
}

/**
 * A registered source checkout. `path` and `branch` are mutable locators;
 * identity is `workspaceId` + `projectId` (domain-contract.md §1).
 */
export interface WorkspaceRegistration {
  workspaceId: string;
  projectId: string;
  path: string;
  branch?: string;
}

/**
 * Port implemented by the SQLite authority owner (T502): where one project's
 * authoritative store lives, under the service's HOME scope. Clients never
 * open it; the service resolves registrations through its API.
 */
export interface ProjectStoreRegistration {
  projectId: string;
  storeLocation: string;
  registeredAt: string;
}

/**
 * Port implemented by the application-service owner (T490): the advertised
 * boot record callers verify before reuse (architecture.md §2 — a PID or an
 * open port alone is insufficient proof of compatibility).
 */
export interface ServiceEndpointRecord {
  protocolVersion: string;
  bootId: string;
  host: "127.0.0.1";
  port: number;
}
