# Product capability audit

The field-level capability manifest in `test/field-capabilities.mjs` is the source of truth for canonical human-owned fields. It declares semantic operations and expected coverage across core, Pi, MCP, HTTP, Web UI, agent-load context, documentation, and behavioral tests.

## Workflow

1. Update the manifest when a canonical field or operation changes.
2. Add or update a behavioral regression that proves persistence and user-visible reachability.
3. Run `node scripts/capability-audit.mjs --check`.
4. Run the focused affected tests, then the canonical final verification gate at phase or release close.

The audit classifies fields as `complete`, `partial`, `harness-specific`, or `exempt`. A handler registration alone never establishes completeness. Derived, planner-owned, and removed compatibility fields must carry an explicit exception rationale.

Generate local JSON and Markdown reports with:

```sh
node scripts/capability-audit.mjs --write
```

Reports are local generated artifacts under `reports/` and are intentionally not committed.
