import { Router } from 'express';
import crypto from 'crypto';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';
import scorer from '../lib/mcp-risk-scorer.js';
import credentialScanner from '../lib/credential-scanner.js';
import governanceClient from '../lib/governance-client.js';
import kongProvisioner from '../lib/kong-provisioner.js';
import escalationClient from '../lib/escalation-client.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const TRANSPORTS   = ['local', 'remote'];
const ENVIRONMENTS = ['development', 'test', 'production'];
const RISK_TIERS   = ['low', 'moderate', 'high', 'critical'];
const STATUSES     = ['pending_review', 'approved', 'rejected', 'retired'];

// Epic 5, Feature 5.3 — replaces this server's 'server_config' credential
// findings with a fresh scan result. Delete + reinsert, same pattern as
// workflow-governance-service's secret/PII exposure upserts.
//
// EP-101-S9 — before wiping, carry forward rotation_confirmed_at/by for any
// finding whose exact fingerprint reappears. A credential claimed as rotated
// that's detected again (same fingerprint) keeps showing its
// rotation-confirmed state next to a finding that's still present — proof
// the claim didn't hold.
//
// scannedFields scopes the DELETE to only the field_names actually rescanned
// this request. PUT here is a partial update (COALESCE — an omitted field
// means "leave unchanged"), so a PUT that doesn't touch `endpoint` must not
// wipe a still-valid finding recorded against `endpoint` from an earlier
// request. Must always run (even when findings is empty) — that's what
// clears a finding once its field is rescanned and found clean; an
// `if (findings.length > 0)` guard around the whole call would mean a
// resolved exposure never gets deleted.
async function persistCredentialFindings(serverId, scannedFields, findings) {
  const { rows: existing } = await pool.query(
    `SELECT fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by
       FROM mcp_governance.mcp_credential_exposure WHERE server_id = $1 AND source_type = 'server_config'`,
    [serverId]
  );
  const priorByFingerprint = new Map(existing.map(e => [e.fingerprint_sha256, e]));

  await pool.query(
    `DELETE FROM mcp_governance.mcp_credential_exposure
      WHERE server_id = $1 AND source_type = 'server_config' AND field_name = ANY($2::text[])`,
    [serverId, scannedFields]
  );
  for (const f of findings) {
    const carried = priorByFingerprint.get(f.fingerprint_sha256);
    await pool.query(
      `INSERT INTO mcp_governance.mcp_credential_exposure
         (server_id, source_type, field_name, secret_type, redacted_preview, fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by)
       VALUES ($1, 'server_config', $2, $3, $4, $5, $6, $7)`,
      [serverId, f.field_name, f.secret_type, f.redacted_preview, f.fingerprint_sha256,
       carried?.rotation_confirmed_at ?? null, carried?.rotation_confirmed_by ?? null]
    );
  }
}

// Mirrors redactFields' own null/undefined-skip rule, so this always lines
// up with which fields it actually evaluated.
function scannedFieldNames(rawFields) {
  return Object.entries(rawFields).filter(([, v]) => v != null).map(([k]) => k);
}

