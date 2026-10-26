# Component census

Every UI building block used across the Agent Brain web UI design, with where it
appears and the variants/states it needs. This is a **spec to rebuild** as real
components, not a list of production selectors. Colors come from
`design-tokens.json`.

A visual gallery of the core primitives is in the `Components` artboard of the
mockup (see `ARTIFACT.md`).

## Layout & shell

| Component | Used in | Variants / states |
|---|---|---|
| App shell | all screens | Fixed-height frame: strip + header fixed, content area scrolls. |
| Top strip | all | Announcement / context line (e.g. environment, demo banner). |
| Header | all | Brand + title + right-side actions. Two identities: product (Planner) and project (others). |
| Sidebar | all | Groups Work / Context / Proposals + Settings footer. States: expanded · icon rail (collapsed) · drawer (mobile). |
| Nav item | all | Default · hover · active · sub-item · icon-only (rail). |
| Nav toggle | all | Hamburger button in header. |
| Scrim | mobile | Dimmed overlay behind the open drawer. |
| Theme toggle | all | Light / dark. |

## Actions

| Component | Used in | Variants / states |
|---|---|---|
| Button | all | primary · secondary · danger · small · with-icon. Hover raises border to accent. Needs disabled. |
| Icon button | all | Square 34px; used for toggles and close. |

## Status & tags

| Component | Used in | Variants / states |
|---|---|---|
| Status badge | Planner, Agents, Task detail | done · in-progress · planned · paused · blocked · draft (pill + dot). |
| Semantic pill | Checks, Map, Code | ok · warn · bad · muted (two-fact signals, e.g. "Rules read ✓", "Stale ⚠"). |
| Capability pill | header | Provider syntactic / semantic support. |
| Status dot | many | 7px, color by status. |
| Entity tag | Planner | FEATURE · PHASE · TASK. |
| Meta / area pill | Checks, To evaluate | Neutral tag (area, requirement, "needs: …"). |

## Identity & IDs

| Component | Used in | Variants / states |
|---|---|---|
| Agent chip | Agents, Task detail, Code, Checks, Resume, Settings | Vendor icon + model + session. Vendor tint: Claude / OpenAI / Gemini. Compact and inline forms. |
| ID breadcrumb | Planner, Task detail | Clickable `Fxxx / Pxxx / Txxx`; each segment navigates. |
| Copy-id button | Planner | Copies the full id. |
| Short id | Planner | Global short id chip (click to copy). |

## Inputs & controls

| Component | Used in | Variants / states |
|---|---|---|
| Text field | Planner (new feature), Settings | Default; required/optional. |
| Textarea | Planner (new feature) | Optional, resizable. |
| Select | Planner, Settings, Agents | Custom chevron; single value. |
| Switch | Settings | On / off boolean. |
| Segmented control | Checks, Settings, analytics window | Single-select (All / Needs attention, comfort/compact, time windows). |
| Faceted search | Planner | Structured `field:value` tokens + suggestions dropdown; token chip with remove. Not free text. |
| Toggle chips | Settings | Multi-select (include-context: Decisions / Conventions / Tests / Related code). |

## Data

| Component | Used in | Variants / states |
|---|---|---|
| Progress meter | Planner, Agents | Feature / phase completion bar. |
| Stat tile / KPI | Planner | Count + delta. |
| Charts | Planner (analytics) | Line/area (throughput), burn-up (open vs closed), horizontal bars (aging, backlog). |
| Context cost bar | Checks | Measured tokens / budget, color by headroom. |

## Containers & structure

| Component | Used in | Variants / states |
|---|---|---|
| Card | all | Base surface. |
| Panel (glass) | Planner | Elevated glass surface (backdrop blur). |
| Section / group header | Checks, Settings, Components | Icon + title + subtitle. |
| Inspector panel | Agents, Task detail, Map, Code | Contextual detail beside a list/canvas. |
| Tree row | Planner | Feature / phase / task; indentation, caret, inline add, density (comfortable/compact). |
| Table | Agents | Header + rows; per-row status and actions. |
| Tabs | Code | Editor file tabs. |
| Collapsible section | Planner (analytics, focus), Code | Caret; expanded/collapsed. |

## Overlays

| Component | Used in | Variants / states |
|---|---|---|
| Modal / dialog | Planner (project details), Task detail | Fixed title + close, scrolling body (`overscroll-behavior:contain`), scrim. |
| Dropdown menu | Planner (export) | Anchored panel; outside-click to close. |
| Toast | Planner | Transient confirmation. |
| Empty state | Planner (no results) | Message + reset action. |

## Specialized

| Component | Used in | Variants / states |
|---|---|---|
| Focus card | Planner | Sticky in-progress list + suggested next + parked; collapsible. |
| Suggested-next card | Planner, Resume | Shown when no task is active; Start action. |
| Proposal card | To evaluate | Status (in evaluation / proposed / deferred) + actions. |
| Restore point row | Settings | Backup entry + Restore. |
| Conflict banner | Code | Agent-edited-this-file keep-both. |
| Code view | Code | Syntax highlighting, line numbers, clickable symbols. |
| Map node + relation | Map | Entity nodes + edges; verified / uncertain / stale. |
