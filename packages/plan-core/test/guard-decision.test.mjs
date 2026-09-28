import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGuardedTool,
  noTaskWarning,
  extractBashWriteTargets,
  isPathInsidePlannerRoot,
  isProjectCodePath,
  isWriteShapedBashCommand,
} from "../dist/index.js";

const CWD = "/repo";
const PLANNER_ROOT = "/repo/.planner";

const baseState = {
  hasPlannerDir: true,
  totalTasks: 3,
  hasInProgressTask: false,
  guardBypassed: false,
  focusTask: { id: "T1", title: "Do the thing" },
};

const event = (overrides = {}) => ({
  toolName: "Edit",
  cwd: CWD,
  plannerRoot: PLANNER_ROOT,
  ...overrides,
});

test("an Edit inside the planner root does not warn, even with no task in progress", () => {
  const decision = noTaskWarning(
    event({ filePath: "/repo/.planner/docs/handoff.md" }),
    baseState,
  );
  assert.equal(decision.warning, undefined);
});

test("an Edit to project code warns, and names the task to start", () => {
  const decision = noTaskWarning(
    event({ filePath: "/repo/src/index.ts" }),
    baseState,
  );
  assert.equal(typeof decision.warning, "string");
  assert.match(decision.warning, /no task is in progress/);
  assert.match(decision.warning, /not blocked/);
  assert.match(decision.warning, /\/repo\/src\/index\.ts/);
  assert.match(decision.warning, /\/planner task start T1 — Do the thing/);
  assert.match(decision.warning, /Planner changes never need a task/);
  assert.doesNotMatch(decision.warning, /OR Or/i);
});

test("a task in-progress silences the warning for the edit outside the planner root", () => {
  const decision = noTaskWarning(
    event({ filePath: "/repo/src/index.ts" }),
    { ...baseState, hasInProgressTask: true },
  );
  assert.equal(decision.warning, undefined);
});

test("an authorized bypass silences the warning for the edit outside the planner root", () => {
  const decision = noTaskWarning(
    event({ filePath: "/repo/src/index.ts" }),
    { ...baseState, guardBypassed: true },
  );
  assert.equal(decision.warning, undefined);
});

test("no planner directory means no warning", () => {
  const decision = noTaskWarning(
    event({ filePath: "/repo/src/index.ts" }),
    { ...baseState, hasPlannerDir: false },
  );
  assert.equal(decision.warning, undefined);
});

test("no tasks at all means no warning", () => {
  const decision = noTaskWarning(
    event({ filePath: "/repo/src/index.ts" }),
    { ...baseState, totalTasks: 0 },
  );
  assert.equal(decision.warning, undefined);
});

test("read-only Bash (git status, build, ls, grep, find, cat) does not warn without touching planner state", () => {
  const commands = [
    "git status",
    "git pull",
    "git log --oneline -5",
    "pnpm build",
    "pnpm test",
    "ls -la packages",
    "grep -rn foo packages",
    "find . -name '*.ts'",
    "cat packages/agent-plan/src/index.ts",
    "echo hello 2>&1",
    "pnpm build 2>&1 | cat",
  ];
  for (const command of commands) {
    assert.equal(isWriteShapedBashCommand(command), false, `expected "${command}" to be read-only`);
    const decision = noTaskWarning(event({ toolName: "Bash", command }), baseState);
    assert.equal(decision.warning, undefined, `expected "${command}" not to warn`);
  }
});

test("write-shaped Bash outside the planner root warns", () => {
  const commands = [
    "echo hi > /repo/src/out.txt",
    "echo hi >> /repo/src/out.txt",
    "pnpm build | tee /repo/src/build.log",
    "sed -i 's/a/b/' /repo/src/index.ts",
    "perl -pi -e 's/a/b/' /repo/src/index.ts",
    "cp /repo/src/a.ts /repo/src/b.ts",
    "mv /repo/src/a.ts /repo/src/b.ts",
    "rm /repo/src/a.ts",
    "git checkout -- /repo/src/index.ts",
    "git apply /repo/patch.diff",
  ];
  for (const command of commands) {
    assert.equal(isWriteShapedBashCommand(command), true, `expected "${command}" to be write-shaped`);
    const decision = noTaskWarning(event({ toolName: "Bash", command }), baseState);
    assert.equal(typeof decision.warning, "string", `expected "${command}" to warn`);
  }
});