// EP-202-S7 — "materiality threshold": the fields that actually define what
// an approver signed off on. transport is excluded — it's set at
// registration and never editable via PUT, so it can never drift. Same
// stable-JSON-then-sha256 pattern as tools.js's computeDefinitionHash.
function computeMaterialityHash({ endpoint, authentication_method, risk_tier, trusted_publisher }) {
  const stable = JSON.stringify({
    endpoint: endpoint ?? null, authentication_method: authentication_method ?? null,
    risk_tier: risk_tier ?? null, trusted_publisher: trusted_publisher ?? null,
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

// EP-201-S14 — the "automatically disable a server on critical drift"
// reaction, shared by PUT /:id (a client submits new values that differ
// from what was approved) and discovery-import's re-scan comparison below
// (the discovery-agent CLI notices the actual launch command/args/url
// changed without anyone touching the registry at all — the genuinely
// proactive half of drift detection, since this codebase has no live
// server-probing mechanism to poll a running MCP server's config directly).
// Extracted rather than duplicated: same revert-to-pending + Kong
// deprovision + incident every time, regardless of how drift was noticed.
async function applyMaterialityDrift(serverId, serverName, reason) {
  // PUT /:id's own caller previously set this inline as part of its single
  // big UPDATE (CASE WHEN revertToPending THEN 'pending_review' ...) — that
  // path still does, redundantly but harmlessly. discovery-import's caller
  // never touches mcp_servers at all otherwise, so this must be
  // self-contained rather than assume the status column is already right.
  await pool.query(`UPDATE mcp_governance.mcp_servers SET status = 'pending_review', updated_at = NOW() WHERE id = $1`, [serverId]);
  await pool.query(
    `INSERT INTO mcp_governance.mcp_server_status_history (server_id, from_status, to_status, reason)
     VALUES ($1, 'approved', 'pending_review', $2)`,
    [serverId, reason]
  );
  await governanceClient.recordApprovalDecision({
    assetType: 'mcp_server', assetId: serverId, decision: 'pending_review',
    actor: 'system:materiality-drift', role: null,
    supportingEvidence: reason,
  });
  // Traffic stops the moment review is required again — same reasoning as
  // deprovisioning on reject/retire (EP-201-S4).
  await kongProvisioner.deprovisionServer(serverId);
  await escalationClient.createIncident({
    title: `MCP server "${serverName}" reverted to pending_review — material change detected`,
    severity: 'high',
    contextJson: { server_id: serverId, previous_status: 'approved' },
  });
}

// GET /servers — registry list, optionally filtered by status
router.get('/', wrap(async (req, res) => {
  const { status } = req.query;
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT * FROM mcp_governance.mcp_servers
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY name`,
    params
  );
  res.json(rows);
}));

// GET /servers/resolve?ref=<string> — used by workflow-governance-service to
// check whether a workflow's declared MCP server reference is registered.
// Registered here means "someone entered it" — this is not risk scoring,
// just existence + identity resolution. Must be registered before /:id or
// Express's wildcard would swallow this path as id='resolve'.
//
// Epic 2, Feature 2.2 — matching is scheme- and trailing-slash-normalized
// (https://host/path and host/path/ resolve as the same endpoint) so a
// workflow-declared reference that differs only by those cosmetics still
// resolves. A reference matching more than one server is reported as
// ambiguous (409) rather than silently picking one via LIMIT 1.
router.get('/resolve', wrap(async (req, res) => {
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'ref is required' });

  const { rows } = await pool.query(
    `SELECT id, name, status FROM mcp_governance.mcp_servers
      WHERE LOWER(name) = LOWER($1)
         OR RTRIM(REGEXP_REPLACE(LOWER(endpoint), '^https?://', ''), '/')
          = RTRIM(REGEXP_REPLACE(LOWER($1),         '^https?://', ''), '/')`,
    [ref]
  );
  if (rows.length === 0) return res.status(404).json({ registered: false });
  if (rows.length > 1) {
    return res.status(409).json({
      registered: false,
      ambiguous: true,
      candidates: rows.map(r => ({ id: r.id, name: r.name, status: r.status })),
      error: `Reference "${ref}" matches ${rows.length} registered servers — resolve manually`,
    });
  }
  res.json({ registered: true, ...rows[0] });
}));

// GET /servers/:id — detail, including tools/resources/prompts/authorizations
router.get('/:id', wrap(async (req, res) => {
  const { rows: [server] } = await pool.query(
    'SELECT * FROM mcp_governance.mcp_servers WHERE id = $1',
    [req.params.id]
  );
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const [{ rows: tools }, { rows: resources }, { rows: prompts }, { rows: authorizations }, { rows: credentialExposure }, { rows: statusHistory }, { rows: assuranceEvidence }, { rows: discoveryHistory }] = await Promise.all([
    pool.query('SELECT * FROM mcp_governance.mcp_tools WHERE server_id = $1 ORDER BY name', [server.id]),
    pool.query('SELECT * FROM mcp_governance.mcp_resources WHERE server_id = $1 ORDER BY uri_template', [server.id]),
    pool.query('SELECT * FROM mcp_governance.mcp_prompts WHERE server_id = $1 ORDER BY name', [server.id]),
    pool.query('SELECT * FROM mcp_governance.mcp_authorizations WHERE server_id = $1', [server.id]),
    pool.query('SELECT * FROM mcp_governance.mcp_credential_exposure WHERE server_id = $1 ORDER BY detected_at DESC', [server.id]),
    pool.query('SELECT * FROM mcp_governance.mcp_server_status_history WHERE server_id = $1 ORDER BY changed_at DESC', [server.id]),
    pool.query('SELECT * FROM mcp_governance.mcp_assurance_evidence WHERE server_id = $1 ORDER BY observed_at DESC', [server.id]),
    // EP-306-S13 — prior discovery_metadata_json snapshots, most recent
    // first, for the Discovered-tab diff view (S5). Empty for anything
    // that's never been re-scanned since it was first discovered.
    pool.query('SELECT metadata_json, recorded_at FROM mcp_governance.discovery_scan_history WHERE server_id = $1 ORDER BY recorded_at DESC', [server.id]),
  ]);

  res.json({
    ...server, tools, resources, prompts, authorizations,
    credential_exposure: credentialExposure, status_history: statusHistory,
    assurance_evidence: assuranceEvidence, discovery_history: discoveryHistory,
  });
}));

// POST /servers — register a new server. Always starts pending_review —
// registering it is not the same as approving it for production use.
router.post('/', requirePermission('mcp:register'), wrap(async (req, res) => {
  const {
    name, version, publisher, source_repository, transport, endpoint, protocol_version,
    authentication_method, hosting_environment, deployment_location, technical_owner,
    business_owner, approved_use_case, data_classification, downstream_systems,
    risk_tier, trusted_publisher, dependencies_json, integrity_info,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!TRANSPORTS.includes(transport)) {
    return res.status(400).json({ error: `transport must be one of: ${TRANSPORTS.join(', ')}` });
  }
  if (hosting_environment && !ENVIRONMENTS.includes(hosting_environment)) {
    return res.status(400).json({ error: `hosting_environment must be one of: ${ENVIRONMENTS.join(', ')}` });
  }
  if (risk_tier && !RISK_TIERS.includes(risk_tier)) {
    return res.status(400).json({ error: `risk_tier must be one of: ${RISK_TIERS.join(', ')}` });
  }

  // Epic 5, Feature 5.3 — never let a hardcoded credential pasted into a
  // config field (e.g. an API key baked into the endpoint URL) reach storage
  // unredacted. The redacted values are what actually get persisted below.
  const rawFields = {
    endpoint, authentication_method, deployment_location, integrity_info,
    approved_use_case, dependencies_json: dependencies_json ?? [],
  };
  const { redactedFields, findings } = credentialScanner.redactFields(rawFields);
  const materialityHash = computeMaterialityHash({
    endpoint: redactedFields.endpoint, authentication_method: redactedFields.authentication_method,
    risk_tier, trusted_publisher: trusted_publisher ?? false,
  });

  const { rows: [server] } = await pool.query(
    `INSERT INTO mcp_governance.mcp_servers
       (name, version, publisher, source_repository, transport, endpoint, protocol_version,
        authentication_method, hosting_environment, deployment_location, technical_owner,
        business_owner, approved_use_case, data_classification, downstream_systems,
        risk_tier, trusted_publisher, dependencies_json, integrity_info, materiality_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      name.trim(), version ?? null, publisher ?? null, source_repository ?? null, transport,
      redactedFields.endpoint ?? null, protocol_version ?? null, redactedFields.authentication_method ?? null,
      hosting_environment ?? null, redactedFields.deployment_location ?? null, technical_owner ?? null,
      business_owner ?? null, redactedFields.approved_use_case ?? null, data_classification ?? null,
      downstream_systems ?? null, risk_tier ?? null, trusted_publisher ?? false,
      JSON.stringify(redactedFields.dependencies_json ?? []), redactedFields.integrity_info ?? null, materialityHash,
    ]
  );

  // EP-101-S9 — always persist, even when findings is empty: this is what
  // clears a stale finding row once the field that triggered it is genuinely
  // fixed (an `if (findings.length > 0)` guard here would mean the DELETE
  // that clears it never runs, and a resolved exposure lingers forever).
  await persistCredentialFindings(server.id, scannedFieldNames(rawFields), findings);
  if (findings.length > 0) await governanceClient.evaluateServer(server.id);
  // EP-103-S4/S5 — deliberately no "Initial registration" history row here
  // (removed — it predates this epic). status_history is now append-only at
  // the DB level, so a server with any row can never be hard-deleted again;
  // a creation stamp that duplicates the row's own created_at isn't a
  // decision worth that permanence. A never-reviewed server stays
  // deletable; the first row only appears once a real transition happens.
  res.status(201).json({ ...server, credential_exposure_detected: findings.length > 0 });
}));

// POST /servers/discovery-import — bulk-import candidates from
// discovery-agent's scan (EP-306-S1/S2/S3). Body shape matches the CLI's own
// runScan() output: { discovered: [{ name, command, args, url, env_hints,
// source, source_path }] }. Every candidate lands as status='discovered' —
// review/promotion to pending_review is a separate, human action (S5).
//
// Idempotent on name: a name already tracked at pending_review or later is
// left untouched except for last_discovery_at (proof of continued
// presence) — a discovery scan must never downgrade or overwrite a real
// governance decision. A name with no existing row gets a fresh insert; one
// that already has a 'discovered' row gets its discovery metadata refreshed
// in place, backed by the partial unique index in 017_discovery_import.sql.
router.post('/discovery-import', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { discovered } = req.body;
  if (!Array.isArray(discovered)) {
    return res.status(400).json({ error: 'discovered must be an array' });
  }

  const result = { created: 0, refreshed: 0, already_tracked: 0, skipped: [] };
  const createdNames = [];

  for (const item of discovered) {
    const { name, command, args, url, env_hints, source, source_path } = item ?? {};
    if (!name || (!command && !url)) {
      result.skipped.push({ name: name ?? null, reason: 'missing name, or neither command nor url' });
      continue;
    }

    const { rows: [tracked] } = await pool.query(
      `SELECT id, status, discovery_metadata_json FROM mcp_governance.mcp_servers WHERE name = $1 AND status != 'discovered'`,
      [name]
    );
    if (tracked) {
      await pool.query(`UPDATE mcp_governance.mcp_servers SET last_discovery_at = NOW() WHERE id = $1`, [tracked.id]);

      // EP-201-S14 — a re-scan is not "overwriting a governance decision"
      // (the comment above this loop is about status/review fields, which
      // this never touches); it's the one proactive signal this codebase
      // has for "did the real launch config change without anyone using
      // PUT /:id" — command/args/url are facts a scan discovers, not
      // governance metadata a human assigns, so comparing them here doesn't
      // second-guess any approval decision, only whether it's still valid.
      if (tracked.status === 'approved') {
        const previous = tracked.discovery_metadata_json ?? {};
        const drifted =
          (command ?? null) !== (previous.command ?? null) ||
          JSON.stringify(args ?? []) !== JSON.stringify(previous.args ?? []) ||
          (url ?? null) !== (previous.url ?? null);
        if (drifted && (previous.command || previous.url)) { // skip servers approved before discovery_metadata_json existed — nothing to compare against yet
          await applyMaterialityDrift(
            tracked.id, name,
            'Material change detected — discovery re-scan found a different launch command, arguments, or URL than what was approved'
          );
        }
      }
      result.already_tracked++;
      continue;
    }

    const transport = url ? 'remote' : 'local';
    const metadata = JSON.stringify({
      command: command ?? null, args: args ?? [], env_hints: env_hints ?? [],
      source: source ?? null, source_path: source_path ?? null,
    });

    const { rows: [existingDiscovered] } = await pool.query(
      `SELECT id, discovery_metadata_json FROM mcp_governance.mcp_servers WHERE name = $1 AND status = 'discovered'`,
      [name]
    );
    if (existingDiscovered) {
      // EP-306-S13 — snapshot what's about to be overwritten, so S5's review
      // UI can diff this scan against the last one. Only meaningful once
      // there's a prior value to snapshot — a row created and refreshed in
      // the same second (extremely unlikely, but free to guard) would
      // otherwise write a pointless empty-to-empty history row.
      if (existingDiscovered.discovery_metadata_json) {
        await pool.query(
          `INSERT INTO mcp_governance.discovery_scan_history (server_id, metadata_json) VALUES ($1, $2)`,
          [existingDiscovered.id, existingDiscovered.discovery_metadata_json]
        );
      }
      await pool.query(
        `UPDATE mcp_governance.mcp_servers
            SET transport = $1, endpoint = $2, discovery_metadata_json = $3, last_discovery_at = NOW(), updated_at = NOW()
          WHERE id = $4`,
        [transport, url ?? null, metadata, existingDiscovered.id]
      );
      result.refreshed++;
    } else {
      await pool.query(
        `INSERT INTO mcp_governance.mcp_servers (name, transport, endpoint, status, discovery_metadata_json, last_discovery_at)
         VALUES ($1, $2, $3, 'discovered', $4, NOW())`,
        [name.trim(), transport, url ?? null, metadata]
      );
      result.created++;
      createdNames.push(name.trim());
    }
  }

  // EP-306-S9 — one incident per import batch, not one per server: a
  // discovery-agent scan (or a single n8n workflow with several unregistered
  // node references, EP-306-S6) can create many candidates in one call, and
  // alerting per-server would be exactly the notification-fatigue pattern
  // that trains governance officers to ignore these. Low severity — this is
  // "worth knowing about," not an incident requiring an active response.
  if (createdNames.length > 0) {
    await escalationClient.createIncident({
      title: `${createdNames.length} new MCP server${createdNames.length === 1 ? '' : 's'} discovered: ${createdNames.join(', ')}`,
      severity: 'low',
      contextJson: { discovered_names: createdNames },
    });
  }

  res.status(201).json(result);
}));

