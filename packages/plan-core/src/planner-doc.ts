/**
 * Planner Markdown documents (P128(F025)/T490 — documents family).
 *
 * The Web UI has always viewed and saved `.planner/docs/*.md` through its
 * own routes; those rules are application behavior, not presentation:
 * which paths are admissible, that symlinks are refused, that a save is
 * an explicit confirmation, and that empty content is not a document.
 * One flow serves the UI routes and the versioned API alike.
 */

import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Refusal codes shared by every document surface. */
export type PlannerDocRefusalCode =
  | "DOCUMENT_PATH_INVALID"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_NOT_REGULAR_FILE"
  | "DOCUMENT_CONFIRMATION_REQUIRED"
  | "DOCUMENT_CONTENT_REQUIRED";

export class PlannerDocRefusal extends Error {
  readonly code: PlannerDocRefusalCode;
  /** Path as supplied by the caller, so a surface can echo it back. */
  readonly documentPath: string;

  constructor(code: PlannerDocRefusalCode, message: string, documentPath: string) {
    super(message);
    this.name = "PlannerDocRefusal";
    this.code = code;
    this.documentPath = documentPath;
  }
}

export interface PlannerDocEntry {
  /** Canonical planner path, e.g. ".planner/docs/architecture.md". */
  path: string;
  /** Bytes on disk. */
  size: number;
  /** File mtime, ISO 8601. */
  updatedAt: string;
}

const DOCUMENT_PATH_PATTERN = /^\.planner\/docs\/.+\.md$/i;
const NOT_REGULAR_FILE_MESSAGE = "Document must be a regular file under .planner/docs/ (symlinks rejected).";

/**
 * Resolve a caller-supplied planner path to an absolute file under
 * `<planRoot>/docs`. Traversal, wrong extensions and symlink escapes are
 * refused before any read.
 */
export function resolvePlannerDocPath(planRoot: string, rawPath: string): string {
  const normalized = rawPath.trim().replace(/\\/g, "/");
  if (!DOCUMENT_PATH_PATTERN.test(normalized) || normalized.includes("/../")) {
    throw new PlannerDocRefusal(
      "DOCUMENT_PATH_INVALID",
      `Document path must be a Markdown file under .planner/docs/: ${rawPath}`,
      rawPath,
    );
  }
  const docsRoot = resolve(planRoot, "docs");
  const target = resolve(planRoot, normalized.slice(".planner/".length));
  if (!target.startsWith(`${docsRoot}${sep}`)) {
    throw new PlannerDocRefusal(
      "DOCUMENT_PATH_INVALID",
      `Document escapes .planner/docs/: ${normalized}`,
      rawPath,
    );
  }
  return target;
}

export interface PlannerDocContent {
  path: string;
  content: string;
}

/** Read one planner Markdown document. */
export async function readPlannerDocument(planRoot: string, rawPath: string): Promise<PlannerDocContent> {
  const target = resolvePlannerDocPath(planRoot, rawPath);
  const fileStat = await lstat(target).catch(() => null);
  if (!fileStat || fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new PlannerDocRefusal("DOCUMENT_NOT_REGULAR_FILE", NOT_REGULAR_FILE_MESSAGE, rawPath);
  }
  const content = await readFile(target, "utf8").catch(() => null);
  if (content === null) {
    throw new PlannerDocRefusal("DOCUMENT_NOT_FOUND", "Document not found.", rawPath);
  }
  return { path: rawPath, content };
}

export interface PlannerDocSaveInput {
  path: string;
  content: string;
  /** Saves are explicit; without it the flow refuses before touching disk. */
  confirmed?: boolean | undefined;
}

/**
 * Write one planner Markdown document. A missing file is created
 * (including its directory); an existing symlink is refused rather than
 * followed.
 */
export async function savePlannerDocument(planRoot: string, input: PlannerDocSaveInput): Promise<{ path: string; saved: true }> {
  if (input.confirmed !== true) {
    throw new PlannerDocRefusal(
      "DOCUMENT_CONFIRMATION_REQUIRED",
      "Saving a planner document requires explicit confirmed=true.",
      input.path,
    );
  }
  const target = resolvePlannerDocPath(planRoot, input.path);
  const fileStat = await lstat(target).catch(() => null);
  if (fileStat && (fileStat.isSymbolicLink() || !fileStat.isFile())) {
    throw new PlannerDocRefusal("DOCUMENT_NOT_REGULAR_FILE", NOT_REGULAR_FILE_MESSAGE, input.path);
  }
  if (!input.content.trim()) {
    throw new PlannerDocRefusal("DOCUMENT_CONTENT_REQUIRED", "Document content must be non-empty Markdown.", input.path);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, input.content, "utf8");
  return { path: input.path, saved: true };
}

/** Recursively list planner Markdown documents, sorted by path. Symlinks are skipped. */
export async function listPlannerDocuments(planRoot: string): Promise<PlannerDocEntry[]> {
  const docsRoot = resolve(planRoot, "docs");
  const entries: PlannerDocEntry[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true }).catch(() => null);
    if (!children) return;
    for (const child of children) {
      const childPath = join(directory, child.name);
      const plannerPath = `${prefix}/${child.name}`;
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        await walk(childPath, plannerPath);
        continue;
      }
      if (!child.isFile() || !/\.md$/i.test(child.name)) continue;
      const details = await stat(childPath).catch(() => null);
      if (!details) continue;
      entries.push({ path: plannerPath, size: details.size, updatedAt: details.mtime.toISOString() });
    }
  };
  await walk(docsRoot, ".planner/docs");
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
