import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Harness-agnostic logic for the "no task in progress" warning. The guard
 * never blocks and never asks: every tool call proceeds, and a call that
 * changes project code while no task is in progress only earns the agent a
 * warning. Planner operations never need a task. Any adapter (Claude Code
 * PreToolUse hook, Pi's tool_call handler, a future harness) feeds it a
 * parsed tool-use event plus already-fetched planner state and gets back the
 * same warning, or none. This never talks to the plan store
 * or stdin/stdout — callers own that I/O. It does read the filesystem in one
 * narrow way (see {@link canonicalize}): resolving symlinks so a path
 * comparison isn't fooled by one, which is cheap (a handful of stat calls,
 * not a plan load) and safe to call on paths that don't exist yet.
 */

/** The tool-use fields the decision needs, already pulled out of whatever
 * shape the harness's raw event uses (Claude Code's `tool_input.file_path`,
 * Pi's `event.input.path`, etc.). */
export interface GuardEventInput {
  /** Tool name in any case: Claude Code's `Edit`/`Bash` and Pi's `edit`/`bash` are the same tool. */
  toolName: string;
  /** Absolute (or resolvable) working directory used to resolve relative paths. */
  cwd: string;
  /** Absolute planner root, e.g. `join(cwd, ".planner")`. */
  plannerRoot: string;
  /** Edit / Write target path (Pi: `path`). */
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
  /** The task the warning suggests starting, when there is an obvious one. */
  focusTask?: { id: string; title: string };
}

export interface GuardClassification {
  /** Whether this tool call may write project code, so the guard must look at task state. */
  guarded: boolean;
  /** The project paths outside `.planner/` the call would write to; empty when the target is unknown. */
  paths: string[];
}

export interface NoTaskWarning {
  /** Text for the agent, present only when it should be warned. */
  warning?: string;
}

const FILE_WRITE_TOOLS = new Set(["edit", "write"]);

/** Strip fd-duplication idioms (`2>&1`, `>&2`, `1>&2`) before segmenting or
 * matching — they duplicate a stream, not a file, are extremely common in
 * otherwise read-only commands, and their bare `&` would otherwise be
 * misread as a command separator by {@link bashSegments}. */
function stripFdDuplication(command: string): string {
  return command.replace(/\d*>&\d+/g, " ");
}

/** Blank out shell operators (`>`, `<`, `|`, `;`, `&`, newlines) that sit
 * inside single or double quotes. They are literal text there — a commit
 * message's `<name@example.com>`, a `grep "a|b"` pattern — not redirects or
 * separators. Quoted paths keep their characters, so `> "/tmp/x"` still
 * reads as a redirect to `/tmp/x`. */
function maskQuotedOperators(command: string): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (quote === null) {
      if (ch === "\\") {
        out += ch + (command[i + 1] ?? "");
        i += 1;
        continue;
      }
      if (ch === "'" || ch === '"') quote = ch;
      out += ch;
      continue;
    }
    if (quote === '"' && ch === "\\") {
      out += "__";
      i += 1;
      continue;
    }
    if (ch === quote) {
      quote = null;
      out += ch;
      continue;
    }
    out += /[<>|;&\n]/.test(ch) ? "_" : ch;
  }
  return out;
}

/** The command line as write-detection reads it: quoted operators masked,
 * then fd-duplication removed. Both detection and target extraction use
 * this, so they always see the same text. */
function normalizeBashCommand(command: string): string {
  return stripFdDuplication(maskQuotedOperators(command));
}

/** Split a Bash command line into pipe/list segments so write-detection on
 * one segment (e.g. `sed -i` on the left of a pipe) doesn't get confused by
 * an unrelated flag on the other side (e.g. `grep -i` on the right). Best
 * effort only — nested subshells are not parsed. Callers must pass the
 * command through {@link normalizeBashCommand} first, or a bare `2>&1`
 * splits on its `&` and a quoted `|` splits a string in two. */
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
 * and friends must stay unmatched, but when in doubt this returns true — a
 * false positive costs one warning to the agent, never a blocked call or a
 * prompt, so under-matching (missing a real edit) is the worse failure.
 */
export function isWriteShapedBashCommand(command: string): boolean {
  if (!command || !command.trim()) return false;
  return bashSegments(normalizeBashCommand(command)).some(isWriteShapedBashSegment);
}

/**
 * Best-effort extraction of the file path(s) a write-shaped Bash segment
 * targets, so a command that only touches `.planner/` or files outside the
 * project earns no warning. This cannot see through a heredoc whose target
 * is computed (a variable, command substitution, etc.) rather than written
 * literally in the command line — that case still reaches the in-progress /
 * bypass checks and can warn, rather than being silently treated as safe.
 *
 * A wider gap of the same kind: a command that writes through an
 * interpreter (`python3 - <<PY` then `open(path, "w")`, `node -e`, a script
 * invoked by name) is opaque here — nothing in the command line looks
 * write-shaped. P105(F005)/T431 evaluated closing this and chose not to,
 * for reasons that also rule out revisiting it the same way later:
 *   - Parsing the script body is unbounded (a path can be computed, read
 *     from argv, or built at runtime) and would trade an honest documented
 *     limit for false confidence.
 *   - A PostToolUse hook that notices tracked files changed while no task
 *     was in progress sounds like a fit (the guard's job is visibility, not
 *     prevention), but it collides with this project's own workflow: a
 *     task is left with its changes uncommitted for the orchestrator to
 *     review, so "no task in-progress, tracked files changed outside
 *     .planner/" is the routine state right after every task completes,
 *     not a signal of anything wrong. Telling that apart from a real
 *     interpreter write means diffing only the delta from one specific
 *     Bash call, which needs a session-scoped git-status baseline checked
 *     on every Bash invocation — read-only ones included, since which
 *     commands wrote can't be known in advance. That statefulness and
 *     per-call cost is worse than the gap it would close.
 * The limit stands, documented rather than silently assumed away.
 */
