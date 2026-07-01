import { useLoaderData } from "react-router-dom";
import { Card } from "../components/ui/card";
import { FormattedText } from "../components/ui/formatted-text";
import { getHandoff } from "../lib/api";
import type { HandoffDocument } from "../lib/types";

function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export async function loader() {
  return getHandoff();
}

export function HandoffRoute() {
  const handoff = useLoaderData() as HandoffDocument;

  return (
    <Card className="grid gap-4">
      <div>
        <h2 className="text-lg font-bold text-[var(--text)]">Handoff</h2>
        <p className="text-sm text-[var(--text-muted)]">Canonical session handoff from <code>.planner/HANDOFF.md</code>.</p>
      </div>

      {handoff.exists ? (
        <>
          <div className="grid gap-1 text-sm text-[var(--text-muted)] md:grid-cols-2">
            <div>Created: <span className="text-[var(--text)]">{formatDateTime(handoff.createdAt)}</span></div>
            <div>Updated: <span className="text-[var(--text)]">{formatDateTime(handoff.updatedAt)}</span></div>
          </div>
          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-5 py-5">
            <FormattedText text={handoff.content} className="max-w-none" />
          </div>
        </>
      ) : (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">No handoff file present.</p>
      )}
    </Card>
  );
}
