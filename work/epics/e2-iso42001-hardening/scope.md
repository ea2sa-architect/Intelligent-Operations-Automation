# Epic E2: ISO 42001 Technical Hardening — Scope

> **Status:** Designed (not started)
> **Created:** 2026-09-18
> **Updated:** 2026-10-08 — scope expanded per `docs/baseline-assessment-2026-10.md`'s
> Modernization Gate (S2.1 widened to a third route; S2.8–S2.10 added). See that
> report for the full evidence trail behind each new story.
> **Backlog rows closed:** E2 (MFA/SSO), E4 (CI/CD), E5 (audit partitions), E6 (integration tests), E8 (n8n callback auth)

## Objective

Make the evidence IOA produces trustworthy enough for an ISO/IEC 42001
internal audit or certification body to rely on: audit records that cannot be
silently lost or altered, inbound webhooks that cannot be forged, human access
protected by a second factor, and a repeatable pipeline that proves the
platform still works before anything ships.

**Value:** Every later ISO 42001 epic (AIMS registers, impact assessment,
internal audit, CAPA) writes its evidence through audit-service and its
approvals through auth-service. This epic is the foundation those rely on.
It is not itself conformity — see "Out of scope".

## Gemba findings that shaped scope (verified 2026-09-18)

- **n8n callback auth is partly built.** `verify-n8n-signature.js` (EP-310-S1/S2)
  does HMAC + 5-minute timestamp window on `POST /workflows/analyze/callback/:job_id`,
  but it **fails open when `N8N_WEBHOOK_SECRET` is unset**, and
  `POST /workflows/:id/execution-event` does not use it at all.
- **A third unauthenticated n8n-facing route exists that this epic's original
  scope missed**: `POST /workflows/:id/enforcement-check` — the actual
  workflow-execution block/allow gate (EP-201-S7/S8) — has zero signature or
  replay protection, the same gap as `execution-event` but on the one route
  whose result halts a running workflow. Found during the 2026-10-08 baseline
  assessment; CLAUDE.md previously documented only two of these three routes.
- **`POST /enforce` in governance-service has no permission gate.** Its own
  comment claims it's "still covered by the existing coarse write-permission
  check in require-auth.js" — that check was removed under EP-308-S4 (see
  `require-auth.js`'s own changelog comment). Any authenticated session of
  any role, including the read-only `auditor` role, can currently call it.
- **Several append-only evidence/approval writes trust caller-supplied
  identity or evidence with no server-side cross-check**: audit-service's
  `POST /events` (`actor_id`/`actor_type`), governance-service's
  `POST /approval-decisions` (`actor`/`role`) and `POST /approval-chains/requests`
  (`requested_by`, exploitable to satisfy a separation-of-duties check with a
  fabricated non-matching identity), and `POST /release-decisions` (trusts the
  caller-supplied `evidence_bundle.violations.by_severity` counts rather than
  re-querying real violation state).
- **Audit partitions are already lapsed.** `001_initial.sql` seeded partitions
  only through 2026-07. Today is 2026-09-18, so August and September events are
  sitting in `audit_events_default`. Postgres refuses to `CREATE` a partition
  whose range overlaps rows already in the default partition, so the fix is
  not just "create next month".
- **CI exists but only deploys the SPA.** The `Jenkinsfile` runs on the
  `gilbert` agent and does build + rsync. It never runs tests.
- **No MFA/SSO code** exists in auth-service or its migrations.
- **Tests are per-service only** (`scripts/test-all.js` runs each service's
  vitest plus one bootstrap regression). Nothing exercises a request across
  service boundaries.

## Stories (9 MUST, 1 SHOULD)