// PUT /servers/:id — edit registry fields (requires mcp:register — same actors who can submit can also update)
//
// EP-202-S7/S8 — a material change (endpoint, authentication_method,
// risk_tier, or trusted_publisher) to an ALREADY-APPROVED server reverts it
// to pending_review and notifies approvers, mirroring what tools.js already
// does for tool definition drift (Epic 3, Feature 3.1/3.3). Fetches the
// existing row first (tools.js's PUT already does this; this route
// previously didn't need to) specifically to compute drift before writing.
router.put('/:id', requirePermission('mcp:register'), wrap(async (req, res) => {
  const {
    name, version, publisher, source_repository, endpoint, protocol_version,
    authentication_method, hosting_environment, deployment_location, technical_owner,
    business_owner, approved_use_case, data_classification, downstream_systems,
    risk_tier, trusted_publisher, integrity_info, review_date, expiration_date,
  } = req.body;

  const { rows: [existing] } = await pool.query('SELECT * FROM mcp_governance.mcp_servers WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Server not found' });

  // Epic 5, Feature 5.3 — same redact-before-persist treatment as
  // registration. Undefined fields pass through untouched (redactFields
  // skips null/undefined) so COALESCE below still means "no change".
  const rawFields = { endpoint, authentication_method, deployment_location, integrity_info, approved_use_case };
  const { redactedFields, findings } = credentialScanner.redactFields(rawFields);

  // Merged (post-update) materiality fields, computed BEFORE writing, so we
  // know whether this edit needs to revert an approved server. A NULL
  // existing hash (a server that predates this column) is "nothing to
  // compare against yet", not a drift — it just gets backfilled.
  const newMaterialityHash = computeMaterialityHash({
    endpoint: redactedFields.endpoint ?? existing.endpoint,
    authentication_method: redactedFields.authentication_method ?? existing.authentication_method,
    risk_tier: risk_tier ?? existing.risk_tier,
    trusted_publisher: trusted_publisher ?? existing.trusted_publisher,
  });
  const materialChange = existing.materiality_hash != null && newMaterialityHash !== existing.materiality_hash;
  const revertToPending = materialChange && existing.status === 'approved';

  const { rows: [server] } = await pool.query(
    `UPDATE mcp_governance.mcp_servers
        SET name                  = COALESCE($1, name),
            version               = COALESCE($2, version),
            publisher             = COALESCE($3, publisher),
            source_repository     = COALESCE($4, source_repository),
            endpoint              = COALESCE($5, endpoint),
            protocol_version      = COALESCE($6, protocol_version),
            authentication_method = COALESCE($7, authentication_method),
            hosting_environment   = COALESCE($8, hosting_environment),
            deployment_location   = COALESCE($9, deployment_location),
            technical_owner       = COALESCE($10, technical_owner),
            business_owner        = COALESCE($11, business_owner),
            approved_use_case     = COALESCE($12, approved_use_case),
            data_classification   = COALESCE($13, data_classification),
            downstream_systems    = COALESCE($14, downstream_systems),
            risk_tier             = COALESCE($15, risk_tier),
            trusted_publisher     = COALESCE($16, trusted_publisher),
            integrity_info        = COALESCE($17, integrity_info),
            review_date           = COALESCE($18, review_date),
            expiration_date       = COALESCE($19, expiration_date),
            materiality_hash      = $20,
            status                = CASE WHEN $21 THEN 'pending_review' ELSE status END,
            updated_at            = NOW()
      WHERE id = $22
      RETURNING *`,
    [
      name ?? null, version ?? null, publisher ?? null, source_repository ?? null,
      redactedFields.endpoint ?? null, protocol_version ?? null, redactedFields.authentication_method ?? null,
      hosting_environment ?? null, redactedFields.deployment_location ?? null, technical_owner ?? null,
      business_owner ?? null, redactedFields.approved_use_case ?? null, data_classification ?? null,
      downstream_systems ?? null, risk_tier ?? null, trusted_publisher ?? null,
      redactedFields.integrity_info ?? null, review_date ?? null, expiration_date ?? null,
      newMaterialityHash, revertToPending, req.params.id,
    ]
  );

  // EP-101-S9 — only touch findings for fields this request actually
  // rescanned; skip entirely if none of the scannable fields were included
  // (nothing to clear or re-flag). Must not be gated on findings.length,
  // same reasoning as registration above.
  const scanned = scannedFieldNames(rawFields);
  if (scanned.length > 0) {
    await persistCredentialFindings(server.id, scanned, findings);
  }
  // EP-105-S4 — any update can change a field a policy cares about
  // (trusted_publisher, expiration_date, ...), not just credential fields —
  // re-evaluate unconditionally rather than only when a finding appeared.
  await governanceClient.evaluateServer(server.id);

  if (revertToPending) {
    await applyMaterialityDrift(
      server.id, server.name,
      'Material change detected — endpoint, authentication method, risk tier, or trusted publisher changed since approval'
    );
  }

  res.json({ ...server, credential_exposure_detected: findings.length > 0, material_change_detected: materialChange });
}));

