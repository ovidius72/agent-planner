import type { CSSProperties } from "react";

/**
 * Display-status token mapping for the Web UI.
 *
 * Maps a `DisplayStatus` (the parent-only derived presentation layer from
 * @agent-plan/core) to the visual signals used by badges: CSS color variable,
 * icon key, border/pattern CSS class, and a human-readable label/tooltip.
 *
 * The Web UI must not rely on color alone — each status also differs via
 * iconography and/or border/pattern treatment so similar states remain
 * distinguishable in grayscale / colorblind mode / dark theme.
 */

/** Parent-only derived display statuses extend the canonical workflow
 *  statuses with `started` and `closed`. Mirrors @agent-plan/core DisplayStatus. */
export type DisplayStatus =
  | "planned"
  | "started"
  | "in-progress"
  | "waiting"
  | "blocked"
  | "deferred"
  | "done"
  | "closed"
  | "canceled"
  | "rejected";

export interface StatusBreakdown {
  planned: number;
  inProgress: number;
  waiting: number;
  blocked: number;
  deferred: number;
  done: number;
  canceled: number;
  rejected: number;
}

export interface DisplayStatusToken {
  /** CSS custom property name for the status color. */
  colorVar: string;
  /** Icon key (resolved by the badge component to an SVG). */
  icon: StatusIcon;
  /** CSS class suffix for border/pattern treatment (empty = solid fill). */
  pattern: StatusPattern | "";
  /** Human-readable label. */
  label: string;
  /** Short description for tooltips / aria-labels. */
  description: string;
  /** Border style: "solid" | "dashed". */
  borderStyle: "solid" | "dashed";
  /** Background opacity for both header strip and surface (uniform). 0–100. */
  bgOpacity: number;
  /** Border opacity for the border accent. 0–100. */
  borderOpacity: number;
}

export type StatusIcon =
  | "circle"
  | "play-start"
  | "play"
  | "clock"
  | "stop"
  | "pause"
  | "check"
  | "check-mixed"
  | "ban"
  | "x";

export type StatusPattern =
  | "dashed"
  | "pulse"
  | "stripe"
  | "hatch"
  | "crosshatch";

export const DISPLAY_STATUS_TOKENS: Record<DisplayStatus, DisplayStatusToken> = {
  planned: {
    colorVar: "--color-status-planned",
    icon: "circle",
    pattern: "",
    label: "Planned",
    description: "Not started",
    borderStyle: "solid",
    bgOpacity: 10,
    borderOpacity: 30,
  },
  started: {
    colorVar: "--color-status-started",
    icon: "play-start",
    pattern: "dashed",
    label: "Started",
    description: "Begun but not active now",
    borderStyle: "dashed",
    bgOpacity: 10,
    borderOpacity: 30,
  },
  "in-progress": {
    colorVar: "--color-status-in-progress",
    icon: "play",
    pattern: "pulse",
    label: "In progress",
    description: "Active now",
    borderStyle: "solid",
    bgOpacity: 12,
    borderOpacity: 30,
  },
  waiting: {
    colorVar: "--color-status-waiting",
    icon: "clock",
    pattern: "dashed",
    label: "Waiting",
    description: "Waiting on a dependency",
    borderStyle: "dashed",
    bgOpacity: 10,
    borderOpacity: 30,
  },
  blocked: {
    colorVar: "--color-status-blocked",
    icon: "stop",
    pattern: "",
    label: "Blocked",
    description: "Impediment",
    borderStyle: "solid",
    bgOpacity: 12,
    borderOpacity: 30,
  },
  deferred: {
    colorVar: "--color-status-deferred",
    icon: "pause",
    pattern: "dashed",
    label: "Deferred",
    description: "Postponed",
    borderStyle: "dashed",
    bgOpacity: 10,
    borderOpacity: 30,
  },
  done: {
    colorVar: "--color-status-done",
    icon: "check",
    pattern: "",
    label: "Done",
    description: "Completed",
    borderStyle: "solid",
    bgOpacity: 14,
    borderOpacity: 30,
  },
  closed: {
    colorVar: "--color-status-closed",
    icon: "check-mixed",
    pattern: "",
    label: "Closed",
    description: "Closed with mixed outcomes",
    borderStyle: "solid",
    bgOpacity: 14,
    borderOpacity: 30,
  },
  canceled: {
    colorVar: "--color-status-canceled",
    icon: "ban",
    pattern: "hatch",
    label: "Canceled",
    description: "Canceled",
    borderStyle: "solid",
    bgOpacity: 8,
    borderOpacity: 30,
  },
  rejected: {
    colorVar: "--color-status-rejected",
    icon: "x",
    pattern: "crosshatch",
    label: "Rejected",
    description: "Rejected",
    borderStyle: "solid",
    bgOpacity: 10,
    borderOpacity: 30,
  },
};

