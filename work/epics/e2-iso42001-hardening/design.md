# Epic E2: ISO 42001 Technical Hardening — Design

> HOW. WHAT and WHY are in `scope.md`.

## Gemba (current state)

| Area | Today |
|------|-------|
| n8n callbacks | `services/workflow-governance-service/src/lib/verify-n8n-signature.js`: HMAC-SHA256 over `req.rawBody`, `X-IOA-Signature: sha256=…`, `X-IOA-Timestamp` within ±5 min. Applied only to `analysis.js` callback route. Skipped entirely when `N8N_WEBHOOK_SECRET` unset. `index.js` already captures `rawBody`. |
| execution-event | `workflows.js` `POST /:id/execution-event` — no verification; comment says it is deliberately unauthenticated. |
| enforcement-check | `workflows.js` `POST /:id/enforcement-check` — the actual workflow-execution block/allow gate (EP-201-S7/S8); no verification either, same documented rationale as execution-event. Missed by this epic's original S2.1 scope; added 2026-10-08. |
| `/enforce` permission gate | `governance-service/src/routes/enforcement.js:98-105` — not `requirePermission`-gated; its comment cites the AUTH-504 coarse write check as still covering it, but that check was removed under EP-308-S4 (`require-auth.js:26-35`). Any authenticated session, any role, can call it today. |
| Audit/approval actor binding | `audit-service/src/routes/events.js:12-16` and `governance-service/src/routes/approval-decisions.js:16-20` take `actor_id`/`actor`/`role` verbatim from `req.body`, never cross-checked against `req.user`. `governance-service/src/routes/approval-chains.js:51-59` takes `requested_by` the same way, which the separation-of-duties check in `approval-chain-engine.js:103` then compares against — spoofable by the same account that later approves. |
| Release-decision evidence | `governance-service/src/routes/release-decisions.js:15-19` computes `decision` server-side (good) but from a caller-supplied `evidence_bundle.violations.by_severity`, never cross-checked against real `governance.violations` rows for the entity. |
| Audit partitions | `db/migrations/audit/001_initial.sql`: monthly range partitions 2026-05..07 seeded by hand, plus `audit_events_default`. PK is `(id, created_at)`. No job creates later partitions. |
| CI | `Jenkinsfile` on agent `gilbert`: Checkout → Build SPA in `node:20-alpine` → rsync deploy. No tests. |
| Tests | Per-service vitest + supertest (`services/*/tests`), `scripts/test-all.js`, `bootstrap/tests/preserve-files.test.js`. |
| Auth | RS256 JWT with roles/permissions embedded at login (`rbac.js`, `permissions.js`); migrations 001–008. No MFA/SSO. |

## Target components

### S2.1 — n8n callback auth