// Shared by the direct status route below and the approval-chain-decided
// callback — the actual status_history write + cross-service side effects
// are identical regardless of whether one actor approved directly or a
// multi-stage chain just completed.
async function finalizeStatusTransition(serverId, status, { approvedVersion, configurationHash, reason, actor, role } = {}) {
  const { rows: [existing] } = await pool.query('SELECT status FROM mcp_governance.mcp_servers WHERE id = $1', [serverId]);
  if (!existing) return null;

  const { rows: [server] } = await pool.query(
    `UPDATE mcp_governance.mcp_servers
        SET status             = $1,
            approved_version   = CASE WHEN $1 = 'approved' THEN COALESCE($2, approved_version) ELSE approved_version END,
            configuration_hash = CASE WHEN $1 = 'approved' THEN COALESCE($3, configuration_hash) ELSE configuration_hash END,
            updated_at         = NOW()
      WHERE id = $4
      RETURNING *`,
    [status, approvedVersion ?? null, configurationHash ?? null, serverId]
  );

  await pool.query(
    `INSERT INTO mcp_governance.mcp_server_status_history (server_id, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4)`,
    [serverId, existing.status, status, reason ?? null]
  );

  // EP-103-S2/S3 — mirrors this decision into governance-service's
  // platform-wide approval_decision_history.
  await governanceClient.recordApprovalDecision({
    assetType: 'mcp_server', assetId: serverId, decision: status,
    actor: actor ?? 'unknown', role: role ?? null, supportingEvidence: reason ?? null,
  });

  // EP-105-S4/S5 — approving/rejecting/retiring is itself a policy-relevant
  // change (e.g. clears a stale violation once a server is retired) and a
  // revocation (rejected/retired) must re-evaluate immediately, not wait for
  // the next unrelated update.
  await governanceClient.evaluateServer(serverId);

  // EP-201-S4 — a never-reviewed server has no business receiving proxied
  // MCP traffic; Kong routing + enforcement is provisioned the moment a
  // server is approved, and disabled (not deleted) the moment it's rejected
  // or retired. See kong-plugins/ioa-mcp-enforcement/README.md.
  if (status === 'approved') {
    await kongProvisioner.provisionServer(server);
  } else if (status === 'rejected' || status === 'retired') {
    await kongProvisioner.deprovisionServer(serverId);
  }

  return server;
}

