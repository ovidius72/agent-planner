# Design tokens — Agent Brain redesign

The design primitives for the **new** UI: typography, colour, spacing, radius,
shadow, effect — for **light and dark**. Machine-readable values are in
`design-tokens.json`; the visual catalogue is the Design System artifact.

> These tokens **define the new UI**. They **replace** the current
> `packages/plan-web-ui/src/styles/tokens.css` / `theme.css`. Build a fresh
> Tailwind v4 `@theme` from these values — do **not** import or extend the old ones.

## Typography

| Family | Stack | Use |
|---|---|---|
| sans | `"Inter", ui-sans-serif, system-ui, sans-serif` | all UI text |
| mono | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | ids, code, counts, `field:value` tokens |

Type scale (sans unless noted):

| Name | Size / line | Weight | Use |
|---|---|---|---|
| `stat-value` | 28 / 32 | 700 | big KPI numbers |
| `page-title` | 18 / 24 | 700 | page H1 |
| `heading` | 16 / 22 | 700 | section/card titles |
| `body-strong` | 14 / 20 | 600 | emphasised body, labels on rows |
| `body` | 14 / 20 | 400 | default text |
| `caption` | 12 / 16 | 500 | metadata, hints |
| `label` | 10 / 14 | 600, `0.22em`, UPPERCASE | eyebrow/section labels |
| `code` (mono) | 13 / 18 | 500 | code, ids |
| `code-sm` (mono) | 11 / 16 | 500 | inline ids, short-ids |

## Colour roles

All colours are **roles**, not raw hex — reference them by name. Each has a light and
a dark value (see `design-tokens.json` for exact values).

**Surfaces** — the look is *glass over a gradient wash*:
- `bg-base` — page base, under the gradient.
- `bg-gradient-a` / `bg-gradient-b` — blue (top-left) + violet (bottom-right) radial washes.
- `surface` / `surface-strong` / `surface-elevated` — translucent panels, increasing opacity. Apply `backdrop-filter: blur(var(--surface-blur))` (18px) to glass surfaces.
- `border` / `border-strong` — hairline / hover-active borders.

**Text:** `text` (primary) · `text-muted` (secondary) · `text-subtle` (tertiary, 13px+ only).

**Accent / brand:** `accent` · `accent-hover` · `accent-soft` (tinted bg for active nav, selected chips). `danger-soft` for destructive hover/wash.

**Entity identity:** `entity-feature` (violet) · `entity-phase` (cyan) · `entity-task` (emerald) — badges, tree rails, icons.

**Lifecycle status** (badge + dot; never hue alone — pair blocked/failing with an icon):
`status-draft` · `status-discovery` · `status-planned` · `status-in-progress` ·
`status-paused` · `status-done` · `status-blocked` · `status-canceled` ·
`status-waiting` · `status-deferred` · `status-rejected`, plus the parent-derived
display statuses `status-started` · `status-closed`.

## Spacing · radius · shadow · effect

- **Spacing:** `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 (default card padding / grid gap) · `space-6` 24 (panel padding) · `space-8` 32 (between dashboard sections).
- **Radius:** `radius-input` 14 (inputs/buttons/chips) · `radius-card` 20 (cards) · `radius-panel` 24 (panels/shell) · `radius-pill` 9999 (badges/pills).
- **Shadow:** `shadow-card` (resting cards) · `shadow-panel` (panels/modals) — both have light/dark values.
- **Effect:** `surface-blur` 18px — the `backdrop-filter` blur on every glass surface.

## Turning this into Tailwind v4

Tailwind v4 is CSS-first. Define the tokens in an `@theme` and switch light/dark with a
root class. Sketch (illustrative — take exact values from `design-tokens.json`):

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  /* roles — light values */
  --color-bg-base: #f8fafc;
  --color-surface: rgba(255,255,255,0.76);
  --color-surface-elevated: rgba(255,255,255,0.98);
  --color-border: rgba(148,163,184,0.22);
  --color-text: #0f172a;
  --color-text-muted: #475569;
  --color-accent: #6366f1;
  --color-accent-soft: rgba(99,102,241,0.14);
  --color-entity-feature: #8b5cf6;
  --color-status-in-progress: #f59e0b;
  /* …all roles… */

  --radius-input: 14px;
  --radius-card: 20px;
  --radius-panel: 24px;
  --surface-blur: 18px;
}

/* dark overrides */
:root.t-dark {
  --color-bg-base: #08111f;
  --color-surface: rgba(15,23,42,0.74);
  --color-surface-elevated: rgba(15,23,42,0.96);
  --color-border: rgba(148,163,184,0.14);
  --color-text: #f8fafc;
  --color-text-muted: #94a3b8;
  --color-accent: #818cf8;
  /* …all dark role values… */
}
```

Then components reference roles (`bg-surface`, `text-muted`, `text-accent`,
`rounded-[var(--radius-card)]`, etc.), never raw hex. Give every surface an explicit
background so theme switching is complete.

## Accessibility notes

- `text` passes 4.5:1 on `surface` in both themes. `text-subtle` is borderline in dark
  — use at 13px+ only.
- Status is never conveyed by colour alone: always pair with a dot/label, and blocked
  / failing with an icon.
