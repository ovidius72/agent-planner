/**
 * Shared text-truncation primitive. Lives in its own module, with no
 * dependency on handoff-context.ts or task-context.ts, because both of
 * those files need it and importing it from either one into the other
 * would create a cycle (handoff-context.ts already imports buildPhaseWorkMap
 * from task-context.ts).
 *
 * This is the one place that decides where an oversized string breaks. Three
 * call sites each carried their own raw `slice(0, maxChars)` before this
 * existed — handoff prose, mutation-reply echoes, and the Accepted Decision
 * context — and a raw slice cuts mid-word ("Ownershi|p") or mid-list-item.
 * A fourth independent copy is not an option; every caller that needs to
 * bound arbitrary prose for transport imports this.
 */

/**
 * Truncate `value` to at most `maxChars`, cutting at the nearest paragraph
 * break, then line break, then word boundary before the limit — never
 * mid-word and never mid-list-item. Falls back to a hard cut at `maxChars`
 * only when no boundary exists before it (e.g. one word longer than the
 * limit), so the result is never empty when `maxChars > 0`.
 */
export function truncateAtSafeBoundary(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  const slice = value.slice(0, maxChars);
  const paragraphBreak = slice.lastIndexOf("\n\n");
  const lineBreak = slice.lastIndexOf("\n");
  const wordBreak = slice.lastIndexOf(" ");
  const cut = paragraphBreak >= 0 ? paragraphBreak : lineBreak >= 0 ? lineBreak : wordBreak >= 0 ? wordBreak : maxChars;
  return slice.slice(0, cut).trimEnd();
}

/** Truncate `content` to at most `maxChars` at a safe boundary (see
 * truncateAtSafeBoundary) and report whether a cut happened. Callers append
 * their own contextual continuation message — this stays message-agnostic
 * so every caller shares one truncation rule without sharing wording that
 * fits only one of them. */
export function boundedContentForTransport(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  return { content: truncateAtSafeBoundary(content, maxChars), truncated: true };
}
