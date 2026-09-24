import test from "node:test";
import assert from "node:assert/strict";
import { DescriptionRefSchema, isPlannerDescriptionRef } from "../dist/index.js";

const directReference = ".planner/docs/p094-pane-hosts-any-app.md";

test("descriptionRef accepts a Markdown file directly under .planner/docs", () => {
  assert.equal(isPlannerDescriptionRef(directReference), true);
  assert.equal(DescriptionRefSchema.parse(directReference), directReference);
  assert.equal(isPlannerDescriptionRef(".planner/docs/phases/p094-pane-hosts-any-app.md"), true);
});

test("descriptionRef rejects paths outside planner docs and unsafe segments", () => {
  for (const value of [
    "p094-pane-hosts-any-app.md",
    "docs/p094-pane-hosts-any-app.md",
    ".planner/docs/",
    ".planner/docs//p094-pane-hosts-any-app.md",
    ".planner/docs/./p094-pane-hosts-any-app.md",
    ".planner/docs/../p094-pane-hosts-any-app.md",
    ".planner/docs/phases/../../p094-pane-hosts-any-app.md",
    ".planner\\docs\\p094-pane-hosts-any-app.md",
    ".planner/docs/p094-pane-hosts-any-app.md\0ignored",
  ]) {
    assert.equal(isPlannerDescriptionRef(value), false, value);
    assert.equal(DescriptionRefSchema.safeParse(value).success, false, value);
  }
});
