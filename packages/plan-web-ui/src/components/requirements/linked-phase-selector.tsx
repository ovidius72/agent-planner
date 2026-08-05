import type { Phase } from "../../lib/types";
import { Field } from "../ui/field";

function formatPhaseRef(phase: Phase) {
  return `P${String(phase.number ?? 0).padStart(3, "0")}`;
}

export function LinkedPhaseSelector({ phases, selectedIds = [] }: { phases: Phase[]; selectedIds?: string[] }) {
  const selected = new Set(selectedIds);

  return (
    <Field label="Linked phases">
      {phases.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-muted)]">
          No phases available yet. Create phases first if you want to link this requirement to delivery work.
        </div>
      ) : (
        <div className="grid gap-2 rounded-[16px] border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
          <p className="text-xs text-[var(--text-muted)]">Select the phases that directly implement or track this requirement.</p>
          <div className="grid gap-2 max-h-[32dvh] overflow-y-auto pr-1">
            {phases.map((phase) => (
              <label key={phase.id} className="flex items-start gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]">
                <input
                  type="checkbox"
                  name="linkedPhaseIds"
                  value={phase.id}
                  defaultChecked={selected.has(phase.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold">{formatPhaseRef(phase)} — {phase.title}</span>
                  {phase.summary ? <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{phase.summary}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Field>
  );
}