// PATCH /servers/:id/status — approve / reject / retire. Epic 1, Feature 1.3:
// every transition is recorded in mcp_server_status_history (from/to/reason)
// so registration decisions are traceable, not just the current status.
//
// EP-202 — an 'approved' transition on a server whose risk_tier has an
// active approval chain doesn't finalize here at all: it starts the
// multi-stage chain in governance-service and returns 202, leaving the
// server's own status untouched until that chain reaches a terminal state
// (see POST /:id/approval-chain-decided below). reject/retire are never
// chain-gated — there's no multi-party-safety reason to slow down taking
// something OUT of service, only putting a risky one INTO service.
router.patch('/:id/status', requirePermission('mcp:approve'), wrap(async (req, res) => {
  const { status, approved_version, configuration_hash, reason } = req.body;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }

  if (status === 'approved') {
    const { rows: [server] } = await pool.query('SELECT risk_tier FROM mcp_governance.mcp_servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    if (server.risk_tier) {
      const chainRequest = await governanceClient.startApprovalChain({
        riskTier: server.risk_tier, assetType: 'mcp_server', assetId: req.params.id,
        requestedBy: req.user?.username ?? 'unknown', reason,
      });
      if (chainRequest) {
        return res.status(202).json({ chain_started: true, request: chainRequest });
      }
      // null => no active chain for this risk tier; fall through to a
      // normal, immediate single-actor approval.
    }
  }

  const server = await finalizeStatusTransition(req.params.id, status, {
    approvedVersion: approved_version, configurationHash: configuration_hash, reason,
    actor: req.user?.username ?? 'unknown', role: req.user?.roles?.[0] ?? null,
  });
  if (!server) return res.status(404).json({ error: 'Server not found' });
  res.json(server);
}));

