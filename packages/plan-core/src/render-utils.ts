import type { AcceptedDecision } from "./schema.js";

export function bullet(lines: string[], indent = 0): string {
  return lines.length > 0
    ? lines.map((l) => `${"  ".repeat(indent)}- ${l}`).join("\n")
    : `${"  ".repeat(indent)}- _none_`;
}

export function statusBadge(status: string): string {
  const icons: Record<string, string> = {
    draft: "📄",
    discovery: "🔍",
    planned: "📋",
    "in-progress": "🚧",
    done: "✅",
    blocked: "🚫",
    canceled: "❌",
    rejected: "❌",
    deferred: "⏸️",
    waiting: "⏳",
  };
  return `${icons[status] ?? "❓"} \`${status}\``;
}

export function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    draft: "📄",
    discovery: "🔍",
    planned: "📋",
    "in-progress": "🚧",
    done: "✅",
    blocked: "🚫",
    canceled: "❌",
    rejected: "❌",
    deferred: "⏸️",
    waiting: "⏳",
  };
  return icons[status] ?? "❓";
}

export function renderAcceptedDecisions(decisions: AcceptedDecision[]): string[] {
  const lines: string[] = [];
  for (const entry of decisions) {
    lines.push(`- **${entry.title}**`);
    if (entry.decision) lines.push(`  - Decision: ${entry.decision}`);
    if (entry.rationale) lines.push(`  - Rationale: ${entry.rationale}`);
    if (entry.implementationNotes) lines.push(`  - Implementation: ${entry.implementationNotes}`);
    lines.push(`  - Accepted at: ${entry.acceptedAt}`);
  }
  return lines;
}
