# Epic E4: Clear Workflows (admin reset) — Scope

> **Status:** ✅ Complete (implemented 2026-10-09, same session as design)
> **Created:** 2026-10-09

## Objective

Switching the n8n connection (E12) left 100+ stale workflow rows from the
previous endpoint with no way to clear them except a raw SQL `DELETE`,
which also kept tripping the session's own destructive-action permission
classifier. The user asked directly for an in-product feature to do this.

**Value:** Makes "reset and re-import from a new source" a supported,
self-service admin action instead of a DB console operation.

## Stories (1, already implemented)

| ID | Story | Size | Description |
|----|-------|:----:|-------------|
| S4.1 | Clear All Workflows | S | `DELETE /workflows` deletes every row in `workflow_governance.workflows` (cascades to nodes, PII/secret findings, risk history, lineage, assurance evidence, analyses via existing `ON DELETE CASCADE`). New permission `workflow:manage` (migration `009_workflow_manage_permission.sql`), granted to **no role except platform-admin/admin** — deliberately not folded into `workflow:read`, which `auditor`/`business-owner` also hold. Writes a `workflow.bulk_delete` audit event via a new `audit-client.js` for workflow-governance-service (its first — the service had none before). SPA: a "Clear All" button on the Workflow Governance page, visible only to `hasPermission('workflow:manage')`, gated behind a confirm dialog (`useConfirm`) that names the current workflow count. |

## Scope

**In scope:** S4.1 as above — unconditional clear, no platform filter (explicit user choice: simplicity over a filtered variant for v1).

**Out of scope (parking lot):**
- Platform-scoped clear (e.g. "clear only n8n workflows, leave Make/Zapier/Camunda") — straightforward to add later as a query param without changing the route's contract, deferred until someone actually needs it.
- Clearing anything beyond workflows (violations, platform connections, lineage chains independent of a workflow) — user explicitly scoped this to workflows only.

## Done Criteria

- [x] `DELETE /workflows` removes all rows and returns `{ deleted: <count> }` — `tests/workflows.test.js`
- [x] Gated on `workflow:manage`, not `workflow:read` — migration `009_workflow_manage_permission.sql` grants it to platform-admin/admin only
- [x] Writes a `workflow.bulk_delete` audit event with actor + count — `tests/audit-client.test.js`, `tests/workflows.test.js`
- [x] SPA button hidden without the permission, disabled when there's nothing to clear, confirm-gated, surfaces success/error — `src/pages/WorkflowGovernance.list.test.jsx`
- [x] Full platform suite green (`node scripts/test-all.js`, frontend `vitest run`)

## Dependencies

None — independent of E11/E12 from the same day, though motivated by the
same n8n-endpoint-switch scenario.

## Architecture

No ADR needed. One design note: deliberately **not** reusing `workflow:read`
for the permission gate, since three of the five named roles already hold
it and none of them should be able to bulk-delete governed data — see
`009_workflow_manage_permission.sql`'s header comment for the full reasoning
(same pattern as S2.8's `/enforce` fix from the day before: match the
permission to the actual blast radius of the action, not the nearest
existing one).