// POST /servers/:id/approval-chain-decided — governance-service calls this
// once a multi-stage chain reaches a terminal state. Authenticated the same
// way as every other service-to-service call in this platform (the shared
// X-Internal-Service-Key, checked by require-auth.js); no separate
// exemption needed, unlike the genuinely public-facing n8n webhooks.
router.post('/:id/approval-chain-decided', wrap(async (req, res) => {
  const { decision } = req.body;
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
  }

  const server = await finalizeStatusTransition(req.params.id, decision, {
    reason: `Approval chain ${decision}`, actor: 'system:approval-chain',
  });
  if (!server) return res.status(404).json({ error: 'Server not found' });
  res.json(server);
}));

// POST /servers/:id/score — compute and persist the 8-dimension MCP risk score
router.post('/:id/score', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { rows: [server] } = await pool.query('SELECT * FROM mcp_governance.mcp_servers WHERE id = $1', [req.params.id]);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const [{ rows: tools }, { rows: resources }, { rows: prompts }, { rows: authorizations }] = await Promise.all([
    pool.query('SELECT * FROM mcp_governance.mcp_tools WHERE server_id = $1', [server.id]),
    pool.query('SELECT * FROM mcp_governance.mcp_resources WHERE server_id = $1', [server.id]),
    pool.query('SELECT * FROM mcp_governance.mcp_prompts WHERE server_id = $1', [server.id]),
    pool.query('SELECT * FROM mcp_governance.mcp_authorizations WHERE server_id = $1', [server.id]),
  ]);

  const result = scorer.scoreServer({ server, tools, resources, prompts, authorizations });

  await pool.query(
    `UPDATE mcp_governance.mcp_servers
        SET risk_score = $1, risk_level = $2, risk_breakdown_json = $3, scored_at = NOW(), updated_at = NOW()
      WHERE id = $4`,
    [result.risk_score, result.risk_level, JSON.stringify(result), req.params.id]
  );

  res.json(result);
}));

