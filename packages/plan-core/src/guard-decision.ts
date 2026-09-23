import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Harness-agnostic decision logic for the "no task in progress" edit guard.
 * Any adapter (Claude Code PreToolUse hook, Pi's advisory guard, a future
 * harness) can feed it a parsed tool-use event plus already-fetched planner
 * state and get back the same decision. This never talks to the plan store
 * or stdin/stdout — callers own that I/O. It does read the filesystem in one
 * narrow way (see {@link canonicalize}): resolving symlinks so a path
 * comparison isn't fooled by one, which is cheap (a handful of stat calls,
 * not a plan load) and safe to call on paths that don't exist yet.
 */

export type GuardPermissionDecision = "allow" | "ask" | "deny";

/** The tool-use fields the decision needs, already pulled out of whatever
 * shape the harness's raw event uses (Claude Code's `tool_input.file_path`,
 * Pi's `event.input.path`, etc.). */
export interface GuardEventInput {
  toolName: string;
  /** Absolute (or resolvable) working directory used to resolve relative paths. */
  cwd: string;
  /** Absolute planner root, e.g. `join(cwd, ".planner")`. */
  plannerRoot: string;
  /** Edit / Write target path. */
  filePath?: string;
  /** NotebookEdit target path. */
  notebookPath?: string;
  /** Bash command line, when toolName is "Bash". */
  command?: string;
}

/** Planner state the caller already fetched (I/O happens once, upstream). */
export interface GuardStateInput {
  hasPlannerDir: boolean;
  totalTasks: number;
  hasInProgressTask: boolean;
  guardBypassed: boolean;
  /** Human-readable "start this task" hint, or the generic fallback; empty allowed. */
  startHint: string;
}

export interface GuardClassification {
  /** Whether this tool call is one the guard evaluates at all. */
  guarded: boolean;
  /** Best-effort candidate paths the call would write to (may be empty when unknown). */
  paths: string[];
}

export interface GuardDecision {
  decision: GuardPermissionDecision;
  reason?: string;
}

const GUARDED_FILE_TOOLS = new Set(["Edit", "Write"]);

/** Strip fd-duplication idioms (`2>&1`, `>&2`, `1>&2`) before segmenting or
 * matching — they duplicate a stream, not a file, are extremely common in
 * otherwise read-only commands, and their bare `&` would otherwise be
 * misread as a command separator by {@link bashSegments}. */
function stripFdDuplication(command: string): string {
  return command.replace(/\d*>&\d+/g, " ");
}

/** Split a Bash command line into pipe/list segments so write-detection on
 * one segment (e.g. `sed -i` on the left of a pipe) doesn't get confused by
 * an unrelated flag on the other side (e.g. `grep -i` on the right). Best
 * effort only — quoting and nested subshells are not fully parsed. Callers
 * must strip fd-duplication first, or a bare `2>&1` splits on its `&`. */
function bashSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||[;&|\n])+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

const GIT_TREE_WRITE_RE = /\bgit\s+(?:checkout|apply|restore|stash\s+pop|reset\s+--hard)\b/;
const IN_PLACE_EDITOR_RE = /\b(sed|perl)\b/;
const IN_PLACE_FLAG_RE = /(^|\s)-\S*i(\s|$)/;

function isWriteShapedBashSegment(segment: string): boolean {
  if (/>{1,2}/.test(segment)) return true;
  if (/\btee\b/.test(segment)) return true;
  if (/\b(cp|mv)\b/.test(segment)) return true;
  if (/\brm\b/.test(segment)) return true;
  if (GIT_TREE_WRITE_RE.test(segment)) return true;
  if (IN_PLACE_EDITOR_RE.test(segment) && IN_PLACE_FLAG_RE.test(segment)) return true;
  return false;
}

/**
 * Whether a Bash command line contains a write-shaped operation: output
 * redirection, `tee`, in-place `sed`/`perl`, a file-creating `cp`/`mv`,
 * `rm`, or a `git` operation that rewrites tracked files. Deliberately
 * over-inclusive: `git`, build/test runners, `ls`, `cat`, `grep`, `find`
 * and friends must stay unmatched, but when in doubt this returns true — the
 * cost of a false positive here is one extra prompt, not a blocked
 * operation, so under-matching (missing a real edit) is the worse failure.
 */
export function isWriteShapedBashCommand(command: string): boolean {
  if (!command || !command.trim()) return false;
  return bashSegments(stripFdDuplication(command)).some(isWriteShapedBashSegment);
}

/**
 * Best-effort extraction of the file path(s) a write-shaped Bash segment
 * targets, so a command that only touches `.planner/` can still be
 * recognized and allowed. This cannot see through a heredoc whose target is
 * computed (a variable, command substitution, etc.) rather than written
 * literally in the command line — that case is expected to fall through to
 * the normal in-progress/bypass checks below, not to be silently allowed.
 */
