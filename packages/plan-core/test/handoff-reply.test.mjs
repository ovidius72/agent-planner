/**
 * T412 (P103/F005) — Pin handoff reply size and the no-duplication invariant.
 *
 * `handoff-reply.ts` documents one rule in its header: the text channel and
 * the structured payload never both carry the same field. Until now nothing
 * enforced it, and every payload figure in P103 was measured by hand, so a
 * whole array could reappear in a reply and no test would notice.
 *
 * These tests build their fixtures in memory. They read no planner directory.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FeatureSchema,
  PhaseSchema,
  createFeatureId,
  createPhaseId,
  createTaskId,
  auditPhaseHandoff,
  buildPhaseWorkMap,
  buildHandoffShowReply,
  buildHandoffPrepareReply,
  handoffContentHash,
  HANDOFF_COMPLETENESS_AUDIT_VERSION,
} from "../dist/index.js";

const NOW = "2026-01-01T00:00:00.000Z";

/**
 * Measured on heca P082 (56 tasks, 5,634-character handoff) after T411:
 * show structured 850 chars, prepare structured 10,890. These ceilings are
 * roughly double the fixture's own figures, so an ordinary wording edit
 * passes and a reappearing array does not.
 */
const SHOW_STRUCTURED_CEILING = 2_000;
const PREPARE_STRUCTURED_CEILING = 24_000;

/** A phase whose task list runs well past the 8,000-character work-map budget. */
function bigPhase({ handoff = "", handoffAudit = null } = {}) {
  const feature = FeatureSchema.parse({
    id: createFeatureId(), number: 5, name: "Feature", description: "Scope", createdAt: NOW, updatedAt: NOW,
  });
  const phaseId = createPhaseId();
  const tasks = Array.from({ length: 40 }, (_, index) => ({
    id: createTaskId(),
    number: index + 1,
    phaseId,
    shortName: `task-${index + 1}`,
    title: `Task ${index + 1} with a title long enough to take real space in the rendered map`,
    status: index % 3 === 0 ? "done" : "planned",
    description: `Goal ${index + 1}: ${"execution context that fills the concise goal line. ".repeat(4)}`,
    createdAt: NOW,
    updatedAt: NOW,
  }));
  const phase = PhaseSchema.parse({
    id: phaseId, number: 82, featureId: feature.id, slug: "phase", title: "Phase",
    description: "Phase scope", createdAt: NOW, updatedAt: NOW,
    tasks, taskIds: tasks.map((task) => task.id),
    handoff, handoffUpdatedAt: handoff ? NOW : "", handoffAudit,
  });
  return { feature, phase };
}

function auditFixture(content) {
  return {
    version: HANDOFF_COMPLETENESS_AUDIT_VERSION,
    contentHash: handoffContentHash(content),
    contentLength: content.length,
    verifiedAt: NOW,
    resumeReadyAt: NOW,
    supportingDocuments: [],
    // Planner-owned legacy evidence: large, and must never reach a reply.
    entries: Array.from({ length: 18 }, (_, index) => ({
      category: `category-${index}`,
      status: "captured",
      detail: `Evidence detail ${index}: ${"recorded from persisted state. ".repeat(6)}`,
    })),
    coldStartInventory: {
      version: 1,
      sourceReviews: Array.from({ length: 5 }, (_, index) => ({
        source: `source-${index}`,
        detail: `Reviewed against the persisted body. ${"No missing resume fact was found. ".repeat(3)}`,
      })),
      entries: Array.from({ length: 14 }, (_, index) => ({
        category: `inventory-${index}`,
        detail: `Item ${index} ${"with a concrete file and symbol reference. ".repeat(3)}`,
      })),
    },
    readBackSourceReviews: Array.from({ length: 5 }, (_, index) => ({
      source: `source-${index}`,
      detail: `Compared against the persisted body. ${"No missing resume fact was found. ".repeat(3)}`,
    })),
  };
}

/**
 * The shared invariant check. Every reply runs through this, so a future
 * third reply inherits it instead of needing its own copy.
 */