- Apply `verifyN8nCallback` to `POST /:id/execution-event` **and `POST /:id/enforcement-check`** in `workflows.js`. Note `req.rawBody` is already captured globally in `index.js`. (Widened 2026-10-08 — `enforcement-check` was missed in the original story scope despite being the more consequential of the two, since it's the route that actually halts workflow execution.)
- Change the unset-secret behaviour: if `N8N_WEBHOOK_SECRET` is absent and `NODE_ENV !== 'development'`, respond 503 with a clear error (fail closed) and log a startup warning. Keep dev convenience.
- Env wiring already exists (`N8N_WEBHOOK_SECRET: ${N8N_WEBHOOK_SECRET}` in `platform.config.yaml` and the generated compose file), so no config change is needed. The real work is operational: generate a secret, set it in `.env`, and update the n8n HTTP nodes (see `docs/Security-Operations.md` rotation steps and `docs/n8n-ai-governance-analysis-workflow.md`, which still says the secret is unset and should be updated).
- Existing tests in `tests/analysis.test.js` cover the analysis route; add equivalent cases for `execution-event` and `enforcement-check`.
- Optional hardening: reject a replayed `(signature, timestamp)` pair inside the 5-minute window using a small in-memory set. Only worth it if the callback is not already idempotent — check during story design.
- Rollout order matters (see scope risks): update n8n HTTP nodes first, then enable enforcement.

### S2.8 — Close the `/enforce` permission-gate gap

- `enforcement.js`'s `POST /` handler currently runs behind `requireAuth` only (applied globally in `index.js`), with no `requirePermission` call and no explicit `isService` check of its own — it relies entirely on the (stale) claim that AUTH-504's coarse check still covers it.
- Fix: add an explicit guard at the top of the route — `if (!req.user?.isService) return res.status(403).json({ error: 'Internal service callers only' })` — matching the route's own documented intent (machine-to-machine, called by Kong's `ioa-mcp-enforcement` plugin and workflow-governance-service's `enforcement-check`, never by a browser session).
- Rewrite the stale comment to state the real history: AUTH-504's check was removed under EP-308-S4; this route was missed when every other mutating route got its `requirePermission` call, and is now closed via an explicit service-only guard instead, since no single named permission fits a machine-to-machine policy check.
- Test: a valid human-session JWT of any role (including a role with zero permissions) gets 403; a request carrying a valid `X-Internal-Service-Key` still succeeds. Add to `tests/enforcement.test.js`.

### S2.9 — Authenticated identity binding on audit/approval writes

- `audit-service/src/routes/events.js`'s `POST /` and `governance-service/src/routes/approval-decisions.js`'s `POST /`: when `req.user.isService` is false (a human session), overwrite `actor_id`/`actor` (and `actor_type`/`role` where present) from `req.user.id`/`req.user.username` rather than trusting `req.body`. When `req.user.isService` is true, keep accepting the caller-supplied value — the calling service is itself the accountable party and already derives it correctly (e.g. `auth-service/src/lib/audit-client.js` populates it from the real user it has in hand).
- `governance-service/src/routes/approval-chains.js`'s `POST /requests`: same pattern for `requested_by` — human callers get it overwritten from `req.user.username`; service-key callers (the documented legitimate delegation case) keep the override.
- This directly closes the self-approval loophole: `approval-chain-engine.js:103`'s `actor === request.requested_by` check becomes meaningful again once `requested_by` can't be set to an arbitrary non-matching string by the same human account that will later approve.
- Tests: for each of the three routes, a human-session request whose body claims a different actor than the session's own identity must persist the session's real identity, not the claimed one. A service-key request's explicit actor must still be honored unchanged (regression coverage for the legitimate case).

### S2.10 — Server-derived release-certification evidence

- `release-decisions.js`'s `computeDecision()` currently reads `evidenceBundle.violations.by_severity` directly from the request body. Replace that input with a server-side query: `SELECT severity, count(*) FROM governance.violations WHERE asset_type = $1 AND asset_id = $2 AND status NOT IN ('resolved','waived') GROUP BY severity` (confirm exact status-exclusion list against `violations.js`'s own definitions during story design), then feed the resulting counts into the existing `computeDecision()` logic unchanged.
- Keep accepting `evidence_bundle` in the request/response — it's still useful supplementary context (e.g. `policy_coverage.pct`) — just stop trusting its violation counts as the input to the decision itself.
- Test: a `POST /release-decisions` call with a forged `evidence_bundle` claiming zero critical/high violations for an entity that has real critical violations in the DB must still return `rejected`.

### S2.2 — Audit partition management

New hand-authored module `services/audit-service/src/lib/partition-manager.js`, started from `index.js` (guarded, like the other startup hooks).

