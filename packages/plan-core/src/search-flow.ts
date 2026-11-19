/**
 * Plan search (P128(F025)/T490 — search family).
 *
 * One query across the operating truth: features, phases, tasks,
 * requirements, accepted decisions, ideas and planner Markdown
 * documents. Each hit carries its canonical ref so a client can act on
 * the result without a second lookup. Matching, ranking and snippets are
 * domain behavior: adapters only wrap the outcome.
 */

import { featureNumberOfPhase, formatFeatureRef, formatIdeaRef, formatPhaseRef, taskCompositeRef } from "./naming.js";
import { listPlannerDocuments, readPlannerDocument } from "./planner-doc.js";
import type { AcceptedDecision, Feature, Phase, PlanStore, Task } from "./index.js";

/** Minimum meaningful query length; one character matches almost everything. */
export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 100;
/** Documents larger than this are skipped: a search is not a full-file transfer. */
export const SEARCH_MAX_DOCUMENT_BYTES = 256 * 1024;
/** Chars of context kept around a match. */
const SNIPPET_RADIUS = 70;

export type SearchHitType =
  | "feature"
  | "phase"
  | "task"
  | "requirement"
  | "accepted-decision"
  | "idea"
  | "document";

export interface SearchHit {
  type: SearchHitType;
  /** Canonical ref of the hit (F00x, P00x(F00x), P00x(F00x)/T00x, I00x, doc path, or entity id). */
  ref: string;
  title: string;
  /** Matched context, whitespace-collapsed, bounded around the first match. */
  snippet: string;
  /** Field names that matched, in the order they were checked. */
  matchedFields: string[];
  /** For accepted decisions: the entity that owns the decision. */
  ownerRef?: string;
}

export interface SearchOutcome {
  query: string;
  hits: SearchHit[];
  /** Hits found before the limit was applied. */
  total: number;
  /** True when `total` exceeds the returned hits. */
  truncated: boolean;
  /** Documents skipped because they exceed SEARCH_MAX_DOCUMENT_BYTES. */
  skippedDocuments: number;
}

export type SearchFlowRefusal = {
  ok: false;
  code: "SEARCH_QUERY_TOO_SHORT";
  message: string;
};

type Field = [field: string, value: string];