// DELETE /servers/:id — mcp:approve required (only governance-officers+ can remove registry entries)
// EP-103-S4/S5 — mcp_server_status_history is now append-only at the DB
// level (see migration 012), so a server that's ever had a real status
// transition can no longer cascade-delete (a never-reviewed server has no
// history row at all — see the registration route above — and stays
// deletable). Retiring (PATCH /:id/status → 'retired') is the intended way
// to decommission a server that HAS been reviewed, without losing its audit
// trail; this guard turns what would otherwise be a raw 500 from the DB
// trigger into a clear, deliberate 409. from_status IS NOT NULL is
// defensive — excludes any pre-this-fix "Initial registration" row a
// long-lived server might still carry.
router.delete('/:id', requirePermission('mcp:approve'), wrap(async (req, res) => {
  const { rows: [history] } = await pool.query(
    'SELECT 1 FROM mcp_governance.mcp_server_status_history WHERE server_id = $1 AND from_status IS NOT NULL LIMIT 1',
    [req.params.id]
  );
  if (history) {
    return res.status(409).json({
      error: 'This server has status history and cannot be deleted — its audit trail is append-only. Retire it instead (PATCH /:id/status with status: "retired").',
    });
  }

  const { rowCount } = await pool.query('DELETE FROM mcp_governance.mcp_servers WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Server not found' });
  res.status(204).end();
}));