1. **Repair migration** `db/migrations/audit/003_partition_repair.sql` (or a one-off script if it must be conditional on data): in one transaction, for each month that has rows in `audit_events_default`, create a temp table, move those rows, create the proper partition, insert the rows back, and assert row counts. Postgres rejects `CREATE TABLE … PARTITION OF` for a range that overlaps default-partition rows, which is why the rows must be moved out first.
2. **Ensure function** `audit.ensure_partitions(months_ahead int)` — idempotent SQL that creates any missing monthly partitions from the current month through `months_ahead`.
3. **Scheduler** in `partition-manager.js`: runs at startup and every 24h, takes a Postgres advisory lock so multiple replicas don't race, calls `ensure_partitions(3)`.
4. **Gap alarm**: after each run, check (a) `audit_events_default` row count > 0, (b) fewer than N future partitions. On either, post an incident to escalation-service. audit-service does not have an escalation client today; add `src/lib/escalation-client.js` following the fail-soft pattern in ai-inference-service (E1-S1.3).
5. **Retention**: config table or env for `AUDIT_RETENTION_MONTHS`. When unset, nothing is dropped. When set, expired partitions are `DETACH`ed (and optionally exported) rather than dropped in the same step. Detach-then-drop separation keeps a mistake recoverable.

### S2.3 — CI pipeline

Extend the existing `Jenkinsfile` with stages before Build/Deploy, all inside `node:20-alpine` (and a `timescale/timescaledb` service container for migrations):

1. `Test` — `node scripts/test-all.js`
2. `Bootstrap drift` — `npm run bootstrap` then `git diff --exit-code`
3. `Migrate` — start ephemeral TimescaleDB, run `npm run migrate` twice (idempotency check)
4. `Lint` — define a minimum. Per repo notes no backend lint exists, so add a root ESLint config with a small rule set and apply it to `services/*/src` and `services/*/index.js`; start by failing only on errors.
5. `Images` — `docker build` each service (no push in this story)
6. Deploy stage gated to `main` only

Fix `.raise/manifest.yaml` test/lint commands as part of this story (PAT-S-001 records they are wrong).

### S2.4 — Integration tests

- `tests/integration/` at repo root, its own `docker-compose.integration.yml` (this is a hand-authored test harness, not the generated compose file).
- Scenario 1: login via auth-service → call a service through the gateway path → assert an audit event exists for the action.
- Scenario 2: create a hard-mode budget → drive inference requests over the limit → assert escalation incident row. E1 verified this manually; this makes it repeatable.
- Kong: shared Kong is not ours to start. Tests target services directly plus a stub for the gateway hop, or run only where Kong is reachable. Decide in story design; do not run `deck gateway sync` from tests.
- Wired into the S2.3 pipeline as a separate stage.

### S2.5 — Audit integrity

See ADR-001. Summary:

- New `audit.checkpoints` table: `id, window_start, window_end, row_count, rows_digest, prev_checkpoint_hash, checkpoint_hash, signature, key_id, created_at`.
- A sealing job (same scheduler as S2.2) seals windows that are closed (e.g. previous day/hour). `rows_digest` is a hash over rows ordered by `(created_at, id)`.
- `checkpoint_hash = SHA256(window bounds ‖ row_count ‖ rows_digest ‖ prev_checkpoint_hash)`, signed with RS256.
- `GET /audit/verify?from=&to=` recomputes digests and the chain, returns pass/fail with the first mismatch.
- `GET /audit/export?from=&to=` returns the rows plus the covering checkpoints in a format an auditor can verify offline.
- New permission `audit:verify` (and reuse the existing read permission for export), added to `permissions.js` with a migration.
- Interaction with S2.2 retention: before a partition is detached, every window inside it must already be sealed, and its checkpoints stay forever.

### S2.6 — MFA (TOTP)

- Migration `db/migrations/auth/009_mfa.sql`: `auth.user_mfa` (user_id, secret encrypted, enabled_at, last_used_step), `auth.mfa_recovery_codes` (hashed, used_at).
- Login becomes two-step when MFA is enabled: password → short-lived `mfa_pending` token → TOTP or recovery code → session cookie/JWT. The JWT gets an `amr` claim.
- Endpoints in `auth.js`: enroll (returns secret/QR URI), confirm, disable (requires current code), regenerate recovery codes, admin reset.
- Reject reuse of the same TOTP step (`last_used_step`) and rate-limit attempts.
- Enforcement policy: per-role "MFA required" setting. Default off until users enrol, so the seeded admin cannot be locked out.
- Secrets encrypted at rest with a key from env, not stored plaintext.
- Add a TOTP dependency to `auth-service/package.json` by hand — that file is hand-authored and in `preserveFiles`.

