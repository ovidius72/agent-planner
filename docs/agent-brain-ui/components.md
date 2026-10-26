# Component census (Atomic Design)

Every UI building block used across the Agent Brain web UI design, organized by
atomic tier (**atoms → molecules → organisms → templates → pages**) with a React
prop/state sketch for each. This is **documentation / a spec to build against** — not
final code. Development starts from here.

A visual gallery of the primitives (atoms then molecules) is in the `Components`
artboard of the mockup (see `ARTIFACT.md`).

## Target stack (verified in `packages/plan-web-ui`)

- **React 19 + TypeScript**, Vite, `react-router-dom` v7.
- **Tailwind CSS v4** (CSS-first: `@import "tailwindcss"`, tokens in `@theme` at
  `src/styles/tokens.css`). Status colors already exist as `--color-status-*`.
- **lucide-react** for icons.
- **elastic-input** for the faceted-search input.
- **@dnd-kit** for drag/drop.
- There is already a `src/components/ui/` folder — treat it as the **atoms** home.

**Styling convention:** Tailwind utilities + the existing CSS variables; map our
`design-tokens.json` onto the `@theme` tokens (don't introduce a parallel token set).
Prop sketches use `LucideIcon` from `lucide-react`.

**On shadcn/ui (not currently a dependency):** build atoms and molecules on the
existing stack. Consider Radix/shadcn **only** for accessible overlays (Dialog,
Select, Popover, Tooltip, DropdownMenu) where focus-trap/keyboard behaviour is hard
to hand-roll — flagged per-component below as *(Radix candidate)*. Adding it is a
dependency decision that needs explicit approval.

---

## Atoms

Primitive, self-contained, no business logic. Home: `components/ui/`.

### Button
Used: everywhere.
```ts
type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'danger'; // default 'secondary'
  size?: 'sm' | 'md';                            // default 'md'
  icon?: LucideIcon;
  iconPosition?: 'start' | 'end';                // default 'start'
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  children: React.ReactNode;
};
```
States: default · hover (border → accent) · active · disabled · loading.

### IconButton
Used: toggles, close, copy, carets.
```ts
type IconButtonProps = {
  icon: LucideIcon;
  label: string;        // aria-label (required, icon-only)
  size?: 'sm' | 'md';   // 26 / 34 px
  active?: boolean;
  onClick?: () => void;
};
```

### Icon
Thin wrapper over lucide to enforce size/stroke defaults.
```ts
type IconProps = { icon: LucideIcon; size?: number; className?: string };
```

### StatusBadge
Used: Planner, Agents, Task detail. Pill + dot; color from `--color-status-*`.
```ts
type Status = 'draft'|'planned'|'in-progress'|'paused'|'done'|'blocked'
            | 'discovery'|'waiting'|'deferred'|'rejected'|'started'|'closed'|'canceled';
type StatusBadgeProps = { status: Status; label?: string };
```

### Pill
Compact squared tag for two-fact signals and capabilities.
```ts
type PillProps = { tone?: 'accent'|'ok'|'warn'|'bad'|'muted'; children: React.ReactNode };
```

### Dot
```ts
type DotProps = { color: string; size?: number };
```

### EntityTag
```ts
type EntityTagProps = { kind: 'feature'|'phase'|'task' };  // FEATURE / PHASE / TASK
```

### ShortId
Global short id; click to copy.
```ts
type ShortIdProps = { id: string; onCopy?: (id: string) => void };
```

### VendorIcon
Provider glyph + tint.
```ts
type Vendor = 'claude' | 'openai' | 'gemini';
type VendorIconProps = { vendor: Vendor; size?: number };
```

### Meter
```ts
type MeterProps = { value: number; max?: number; tone?: 'feature'|'phase'|'task'|'accent'; width?: number };
```

### Input / Textarea
```ts
type InputProps  = { value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; invalid?: boolean; };
type TextareaProps = InputProps & { rows?: number };
```

### Select
Native `<select>` styled, or *(Radix candidate)* for a richer listbox.
```ts
type SelectProps<T extends string> = {
  value: T; onChange: (v: T) => void;
  options: { value: T; label: string }[];
  'aria-label': string;
};
```

### Switch
```ts
type SwitchProps = { checked: boolean; onChange: (b: boolean) => void; 'aria-label': string };
```

### ToggleChip
Multi-select chip (e.g. include-context).
```ts
type ToggleChipProps = { selected: boolean; onToggle: () => void; children: React.ReactNode };
```

### Scrim
Dimmed overlay behind drawer/modal.
```ts
type ScrimProps = { show: boolean; onClick?: () => void };
```

---

## Molecules

Small compositions of atoms with a bit of internal layout/logic.

### AgentChip
Vendor icon + model + session. Used: Agents, Task detail, Code, Checks, Resume, Settings.
```ts
type AgentChipProps = {
  vendor: Vendor; model: string; session: string;
  role?: string; branch?: string;   // optional suffixes
  size?: 'sm' | 'md';
};
```

### IDBreadcrumb
Clickable `Fxxx / Pxxx / Txxx` + copy + short id. Used: Planner, Task detail.
```ts
type IDBreadcrumbProps = {
  feature: string; phase?: string; task?: string;
  shortId?: string;
  onNavigate: (level: 'feature'|'phase'|'task') => void;
  onCopy?: (fullId: string) => void;
};
```

### SegmentedControl
Single-select. Used: Checks, Settings, analytics window.
```ts
type SegmentedControlProps<T extends string> = {
  value: T; onChange: (v: T) => void;
  segments: { value: T; label: string }[];
};
```

### FacetedSearchField
Structured `field:value` tokens + suggestions (built on `elastic-input`). Used: Planner.
```ts
type Facet = { field: 'feature'|'phase'|'task'|'id'|'status'|'feature-status'|'phase-status'|'title'; value: string };
type FacetedSearchFieldProps = {
  tokens: Facet[];
  draft: string;
  onDraftChange: (s: string) => void;
  onAddToken: (f: Facet) => void;
  onRemoveToken: (i: number) => void;
  suggestions: { label: string; desc: string; apply: () => void }[];
};
```
Sub-parts: `SearchToken` (chip + remove), `SuggestionList`.

### StatTile
```ts
type StatTileProps = { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon };
```

### SectionHeader
Icon + title + subtitle (+ optional trailing action). Used: Checks, Settings, Components.
```ts
type SectionHeaderProps = { icon?: LucideIcon; title: string; subtitle?: string; action?: React.ReactNode };
```

### NavItem / NavGroup
Sidebar primitives.
```ts
type NavItemProps = {
  icon: LucideIcon; label: string; href: string;
  active?: boolean; sub?: boolean; collapsed?: boolean; // collapsed = icon rail
};
type NavGroupProps = { label: string; children: React.ReactNode };
```

### FormField
```ts
type FormFieldProps = { label: string; required?: boolean; hint?: string; children: React.ReactNode };
```

### RestorePointRow
Used: Settings (backup list).
```ts
type RestorePointRowProps = { when: string; meta: string; onRestore: () => void };
```

### CheckItem
Two-fact row: a subject + one or more independent facts. Used: Checks.
```ts
type Fact = { text: string; tone: 'ok'|'warn'|'bad'|'muted' };
type CheckItemProps = { title: string; sub?: string; agent?: AgentChipProps; facts: Fact[] };
```

### ContextCostRow
Used: Checks (measured cost).
```ts
type ContextCostRowProps = { agent: AgentChipProps; task: string; usedTokens: number; budgetTokens: number };
```

---

## Organisms

Larger, feature-aware compositions.

| Component | Used in | Notes |
|---|---|---|
| `Sidebar` | all | Groups + `NavItem`s + Settings footer; `collapsed` (rail) / `drawerOpen` (mobile). |
| `AppHeader` | all | Brand + title + actions (theme, context switch). Two identities (product/project). |
| `TopStrip` | all | Announcement/context bar. |
| `Modal` | Planner, Task detail | Fixed title + close, scrolling body, scrim. *(Radix Dialog candidate)* |
| `DropdownMenu` | Planner (export) | Anchored menu. *(Radix candidate)* |
| `Toast` | Planner | Transient confirm; needs a provider/queue. |
| `DataTable` | Agents | Header + rows, per-row status + actions. |
| `TreeRow` | Planner | Feature/phase/task; caret, indentation, inline-add, density. `@dnd-kit` for reorder. |
| `FocusCard` | Planner | Sticky in-progress + suggested-next + parked; collapsible. |
| `Inspector` | Agents, Task, Map, Code | Contextual detail pane. |
| `Charts` | Planner | `ThroughputChart`, `BurnUpChart`, `AgingBars`, `BacklogBars`. |
| `ExportMenu` | Planner | Export targets dropdown. |
| `CodeEditorView` | Code | Syntax, line numbers, clickable symbols, source/draft/history. |
| `ConflictBanner` | Code | Agent-edited-this-file keep-both. |
| `MapCanvas` | Map | Entity nodes + relation edges; verified/uncertain/stale. |
| `EmptyState` | Planner | Message + reset action. |

## Templates

### AppShell
The one shared layout every page renders inside. Replaces the per-artboard duplication
in the mockup.
```ts
type AppShellProps = {
  active: NavKey;                 // which nav item is current
  header: React.ReactNode;        // AppHeader content (page-specific right side)
  children: React.ReactNode;      // page content (scrolls)
};
// Internal state: sidebarCollapsed (desktop rail) + drawerOpen (mobile),
// theme ('light' | 'dark') — persisted (localStorage / user settings).
```

## Pages

One per screen, each a route rendered inside `AppShell`:
`Resume`, `Planner` (+ `Requirements`, `Ideas`, `Handoff`), `AgentsTargets`,
`TaskDetail`, `Map`, `Code`, `Checks`, `Settings`, `ToEvaluate`.

See `README.md` for what each page does and the concepts it must keep distinct.
