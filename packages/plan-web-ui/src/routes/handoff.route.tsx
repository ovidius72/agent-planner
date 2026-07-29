import { useLoaderData, useLocation, Link } from "react-router-dom";
import { Card } from "../components/ui/card";
import { FormattedText } from "../components/ui/formatted-text";
import { listHandoffs } from "../lib/api";
import type { HandoffSummary } from "../lib/types";
import { CopyableBadge } from "../components/ui/badges";
import { useEffect, useState } from "react";

function formatDateTime(value: string): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export async function loader() {
  return { handoffs: await listHandoffs() };
}

export function HandoffRoute() {
  const { handoffs: initial } = useLoaderData() as { handoffs: HandoffSummary[] };
  const [handoffs, setHandoffs] = useState<HandoffSummary[]>(initial);
  const location = useLocation();

  // Live update: re-fetch the list on WS handoff events (so cleared/updated
  // handoffs appear/disappear without a manual reload).
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<{ type?: string }>).detail;
      if (msg?.type === "handoffUpdated" || msg?.type === "handoffCleared") {
        listHandoffs().then(setHandoffs).catch(() => {});
      }
    };
    window.addEventListener("agent-plan:ws-event", handler);
    return () => window.removeEventListener("agent-plan:ws-event", handler);
  }, []);

  // Scroll to the #phaseId anchor (deep-linked from a HandoffBadge) once the
  // list has rendered. Re-runs when the hash or the list changes.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, handoffs]);

  if (handoffs.length === 0) {
    return (
      <Card className="grid gap-4">
        <div>
          <h1 className="text-lg font-bold text-[var(--text)]">Phase handoffs</h1>
          <p className="text-sm text-[var(--text-muted)]">Entity-scoped handoffs written on phases (<code>phase.handoff</code>).</p>
        </div>
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">No pending phase handoffs.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-lg font-bold text-[var(--text)]">Phase handoffs</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Entity-scoped handoffs written on phases (<code>phase.handoff</code>). {handoffs.length} pending.
        </p>
      </div>
      {handoffs.map((h) => (
        <section key={h.phaseId} id={h.phaseId} className="scroll-mt-20">
          <Card className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CopyableBadge id={h.compositeRef}>{h.compositeRef}</CopyableBadge>
                <span className="text-xs text-[var(--text-muted)]">Updated {formatDateTime(h.updatedAt)}</span>
              </div>
              <Link
                to={h.featureId ? `/features/${h.featureId}/phases/${h.phaseId}` : "/features"}
                className="text-xs text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
              >
                {h.featureId ? "Open phase →" : "Browse features →"}
              </Link>
            </div>
            <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-5 py-5">
              {h.firstLine ? (
                <FormattedText text={h.content} className="formatted-text max-w-none" />
              ) : (
                <p className="text-sm italic text-[var(--text-muted)]">Empty handoff content.</p>
              )}
            </div>
          </Card>
        </section>
      ))}
    </div>
  );
}