// POST /servers/:id/containment — called by governance-service's kill
// switch (POST /assets/mcp_server/:id/suspend|quarantine|restore|read-only),
// authenticated the same way as approval-chain-decided: the shared
// X-Internal-Service-Key, no separate exemption needed. Only 'active'
// receives proxied traffic — every other state deprovisions Kong the same
// way rejection/retirement already do (EP-201-S4); re-approving via
// provisionServer only happens on restore-to-active, and only if the
// server's own approval status is still 'approved' (containment and
// approval are independent axes — restoring containment must not silently
// re-approve a server that was separately rejected in the meantime).
const CONTAINMENT_STATES = ['active', 'suspended', 'quarantined', 'read_only'];
router.post('/:id/containment', wrap(async (req, res) => {
  const { containment_state } = req.body;
  if (!CONTAINMENT_STATES.includes(containment_state)) {
    return res.status(400).json({ error: `containment_state must be one of: ${CONTAINMENT_STATES.join(', ')}` });
  }

  const { rows: [server] } = await pool.query(
    `UPDATE mcp_governance.mcp_servers SET containment_state = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [containment_state, req.params.id]
  );
  if (!server) return res.status(404).json({ error: 'Server not found' });

  if (containment_state === 'active') {
    if (server.status === 'approved') await kongProvisioner.provisionServer(server);
  } else {
    await kongProvisioner.deprovisionServer(server.id);
  }

  res.json(server);
}));

export default router;