test("write-shaped Bash entirely inside the planner root does not warn", () => {
  const commands = [
    "echo hi > /repo/.planner/docs/handoff.md",
    "sed -i 's/a/b/' /repo/.planner/docs/handoff.md",
    "cp /repo/.planner/docs/a.md /repo/.planner/docs/b.md",
  ];
  for (const command of commands) {
    const decision = noTaskWarning(event({ toolName: "Bash", command }), baseState);
    assert.equal(decision.warning, undefined, `expected "${command}" not to warn`);
  }
});

test("a Bash command touching both a planner and a project path warns, and reports only the project path", () => {
  const command = "echo a > /repo/.planner/docs/a.md && echo b > /repo/src/b.ts";
  assert.deepEqual(classifyGuardedTool(event({ toolName: "Bash", command })), { guarded: true, paths: ["/repo/src/b.ts"] });
  assert.equal(noTaskWarning(event({ toolName: "Bash", command }), baseState).warning === undefined, false);
});

test("writes that land outside the project never need a task", () => {
  const commands = [
    "grep -rn foo packages 2>/dev/null",
    "ls ~/.claude/settings.json 2>/dev/null | head",
    "pnpm test >/dev/null",
    "pnpm test &>/dev/null",
    "echo '{}' > ~/.claude/settings.json",
    "echo x > $HOME/.config/tool.json",
    "echo x > /tmp/scratch.txt",
    "cp /repo/src/a.ts /tmp/a.ts",
    "echo x > ../other-repo/file.txt",
  ];
  for (const command of commands) {
    const decision = noTaskWarning(event({ toolName: "Bash", command }), baseState);
    assert.equal(decision.warning, undefined, `expected "${command}" not to warn`);
  }
  for (const filePath of ["/tmp/x.ts", `${process.env.HOME}/.claude/settings.json`, "/etc/hosts"]) {
    assert.equal(noTaskWarning(event({ filePath }), baseState).warning, undefined, `expected Edit ${filePath} not to warn`);
  }
});

test("a project write mixed with /dev/null still warns", () => {
  const decision = noTaskWarning(event({ toolName: "Bash", command: "echo x > src/a.ts 2>/dev/null" }), baseState);
  assert.equal(typeof decision.warning, "string");
});

test("operators inside quotes are text, not redirects or separators", () => {
  const commands = [
    'git add .planner && git commit -q -m "chore: handoff\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: x" && git push -q 2>&1 | tail -2; git status --short',
    "git commit -m 'a -> b; c | d & e'",
    'grep -rn "a|b" packages',
    'echo "x > y"',
  ];
  for (const command of commands) {
    assert.equal(isWriteShapedBashCommand(command), false, `expected "${command}" to be read-only`);
    assert.equal(noTaskWarning(event({ toolName: "Bash", command }), baseState).warning, undefined);
  }
  // A quoted redirect target is still a redirect target.
  assert.equal(noTaskWarning(event({ toolName: "Bash", command: 'echo x > "/repo/src/a.ts"' }), baseState).warning === undefined, false);
  assert.equal(noTaskWarning(event({ toolName: "Bash", command: 'echo x > "/tmp/a.ts"' }), baseState).warning, undefined);
});

test("an unknown write target still warns", () => {
  assert.equal(noTaskWarning(event({ toolName: "Edit" }), baseState).warning === undefined, false);
  assert.equal(noTaskWarning(event({ toolName: "Bash", command: 'echo x > "$OUT_FILE"' }), baseState).warning === undefined, false);
});

test("isProjectCodePath is inside the project and outside .planner/", () => {
  assert.equal(isProjectCodePath("src/a.ts", PLANNER_ROOT, CWD), true);
  assert.equal(isProjectCodePath("/repo/.planner/x.json", PLANNER_ROOT, CWD), false);
  assert.equal(isProjectCodePath("/dev/null", PLANNER_ROOT, CWD), false);
  assert.equal(isProjectCodePath("~/.claude/settings.json", PLANNER_ROOT, CWD), false);
});