| ID | Story | Size | Description |
|----|-------|:----:|-------------|
| S2.1 | Close n8n callback auth gaps | S | Apply signature verification to `execution-event` **and `enforcement-check`** (widened 2026-10-08 — see Gemba); fail closed when the secret is unset outside dev; set a real secret in the deployment `.env` (env wiring already exists in `platform.config.yaml`, but `docs/n8n-ai-governance-analysis-workflow.md` says the value is unset, so the callback is open in practice); update the n8n HTTP node setup |
| S2.2 | Audit partition management | M | Repair the lapsed default-partition data; scheduled pre-creation of future partitions; gap alarm through escalation-service; retention policy mechanism (detach/archive, no silent drop) |
| S2.3 | CI pipeline for tests and drift | M | Extend the existing Jenkinsfile: run `scripts/test-all.js`, `npm run bootstrap` drift check, migration check on an ephemeral TimescaleDB, image build; define a minimal lint |
| S2.4 | Cross-service integration tests | M | Compose-based harness; auth → Kong → service → audit path; budget breach → escalation incident path; runs in the S2.3 pipeline |
| S2.5 | Audit integrity checkpoints | L | Signed, chained checkpoints over sealed audit windows; verify endpoint; verifiable export (ADR-001) |
| S2.6 | MFA (TOTP) | M | Enrollment, login challenge, recovery codes, admin reset; enforcement toggle per role |
| S2.7 | SSO via OIDC (SHOULD) | L | OIDC login, IdP group → named-role mapping, JIT user provisioning; local login retained as break-glass |
| S2.8 | Close the `/enforce` permission-gate gap | S | Added 2026-10-08. Gate `POST /enforce` so a human session can no longer call it regardless of role; restrict it to `req.user.isService` (the internal-service-key path), matching its own doc comment's stated intent that it's a machine-to-machine decision point for Kong/n8n, not a browser-session endpoint. Fix the stale comment referencing the removed AUTH-504 check. |
| S2.9 | Authenticated identity binding on audit/approval writes | M | Added 2026-10-08. `audit-service`'s `POST /events` and governance-service's `POST /approval-decisions` must derive `actor_id`/`actor` server-side from `req.user` for human-session callers (service-key callers keep passing an explicit actor, since the calling service is itself accountable). `POST /approval-chains/requests` must derive `requested_by` from `req.user` the same way, closing the self-approval loophole in the separation-of-duties check. |
| S2.10 | Server-derived release-certification evidence | S | Added 2026-10-08. `POST /release-decisions` must re-query `governance.violations` for the entity server-side and compute `by_severity` from that, rather than trusting the caller-supplied `evidence_bundle.violations.by_severity` counts. The submitted bundle becomes supplementary context, not the input to `computeDecision()`. |

## Scope

**In scope (MUST):**
- S2.1–S2.6, S2.8–S2.10 as above.
- Fix the stale backlog entries in `governance/backlog.md` (row E1 named
  permissions is built) and the "not built yet" list in the
  `ioa-platform-reference` skill (named permissions and AI budgets are built).
  This is a chore, not a story.

**In scope (SHOULD):**
- S2.7 OIDC SSO.

**Out of scope:**
- **SAML** — deferred until an IdP is chosen; OIDC covers the common IdPs. Parking lot.
- **Environment-specific K8s overlays** (backlog E3) — unrelated to evidence integrity.
- **Any AIMS registers, impact assessment, training, supplier or review features** — later ISO 42001 epics.
- **Organizational conformity work** (executive approval, competence, management review) — people work, not code.
- **Kong config changes beyond what a story strictly needs** — remember `npm run kong:sync` is tag-scoped (see CLAUDE.md danger note).

## Done Criteria

**Per story:**
- [ ] Tests passing via `node scripts/test-all.js` (run in `node:20-alpine`; host Node v12 cannot run vitest)
- [ ] Hand-authored files only where CLAUDE.md permits; generated files untouched, `npm run bootstrap` produces no diff
- [ ] Any new permission added to `services/auth-service/src/lib/permissions.js` with a migration and role mapping

**Epic complete (measurable):**
- [ ] A forged or replayed request to any of the three n8n-facing routes returns 401, and a service started without `N8N_WEBHOOK_SECRET` outside dev refuses to accept them (signature check now applied to all three routes 2026-10-08; the fail-closed-on-unset-secret behavior is still open)
- [x] A human-session JWT (any role) calling `POST /enforce` directly gets 403; only `X-Internal-Service-Key` callers succeed — done 2026-10-08, `tests/enforcement.test.js`
- [x] A human-session caller cannot set `actor_id`/`actor`/`requested_by` to an identity other than their own on `POST /events`, `POST /approval-decisions`, or `POST /approval-chains/requests` — done 2026-10-08, test coverage in each route's own test file
- [x] `POST /release-decisions` returns `rejected` for an entity with real critical/high violations in the database even when a forged `evidence_bundle` claims zero — done 2026-10-08, `tests/release-decisions.test.js`
- [ ] `audit_events_default` holds zero rows; partitions exist for at least the next 3 months; a simulated missing partition raises a real escalation incident
- [ ] Tampering with any audited row in a sealed window makes the verify endpoint fail, demonstrated by a test
- [ ] Pipeline runs unit tests, drift check, migrations and integration tests on every push to `main` and fails the build on any of them
- [ ] A user with MFA enabled cannot obtain a session with a password alone; recovery and admin reset both work
- [ ] (SHOULD) An OIDC login maps IdP groups to named roles and the resulting JWT carries the right permissions
- [ ] `governance/architecture/modules/audit-service.md`, `auth-service.md`, `workflow-governance-service.md` updated
- [ ] Retrospective completed; merged to `main`

