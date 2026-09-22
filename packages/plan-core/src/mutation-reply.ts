/**
 * Shared reply shaping for every mutation tool (update, discuss, and the
 * small mutations around them).
 *
 * The rule this file exists to hold: a mutation result says what changed.
 * It does not say what the entity now contains. Before P104(F005)/T417 each
 * adapter hand-built `{ ...entity, updated: true }`, so changing one field
 * on this repository's own P104 returned 139,805 characters — every task
 * body in the phase, echoed back to a caller who already knew them. A task
 * update peaked at 33,499. The harness had to spill those results to a file,
 * and reading back whether `updated` was true then needed jq.
 *
 * The bound lives here rather than in an adapter for the reason in AGENTS.md
 * rule 4: both adapters render what the core returns, so neither can drift
 * and a third harness inherits the bound without knowing it exists. Four
 * separate defects in P104 came from logic duplicated per adapter.
 *
 * Channel discipline matches handoff-reply.ts: `text` is the human-readable
 * body, `structured` is the machine-readable payload, and no field is
 * carried by both.
 */
import { truncateAtSafeBoundary } from "./text-bounds.js";
import type { PlannerPayloadEntity, PlannerPayloadOperation } from "./payload-fallback.js";

/**
 * Per-field echo budget. A changed field is worth showing back so the caller
 * can confirm what landed without a second call; a changed field the size of
 * a task description is not. 2,000 characters is about three screens — long
 * enough to read a title, a status, a checklist or a short note whole, short
 * enough that echoing a full description is impossible.
 */
export const MUTATION_ECHO_MAX_FIELD_CHARS = 2_000;

/**
 * Ceiling for the whole structured payload of a mutation reply. Chosen to
 * match MAX_PHASE_WORK_MAP_CHARS and MAX_ACCEPTED_DECISION_CONTEXT_CHARS so
 * an agent has one number in mind for planner payloads rather than four.
 * When the assembled payload exceeds it, echoed values are dropped to names
 * (see `boundMutationEcho`) — the caller still learns exactly which fields
 * changed, which is the part it cannot get anywhere else.
 */
export const MUTATION_REPLY_MAX_CHARS = 8_000;

/**
 * The long-text size a planner tool accepts in one call, stated up front so
 * a caller does not discover it by being rejected. This is not a limit the
 * planner imposes for its own sake: a long `description` can be dropped by
 * the transport before it ever reaches the planner, which arrives here as
 * "no mutable fields received" and is why DESCRIPTION_MARKDOWN_FALLBACK_REQUIRED
 * exists. Measured: ~13,500 characters accepted, ~17,000 rejected. 12,000 is
 * under the observed floor with room to spare.
 *
 * Above this, write the prose to a committed file under `.planner/docs/` and
 * pass `descriptionRef` — see suggestedDescriptionRefPath in payload-fallback.ts.
 */
export const PLANNER_LONG_TEXT_FIELD_MAX_CHARS = 12_000;

/**
 * One sentence for a tool description, so the limit is discoverable at the
 * point of the call instead of after it fails. Every tool taking a long text
 * field appends this to its own description.
 */
export function longTextFieldLimitNotice(field = "description"): string {
  return `Keep ${field} under ${PLANNER_LONG_TEXT_FIELD_MAX_CHARS.toLocaleString("en-US")} characters; above that the transport may drop it before it arrives. Put longer prose in a committed .planner/docs/ file and pass ${field}Ref instead.`;
}

/** A tool reply as one result: the human-readable body and the structured
 * payload, with no field present in both. */
export interface MutationReply {
  text: string;
  structured: Record<string, unknown>;
}

/** Who was mutated, in the terms a caller refers to it by. The canonical
 * `ref` is what travels — never the raw text the caller happened to type,
 * which may be a short id, a title or a UUID. */
export interface MutationIdentity {
  entity: PlannerPayloadEntity;
  ref: string;
  id?: string;
  shortId?: string;
  title?: string;
  status?: string;
}

export interface MutationReplyInput {
  identity: MutationIdentity;
  operation: PlannerPayloadOperation;
  /** Fields the caller actually changed, in the order they were received. */
  updatedFields: readonly string[];
  /** The persisted values of those fields, to be echoed back within budget.
   * Keys outside `updatedFields` are ignored: a mutation reply never carries
   * a field the mutation did not touch. */
  changedValues?: Record<string, unknown>;
  /** Diagnostics that are not the entity — description freshness, stale
   * parents, lost checklist ticks, resume-required notices. These are the
   * reason to read a mutation result at all, so they are never trimmed. */
  extras?: Record<string, unknown>;
  /** Extra lines for the human channel, such as a lost-tick warning. */
  notices?: readonly string[];
  /** The command that returns the full entity, for a caller that wants what
   * this reply deliberately leaves out. */
  readBackCommand?: string;
}

interface BoundedValue {
  value: unknown;
  truncated: boolean;
}