const TYPE_ORDER: Record<SearchHitType, number> = {
  feature: 0,
  phase: 1,
  task: 2,
  requirement: 3,
  "accepted-decision": 4,
  idea: 5,
  document: 6,
};

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function snippetAround(value: string, needle: string, fallbackIndex: number): string {
  const flat = collapse(value);
  const flatIndex = flat.toLowerCase().indexOf(needle);
  const position = flatIndex >= 0 ? flatIndex : Math.max(0, Math.min(fallbackIndex, flat.length));
  const start = Math.max(0, position - SNIPPET_RADIUS);
  const end = Math.min(flat.length, position + needle.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** Check every field in order; the first match decides the snippet. */
function matchFields(fields: Field[], needle: string): { matchedFields: string[]; snippet: string } | null {
  const matchedFields: string[] = [];
  let snippet = "";
  for (const [field, value] of fields) {
    if (!value) continue;
    const index = value.toLowerCase().indexOf(needle);
    if (index < 0) continue;
    matchedFields.push(field);
    if (!snippet) snippet = snippetAround(value, needle, index);
  }
  return matchedFields.length > 0 ? { matchedFields, snippet } : null;
}

function rankOf(hit: SearchHit, needle: string): number {
  if (hit.ref.toLowerCase() === needle) return 0;
  if (hit.title.toLowerCase().includes(needle)) return 1;
  return 2;
}

function decisionHit(decision: AcceptedDecision, ownerRef: string, needle: string): SearchHit | null {
  const matched = matchFields([
    ["title", decision.title],
    ["decision", decision.decision],
    ["rationale", decision.rationale],
    ["implementationNotes", decision.implementationNotes],
  ], needle);
  if (!matched) return null;
  return { type: "accepted-decision", ref: decision.id, title: decision.title, ownerRef, ...matched };
}

/**
 * Search the plan. Empty or one-character queries are refused instead of
 * returning the entire document set.
 */
export async function searchPlan(store: PlanStore, query: string, limit?: number | undefined): Promise<({ ok: true } & SearchOutcome) | SearchFlowRefusal> {
  const needle = query.trim().toLowerCase();
  if (needle.length < SEARCH_MIN_QUERY_LENGTH) {
    return {
      ok: false,
      code: "SEARCH_QUERY_TOO_SHORT",
      message: `Search query must be at least ${SEARCH_MIN_QUERY_LENGTH} characters.`,
    };
  }
  const effectiveLimit = Math.max(1, Math.min(limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT));

  const [features, phases, requirementsDocument, ideasDocument, project] = await Promise.all([
    store.loadFeatures(),
    store.loadAllPhases(),
    store.loadRequirements(),
    store.loadIdeas(),
    store.loadProject(),
  ]);

  const hits: SearchHit[] = [];
  const push = (hit: SearchHit | null) => {
    if (hit) hits.push(hit);
  };

  for (const decision of project.acceptedDecisions) push(decisionHit(decision, "project", needle));

  for (const feature of features.features as Feature[]) {
    const ref = formatFeatureRef(feature.number);
    const matched = matchFields([
      ["ref", ref],
      ["shortId", feature.shortId],
      ["name", feature.name],
      ["description", feature.description],
    ], needle);
    if (matched) hits.push({ type: "feature", ref, title: feature.name, ...matched });
    for (const decision of feature.acceptedDecisions) push(decisionHit(decision, ref, needle));
  }

  for (const phase of phases as Phase[]) {
    const featureNumber = featureNumberOfPhase(phase, features.features);
    const ref = formatPhaseRef(phase.number, featureNumber);
    const matched = matchFields([
      ["ref", ref],
      ["shortId", phase.shortId],
      ["title", phase.title],
      ["summary", phase.summary],
      ["description", phase.description],
    ], needle);
    if (matched) hits.push({ type: "phase", ref, title: phase.title, ...matched });
    for (const decision of phase.acceptedDecisions) push(decisionHit(decision, ref, needle));
    for (const task of phase.tasks as Task[]) {
      const taskRef = taskCompositeRef(task, phase, features.features);
      const taskMatched = matchFields([
        ["ref", taskRef],
        ["shortId", task.shortId],
        ["title", task.title],
        ["description", task.description],
        ["notes", task.notes],
      ], needle);
      if (taskMatched) hits.push({ type: "task", ref: taskRef, title: task.title, ...taskMatched });
      for (const decision of task.acceptedDecisions) push(decisionHit(decision, taskRef, needle));
    }
  }

  for (const requirement of requirementsDocument.requirements) {
    const matched = matchFields([
      ["title", requirement.title],
      ["description", requirement.description],
    ], needle);
    if (matched) hits.push({ type: "requirement", ref: requirement.id, title: requirement.title, ...matched });
  }

  for (const idea of ideasDocument.ideas) {
    const matched = matchFields([
      ["ref", formatIdeaRef(idea.number)],
      ["title", idea.title],
      ["description", idea.description],
    ], needle);
    if (matched) hits.push({ type: "idea", ref: formatIdeaRef(idea.number), title: idea.title, ...matched });
  }

  let skippedDocuments = 0;
  for (const document of await listPlannerDocuments(store.root)) {
    if (document.size > SEARCH_MAX_DOCUMENT_BYTES) {
      skippedDocuments += 1;
      continue;
    }
    const content = await readPlannerDocument(store.root, document.path).catch(() => null);
    if (!content) continue;
    const matched = matchFields([["content", content.content]], needle);
    if (matched) hits.push({ type: "document", ref: document.path, title: document.path, ...matched });
  }

  hits.sort((left, right) => rankOf(left, needle) - rankOf(right, needle)
    || TYPE_ORDER[left.type] - TYPE_ORDER[right.type]
    || left.ref.localeCompare(right.ref));

  return {
    ok: true,
    query: query.trim(),
    hits: hits.slice(0, effectiveLimit),
    total: hits.length,
    truncated: hits.length > effectiveLimit,
    skippedDocuments,
  };
}
