import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGuardedTool,
  decideGuardPreToolUse,
  extractBashWriteTargets,
  isEntirelyInsidePlannerRoot,
  isPathInsidePlannerRoot,
  isWriteShapedBashCommand,
} from "../dist/index.js";

const CWD = "/repo";
const PLANNER_ROOT = "/repo/.planner";

const baseState = {
  hasPlannerDir: true,
  totalTasks: 3,
  hasInProgressTask: false,
  guardBypassed: false,
  startHint: " Start a task with /planner task start T1 (Do the thing), OR",
};

const event = (overrides = {}) => ({
  toolName: "Edit",
  cwd: CWD,
  plannerRoot: PLANNER_ROOT,
  ...overrides,
});

test("an Edit inside the planner root is allowed, even with no task in progress", () => {
  const decision = decideGuardPreToolUse(
    event({ filePath: "/repo/.planner/docs/handoff.md" }),
    baseState,
  );
  assert.equal(decision.decision, "allow");
});

test("an Edit outside the planner root asks, and names the concrete startHint task", () => {
  const decision = decideGuardPreToolUse(
    event({ filePath: "/repo/src/index.ts" }),
    baseState,
  );
  assert.equal(decision.decision, "ask");
  assert.match(decision.reason, /no task is in-progress/);
  assert.match(decision.reason, /outside \.planner\//);
  assert.match(decision.reason, /Start a task with \/planner task start T1 \(Do the thing\), OR/);
});

test("a task in-progress allows the edit outside the planner root", () => {
  const decision = decideGuardPreToolUse(
    event({ filePath: "/repo/src/index.ts" }),
    { ...baseState, hasInProgressTask: true },
  );
  assert.equal(decision.decision, "allow");
});

test("an authorized bypass allows the edit outside the planner root", () => {
  const decision = decideGuardPreToolUse(
    event({ filePath: "/repo/src/index.ts" }),
    { ...baseState, guardBypassed: true },
  );
  assert.equal(decision.decision, "allow");
});

test("no planner directory allows immediately", () => {
  const decision = decideGuardPreToolUse(
    event({ filePath: "/repo/src/index.ts" }),
    { ...baseState, hasPlannerDir: false },
  );
  assert.equal(decision.decision, "allow");
});

test("no tasks at all allows immediately", () => {
  const decision = decideGuardPreToolUse(
    event({ filePath: "/repo/src/index.ts" }),
    { ...baseState, totalTasks: 0 },
  );
  assert.equal(decision.decision, "allow");
});

test("read-only Bash (git status, build, ls, grep, find, cat) is allowed without touching planner state", () => {
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
    const decision = decideGuardPreToolUse(event({ toolName: "Bash", command }), baseState);
    assert.equal(decision.decision, "allow", `expected "${command}" to be allowed`);
  }
});

test("write-shaped Bash outside the planner root asks", () => {
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
    const decision = decideGuardPreToolUse(event({ toolName: "Bash", command }), baseState);
    assert.equal(decision.decision, "ask", `expected "${command}" to ask`);
  }
});

test("write-shaped Bash entirely inside the planner root is allowed", () => {
  const commands = [
    "echo hi > /repo/.planner/docs/handoff.md",
    "sed -i 's/a/b/' /repo/.planner/docs/handoff.md",
    "cp /repo/.planner/docs/a.md /repo/.planner/docs/b.md",
  ];
  for (const command of commands) {
    const decision = decideGuardPreToolUse(event({ toolName: "Bash", command }), baseState);
    assert.equal(decision.decision, "allow", `expected "${command}" to be allowed`);
  }
});

test("a Bash command touching both a planner and a non-planner path is not blanket-allowed", () => {
  // A single redirect target can only resolve to one path, so exercise the
  // extraction/allow check directly against a mixed pair.
  const inside = isEntirelyInsidePlannerRoot(
    ["/repo/.planner/docs/a.md", "/repo/src/b.ts"],
    PLANNER_ROOT,
    CWD,
  );
  assert.equal(inside, false);
});

test("a NotebookEdit outside the planner root asks; inside it is allowed", () => {
  const outside = decideGuardPreToolUse(
    event({ toolName: "NotebookEdit", notebookPath: "/repo/notebooks/a.ipynb" }),
    baseState,
  );
  assert.equal(outside.decision, "ask");

  const inside = decideGuardPreToolUse(
    event({ toolName: "NotebookEdit", notebookPath: "/repo/.planner/notebooks/a.ipynb" }),
    baseState,
  );
  assert.equal(inside.decision, "allow");
});

test("tools the guard does not cover (Read, Grep, MCP tools) are allowed without state", () => {
  for (const toolName of ["Read", "Grep", "Glob", "WebFetch", "mcp__agent-plan__planner-task-show"]) {
    const decision = decideGuardPreToolUse(event({ toolName, filePath: "/repo/src/index.ts" }), baseState);
    assert.equal(decision.decision, "allow");
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
  assert.equal(isEntirelyInsidePlannerRoot(targets, PLANNER_ROOT, CWD), false);
});
