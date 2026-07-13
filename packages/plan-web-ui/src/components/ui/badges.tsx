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
  const color = TYPE_COLORS[type] || TYPE_COLORS.task;
  const soft = color?.soft || "transparent";
  const strong = color?.strong || "inherit";
  return (
    <span
      className="inline-flex items-center justify-center font-mono text-[11px] font-bold leading-none px-2 py-1 rounded-md transition-colors"
      style={{
        backgroundColor: soft,
        color: strong,
      }}
    >
      {(type ? type.charAt(0).toUpperCase() : "?")}{formatSeq(number)}
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

/**
 * Unified entity-path badge: F00x[/P00x][/T00x] in a single pill, each segment
 * color-coded by group (feature=purple, phase=cyan, task=green). Used in the
 * Work Tree so the full identifier is easy to scan and type. The title sits
 * below this badge on its own (wrapping) line.
 */
export function EntityPathBadge({
  featureNum,
  phaseNum,
  taskNum,
}: {
  featureNum?: number | undefined;
  phaseNum?: number | undefined;
  taskNum?: number | undefined;
}) {
  return (
    <span className="entity-path-badge">
      {featureNum !== undefined ? (
        <span className="entity-path-seg entity-path-seg--feature">F{formatSeq(featureNum)}</span>
      ) : null}
      {phaseNum !== undefined ? (
        <>
          <span className="entity-path-sep" aria-hidden="true">/</span>
          <span className="entity-path-seg entity-path-seg--phase">P{formatSeq(phaseNum)}</span>
        </>
      ) : null}
      {taskNum !== undefined ? (
        <>
          <span className="entity-path-sep" aria-hidden="true">/</span>
          <span className="entity-path-seg entity-path-seg--task">T{formatSeq(taskNum)}</span>
        </>
      ) : null}
    </span>
  );
}
