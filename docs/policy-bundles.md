# Policy bundles

A policy bundle is a portable JSON description of one or more policies: their rules, settings and bindings. It lets you keep policies in Git, review a change as a diff, back policies up, and reuse them.

**Scope today:** bundles are suited to backup, review and *same-environment* reuse. Bindings point at this environment's workflow, MCP server and AI model ids, so a bundle is not yet a dev→test→prod promotion artifact. That needs stable binding references and per-environment target mapping, which is a follow-up.

The policy editor in the UI stays the primary way to author policies. Bundles are how you move them in and out.

## Safety model

- **Imports always land as Draft / Observe.** A bundle's `requested_mode` is what its author wants; it is shown in the preview and recorded on the policy, but never applied. Activating or enforcing is the existing, separate, deliberate step.
- **Validate first.** `POST /policy-bundles/validate` (and the UI preview) is a dry run that writes nothing. Import re-validates on the server, so a stale preview cannot slip through.
- **All or nothing.** Every policy in a bundle is imported in one transaction.
- **Name collisions are rejected.** Replacing an existing policy is opt-in (`on_conflict: "replace"`), needs `policy:edit` on top of `policy:import`, resets that policy to Draft / Observe, and is refused if it would delete a rule that has violations or control tests attached.
- **Rules the platform doesn't evaluate** (`prompt_inspection`, `logging_restriction`, `execution_rate`) are flagged in the preview, on the policy list and detail, and again when someone activates or enforces a policy that holds one. They are recorded but never checked, so an "Enforce" policy containing only those protects nothing.
- **Audited.** Exports and imports emit `policy.bundle_export` / `policy.bundle_import` events with outcome `success` or `failure`. A success event is only emitted after the import has committed.

## Format: `ioa.policy-bundle/v1`

```json
{
  "schema": "ioa.policy-bundle/v1",
  "policies": [
    {
      "name": "PII Output Protection",
      "description": "…",
      "bundle_version": "1.0.0",
      "requested_mode": "observe",
      "rules": [
        {
          "name": "pii-in-output",
          "rule_type": "pii_detection",
          "severity": "high",
          "enabled": true,
          "priority": 0,
          "config": { "inspection_targets": ["webhook_payload"], "sensitive_fields": ["SSN"], "actions": ["flag_workflow"] }
        }
      ],
      "bindings": [{ "entity_type": "workflow", "entity_id": "…" }]
    }
  ]
}
```

A complete, valid example is in [`policies/examples/pii-output-protection.bundle.json`](../policies/examples/pii-output-protection.bundle.json).

| Field | Notes |
|---|---|
| `name` | Unique key. Matching an existing policy is case-insensitive. |
| `bundle_version` | Free-text label, kept in `metadata_json`. The integer policy version is managed by the server. |
| `requested_mode` | `observe`, `warn` or `enforce`. Never applied on import. |
| `rules[].name` | Stable key within the policy (letters, digits, spaces, `_ . : / ( ) -`, up to 128 characters). Used to match rules on replace. |
| `rules[].rule_type` | A type from `GET /rule-schemas`. |
| `rules[].config` | Validated against that type's schema: allowed keys only, required fields present, enum values from the declared options. `severity` is a separate field of the rule, not part of `config`. |
| `bindings[]` | `entity_type` is one of `workflow`, `mcp_server`, `ai_model`, `zap`. The target must exist in this environment (a Zap counts as existing once it has been bound by an evaluation). A policy with no bindings applies to nothing, and the preview says so. |

Unknown fields are rejected at every level. Limits: 100 policies per bundle, 200 rules and 500 bindings per policy, 16 KB / 8 levels of nesting per rule config, 100 KB request body.

Exports are deterministic (policies by name, rules by priority then name, sorted config keys, no ids or timestamps inside a policy) so an unchanged policy re-exports byte-for-byte. Rules created before names existed are exported as `<rule_type>-<n>`.

**Legacy rules.** Rules built with the old custom-condition editor (`condition_json`, no rule type) cannot be represented in a bundle. Exporting a policy that has them is refused, rather than producing a bundle that restores to a weaker policy; the UI asks whether to export without them, and the API takes `skip_legacy=true`.

## Using it

**UI (Governance page):** *Export* downloads the policies in the current filter, or use the download icon on a policy's detail view for just that one. *Import* (needs `policy:import`) opens a file, shows the preview with errors and warnings, and imports on confirm.

**API** (through Kong, `/api/governance/…`):

| Call | Permission |
|---|---|
| `GET /policy-bundles/export?ids=&status=&skip_legacy=` | `policy:read` |
| `POST /policy-bundles/validate` `{ bundle, on_conflict }` | `policy:read` |
| `POST /policy-bundles/import` `{ bundle, on_conflict }` | `policy:import` (+ `policy:edit` for `replace`) |

`on_conflict` is `reject` (default) or `replace`. `policy:import` is granted to `governance-officer`, `platform-admin` and `admin`.

## Not yet

Version history and rollback, approval records for activation, cross-environment promotion, a CLI/Git deployment path, and evaluators for rule types the platform does not evaluate yet.