function assertNoChannelDuplication(reply, label) {
  const walk = (value, path) => {
    if (typeof value === "string") {
      // Short scalars (ids, hashes, timestamps, flags) legitimately appear in
      // both channels; only substantial prose is duplicated payload.
      if (value.length >= 200 && reply.text.includes(value)) {
        assert.fail(`${label}: ${path} (${value.length} chars) appears in both text and structured`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
    }
  };
  for (const [key, value] of Object.entries(reply.structured)) walk(value, key);
}

test("handoff show carries no field in both channels and stays small", () => {
  const body = `# Capsule\n\nResume at plan-store.ts:3746. ${"Detail line that a cold agent needs. ".repeat(120)}`;
  const { feature, phase } = bigPhase({ handoff: body, handoffAudit: auditFixture(body) });
  const workMap = buildPhaseWorkMap(phase, feature.number);
  const reply = buildHandoffShowReply({ kind: "active", phaseRef: "P082(F005)", phase, phaseWorkMap: workMap });

  assertNoChannelDuplication(reply, "show");

  // The body is prose and belongs to the text channel alone.
  assert.equal(Object.hasOwn(reply.structured, "content"), false);
  assert.ok(reply.text.includes("Detail line that a cold agent needs."));

  // The work map's JSON twin never travels; the rendered map is in the text.
  assert.equal(Object.hasOwn(reply.structured.phaseWorkMap, "entries"), false);
  assert.equal(reply.structured.phaseWorkMap.total, 40);
  assert.ok(reply.text.includes("Phase work map"));

  // The audit keeps its verification facts and sheds its legacy evidence.
  for (const dropped of ["entries", "coldStartInventory", "readBackSourceReviews"]) {
    assert.equal(Object.hasOwn(reply.structured.handoffAudit, dropped), false, dropped);
  }
  for (const kept of ["version", "contentHash", "contentLength", "resumeReadyAt", "supportingDocuments"]) {
    assert.equal(Object.hasOwn(reply.structured.handoffAudit, kept), true, kept);
  }

  const size = JSON.stringify(reply.structured).length;
  assert.ok(size < SHOW_STRUCTURED_CEILING, `show structured payload grew to ${size}`);
});

test("handoff prepare carries no field in both channels and stays bounded", () => {
  const body = `# Existing\n\nPrevious capsule. ${"Still-relevant detail to reconcile. ".repeat(80)}`;
  const { feature, phase } = bigPhase({ handoff: body, handoffAudit: auditFixture(body) });
  const audit = auditPhaseHandoff(phase, feature);
  const reply = buildHandoffPrepareReply({ phaseRef: "P082(F005)", audit });

  assertNoChannelDuplication(reply, "prepare");

  // Prepare renders the map nowhere else, so it keeps content but not the twin.
  assert.equal(Object.hasOwn(reply.structured.phaseWorkMap, "entries"), false);
  assert.ok(reply.structured.phaseWorkMap.content.includes("P082(F005)/T001"));

  // The scaffold lives in the structured payload; the text points at it.
  assert.ok(reply.structured.draftTemplate.length > 0);
  assert.equal(reply.text.includes(reply.structured.draftTemplate), false);

  // The existing body is prose: text only, with its measurements structured.
  assert.ok(reply.text.includes("Still-relevant detail to reconcile."));
  assert.equal(reply.structured.existingHandoffLength, body.length);

  for (const dropped of ["entries", "coldStartInventory", "readBackSourceReviews"]) {
    assert.equal(Object.hasOwn(reply.structured.existingCompletenessAudit, dropped), false, dropped);
  }

  const size = JSON.stringify(reply.structured).length;
  assert.ok(size < PREPARE_STRUCTURED_CEILING, `prepare structured payload grew to ${size}`);
});

// P104(F005)/T415 — handoff_prepare previously handed back only the compact
// remainder of an existing handoff, with no way to see what a prior
// auto-externalization had moved into .planner/docs/. These pin the fix:
// content is inlined into `text` (never `structured`, per the no-duplication
// invariant above) when it fits a shared budget, and every document is
// named — path, description, headings — even when it does not fit or the
// file is gone.
test("handoff prepare inlines an externalized document's content, text only", () => {
  const body = "# Existing\n\nCompact remainder.";
  const { feature, phase } = bigPhase({ handoff: body, handoffAudit: auditFixture(body) });
  const audit = {
    ...auditPhaseHandoff(phase, feature),
    externalizedHandoffDocuments: [{
      path: ".planner/docs/handoff-p082-test.md",
      description: "Full submitted handoff detail externalized automatically; required for cold resume and reconciliation.",
      headings: ["Current focus", "Current and partial state"],
      content: "Moved fact: the reporting session's two live code defects live only here.",
      contentLength: 74,
      missing: false,
    }],
  };
  const reply = buildHandoffPrepareReply({ phaseRef: "P082(F005)", audit });

  assertNoChannelDuplication(reply, "prepare/externalized");
  assert.ok(reply.text.includes("Moved fact: the reporting session's two live code defects live only here."));
  assert.ok(reply.text.includes(".planner/docs/handoff-p082-test.md"));
  assert.ok(reply.text.includes("Current focus"));

  assert.equal(Object.hasOwn(reply.structured, "externalizedHandoffDocuments"), false);
  assert.equal(reply.structured.existingHandoffExternalizedDocuments.length, 1);
  const [entry] = reply.structured.existingHandoffExternalizedDocuments;
  assert.equal(entry.path, ".planner/docs/handoff-p082-test.md");
  assert.equal(entry.inlined, true);
  assert.equal(entry.truncated, false);
  assert.equal(Object.hasOwn(entry, "content"), false);
});

test("handoff prepare names a missing externalized document without fabricating content", () => {
  const body = "# Existing\n\nCompact remainder.";
  const { feature, phase } = bigPhase({ handoff: body, handoffAudit: auditFixture(body) });
  const audit = {
    ...auditPhaseHandoff(phase, feature),
    externalizedHandoffDocuments: [{
      path: ".planner/docs/handoff-p082-gone.md",
      description: "Full submitted handoff detail externalized automatically; required for cold resume and reconciliation.",
      headings: [],
      content: null,
      contentLength: 9_074,
      missing: true,
    }],
  };
  const reply = buildHandoffPrepareReply({ phaseRef: "P082(F005)", audit });

  assert.ok(reply.text.includes(".planner/docs/handoff-p082-gone.md"));
  assert.match(reply.text, /not found on disk/i);
  assert.equal(reply.structured.existingHandoffExternalizedDocuments[0].missing, true);
  assert.equal(reply.structured.existingHandoffExternalizedDocuments[0].inlined, false);
});

test("handoff prepare shares one budget across several externalized documents instead of unbounded growth", () => {
  const body = "# Existing\n\nCompact remainder.";
  const { feature, phase } = bigPhase({ handoff: body, handoffAudit: auditFixture(body) });
  // Three documents from successive rewrites, each near the per-document
  // ceiling — mirrors the reporting phase's own P082 capsule, which had two
  // linked documents at once and where a single externalized draft can
  // already be as large as the ceiling.
  const bigDoc = (name) => ({
    path: `.planner/docs/${name}.md`,
    description: "Full submitted handoff detail externalized automatically; required for cold resume and reconciliation.",
    headings: ["Current and partial state"],
    content: `${name} detail. ${"Filler carried forward from an earlier rewrite. ".repeat(700)}`,
    contentLength: 24_000,
    missing: false,
  });
  const audit = {
    ...auditPhaseHandoff(phase, feature),
    externalizedHandoffDocuments: [bigDoc("first"), bigDoc("second"), bigDoc("third")],
  };
  const reply = buildHandoffPrepareReply({ phaseRef: "P082(F005)", audit });

  assertNoChannelDuplication(reply, "prepare/externalized-budget");
  // The combined inlined text stays bounded to roughly one more ceiling's
  // worth, not three — the third (and possibly the second) document must be
  // named without being fully inlined.
  const notFullyInlined = reply.structured.existingHandoffExternalizedDocuments
    .filter((entry) => !entry.inlined || entry.truncated);
  assert.ok(notFullyInlined.length > 0, "at least one document must not be fully inlined once the shared budget is exhausted");
  // Every document is still named even when its content is not.
  for (const name of ["first", "second", "third"]) {
    assert.ok(reply.text.includes(`.planner/docs/${name}.md`), `${name} must still be named`);
  }
  const size = JSON.stringify(reply.structured).length;
  assert.ok(size < PREPARE_STRUCTURED_CEILING, `prepare structured payload grew to ${size}`);
});

test("handoff show empty and archived branches shed the same evidence", () => {
  const body = "# Archived\n\nClosed out at the terminal outcome.";
  const audit = auditFixture(body);

  const empty = buildHandoffShowReply({ kind: "empty", phaseRef: "P082(F005)", phaseId: "phase-id", handoffAudit: audit });
  assertNoChannelDuplication(empty, "show/empty");
  assert.equal(Object.hasOwn(empty.structured.handoffAudit, "coldStartInventory"), false);

  const archived = buildHandoffShowReply({
    kind: "archived", phaseRef: "P082(F005)", phaseId: "phase-id", content: body,
    archiveReason: "phase-done", archivedAt: NOW, archiveFile: "archive.md", handoffAudit: audit,
  });
  assertNoChannelDuplication(archived, "show/archived");
  assert.equal(Object.hasOwn(archived.structured.handoffAudit, "entries"), false);
  assert.ok(archived.text.includes("Closed out at the terminal outcome."));
});

test("a null audit stays null rather than becoming empty fields", () => {
  const reply = buildHandoffShowReply({ kind: "empty", phaseRef: "P082(F005)", phaseId: "phase-id", handoffAudit: null });
  assert.equal(reply.structured.handoffAudit, null);
});
