import type { ReactNode } from "react";
import {
  CopyableBadge,
  EntityPathBadge,
  ShortIdBadge,
  formatEntityPath,
} from "../ui/badges";

export interface DetailEntityBarProps {
  /** Composite numbers rendered as color-coded F/P/T segments. */
  featureNum?: number;
  phaseNum?: number;
  taskNum?: number;
  /** IDs that make the matching segments clickable links. */
  featureId?: string;
  phaseId?: string;
  taskId?: string;
  /** Global short id shown next to the path and copyable. */
  shortId?: string | null;
  /** Additional trailing badges (status, handoff, etc.). */
  children?: ReactNode;
}

/**
 * Uniform identifier bar for feature/phase/task detail pages.
 * Mirrors the Work Tree row layout: color-coded entity path, copy action,
 * short id, then any trailing status/handoff chips supplied by the caller.
 */
export function DetailEntityBar({
  featureNum,
  phaseNum,
  taskNum,
  featureId,
  phaseId,
  taskId,
  shortId,
  children,
}: DetailEntityBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EntityPathBadge
        featureNum={featureNum}
        phaseNum={phaseNum}
        taskNum={taskNum}
        featureId={featureId}
        phaseId={phaseId}
        taskId={taskId}
      />
      <CopyableBadge
        id={formatEntityPath({ featureNum, phaseNum, taskNum })}
      >
        <span className="sr-only">Copy path</span>
      </CopyableBadge>
      {shortId ? <ShortIdBadge shortId={shortId} /> : null}
      {children}
    </div>
  );
}
