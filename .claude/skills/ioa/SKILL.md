---
name: ioa
description: Bring IOA governance into the dev loop — build governed artifacts, check work in progress, and certify a release. Use when the user asks to build/scaffold a governance policy, check or QA a workflow against governance policy, assess governance coverage, threat-model a workflow's attack surface, or verify/certify a release.
---

# /ioa

Wraps `packages/ioa-cli/` (bin: `ioa`). IOA remains the policy authority and
system of record — this skill/CLI is its developer-facing execution
surface, not a replacement for it.

## Setup

Requires `IOA_API_URL` and `IOA_API_KEY` in the environment — same
convention as `packages/discovery-agent/`. An API key is issued via
`POST /api/auth/api-keys` (needs an existing authenticated session/key with
`user:manage`); scope it to whatever the command needs (see table below).

If `packages/ioa-cli/node_modules` doesn't exist yet, run `npm install`
inside `packages/ioa-cli` first (host Node may be too old for this repo's
tooling — see this repo's own `CLAUDE.md`/session conventions for the
`node:20-alpine` Docker fallback already used throughout this project).

## Dispatch

| User asks for | Run | Required API key scopes |
|---|---|---|
| Build/scaffold a policy | `node bin/ioa.js build-policy [--apply]` | `policy:edit` (only needed for `--apply`) |
| Quick pre-commit-style policy check | `node bin/ioa.js policy-check <target>` | `workflow:read`, `violation:resolve` |
| Read-only governance snapshot | `node bin/ioa.js assess <target>` | `workflow:read`, `violation:resolve` |
| Attack-surface / blast-radius report | `node bin/ioa.js threat-model <target>` | `workflow:read`, `violation:resolve` |
| Full QA incl. controlled execution testing | `node bin/ioa.js qa <target>` | `workflow:read`, `violation:resolve` (+ an approved execution profile for the execution tier to run rather than report `not_eligible`/`not_approved`) |
| Release gate / certification | `node bin/ioa.js verify-release <target> --release-ref <sha>` | everything `qa` needs, plus `release:certify` |

`<target>` is a workflow's IOA id, its `n8n_id`, or its exact name — if not
yet imported into IOA, it's registered automatically as the pipeline's
first step (never a separate command of its own).

Every command supports `--json` for raw output — prefer that when the
result needs parsing, and summarize it back to the user in prose otherwise.
Always surface the exit code and, for `qa`/`verify-release`, the
`execution.status` field prominently: `not_eligible`/`not_approved` mean
the execution tier didn't run, which is a materially different governance
posture than `tested`, not just missing data.

## Controlled execution testing (qa's execution tier)

Only possible for workflows with a Webhook trigger node — n8n's own public
API has no endpoint to trigger a workflow execution at all; a Webhook
node's URL is the only way in. It also requires an **approved test-execution
profile** — a governance artifact, not a CLI flag:

1. `POST /api/workflow-governance/workflows/:id/execution-profile` —
   `{scenarios: [{name, payload_json, expected_outcome}]}`. 422s if the
   workflow has no Webhook node.
2. A human with `workflow:execution-approve` reviews and
   `PATCH /api/workflow-governance/workflows/:id/execution-profile/:profileId/approval`
   — `{decision: "approved"|"rejected", reason?, expiration?}`.
3. Only then does `ioa qa`'s execution tier actually POST the approved
   scenarios to the workflow's real webhook URL and report real HTTP
   outcomes (status, latency) — never fabricated, never silently skipped.

Don't request or approve an execution profile for a workflow without
understanding what a real invocation does — it's a real call against a
real, possibly-production automation.

## What's deliberately not built here

Auto-remediation (`--fix`) and a re-verify-to-confirm-closure loop
(`--recheck`) were scoped out — every `qa`/`verify-release` result already
tells you what's wrong (open violations, coverage gaps, execution
failures); acting on those findings is still a human or a separate,
explicitly-designed change, not something this skill silently does on your
behalf.
