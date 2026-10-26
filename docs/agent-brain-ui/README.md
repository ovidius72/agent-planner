# Agent Brain — Web UI design

A clickable mockup and component spec for the reorganized Agent Plan web UI (the
"Agent Brain" direction, F025). This folder is the **design source**: it shows
layout, flows and the concepts the UI must encode — not production code. All data
in the mockup is illustrative.

The real UI is built separately in `packages/plan-web-ui`. This design is the
reference it should be built against.

## Where things live

| Path | What |
|---|---|
| `README.md` | This handoff. |
| `components.md` | Full component census — every UI building block, where it is used, and its variants/states. |
| `design-tokens.json` | Color/spacing tokens for light and dark themes. |
| `ARTIFACT.md` | Link to the interactive, clickable version hosted on claude.ai. |
| `mockup/` | The Design Canvas source (`*.dc.html` + `canvas.json`). Editable; previewable through the artifact above. Not standalone-runnable (it needs the canvas runtime), so use `ARTIFACT.md` to click through it. |

The interactive artifact and this source are kept in sync.

## The screens

Ten artboards: a handoff/README, a component kit, and eight app screens grouped by
the left-sidebar areas. Entry point is **Planner**.

| Area | Screen | Purpose |
|---|---|---|
| Work | **Resume** | Orientation on return: suggested next, what changed, resume command. |
| Work | **Planner** | The dashboard: features → phases → tasks, faceted search, analytics, focus card. Sub-items: Requirements, Ideas, Handoff. |
| Work | **Agents & targets** | Who is working, where, with what result — work status and integration status kept separate. |
| Work | **Task detail** | One task: context, executions, code anchors, draft/saved/history. |
| Context | **Map** | Relations between plan and code; verified vs uncertain. |
| Context | **Code** | Editor with the four context needs; saved source vs draft vs history; keep-both on conflict. |
| Context | **Checks** | Trust signals: context, conformance, coherence, verifications; measured context cost; pending reviews. |
| Project | **Settings** | Project config, context delivery, backup (BR26), export/import/restore (BR27). |
| Proposals | **To evaluate** | Design ideas not yet decided — accept, try behind a flag, or defer. |

## Shell & interaction conventions

- **Left sidebar** grouped Work / Context / Proposals, with Settings pinned at the
  bottom. Identical on every screen.
- **Collapsible:** a header toggle collapses the sidebar to an icon rail on desktop;
  below 1180px it becomes an off-canvas drawer with a scrim. Sub-items show in the
  expanded sidebar / drawer, not in the rail.
- **App-shell layout:** fixed-height frame (strip + header fixed, content scrolls),
  so the sidebar stays full-height and Settings is always reachable.
- **Theme:** light and dark via CSS variables (`.t-dark` on the root); dark is the
  demo default. Every color is a token.
- **Few actions per spot**, single-select filters, modals keep their title and close
  affordance fixed while the body scrolls.

## Concepts the UI must keep distinct

These come from the F025 / agent-brain docs. The UI's job is to never collapse two
of these into one signal.

- **Work status ≠ Integration status** — progress on the task vs. whether it reached the target branch.
- **Workspace ≠ Integration target** — the `.planner/` worktree vs. the branch work integrates into.
- **Rules read ≠ Code conforms** — conventions were loaded vs. the code actually follows them.
- **Test passed ≠ Still relevant** — a check is green vs. it still covers the current code.
- **Resolved ≠ Reviewed** — an anchor points at code vs. a human confirmed it (pending / invalidated / stale).
- **Verified ≠ Uncertain** — relations confirmed by resolution vs. only inferred.
- **Measured ≠ Estimated** — context cost is measured after delivery, not guessed up front.
- **Saved ≠ Draft ≠ History** — three distinct states; agent edits during yours are kept side by side.

## Referring to an agent

Wherever an agent appears, show **AI vendor icon + model + session**, e.g.
`[Claude] Opus 5.5 · dev-a`, `[OpenAI] GPT-5.6 · dev-b`, `[Gemini] Gemini 3 Pro · dev-c`.
The vendor tint encodes the provider; the label stays neutral.

## What is grounded vs proposed

- **From the agent-brain docs** — the capabilities and requirements (BR22–29): the
  two-axis concepts, context cost, anchors/reviews, backup & export.
- **Design proposal** — the arrangement (sidebar grouping, the specific screens),
  field names, and everything under **To evaluate**.
- **Illustrative** — all numbers, names, tasks, agents and sessions. Replace with real data.

## For the implementer

- Build with the project stack (React + TypeScript, Vite) and your own component
  layer; use `design-tokens.json`. Do not port the mockup's markup.
- Each mockup board is a standalone artboard (no shared partials — a canvas
  limitation), so header/sidebar are duplicated there on purpose. In the real app
  they become one `Shell` component (see `components.md`).
- Theme is CSS variables with a `.t-dark` class on the root; mirror that split in the
  token layer.
- The existing `plan-web-ui` package already has the faceted search, status rollups
  and dashboard analytics referenced here — reuse them.

## Maintenance

This design evolves with the plan. When new agent-brain documentation lands, it is
merged from `feat/agent-brain`, re-read, and the affected screens here (and the
artifact) are updated together.
