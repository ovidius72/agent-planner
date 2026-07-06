import React from "react";

export type EntityType = "feature" | "phase" | "task";

const TYPE_COLORS: Record<EntityType, { soft: string; strong: string }> = {
  feature: { soft: "rgba(139, 92, 246, 0.16)", strong: "var(--color-entity-feature)" },
  phase: { soft: "rgba(6, 182, 212, 0.16)", strong: "var(--color-entity-phase)" },
  task: { soft: "rgba(16, 185, 129, 0.16)", strong: "var(--color-entity-task)" },
};

function formatSeq(n: number | undefined): string {
  return String(n && n > 0 ? n : 0).padStart(3, "0");
}

export function EntityBadge({ type, number }: { type: EntityType; number?: number | undefined }) {
  const color = TYPE_COLORS[type] ?? TYPE_COLORS.task;
  return (
    <span
      className="inline-flex items-center justify-center font-mono text-[11px] font-bold leading-none px-2 py-1 rounded-md transition-colors"
      style={{
        backgroundColor: color.soft,
        color: color.strong,
      }}
    >
      {type[0].toUpperCase()}{formatSeq(number)}
    </span>
  );
}

export function ParentBadge({
  type,
  phaseNum,
  featureNum,
}: {
  type: EntityType;
  phaseNum?: number | undefined;
  featureNum?: number | undefined;
}) {
  //- Feature: no parent
  if (type === "feature") return null;

  //- Phase: parent is feature
  if (type === "phase") {
    if (featureNum === undefined) return null;
    return (
      <div className="inline-flex items-stretch font-mono text-[10.5px] font-semibold rounded-md overflow-hidden border border-[var(--border)] bg-[var(--surface-elevated)]">
        <span className="px-2 py-1 text-[var(--text-muted)]">F{formatSeq(featureNum)}</span>
      </div>
    );
  }

  //- Task: parents are phase + feature
  if (type === "task") {
    if (phaseNum === undefined) return null;
    return (
      <div className="inline-flex items-stretch font-mono text-[10.5px] font-semibold rounded-md overflow-hidden border border-[var(--border)] bg-[var(--surface-elevated)]">
        <span className="px-2 py-1 text-[var(--text-muted)]">P{formatSeq(phaseNum)}</span>
        {featureNum !== undefined && (
          <>
            <span className="w-[1px] bg-[var(--border)]" />
            <span className="px-2 py-1 text-[var(--text-subtle)]">F{formatSeq(featureNum)}</span>
          </>
        )}
      </div>
    );
  }

  return null;
}