/** Get the token for a display status. Falls back to `planned` for unknown. */
export function getDisplayToken(status: DisplayStatus): DisplayStatusToken {
  return DISPLAY_STATUS_TOKENS[status] ?? DISPLAY_STATUS_TOKENS.planned;
}

/** CSS color value (using color-mix) for the given token + role. */
export function tokenColor(token: DisplayStatusToken, role: "bg" | "border", opacity?: number): string {
  switch (role) {
    case "bg":     return `color-mix(in srgb, var(${token.colorVar}) ${opacity ?? token.bgOpacity}%, transparent)`;
    case "border": return `color-mix(in srgb, var(${token.colorVar}) ${opacity ?? token.borderOpacity}%, transparent)`;
  }
}

/** Inline style for a "surface" container (task row, big card). */
export function statusSurfaceStyle(status: DisplayStatus): CSSProperties {
  const t = getDisplayToken(status);
  return {
    backgroundColor: tokenColor(t, "bg"),
    borderStyle: t.borderStyle,
    borderColor: tokenColor(t, "border"),
    borderWidth: "1px",
  };
}

/** Inline style for the inner HEADER strip on a row/accordion. */
export function statusHeaderStyle(status: DisplayStatus): CSSProperties {
  const t = getDisplayToken(status);
  return {
    backgroundColor: tokenColor(t, "bg"),
    borderStyle: t.borderStyle,
    borderColor: tokenColor(t, "border"),
    borderWidth: "1px",
  };
}

/** CSS class name for the pattern (e.g. "status-pattern-dashed"), or empty.
 *  Returns BOTH a generic pattern class AND a per-status override so the
 *  pattern colour matches the status colour even when the pattern itself
 *  is shared (e.g. all "idle" states share `status-pattern-dashed`). */
export function patternClass(status: DisplayStatus): string {
  const { pattern } = getDisplayToken(status);
  if (!pattern) return "";
  if (pattern === "dashed") {
    return `status-pattern-dashed status-pattern-dashed-${status}`;
  }
  return `status-pattern-${pattern}`;
}

/** CSS class name for the status color (e.g. "status-started"). */
export function statusColorClass(status: DisplayStatus): string {
  return `status-${status}`;
}

/** CSS color value (using color-mix) for the status border accent. */
export function statusBorderColor(status: DisplayStatus, opacity = 30): string {
  return `color-mix(in srgb, var(${getDisplayToken(status).colorVar}) ${opacity}%, transparent)`;
}

/** CSS class name for the container surface treatment (e.g. "ap-status-surface-in-progress"), or empty. */
export function statusSurfaceClass(status: DisplayStatus): string {
  return `ap-status-surface ap-status-surface-${status}`;
}

/** CSS class name for the HEADER strip only (bg + border + pattern applied to
 *  the inner header row, not the whole accordion wrapper). Used by
 *  feature/phase outer containers so the status color lives on the header
 *  rectangle, leaving the children's area with a normal background. */
export function statusHeaderClass(status: DisplayStatus): string {
  return `ap-status-header ap-status-header-${status}`;
}

/** Border-only CSS class (no background) — for outer accordion wrappers.
 *  Colors the full accordion border subtly so the parent's status is
 *  glanceable without overwhelming the children. */
export function statusBorderClass(status: DisplayStatus): string {
  return `ap-status-border ap-status-border-${status}`;
}

/** Narrow an arbitrary status string to a known DisplayStatus. Falls back to `planned`. */
export function toDisplayStatus(status: string): DisplayStatus {
  if (status in DISPLAY_STATUS_TOKENS) return status as DisplayStatus;
  return "planned";
}

/**
 * Build an accessible aria-label / tooltip string from a breakdown.
 * Example: "Started · 1 done · 2 planned · 1 waiting"
 */
export function buildBreakdownLabel(
  status: DisplayStatus,
  breakdown: {
    planned: number;
    inProgress: number;
    waiting: number;
    blocked: number;
    deferred: number;
    done: number;
    canceled: number;
    rejected: number;
  },
): string {
  const token = getDisplayToken(status);
  const parts: string[] = [token.label];
  const entries: Array<[string, number]> = [
    ["done", breakdown.done],
    ["in-progress", breakdown.inProgress],
    ["planned", breakdown.planned],
    ["waiting", breakdown.waiting],
    ["blocked", breakdown.blocked],
    ["deferred", breakdown.deferred],
    ["canceled", breakdown.canceled],
    ["rejected", breakdown.rejected],
  ];
  for (const [label, count] of entries) {
    if (count > 0) parts.push(`${count} ${label}`);
  }
  return parts.join(" · ");
}