### S2.7 — OIDC SSO (SHOULD)

- `auth.identity_providers` and `auth.idp_group_role_map` tables (migration 010).
- Authorization-code flow with PKCE via a standard OIDC library; validate `iss`, `aud`, `nonce`, signature.
- Group claim → named role via the mapping table. Roles are re-resolved at every SSO login, so removal at the IdP takes effect.
- Just-in-time user creation with an `auth_source` column; local password login stays as break-glass for platform-admin.
- Decision needed on whether IdP-authenticated users also face IOA MFA (recommendation: trust IdP `amr` if it asserts MFA, otherwise require IOA MFA).
- SPA: "Sign in with SSO" on `Login.jsx`; IdP admin screen under Administration following the TagAdmin pattern.

## Key contracts

| Contract | Shape |
|----------|-------|
| n8n signed request | Headers `X-IOA-Signature: sha256=<hex HMAC of raw body>`, `X-IOA-Timestamp: <epoch ms>`; 401 on missing/invalid/stale; 503 when secret unset outside dev |
| Partition names | `audit.audit_events_YYYY_MM`, range `[first of month, first of next month)` |
| Checkpoint | Fields above; `checkpoint_hash` chains to previous; `key_id` identifies the signing key |
| Verify response | `{ ok: boolean, windows_checked, first_failure: { window_start, reason } \| null }` |
| MFA login | `POST /auth/login` → `{ mfa_required: true, mfa_token }` → `POST /auth/mfa/verify` → normal session |

## ADRs

### ADR-001 — Integrity via signed window checkpoints, not a per-row hash chain

**Context.** Audit rows are written concurrently by every service. A classic per-row chain (each row hashes the previous row) needs a single global ordering, so each insert must lock or wait on the latest row. That bottlenecks audit writes and makes an audit failure a platform-wide slowdown.
**Decision.** Leave inserts unchanged. A background job seals closed time windows into signed, chained checkpoints (digest of the window's rows plus the previous checkpoint hash).
**Consequences.** No write-path cost. Tampering is detectable once a window is sealed; rows in the still-open window are not yet protected. Deleting a whole window breaks the chain. Off-host anchoring (parking lot) would strengthen this later.
**Alternatives rejected.** Per-row chain (write bottleneck); relying on DB permissions alone (not verifiable by a third party).

### ADR-002 — Extend the existing Jenkinsfile

**Context.** A Jenkins pipeline on the `gilbert` agent already deploys the SPA.
**Decision.** Add test/drift/migrate/lint/image stages to it rather than introduce GitHub Actions in parallel.
**Consequences.** One CI system to maintain; depends on the `gilbert` agent being available and having Docker. If the repo moves to a hosted CI later, the stages port over as shell steps.

### ADR-003 — Partition maintenance inside audit-service

**Context.** The database is a TimescaleDB image; `pg_cron` is not guaranteed present, and DB-side jobs are invisible to the service's tests and deploys.
**Decision.** A guarded scheduler in audit-service calls an idempotent SQL function, protected by an advisory lock.
**Consequences.** Works with multiple replicas; the alarm path can reuse service clients; if audit-service is down nobody creates partitions, which the default partition and the gap alarm still cover.

## Story sequence

S2.1 → S2.2 → S2.3 → S2.4 → S2.5 → S2.6 → S2.7. S2.1 and S2.2 fix live problems and do not depend on anything else, so they go first. CI comes before the integration tests so the new tests land in a pipeline that already runs. Integrity comes after partitions because retention and sealing must agree on window boundaries.

## Notes for /rai-epic-plan

- Write a story-level design (`/rai-story-design`) for S2.2 first. It is the riskiest data operation and has the most non-obvious Postgres behaviour.
- Take a `pg_dump` of the `audit` schema before running any S2.2 repair against a real database.
