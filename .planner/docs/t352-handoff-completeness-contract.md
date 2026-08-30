# T352 — Operational Handoff Completeness and Bounded Transport Contract

## Purpose

A handoff must let a new agent resume without asking for branch, location, commands, runtime caveats, expected behavior, verification status, or operator actions. Structural headings alone are insufficient.

## Completeness audit

Every canonical handoff write carries a versioned audit. Each category is either:

- `captured`, with substantive content; or
- `not-applicable`, with a substantive reason.

Required categories:

1. exact focus and resume point;
2. first resume action;
3. completed work;
4. partial work;
5. remaining work;
6. decisions and rationale;
7. rejected alternatives;
8. files and symbols;
9. branch and worktree;
10. commands and tools;
11. completed verification;
12. pending verification;
13. runtime limitations and workarounds;
14. blockers and risks;
15. user-visible behavior;
16. operator actions;
17. project-specific operating notes;
18. conversation-only facts.

Generic placeholders such as `none`, `n/a`, `unknown`, `same as above`, or `see handoff` are not substantive.

## Write contract

`handoff_prepare` returns the audit categories and current version. `handoff_write` requires the full audit and rejects missing or generic entries with typed `HANDOFF_COMPLETENESS_AUDIT_REQUIRED` diagnostics. The core cross-validates the canonical Markdown body against the audit, writes task/phase/feature context atomically, reads the persisted phase back, verifies the content hash, and persists durable audit metadata.

Legacy handoffs remain readable. New writes use the enforced contract.

## Size and supporting documents

The canonical inline handoff has a deterministic maximum of 24,000 characters. Resume-critical focus, exact resume point, first action, risks, verification state, user-visible behavior, and operator actions remain inline.

Extended logs, command transcripts, large mappings, and deep design material move to committed Markdown under `.planner/docs/`. The handoff must link each supporting document with a substantive explanation. Links supplement rather than replace the inline resume contract.

## Transport behavior

- Active handoff lists return compact summary metadata only; they never embed full handoff bodies.
- Lists are bounded and paginated.
- A targeted handoff show returns the bounded body and audit metadata consistently in both text content and MCP structured content.
- Pi and MCP expose equivalent semantics and typed diagnostics.

## Regression scenario

The reported real-world failure must be rejected when it omits any of the following:

- working branch `feat/notification-system-app`;
- composite references required because bare `T###` values collide across planners;
- the handoff-list/show client caveat;
- temporary Rust notification verification command and exact insertion point;
- centralized reporting protocol;
- user-visible behavior;
- Antonio's required manual actions;
- runtime and transport limitations.

The same scenario passes only after every category is captured or substantively marked not applicable.
