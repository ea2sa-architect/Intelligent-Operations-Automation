# Epic E3: Lineage → n8n Execution Linkage — Scope

> **Status:** ✅ Complete (implemented 2026-10-09, same session as design)
> **Created:** 2026-10-09
> **Backlog rows closed:** none new — amends EP-304 (Data Lineage & Sensitive Data Flow,
> marked "Done" in `docs/IOA-Implementation-Plan.html` but missing this linkage)

## Objective

The Data Lineage page showed aggregate boxes ("4 calls to good-model") with
no way to trace a finding back to the n8n workflow, execution, or node that
produced it. The user's own worked example: click a "PII went to an
external model" violation → see Workflow / Execution / Node / Data /
Policy → click **Open in n8n** → land on the exact execution.

**Value:** Turns a lineage finding from "informational, needs manual
investigation" into "actionable, one click from the violation to the live
n8n execution." Without this, the lineage/PII detection work IOA already
does (EP-304, redaction-patterns) can't actually drive a remediation
workflow — a reviewer has no way to find the workflow run that caused a
finding.

## Gemba findings that shaped scope (verified 2026-10-09, via Explore agent)

- `lineage_nodes`/`lineage_edges` (`db/migrations/workflow_governance/022_lineage.sql`)
  had no n8n execution/node columns, and `lineage-builder.js` derives nodes
  purely from `telemetry.metrics`, which never carried n8n's own
  `execution_id`/node name — only IOA's own internally-minted
  `correlation_id` (a different, unrelated identifier namespace).
- The natural place node-level "which n8n node called this model"
  granularity already existed was **not** per-node workflow telemetry
  (which doesn't exist — `execution-event` is once per execution, start/
  success/failure only) but **`POST /inference`** — every AI model call
  already carries `workflow_id` for budget-scoping, and whatever calls it
  (an n8n HTTP Request node, directly or via a thin proxy) can trivially
  also send n8n's built-in `$execution.id`/`$node.name` expressions at
  zero extra n8n-side API cost.
- `lineage-builder.js`'s lineage_nodes insert already does
  `metadata_json: { metric_name, value, ...labels }` — a verbatim spread of
  `labels_json`. This meant **no lineage-builder.js change was needed at
  all**: once `n8n_execution_id`/`n8n_node_name` exist as `labels_json`
  keys, they reach `lineage_nodes.metadata_json` for free.
- `n8n-client.js` already had the URL-stripping pattern needed for a human
  n8n UI deep link (`workflows.js:970`'s `N8N_WEBHOOK_BASE`, built for
  webhook trigger URLs) — just needed a sibling helper for execution URLs.
- `Lineage.jsx`'s SVG DAG nodes were hover-only; no onClick anywhere, no
  "open in n8n" precedent anywhere in the SPA.

## Stories (1, already implemented)

| ID | Story | Size | Description |
|----|-------|:----:|-------------|
| S3.1 | Lineage → n8n execution linkage | M | `inference_requests` gains `n8n_execution_id`/`n8n_node_name` (migration `005_n8n_execution_linkage.sql`), captured at `POST /inference` and merged into the completion-time telemetry event at `PUT /:id` (same request-scoped-field pattern as `workflow_id`). `lineage.js`'s `GET /:correlation_id` enriches each node with a `n8n: {workflow_id, workflow_name, execution_id, node_name, execution_url}` object (or `null`), resolving the workflow's display name and building the deep link via a new `n8nClient.buildExecutionUrl()` helper. `Lineage.jsx` gains a click-to-detail `NodeDetailModal` (DAG nodes and table rows both open it) showing the n8n linkage and an **Open in n8n** external link, plus violation messages in the summary banner are now clickable and jump straight to their chain. |

## Scope

**In scope:**
- S3.1 as above — the AI-inference-call path only (the concrete case in the
  user's example: a PII-shaped field flowing to an external model node).

**Out of scope (parking lot):**
- Per-node telemetry for non-model n8n nodes (e.g. a plain data-transform
  node with no AI/MCP call) — would need n8n-side instrumentation beyond a
  single HTTP Request node at workflow start, out of scope for this pass.
- Bridging the static `workflow_pii_exposure.node_name` (set at
  workflow-definition scan time) to a specific execution's lineage node —
  these remain two separate data paths; today's fix links the *telemetry*
  path (what actually ran) to n8n, not the *static-scan* PII path.
- A `getExecution(id)`-based fetch of full n8n node-run data — unnecessary
  once the triggering request already sends its own execution/node context;
  parked unless a future need requires reading n8n's execution detail back.

## Done Criteria

- [x] `POST /inference` accepts and persists `n8n_execution_id`/`n8n_node_name`
  — `tests/inference.test.js`
- [x] Completion-time telemetry event carries both fields — `tests/inference.test.js`, `tests/telemetry-client.test.js`
- [x] `GET /lineage/:correlation_id` returns a `n8n` object (workflow name +
  deep link) for a node with linkage, and `null` for one without, with zero
  extra query when no node has linkage — `tests/lineage.test.js`
- [x] `n8nClient.buildExecutionUrl()` strips `/api/v1` correctly and returns
  `null` on a missing id — `tests/n8n-client.test.js`
- [x] Lineage.jsx: clicking a node (DAG or table) opens a detail panel with
  Workflow/Execution/Node and an "Open in n8n" link when linkage exists, a
  clear fallback message when it doesn't; clicking a violation jumps to its
  chain — `src/pages/Lineage.test.jsx`
- [x] Full platform suite green (`node scripts/test-all.js`)

## Dependencies

None — additive, independent of the E2/S2.x work from the same day.

## Architecture

No ADR needed — this is a straightforward "propagate an optional field
through an existing pipeline, enrich at read time" change with no
structural decision point (confirmed during design: `metadata_json`'s
existing spread meant no schema/builder change for lineage itself, only for
`inference_requests`).
