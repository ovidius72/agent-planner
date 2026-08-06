/**
 * StatusItem — unified accordion wrapper for feature/phase/task headers.
 *
 * Renders a single, opinionated rectangle whose `backgroundColor`,
 * `borderStyle`, and `borderColor` are derived from a `DisplayStatus` via
 * the central `DISPLAY_STATUS_TOKENS` map. No CSS per-state overrides
 * are needed; the same component is used at every level (feature, phase,
 * task) and produces a coherent visual signal everywhere.
 *
 * Variants:
 *   - "header"   → inner strip (header row of an accordion). Uses
 *                  `bgHeaderOpacity` for a subtle background.
 *   - "surface"  → outer row (task row, full container). Uses
 *                  `bgOpacity` for a more pronounced background.
 *
 * The optional `pattern` overlay adds the per-status stripe/hatch
 * treatment via a single CSS layer (`status-pattern-*`). Centralizing
 * the pattern here means the same component handles the hatch on
 * canceled, the crosshatch on rejected, and the pulse on in-progress.
 *
 * Slots:
 *   `leading`  — left side of the row (e.g. drag handle, copyable badge)
 *   `title`    — title text rendered below the leading row (or beside,
 *                controlled by the parent)
 *   `trailing` — right side of the row (counters, status chip)
 *
 * No `title` slot is rendered automatically; consumers compose the row
 * themselves and use `StatusItem` only as the colored wrapper.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  type DisplayStatus,
  statusHeaderStyle,
  statusSurfaceStyle,
  patternClass,
} from "../../lib/display-status-tokens";

export interface StatusItemProps {
  status: DisplayStatus;
  variant?: "header" | "surface";
  className?: string;
  children?: ReactNode;
  /** Accessibility label for the colored rectangle. Optional — the inner
   *  text already provides one, but providing a label makes screen readers
   *  announce the status explicitly. */
  ariaLabel?: string;
}

export function StatusItem({
  status,
  variant = "header",
  className,
  children,
  ariaLabel,
}: StatusItemProps) {
  const baseStyle: CSSProperties =
    variant === "surface"
      ? statusSurfaceStyle(status)
      : statusHeaderStyle(status);
  const pattern = patternClass(status);
  const composedClassName = [
    "status-item",
    variant === "surface" ? "status-item--surface" : "status-item--header",
    pattern,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={composedClassName}
      style={baseStyle}
      aria-label={ariaLabel}
      data-status={status}
    >
      {children}
    </div>
  );
}