/**
 * Bound one echoed value. A short string travels whole. A long one is cut at
 * a safe boundary — paragraph, then line, then word, the same helper the
 * handoff path uses — and reports its true length, so a caller can tell a
 * 2,000-character field from a 20,000-character one without receiving either
 * in full. Arrays and objects are measured by their serialized size and
 * degrade to a count rather than a preview, because half an array read as
 * whole is worse than no array at all.
 */
function boundEchoedValue(value: unknown): BoundedValue {
  if (typeof value === "string") {
    if (value.length <= MUTATION_ECHO_MAX_FIELD_CHARS) return { value, truncated: false };
    const bounded = truncateAtSafeBoundary(value, MUTATION_ECHO_MAX_FIELD_CHARS);
    return {
      value: { preview: bounded, fullLength: value.length, truncated: true },
      truncated: true,
    };
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return { value, truncated: false };
  }
  const serialized = JSON.stringify(value) ?? "";
  if (serialized.length <= MUTATION_ECHO_MAX_FIELD_CHARS) return { value, truncated: false };
  if (Array.isArray(value)) {
    return { value: { count: value.length, serializedLength: serialized.length, truncated: true }, truncated: true };
  }
  return { value: { keys: Object.keys(value), serializedLength: serialized.length, truncated: true }, truncated: true };
}

/**
 * Assemble the echo of changed fields within the reply ceiling. Fields are
 * taken in the order the caller changed them and the budget is shared, so
 * one large field cannot crowd out the rest: what does not fit is named in
 * `omittedValues` rather than silently dropped. Naming what was left out is
 * the same degradation the prepare path uses — elided must never mean
 * invisible.
 */
function boundMutationEcho(
  updatedFields: readonly string[],
  changedValues: Record<string, unknown>,
  budget: number,
): { changed: Record<string, unknown>; omittedValues: string[]; truncatedFields: string[] } {
  const changed: Record<string, unknown> = {};
  const omittedValues: string[] = [];
  const truncatedFields: string[] = [];
  let remaining = budget;
  for (const field of updatedFields) {
    if (!(field in changedValues)) continue;
    const bounded = boundEchoedValue(changedValues[field]);
    const cost = (JSON.stringify(bounded.value) ?? "").length + field.length + 4;
    if (cost > remaining) {
      omittedValues.push(field);
      continue;
    }
    remaining -= cost;
    changed[field] = bounded.value;
    if (bounded.truncated) truncatedFields.push(field);
  }
  return { changed, omittedValues, truncatedFields };
}

/**
 * Build the one reply every mutation tool returns.
 *
 * What a caller gets: that the write happened, which fields it touched, the
 * canonical ref and identity of what it touched, the changed values within
 * budget, and every diagnostic. What it does not get: the rest of the
 * entity, which it can read with the command named in `readBack`.
 *
 * `updated` (or `discussed`), `updatedFields` and any `errorCode` keep their
 * exact prior shape — mutation-integrity checking across the whole project
 * reads those three and nothing else.
 */
export function buildMutationReply(input: MutationReplyInput): MutationReply {
  const { identity, operation, updatedFields } = input;
  const fields = [...updatedFields];
  const extras = input.extras ?? {};

  const identityPayload: Record<string, unknown> = {
    entity: identity.entity,
    ref: identity.ref,
    ...(identity.id ? { id: identity.id } : {}),
    ...(identity.shortId ? { shortId: identity.shortId } : {}),
    ...(identity.title ? { title: identity.title } : {}),
    ...(identity.status ? { status: identity.status } : {}),
  };

  // Everything except the echo is non-negotiable, so the echo gets whatever
  // the ceiling leaves once identity, fields and diagnostics are counted.
  const fixedCost = (JSON.stringify({ ...identityPayload, updatedFields: fields, ...extras }) ?? "").length;
  const { changed, omittedValues, truncatedFields } = boundMutationEcho(
    fields,
    input.changedValues ?? {},
    Math.max(0, MUTATION_REPLY_MAX_CHARS - fixedCost),
  );

  const structured: Record<string, unknown> = {
    ...(operation === "discuss" ? { discussed: true as const } : { updated: true as const }),
    ...identityPayload,
    updatedFields: fields,
    ...(Object.keys(changed).length > 0 ? { changed } : {}),
    ...(truncatedFields.length > 0 ? { truncatedFields } : {}),
    ...(omittedValues.length > 0 ? { omittedValues } : {}),
    ...extras,
    ...(input.readBackCommand ? { readBack: input.readBackCommand } : {}),
  };

  const descriptor = [identity.ref, identity.title].filter(Boolean).join(" — ");
  const statusSuffix = identity.status ? ` (${identity.status})` : "";
  const shortIdSuffix = identity.shortId ? ` · ${identity.shortId}` : "";
  const verb = operation === "discuss" ? "discussed/updated" : "updated";
  const entityLabel = identity.entity.charAt(0).toUpperCase() + identity.entity.slice(1);
  const lines = [
    `✅ ${entityLabel} ${verb}: ${descriptor}${statusSuffix}${shortIdSuffix}. Fields saved: ${fields.join(", ")}.`,
    ...(input.notices ?? []).filter((notice) => notice.trim().length > 0),
  ];

  return { text: lines.join(" "), structured };
}
