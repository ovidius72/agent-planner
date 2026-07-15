import React, { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

export type EntityType = "feature" | "phase" | "task";

const TYPE_COLORS: Record<EntityType, { soft: string; strong: string }> = {
  feature: { soft: "rgba(139, 92, 246, 0.16)", strong: "var(--color-entity-feature)" },
  phase: { soft: "rgba(6, 182, 212, 0.16)", strong: "var(--color-entity-phase)" },
  task: { soft: "rgba(16, 185, 129, 0.16)", strong: "var(--color-entity-task)" },
};

function formatSeq(n: number | undefined): string {
  return String(n && n > 0 ? n : 0).padStart(3, "0");
}

/** Plain entity-path identifier string, e.g. "F001/P002/T003". Used for copy. */
export function formatEntityPath({
  featureNum,
  phaseNum,
  taskNum,
}: {
  featureNum?: number | undefined;
  phaseNum?: number | undefined;
  taskNum?: number | undefined;
}): string {
  const parts: string[] = [];
  if (featureNum !== undefined) parts.push(`F${formatSeq(featureNum)}`);
  if (phaseNum !== undefined) parts.push(`P${formatSeq(phaseNum)}`);
  if (taskNum !== undefined) parts.push(`T${formatSeq(taskNum)}`);
  return parts.join("/");
}

/** Copy text with a fallback for non-secure contexts (http LAN). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function EntityBadge({ type, number }: { type: EntityType; number?: number | undefined }) {
  const color = TYPE_COLORS[type] || TYPE_COLORS.task;
  const soft = color?.soft || "transparent";
  const strong = color?.strong || "inherit";
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center font-mono text-[11px] font-bold leading-none px-2 py-1 rounded-md transition-colors"
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
      <div className="shrink-0 inline-flex items-stretch font-mono text-[10.5px] font-semibold rounded-md overflow-hidden border border-[var(--border)] bg-[var(--surface-elevated)]">
        <span className="px-2 py-1 text-[var(--text-muted)]">F{formatSeq(featureNum)}</span>
      </div>
    );
  }

  //- Task: parents are phase + feature
  if (type === "task") {
    if (phaseNum === undefined) return null;
    return (
      <div className="shrink-0 inline-flex items-stretch font-mono text-[10.5px] font-semibold rounded-md overflow-hidden border border-[var(--border)] bg-[var(--surface-elevated)]">
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

/**
 * Wraps an id badge so clicking it copies the identifier. Works on secure
 * contexts (clipboard API) and on http LAN (execCommand fallback). Shows a
 * transient check on success. Sibling of a navigation link — never nested
 * inside an <a>.
 */
export function CopyableBadge({ id, children }: { id: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (await copyText(id)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }
      }}
      title={copied ? "Copied" : `Copy ${id}`}
      aria-label={copied ? "Copied" : `Copy ${id}`}
      className="copyable-id group inline-flex items-center gap-1.5"
    >
      {children}
      <span className="copyable-id__icon" aria-hidden="true">
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </span>
    </button>
  );
}

/** Compact, copyable short id pill (e.g. "UUXD1"). Globally unique within a
 *  project (Crockford 5-char). Shown alongside the composite F00x/P00x/T00x
 *  badge so both the per-parent number and the global short id are visible. */
export function ShortIdBadge({ shortId }: { shortId: string }) {
  return (
    <CopyableBadge id={shortId}>
      <span className="short-id-badge">{shortId}</span>
    </CopyableBadge>
  );
}