## Dependencies

```
S2.1 (independent, smallest, closes a live hole)
S2.2 (independent, fixes live data problem)
S2.8 (independent, smallest, closes a live hole)
S2.9 (independent)
S2.10 (independent, smallest)
   ↓
S2.3 (CI) ──► S2.4 (integration tests run in CI)
   ↓
S2.5 (integrity) ◄── S2.2 (needs stable partition/retention model)
S2.6 (MFA) ──► S2.7 (SSO; MFA decision needed for IdP-authenticated users)
```

S2.8, S2.9, and S2.10 are each independent, single-route permission/provenance
fixes with no dependency on any other story in this epic — they can land in
any order, in parallel with S2.1/S2.2, and do not need to wait on S2.3's CI
pipeline to be merged (though they should obviously run through it once it
exists).

**External:** S2.7 needs an identity provider and test tenant (decision below).
S2.3 depends on access to the Jenkins `gilbert` agent.

## Architecture

| Decision | ADR | Summary |
|----------|-----|---------|
| Integrity via signed window checkpoints, not a per-row hash chain | ADR-001 | A per-row chain forces every audit write to serialize behind the previous one |
| Extend the existing Jenkinsfile rather than adopt a second CI system | ADR-002 | Jenkins on `gilbert` is already the deploy path |
| Partition maintenance runs inside audit-service, not pg_cron | ADR-003 | Keeps it in the same repo, tests and deploy unit |

See `design.md`.

## Risks

| Risk | L/I | Mitigation |
|------|:---:|------------|
| Repairing the default partition moves live audit rows; a mistake loses evidence | M/H | Do it in one transaction with row-count assertion before/after, rehearse on a restored copy, and take a `pg_dump` of the audit schema first |
| Failing closed on the n8n secret breaks running n8n workflows until their HTTP nodes send headers | H/M | Ship n8n-side header setup and a startup log warning first; flip enforcement only after the n8n workflows are updated, with a documented rollout order |
| MFA lockout of the seeded admin | M/H | Recovery codes plus a documented CLI/SQL reset that works without a session; MFA enforcement off by default until enrolled |
| Signature keys for checkpoints become a new secret to manage | M/M | Reuse the RS256 key material and rotation approach auth-service already has; record the key id in each checkpoint so rotation doesn't invalidate history |

## Open decisions (need the user)

1. **Identity provider** for S2.7 (Entra ID, Okta, Google, Keycloak, other).
2. **Audit retention period** — no data is dropped by S2.2 until this is set.
3. **Should the n8n secret be mandatory everywhere, or only when `NODE_ENV=production`?** Recommendation: mandatory unless `NODE_ENV=development`.
4. **Who holds the checkpoint signing key** — reuse auth-service's JWT key or a separate key.

## Parking Lot

- SAML SSO → after IdP decision
- Off-host anchoring of checkpoints (WORM bucket / external timestamping) → after S2.5 if an auditor asks for stronger tamper evidence
- Backlog E3 (K8s overlays), E9 (tag usage reporting) → untouched

## Implementation Plan

> Added by `/rai-epic-plan` — 2026-09-18. Plans are hypotheses, not commitments;
> no dates, because E1's velocity data is thin (first RaiSE-tracked epic).

### Story Sequence

| Order | Story | Size | Dependencies | Milestone | Rationale |
|:-----:|-------|:----:|--------------|-----------|-----------|
| 1 | S2.1 | S | None | M1 | Quick win that closes a live hole (unverified `execution-event`, fail-open secret). Also validates the test-in-`node:20-alpine` workflow before the harder stories |
| 2 | S2.2 | M | None (parallel-capable with S2.1) | M1 | Risk-first: it moves live audit rows and every day it waits, more events pile into the default partition. Do its story-level design first, rehearse on a restored copy |
| 3 | S2.3 | M | None hard; soft on S2.1/S2.2 being merged so the first pipeline run is green | M2 | Builds the pipeline that S2.4 through S2.7 then run inside |
| 4 | S2.4 | M | S2.3 | M2 | Needs the pipeline to run in. Only meaningful once S2.2 exists, because the audit path is scenario 1 |
| 5 | S2.5 | L | S2.2 | M3 | Retention and sealing must agree on window boundaries. Largest and most novel story, so it gets a full story-design pass and an ADR-001 revisit if the window size proves wrong |
| 5 | S2.6 | M | None | M3 | Independent of the audit stories (auth-service only), so it can run as a parallel stream if a second person or session is available |
| 6 | S2.7 | L | S2.6 | M4 | SHOULD priority. Needs the MFA decision and an IdP, so it goes last and can be dropped without failing the epic |

