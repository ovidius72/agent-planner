import { useLoaderData, useLocation, Link } from "react-router-dom";
import { Card } from "../components/ui/card";
import { Accordion } from "../components/ui/accordion";
import { FormattedText } from "../components/ui/formatted-text";
import { clearPhaseHandoff, listHandoffs } from "../lib/api";
import type { HandoffSummary } from "../lib/types";
import { CopyableBadge } from "../components/ui/badges";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";

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
  const [deletingPhaseId, setDeletingPhaseId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const location = useLocation();

  async function handleClear(handoff: HandoffSummary) {
    if (deletingPhaseId) return;
    const confirmed = window.confirm(`Clear handoff for ${handoff.compositeRef}?`);
    if (!confirmed) return;
    setDeletingPhaseId(handoff.phaseId);
    setError("");
    try {
      await clearPhaseHandoff(handoff.phaseId);
      setHandoffs((current) => current.filter((entry) => entry.phaseId !== handoff.phaseId));
      listHandoffs().then(setHandoffs).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || `Failed to clear handoff for ${handoff.compositeRef}.`);
    } finally {
      setDeletingPhaseId(null);
    }
  }

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
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-lg font-bold text-[var(--text)]">Phase handoffs</h1>
            <Link to="/handoff/archive" className="text-sm text-[var(--accent)] underline-offset-2 hover:underline">View archive →</Link>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Pending entity-scoped handoffs on non-completed phases.</p>
        </div>
        {error ? <p className="rounded-[12px] border border-[var(--danger-soft)] bg-[var(--danger-soft)]/50 px-3 py-2 text-sm text-[var(--color-status-blocked)]">{error}</p> : null}
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">No pending phase handoffs.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-bold text-[var(--text)]">Phase handoffs</h1>
          <Link to="/handoff/archive" className="text-sm text-[var(--accent)] underline-offset-2 hover:underline">View archive →</Link>
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          Pending entity-scoped handoffs on non-completed phases. {handoffs.length} pending.
        </p>
      </div>
      {error ? <p className="rounded-[12px] border border-[var(--danger-soft)] bg-[var(--danger-soft)]/50 px-3 py-2 text-sm text-[var(--color-status-blocked)]">{error}</p> : null}
      {handoffs.map((h) => (
        <section key={h.phaseId} id={h.phaseId} className="scroll-mt-20">
          <Card className="overflow-hidden p-0">
            <Accordion
              defaultOpen={false}
              title={(
                <>
                  <CopyableBadge id={h.compositeRef}>{h.compositeRef}</CopyableBadge>
                  <span className="text-xs font-normal text-[var(--text-muted)]">Updated {formatDateTime(h.updatedAt)}</span>
                </>
              )}
              subtitle={h.firstLine || "Empty handoff content."}
              summaryClassName="hover:bg-[var(--surface-hover)]/60 focus-visible:bg-[var(--surface-hover)]/60"
              actions={(
                <>
                  <Button
                    type="button"
                    variant="danger"
                    className="min-h-8 px-2.5 py-1 text-xs sm:min-h-9"
                    disabled={deletingPhaseId === h.phaseId}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleClear(h);
                    }}
                  >
                    {deletingPhaseId === h.phaseId ? "Clearing…" : "Clear"}
                  </Button>
                  <Link
                    to={h.featureId ? `/features/${h.featureId}/phases/${h.phaseId}` : "/features"}
                    className="text-xs text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {h.featureId ? "Open phase →" : "Browse features →"}
                  </Link>
                </>
              )}
              contentClassName="px-5 py-5"
            >
              {h.firstLine ? (
                <FormattedText text={h.content} className="formatted-text max-w-none" />
              ) : (
                <p className="text-sm italic text-[var(--text-muted)]">Empty handoff content.</p>
              )}
            </Accordion>
          </Card>
        </section>
      ))}
    </div>
  );
}