test("a NotebookEdit outside the planner root warns; inside it does not warn", () => {
  const outside = noTaskWarning(
    event({ toolName: "NotebookEdit", notebookPath: "/repo/notebooks/a.ipynb" }),
    baseState,
  );
  assert.equal(outside.warning === undefined, false);

  const inside = noTaskWarning(
    event({ toolName: "NotebookEdit", notebookPath: "/repo/.planner/notebooks/a.ipynb" }),
    baseState,
  );
  assert.equal(inside.warning, undefined);
});

test("tools the guard does not cover (Read, Grep, MCP tools) do not warn without state", () => {
  for (const toolName of ["Read", "Grep", "Glob", "WebFetch", "mcp__agent-plan__planner-task-show"]) {
    const decision = noTaskWarning(event({ toolName, filePath: "/repo/src/index.ts" }), baseState);
    assert.equal(decision.warning, undefined);
  }
});

test("classifyGuardedTool reports guarded=false for non-covered tools without inspecting paths", () => {
  assert.deepEqual(classifyGuardedTool({ toolName: "Read", cwd: CWD, plannerRoot: PLANNER_ROOT, filePath: "/repo/src/index.ts" }), { guarded: false, paths: [] });
});

test("isPathInsidePlannerRoot resolves relative paths and rejects a path that merely contains the text '.planner'", () => {
  assert.equal(isPathInsidePlannerRoot(".planner/docs/handoff.md", PLANNER_ROOT, CWD), true);
  assert.equal(isPathInsidePlannerRoot("/repo/.planner", PLANNER_ROOT, CWD), true);
  assert.equal(isPathInsidePlannerRoot("/repo/not.planner-really/x.ts", PLANNER_ROOT, CWD), false);
  assert.equal(isPathInsidePlannerRoot("/repo/src/.planner-lookalike/x.ts", PLANNER_ROOT, CWD), false);
  assert.equal(isPathInsidePlannerRoot("/repo/.plannerother/x.ts", PLANNER_ROOT, CWD), false);
});

test("isPathInsidePlannerRoot rejects a path outside the repository entirely", () => {
  assert.equal(isPathInsidePlannerRoot("/etc/passwd", PLANNER_ROOT, CWD), false);
});

test("extractBashWriteTargets is best-effort and a computed heredoc target is not silently trusted as inside the planner root", () => {
  const command = 'python3 - <<PY > "$OUT_FILE"\nprint("hi")\nPY';
  const targets = extractBashWriteTargets(command);
  // Whatever is extracted (if anything) must not resolve as "entirely inside
  // the planner root" purely because the literal redirect target is a shell
  // variable rather than a real path — that must fall through to the normal
  // in-progress/bypass checks, never a silent allow.
  assert.equal(targets.length > 0 && targets.every((target) => isPathInsidePlannerRoot(target, PLANNER_ROOT, CWD)), false);
  assert.equal(noTaskWarning(event({ toolName: "Bash", command }), baseState).warning === undefined, false);
});

test("the result is only ever a warning: never a permission decision", () => {
  const warned = noTaskWarning(event({ filePath: "/repo/src/index.ts" }), baseState);
  const silent = noTaskWarning(event({ filePath: "/repo/.planner/x.json" }), baseState);
  assert.deepEqual(Object.keys(warned), ["warning"]);
  assert.deepEqual(Object.keys(silent), []);
});

test("Pi's lowercase tool names follow the same rule", () => {
  assert.equal(typeof noTaskWarning(event({ toolName: "edit", filePath: "/repo/src/a.ts" }), baseState).warning, "string");
  assert.equal(typeof noTaskWarning(event({ toolName: "bash", command: "echo x > /repo/src/a.ts" }), baseState).warning, "string");
  assert.equal(noTaskWarning(event({ toolName: "bash", command: "ls 2>/dev/null" }), baseState).warning, undefined);
  assert.equal(noTaskWarning(event({ toolName: "write", filePath: "/repo/.planner/docs/a.md" }), baseState).warning, undefined);
});

test("without an obvious task the warning still says how to start one", () => {
  const { focusTask, ...state } = baseState;
  assert.match(noTaskWarning(event({ filePath: "/repo/src/a.ts" }), state).warning, /\/planner task start <task>/);
});