**Critical path:** S2.2 → S2.5 (the audit chain). Everything else has slack.

### Milestones

| Milestone | Stories | Success criteria |
|-----------|---------|------------------|
| **M1: Live problems closed** | S2.1, S2.2 | A forged request to either n8n route returns 401 and a service without the secret refuses them outside dev. `audit_events_default` has zero rows, partitions exist 3 months ahead, and a deliberately removed future partition raises a real escalation incident |
| **M2: Safety net** | S2.3, S2.4 | One Jenkins run executes unit tests, bootstrap drift check, double migration, lint, image build and the integration scenarios, and fails when any of them is broken on purpose |
| **E2E Integration Checkpoint** (PAT-E-539) | — | Before M4. Multi-component epic (audit-service, auth-service, escalation-service, workflow-governance-service, SPA, Jenkins). Run real `docker compose` with a real DB. Log in with MFA, trigger an audited action, seal a checkpoint, tamper with a row and confirm `/audit/verify` fails, and send a signed and an unsigned n8n callback. Confirm the header names, token claims and payload shapes in "Key contracts" match what each side actually sends |
| **M3: Evidence integrity** | S2.5, S2.6 | Tampering with a sealed row fails verify in a test. A password alone cannot obtain a session for an MFA-enabled user, and recovery and admin reset both work |
| **M4: Epic complete** | S2.7 (SHOULD) | All Done Criteria in this document met, module docs updated via `/rai-docs-update`, retrospective done. If S2.7 is dropped, record it in the parking lot and close on M3 |

### Parallel Work Streams

```
Stream 1 (Critical): S2.2 ─► S2.3 ─► S2.4 ─► S2.5 ─┐
Stream 2:            S2.1 ──┘                       ├─► E2E checkpoint ─► M4
Stream 3 (auth):                        S2.6 ─► S2.7 ┘
```

**Merge points:** S2.1 merges before S2.3 so the first pipeline run is green. Streams 1 and 3 merge at the E2E checkpoint.

### Progress Tracking

| Story | Size | Status | Actual | Velocity | Notes |
|-------|:----:|:------:|:------:|:--------:|-------|
| S2.1 | S | Partial | — | — | Signature verification now applied to execution-event + enforcement-check (2026-10-08) with tests; the unset-secret fail-closed behavior and n8n HTTP node/`.env` rollout are still open |
| S2.2 | M | Not started | — | — | Story design first; `pg_dump` of `audit` schema before any repair |
| S2.3 | M | Not started | — | — | Needs the `gilbert` Jenkins agent |
| S2.4 | M | Not started | — | — | Decide how to handle the shared Kong hop in story design |
| S2.5 | L | Not started | — | — | Needs open decision 4 (signing key) |
| S2.6 | M | Not started | — | — | |
| S2.7 | L | Not started | — | — | Needs open decision 1 (IdP) |
| S2.8 | S | ✅ Done | S | — | Service-only guard on `POST /enforce`; test coverage in `tests/enforcement.test.js` |
| S2.9 | M | ✅ Done | S | — | Identity binding on audit-service `POST /events`, governance-service `POST /approval-decisions` and `POST /approval-chains/requests`; test coverage added to each route's existing test file |
| S2.10 | S | ✅ Done | S | — | `release-decisions.js` now re-queries `governance.violations` server-side; test coverage added to `tests/release-decisions.test.js` |

### Sequencing Risks

| Risk | L/I | Mitigation |
|------|:---:|------------|
| Open decisions 1, 2 and 4 stay unanswered and block S2.2 retention, S2.5 and S2.7 | M/M | S2.2's retention is off by default so it can ship without decision 2. S2.5 needs decision 4 before its story design. S2.7 is SHOULD and can be dropped |
| S2.1's fail-closed change is enabled before the n8n HTTP nodes send headers, breaking live workflows | M/H | Ship the n8n-side header instructions and a startup warning first; flip enforcement in a separate step after the n8n nodes are updated |
| Jenkins `gilbert` agent unavailable or lacks Docker-in-Docker for the ephemeral TimescaleDB | M/M | Check the agent's Docker access at the start of S2.3 story design; fall back to a host-installed Postgres only as a last resort |
| Skipping the E2E checkpoint because unit tests with mocks pass | M/H | It is a named milestone row, not folded into M3 or M4, and has to be marked done explicitly |
