import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNER_LOAD_AGENT_HEADING,
  PLANNER_LOAD_RECAP_HEADING,
  buildPlannerLoadReply,
  splitPlannerLoadText,
} from "../dist/index.js";

const recap = "## Planner recap\nProject: Fixture\n\n## Web UI\n🌐 Web UI: http://127.0.0.1:1234";
const projectContext = {
  text: "Project context v1\nName: Fixture\nGoal: Ship it\nRequirements (1):\n  - Users can authenticate",
  structured: { loaded: true, contextComplete: true, fingerprint: "f".repeat(64), requirementCount: 1 },
};
const scopedDecisions = { content: "Accepted decisions — feature F001 (1):\n  - Feature decision", total: 1, truncated: false };
const guideBody = "# Agent Plan operating guide\n\n## Handoff protocol\n" + "guide text ".repeat(2_000);

const pointer = { mode: "pointer", path: ".planner/SKILL.md", customized: false, message: "" };
const include = { mode: "include", content: guideBody, customized: false, message: "" };

// Headings, section titles and the guide pointer line: everything that is
// not one of the input pieces. If a piece is ever sent twice, the reply
// outgrows this budget.
const LAYOUT_BUDGET = 600;

test("each piece is sent once: the reply is its parts plus a small fixed layout", () => {
  const reply = buildPlannerLoadReply({ recap, projectContext, scopedDecisions, plannerGuide: pointer });
  const parts = recap.length + projectContext.text.length + scopedDecisions.content.length;
  assert.ok(reply.text.length <= parts + LAYOUT_BUDGET, `load reply is ${reply.text.length} chars for ${parts} chars of content`);
  assert.equal(reply.text.split("Users can authenticate").length - 1, 1);
  assert.equal(reply.text.split("Feature decision").length - 1, 1);
  assert.doesNotMatch(JSON.stringify(reply.structured), /Users can authenticate|Feature decision|Project: Fixture/, "structured carries status only, never a second copy");
});

test("pointer mode never sends the guide body; include mode sends it once", () => {
  const pointed = buildPlannerLoadReply({ recap, projectContext, plannerGuide: pointer });
  assert.doesNotMatch(pointed.text, /## Handoff protocol/);
  assert.match(pointed.text, /read \.planner\/SKILL\.md/);

  const included = buildPlannerLoadReply({ recap, projectContext, plannerGuide: include });
  assert.equal(included.text.split("## Handoff protocol").length - 1, 1);
  assert.ok(included.text.length <= recap.length + projectContext.text.length + guideBody.length + LAYOUT_BUDGET);
});

test("the recap comes first and splits cleanly from the agent-only context", () => {
  const reply = buildPlannerLoadReply({ recap, projectContext, scopedDecisions, plannerGuide: pointer });
  assert.ok(reply.text.startsWith(PLANNER_LOAD_RECAP_HEADING));
  assert.ok(reply.text.indexOf(PLANNER_LOAD_AGENT_HEADING) > reply.text.indexOf(recap));
  const split = splitPlannerLoadText(reply.text);
  assert.equal(split.recap, recap);
  assert.match(split.agentContext, /Users can authenticate/);
  assert.doesNotMatch(split.recap, /Users can authenticate|Feature decision|SKILL\.md/);
});

test("an incomplete project context is reported, not padded", () => {
  const incomplete = {
    text: "Project context exceeds the 100-character single-response bound.",
    structured: { loaded: false, contextComplete: false, nextActions: ["Retry planner-load with a larger maxChars."] },
  };
  const reply = buildPlannerLoadReply({ recap, projectContext: incomplete, plannerGuide: pointer });
  assert.equal(reply.structured.projectContext.contextComplete, false);
  assert.match(reply.text, /exceeds the 100-character/);
});