export function extractBashWriteTargets(command: string): string[] {
  const targets: string[] = [];
  for (const segment of bashSegments(normalizeBashCommand(command))) {
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

/** Turn a path as written in a command line into one `resolve` understands:
 * drop surrounding quotes and expand a leading `~` or `$HOME`. Anything else
 * the shell would expand (other variables, command substitution) is left
 * as-is, so it resolves inside the project and the agent is still warned. */
function shellPathToFsPath(candidate: string): string {
  const unquoted = candidate.replace(/^['"]|['"]$/g, "");
  return unquoted.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir());
}

/** Whether `candidate` resolves to `root` itself or a path inside it. */
function isPathInside(candidate: string, root: string, cwd: string): boolean {
  const resolvedRoot = canonicalize(resolve(root));
  const resolvedCandidate = canonicalize(resolve(cwd, shellPathToFsPath(candidate)));
  const rel = relative(resolvedRoot, resolvedCandidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Whether `candidate` resolves to a path inside `plannerRoot` (or is it exactly). */
export function isPathInsidePlannerRoot(candidate: string, plannerRoot: string, cwd: string): boolean {
  return isPathInside(candidate, plannerRoot, cwd);
}

/** Whether writing `candidate` changes the project's code: it is inside the
 * project (the directory that owns `.planner/`) and not inside `.planner/`.
 * `/dev/null`, `~/.claude/...`, temp dirs and other repositories are not. */
export function isProjectCodePath(candidate: string, plannerRoot: string, cwd: string): boolean {
  return isPathInside(candidate, dirname(plannerRoot), cwd) && !isPathInside(candidate, plannerRoot, cwd);
}

/** Which paths a covered tool call would write to, before any filtering;
 * empty when the target cannot be read from the event. */
function rawWriteTargets(event: GuardEventInput): { covered: boolean; paths: string[] } {
  const tool = event.toolName.toLowerCase();
  if (FILE_WRITE_TOOLS.has(tool)) {
    return { covered: true, paths: event.filePath ? [event.filePath] : [] };
  }
  if (tool === "notebookedit") {
    return { covered: true, paths: event.notebookPath ? [event.notebookPath] : [] };
  }
  if (tool === "bash") {
    const command = event.command ?? "";
    if (!isWriteShapedBashCommand(command)) return { covered: false, paths: [] };
    return { covered: true, paths: extractBashWriteTargets(command) };
  }
  return { covered: false, paths: [] };
}

/**
 * Whether a tool call may change the project's code, and so needs the guard
 * to look at task state. This is the one place that rule lives; the hook's
 * cheap early exit and {@link noTaskWarning} both read `guarded`.
 *
 * - Tools that never write (Read, Grep, MCP tools, read-only Bash, ...) are
 *   not guarded.
 * - A write whose targets are all known and none is project code (inside
 *   `.planner/`, `/dev/null`, `~/.claude/...`, a temp dir, another repo) is
 *   not guarded: updating the planner or the user's own config never needs a
 *   task.
 * - A write with at least one project-code target is guarded, with `paths`
 *   narrowed to those targets.
 * - A write whose target is unknown (a computed heredoc, an Edit with no
 *   path) is guarded with empty `paths` — never silently allowed.
 */
export function classifyGuardedTool(event: GuardEventInput): GuardClassification {
  const { covered, paths } = rawWriteTargets(event);
  if (!covered) return { guarded: false, paths: [] };
  if (paths.length === 0) return { guarded: true, paths: [] };
  const projectPaths = paths.filter((path) => isProjectCodePath(path, event.plannerRoot, event.cwd));
  return { guarded: projectPaths.length > 0, paths: projectPaths };
}

/**
 * The warning for a tool call that changes project code while no task is in
 * progress, or none. Never a block or a prompt: the adapter lets the call
 * proceed either way and only passes the text to the agent. Pure apart from
 * the cheap symlink canonicalization in {@link isPathInsidePlannerRoot}.
 *
 * Order mirrors the cost of finding out: anything that cannot change project
 * code (see {@link classifyGuardedTool}) is settled from the event alone, so
 * adapters can skip loading the plan for it.
 */
export function noTaskWarning(event: GuardEventInput, state: GuardStateInput): NoTaskWarning {
  const classification = classifyGuardedTool(event);
  if (!classification.guarded) return {};
  if (!state.hasPlannerDir || state.totalTasks === 0) return {};
  if (state.hasInProgressTask || state.guardBypassed) return {};

  const target = classification.paths.length > 0 ? classification.paths.join(", ") : "a project file";
  const start = state.focusTask
    ? `start the task that covers it (/planner task start ${state.focusTask.id} — ${state.focusTask.title}, or another one)`
    : "start the task that covers it (/planner task start <task>)";
  return {
    warning: `Agent Plan: no task is in progress, and this call changes project code (${target}). It was not blocked. If this is planned work, ${start} so the plan stays accurate. Planner changes never need a task.`,
  };
}
