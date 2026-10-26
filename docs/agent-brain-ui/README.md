# Agent Brain — Web UI redesign

**Start here.** This folder is the design and the spec for the **redesigned** Agent
Plan web UI (the "Agent Brain" direction, F025). It is what to build and how to
build it. The target is exactly the interactive mockup (see `ARTIFACT.md`).

> ## The rule — read this first
>
> This is a **redesign**. The new UI has its **own** design language: its own
> typography, tokens, colours and components, defined here.
>
> The UI currently shipping in `packages/plan-web-ui` (its `styles/`, tokens,
> typography and existing components) is the **old UI**. It is being **replaced**.
>
> - **Do not** copy, import, extend or "align to" the current `tokens.css`,
>   `theme.css`, or the existing components. Do not mix old and new.
> - Build the visual layer **fresh** from this design.
> - You **do** reuse the *toolchain* (React 19, TypeScript, Vite, Tailwind v4,
>   `lucide-react`, `elastic-input`) and the *domain/data layer* (the plan model,
>   the server API, status semantics) — never the old look.
>
> If something here and the current code disagree on appearance, **this design
> wins**.

## Source of truth

| Concern | Canonical source | Who reads it |
|---|---|---|
| Look of the new UI (screens, layout, flows) | the **mockup** — `mockup/` + the artifact in `ARTIFACT.md` | everyone |
| Tokens (colour, type, spacing, radius, shadow) | `tokens.md` + `design-tokens.json` + the Design System artifact | implementers (JSON) / designers (artifact) |
| Components (contracts, props, hierarchy) | `components.md` | implementers |

The mockup, the tokens and this spec are kept in sync. The Design System artifact is
the human/visual catalogue of the tokens; agents read the repo files.

## Reading order

1. **This file** — the rule, the map, how to build.
2. **`tokens.md`** — the new design tokens and typography. Build these first.
3. **`components.md`** — the components by Atomic Design tier, with React props.
4. **`mockup/` / the artifact** — see every screen in context and click through it.

## What you are building

| Area | Screen | Purpose |
|---|---|---|
| Work | **Resume** | Orientation on return: suggested next, what changed, resume command. |
| Work | **Planner** | Dashboard: features → phases → tasks, faceted search, analytics, focus card. Sub-items: Requirements, Ideas, Handoff. |
| Work | **Agents & targets** | Who is working, where, with what result — work status and integration status kept separate. |
| Work | **Task detail** | One task: context, executions, code anchors, draft/saved/history. |
| Context | **Map** | Relations between plan and code; verified vs uncertain. |
| Context | **Code** | Editor with the four context needs; saved source vs draft vs history; keep-both on conflict. |
| Context | **Checks** | Trust signals: context, conformance, coherence, verifications; measured context cost; pending reviews. |
| Project | **Settings** | Project config, context delivery, backup (BR26), export/import/restore (BR27). |
| Proposals | **To evaluate** | Design ideas not yet decided — accept, try behind a flag, or defer. |

Every screen renders inside **one shared `AppShell`** (top strip + header + left
sidebar + scrolling content). The mockup duplicates the shell per artboard only
because it is a flat prototype — in the real app it is a single component.

## Shell & interaction conventions

- **Left sidebar** grouped Work / Context / Proposals, Settings pinned at the bottom. Identical on every screen.
- **Collapsible:** header toggle → icon rail on desktop; below 1180px → off-canvas drawer with a scrim. Sub-items show only when expanded / in the drawer.
- **App-shell layout:** fixed-height frame (strip + header fixed, content scrolls); the sidebar stays full-height and Settings is always reachable.
- **Light and dark** are both first-class; dark is the demo default. Driven by tokens (see `tokens.md`).
- **Few actions per spot**, single-select filters, modals keep title + close fixed while the body scrolls.

## Concepts the UI must keep distinct

From the agent-brain docs. The UI must never collapse two of these into one signal:

- **Work status ≠ Integration status** — progress on the task vs. whether it reached the target branch.
- **Workspace ≠ Integration target** — the `.planner/` worktree vs. the branch work integrates into.
- **Rules read ≠ Code conforms** — conventions loaded vs. code actually follows them.
- **Test passed ≠ Still relevant** — a check is green vs. it still covers the current code.
- **Resolved ≠ Reviewed** — an anchor points at code vs. a human confirmed it (pending / invalidated / stale).
- **Verified ≠ Uncertain** — relations confirmed by resolution vs. only inferred.
- **Measured ≠ Estimated** — context cost is measured after delivery, not guessed.
- **Saved ≠ Draft ≠ History** — three distinct states; agent edits during yours are kept side by side.

## Referring to an agent

Wherever an agent appears, show **AI vendor icon + model + session** —
`[Claude] Opus 5.5 · dev-a`, `[OpenAI] GPT-5.6 · dev-b`, `[Gemini] Gemini 3 Pro · dev-c`.
Vendor tint encodes the provider; the label stays neutral.

## How to build it

1. **Tokens first.** From `tokens.md` / `design-tokens.json`, create the new Tailwind
   v4 theme: a fresh `@theme` block (new file, e.g. `styles/tokens.css` rewritten for
   the redesign) with the fonts, colour roles, spacing, radius and shadows defined
   here, for **both** light and dark. This **replaces** the old token layer — do not
   extend it.
2. **Theme switching.** Dark/light via a `.t-dark` (or equivalent) class on the root,
   persisted as a user preference. Give every surface an explicit background.
3. **Atoms, then molecules.** Build `components/ui/` atoms from `components.md`
   (Button, StatusBadge, Pill, Input, Select, Switch, VendorIcon, Meter, …), then the
   molecules (AgentChip, IDBreadcrumb, SegmentedControl, FacetedSearchField, NavItem,
   …). Use `lucide-react` for icons, `elastic-input` for the faceted search.
4. **Overlays.** For Dialog / Select / Popover / Tooltip / DropdownMenu, consider
   Radix (via shadcn) for accessibility — flagged per-component in `components.md`.
   Adding that dependency is a decision for the team.
5. **Shell, then screens.** Build `AppShell` (strip + header + sidebar + collapse +
   drawer), then assemble each screen/route from the components, matching the mockup.
6. **Keep the distinctions.** Implement the "concepts to keep distinct" above as
   separate, visible signals — never one combined status.
7. **Data, not decoration.** Wire screens to the plan model / server API and status
   semantics. Reuse that domain logic; do not reuse the old UI's styling.

## Maintenance

This design evolves with the plan. When new agent-brain documentation lands, it is
merged from `feat/agent-brain`, re-read, and the affected screens, tokens and this
spec (plus the artifact) are updated together.
