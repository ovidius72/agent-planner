import { useLoaderData } from "react-router-dom";
import { Card } from "../components/ui/card";
import { FormattedText } from "../components/ui/formatted-text";
import { listHandoffs, getPhaseHandoff, clearPhaseHandoff } from "../lib/api";
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
  const { handoffs } = useLoaderData() as { handoffs: HandoffSummary[] };
  const [selectedId, setSelectedId] = useState<string | null>(handoffs[0]?.phaseId ?? null);
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) { setContent(""); setUpdatedAt(""); return; }
    setLoading(true);
    getPhaseHandoff(selectedId)
      .then((h) => { if (!cancelled) { setContent(h.content); setUpdatedAt(h.updatedAt); } })
      .catch(() => { if (!cancelled) { setContent(""); setUpdatedAt(""); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, version]);

  // Live update: re-fetch list + selected on WS handoff events
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<{ type?: string; data?: { phaseId?: string } }>).detail;
      if (msg?.type === "handoffUpdated" || msg?.type === "handoffCleared") setVersion((v) => v + 1);
    };
    window.addEventListener("agent-plan:ws-event", handler);
    return () => window.removeEventListener("agent-plan:ws-event", handler);
  }, []);

  const selected = handoffs.find((h) => h.phaseId === selectedId) ?? null;

  async function handleClear() {
    if (!selectedId) return;
    await clearPhaseHandoff(selectedId);
    setSelectedId(null);
    setContent("");
    setUpdatedAt("");
  }

  if (handoffs.length === 0) {
    return (
      <Card className="grid gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text)]">Phase handoffs</h2>
          <p className="text-sm text-[var(--text-muted)]">Entity-scoped handoffs written on phases (phase.handoff field).</p>
        </div>
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">No pending phase handoffs.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="grid gap-1 p-3">
        <h2 className="px-2 pb-2 text-sm font-bold text-[var(--text)]">Pending ({handoffs.length})</h2>
        <ul className="grid gap-1">
          {handoffs.map((h) => (
            <li key={h.phaseId}>
              <button
                type="button"
                onClick={() => setSelectedId(h.phaseId)}
                className={`grid w-full gap-1 rounded-xl px-2 py-2 text-left ${selectedId === h.phaseId ? "bg-[var(--surface-elevated)]" : "hover:bg-[var(--surface-card)]"}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <CopyableBadge id={h.compositeRef}>{h.compositeRef}</CopyableBadge>
                </span>
                <span className="truncate text-xs text-[var(--text-muted)]">{h.firstLine}</span>
                <span className="text-[10px] text-[var(--text-muted)]">{formatDateTime(h.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {selected ? <CopyableBadge id={selected.compositeRef}>{selected.compositeRef}</CopyableBadge> : null}
              <span className="text-xs text-[var(--text-muted)]">Updated {formatDateTime(updatedAt)}</span>
            </div>
            <h2 className="text-lg font-bold text-[var(--text)]">{selected?.firstLine ?? "Handoff"}</h2>
          </div>
          {selected ? (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-card)]"
            >
              Clear handoff
            </button>
          ) : null}
        </div>
        <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface-card)] px-5 py-5">
          {loading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : content ? (
            <FormattedText text={content} className="formatted-text max-w-none" />
          ) : (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">Select a handoff from the list.</p>
          )}
        </div>
      </Card>
    </div>
  );
}