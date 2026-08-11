import { Link, useLoaderData } from "react-router-dom";
import { Accordion } from "../components/ui/accordion";
import { Card } from "../components/ui/card";
import { FormattedText } from "../components/ui/formatted-text";
import { CopyableBadge } from "../components/ui/badges";
import { listArchivedHandoffs } from "../lib/api";
import type { ArchivedHandoffSummary } from "../lib/types";

function formatDateTime(value: string): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export async function loader() {
  return { archived: await listArchivedHandoffs() };
}

export function HandoffArchiveRoute() {
  const { archived } = useLoaderData() as { archived: ArchivedHandoffSummary[] };

  if (archived.length === 0) {
    return (
      <Card className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-[var(--text)]">Archived handoffs</h1>
            <p className="text-sm text-[var(--text-muted)]">Completed, superseded, and manually cleared handoffs.</p>
          </div>
          <Link to="/handoff" className="text-sm text-[var(--accent)] underline-offset-2 hover:underline">← Pending handoffs</Link>
        </div>
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">No archived handoffs.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-[var(--text)]">Archived handoffs</h1>
          <p className="text-sm text-[var(--text-muted)]">{archived.length} archived entries. These are history, not pending resume context.</p>
        </div>
        <Link to="/handoff" className="text-sm text-[var(--accent)] underline-offset-2 hover:underline">← Pending handoffs</Link>
      </div>
      {archived.map((handoff) => (
        <Card key={`${handoff.phaseId}:${handoff.file}`} className="overflow-hidden p-0">
          <Accordion
            defaultOpen={false}
            title={(
              <>
                <CopyableBadge id={handoff.compositeRef}>{handoff.compositeRef}</CopyableBadge>
                <span className="text-xs font-normal text-[var(--text-muted)]">Archived {formatDateTime(handoff.archivedAt)}</span>
              </>
            )}
            subtitle={handoff.firstLine || "Empty archived handoff."}
            contentClassName="px-5 py-5"
          >
            <div className="mb-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
              <span>Reason: {handoff.reason || "unknown"}</span>
              <span className="break-all">File: {handoff.file}</span>
            </div>
            <FormattedText text={handoff.content || "(archive file unavailable)"} className="formatted-text max-w-none" />
          </Accordion>
        </Card>
      ))}
    </div>
  );
}