export function extractBashWriteTargets(command: string): string[] {
  const targets: string[] = [];
  for (const segment of bashSegments(stripFdDuplication(command))) {
    const redirect = segment.match(/>{1,2}\s*([^\s;&|>]+)/);
    if (redirect?.[1]) targets.push(redirect[1]);

    const tee = segment.match(/\btee\b\s+(?:-\S+\s+)*([^\s;&|]+)/);
    if (tee?.[1]) targets.push(tee[1]);

    if (/\b(cp|mv)\b/.test(segment)) {
      const tokens = segment.trim().split(/\s+/).filter((token) => !token.startsWith("-"));
      const last = tokens[tokens.length - 1];
      if (last && !/^(cp|mv)$/.test(last)) targets.push(last);
    }

    if (/\brm\b/.test(segment)) {
      const tokens = segment.trim().split(/\s+/).filter((token) => !token.startsWith("-") && token !== "rm");
      targets.push(...tokens);
    }

    if (IN_PLACE_EDITOR_RE.test(segment) && IN_PLACE_FLAG_RE.test(segment)) {
      const tokens = segment.trim().split(/\s+/);
      const last = tokens[tokens.length - 1];
      if (last && !last.startsWith("-")) targets.push(last);
    }
  }
  return targets.filter(Boolean);
}

/**
 * Canonicalize a path by resolving symlinks wherever the filesystem lets us,
 * so e.g. a macOS temp dir under `/var` (itself a symlink to `/private/var`)
 * compares equal to a path already given in its resolved form, instead of
 * two spellings of the same directory looking like different ones. `Edit`
 * targets an existing file, but `Write` and Bash redirects can target a path
 * that doesn't exist yet — realpath() throws ENOENT for those, so this walks
 * up to the nearest existing ancestor, canonicalizes that, and reattaches
 * the missing tail. Never throws; worst case it returns `path` unchanged.
 */
function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path; // reached the filesystem root
    return join(canonicalize(parent), basename(path));
  }
}

/** Whether `candidate` resolves to a path inside `plannerRoot` (or is it exactly). */
export function isPathInsidePlannerRoot(candidate: string, plannerRoot: string, cwd: string): boolean {
  const resolvedRoot = canonicalize(resolve(plannerRoot));
  const resolvedCandidate = canonicalize(resolve(cwd, candidate));
  const rel = relative(resolvedRoot, resolvedCandidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** True only when every candidate path is inside the planner root, and there
 * is at least one candidate — an empty/unknown path list must never count as
 * "inside", or an unresolvable target would be silently allowed. Exported so
 * a hook harness can use the exact same check for its cheap early-allow path
 * without duplicating the rule. */
export function isEntirelyInsidePlannerRoot(paths: string[], plannerRoot: string, cwd: string): boolean {
  return paths.length > 0 && paths.every((path) => isPathInsidePlannerRoot(path, plannerRoot, cwd));
}

/**
 * Which tool calls the guard covers, and what path(s) they would write to.
 * Everything else (Read, Grep, WebFetch, MCP tools, read-only Bash, ...) is
 * unguarded and returns `{ guarded: false }` without touching the planner
 * store.
 */
export function classifyGuardedTool(event: GuardEventInput): GuardClassification {
  if (GUARDED_FILE_TOOLS.has(event.toolName)) {
    return { guarded: true, paths: event.filePath ? [event.filePath] : [] };
  }
  if (event.toolName === "NotebookEdit") {
    return { guarded: true, paths: event.notebookPath ? [event.notebookPath] : [] };
  }
  if (event.toolName === "Bash") {
    const command = event.command ?? "";
    if (!isWriteShapedBashCommand(command)) return { guarded: false, paths: [] };
    return { guarded: true, paths: extractBashWriteTargets(command) };
  }
  return { guarded: false, paths: [] };
}

/**
 * The full "no task in progress" guard decision, as a pure function: given a
 * parsed tool-use event and planner state the caller already fetched, decide
 * allow or ask (deny is part of the type for a future genuinely-deny case,
 * but nothing here returns it today). No stdin/stdout and no plan-store
 * calls — the hook harness (or a Pi equivalent) does the reading and
 * printing around this; the only filesystem access is the cheap symlink
 * canonicalization in {@link isPathInsidePlannerRoot}.
 *
 * Order matters and mirrors the cost of finding out: anything the guard
 * doesn't cover, and anything that resolves entirely inside the planner
 * root, is decided from the event alone (no planner state needed). Only a
 * real candidate for blocking reaches the state-based checks.
 */
export function decideGuardPreToolUse(event: GuardEventInput, state: GuardStateInput): GuardDecision {
  const classification = classifyGuardedTool(event);
  if (!classification.guarded) return { decision: "allow" };

  // Writing a handoff or recording task state is how an agent reports what
  // it did, and it is most needed exactly when no task is in progress. Never
  // block or ask for anything inside .planner/, regardless of task state.
  if (isEntirelyInsidePlannerRoot(classification.paths, event.plannerRoot, event.cwd)) {
    return { decision: "allow" };
  }

  if (!state.hasPlannerDir) return { decision: "allow" };
  if (state.totalTasks === 0) return { decision: "allow" };
  if (state.hasInProgressTask) return { decision: "allow" };
  if (state.guardBypassed) return { decision: "allow" };

  const reason = `Agent Plan guard: no task is in-progress, and this ${event.toolName} touches a file outside .planner/.${state.startHint} Or authorize a temporary bypass so this and further edits this session don't ask again (run /planner bypass, or call planner-authorize-bypass) — same bypass window an in-progress task already skips.`;
  return { decision: "ask", reason };
}
