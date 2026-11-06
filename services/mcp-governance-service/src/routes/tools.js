import { Router } from 'express';
import crypto from 'crypto';
import pool from '../../db.js';
import credentialScanner from '../lib/credential-scanner.js';
import governanceClient from '../lib/governance-client.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

// EP-101-S4 — replaces this tool's 'tool_definition' credential findings
// with a fresh scan result. Delete + reinsert, same pattern as servers.js's
// persistCredentialFindings.
// EP-101-S9 — carries forward rotation_confirmed_at/by across a rescan when
// the exact same fingerprint reappears (see servers.js's persistCredentialFindings).
// scannedFields scopes the DELETE to only the field_names actually rescanned
// this request — PUT below is a partial update (COALESCE), so a PUT that
// doesn't touch `description` must not wipe a still-valid finding recorded
// against it earlier. Must always run (even when findings is empty) — that's
// what clears a finding once its field is rescanned and found clean.
async function persistToolCredentialFindings(serverId, toolId, scannedFields, findings) {
  const { rows: existing } = await pool.query(
    `SELECT fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by
       FROM mcp_governance.mcp_credential_exposure WHERE tool_id = $1 AND source_type = 'tool_definition'`,
    [toolId]
  );
  const priorByFingerprint = new Map(existing.map(e => [e.fingerprint_sha256, e]));

  await pool.query(
    `DELETE FROM mcp_governance.mcp_credential_exposure
      WHERE tool_id = $1 AND source_type = 'tool_definition' AND field_name = ANY($2::text[])`,
    [toolId, scannedFields]
  );
  for (const f of findings) {
    const carried = priorByFingerprint.get(f.fingerprint_sha256);
    await pool.query(
      `INSERT INTO mcp_governance.mcp_credential_exposure
         (server_id, tool_id, source_type, field_name, secret_type, redacted_preview, fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by)
       VALUES ($1, $2, 'tool_definition', $3, $4, $5, $6, $7, $8)`,
      [serverId, toolId, f.field_name, f.secret_type, f.redacted_preview, f.fingerprint_sha256,
       carried?.rotation_confirmed_at ?? null, carried?.rotation_confirmed_by ?? null]
    );
  }
}

// Mirrors redactFields' own null/undefined-skip rule, so this always lines
// up with which fields it actually evaluated.
function scannedFieldNames(rawFields) {
  return Object.entries(rawFields).filter(([, v]) => v != null).map(([k]) => k);
}

const BEHAVIORS       = ['read', 'write'];
const PRIVILEGE_LEVELS = ['low', 'moderate', 'high', 'critical'];
const CLASSIFICATIONS  = ['T0', 'T1', 'T2', 'T3', 'T4'];
const APPROVAL_STATUSES = ['pending', 'allowed', 'denied'];

// The definition hash is always server-computed from the fields that matter
// for trust (description + schemas) — never trust a client-supplied hash,
// same principle as never trusting a client-supplied secret redaction.
function computeDefinitionHash({ description, input_schema_json, output_schema_json }) {
  const stable = JSON.stringify({ description: description ?? null, input_schema_json: input_schema_json ?? null, output_schema_json: output_schema_json ?? null });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

// GET /servers/:serverId/tools
router.get('/servers/:serverId/tools', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM mcp_governance.mcp_tools WHERE server_id = $1 ORDER BY name',
    [req.params.serverId]
  );
  res.json(rows);
}));

// POST /servers/:serverId/tools — registered pending by default (deny-by-default)
router.post('/servers/:serverId/tools', requirePermission('mcp:register'), wrap(async (req, res) => {
  const {
    name, description, input_schema_json, output_schema_json, behavior,
    downstream_systems, required_scopes, destructive, external_communication,
    privilege_level, classification, version,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (behavior && !BEHAVIORS.includes(behavior)) {
    return res.status(400).json({ error: `behavior must be one of: ${BEHAVIORS.join(', ')}` });
  }
  if (privilege_level && !PRIVILEGE_LEVELS.includes(privilege_level)) {
    return res.status(400).json({ error: `privilege_level must be one of: ${PRIVILEGE_LEVELS.join(', ')}` });
  }
  if (classification && !CLASSIFICATIONS.includes(classification)) {
    return res.status(400).json({ error: `classification must be one of: ${CLASSIFICATIONS.join(', ')}` });
  }

  // EP-101-S4 — a hardcoded credential pasted into a description or schema
  // example (e.g. a sample header value) previously went unscanned; the
  // redacted values are what actually get persisted below. The definition
  // hash is computed on the post-redaction values, since that's what's
  // actually stored — hashing the raw input here would make every
  // subsequent PUT see false drift against the (redacted) stored row.
  const rawFields = { description, input_schema_json: input_schema_json ?? null, output_schema_json: output_schema_json ?? null };
  const { redactedFields, findings } = credentialScanner.redactFields(rawFields);
  const definitionHash = computeDefinitionHash({
    description: redactedFields.description,
    input_schema_json: redactedFields.input_schema_json,
    output_schema_json: redactedFields.output_schema_json,
  });

  const { rows: [tool] } = await pool.query(
    `INSERT INTO mcp_governance.mcp_tools
       (server_id, name, description, input_schema_json, output_schema_json, behavior,
        downstream_systems, required_scopes, destructive, external_communication,
        privilege_level, classification, definition_hash, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      req.params.serverId, name.trim(), redactedFields.description ?? null,
      redactedFields.input_schema_json ? JSON.stringify(redactedFields.input_schema_json) : null,
      redactedFields.output_schema_json ? JSON.stringify(redactedFields.output_schema_json) : null,
      behavior ?? null, downstream_systems ?? null, required_scopes ?? null,
      destructive ?? false, external_communication ?? false,
      privilege_level ?? null, classification ?? null, definitionHash, version ?? null,
    ]
  );

  if (classification) {
    await pool.query(
      `INSERT INTO mcp_governance.mcp_tool_decision_history (tool_id, decision_type, from_value, to_value, reason)
       VALUES ($1, 'classification', NULL, $2, 'Initial classification at registration')`,
      [tool.id, classification]
    );
  }

  // EP-101-S9 — only touch findings for fields this request actually
  // scanned; must not be gated on findings.length (that's what clears a
  // finding once its field is rescanned and found clean).
  const scannedAtCreate = scannedFieldNames(rawFields);
  if (scannedAtCreate.length > 0) {
    await persistToolCredentialFindings(req.params.serverId, tool.id, scannedAtCreate, findings);
    if (findings.length > 0) await governanceClient.evaluateServer(req.params.serverId);
  }
  res.status(201).json({ ...tool, credential_exposure_detected: findings.length > 0 });
}));

// PATCH /tools/:id/approval — allow / deny a specific tool (per-tool, not
// per-server). Epic 3, Feature 3.2: an optional reason is recorded in
// mcp_tool_decision_history alongside the from/to transition and timestamp —
// required when denying (an auditor needs to know why), optional when allowing.
router.patch('/tools/:id/approval', requirePermission('mcp:approve'), wrap(async (req, res) => {
  const { approval_status, reason } = req.body;
  if (!APPROVAL_STATUSES.includes(approval_status)) {
    return res.status(400).json({ error: `approval_status must be one of: ${APPROVAL_STATUSES.join(', ')}` });
  }
  if (approval_status === 'denied' && !reason) {
    return res.status(400).json({ error: 'reason is required when denying a tool' });
  }

  const { rows: [existing] } = await pool.query('SELECT approval_status FROM mcp_governance.mcp_tools WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Tool not found' });

  const { rows: [tool] } = await pool.query(
    `UPDATE mcp_governance.mcp_tools SET approval_status = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [approval_status, req.params.id]
  );

  await pool.query(
    `INSERT INTO mcp_governance.mcp_tool_decision_history (tool_id, decision_type, from_value, to_value, reason)
     VALUES ($1, 'approval', $2, $3, $4)`,
    [req.params.id, existing.approval_status, approval_status, reason ?? null]
  );

  // EP-103-S2/S3 — mirrors this decision into governance-service's
  // platform-wide approval_decision_history.
  await governanceClient.recordApprovalDecision({
    assetType: 'mcp_tool', assetId: req.params.id, decision: approval_status,
    actor: req.user?.username ?? 'unknown', role: req.user?.roles?.[0] ?? null,
    supportingEvidence: reason ?? null,
  });

  // EP-105-S4/S5 — denying is a revocation and must re-evaluate the owning
  // server's policies immediately (e.g. a drift violation this tool caused).
  await governanceClient.evaluateServer(tool.server_id);

  res.json(tool);
}));

// GET /tools/:id/decision-history — classification and approval audit trail.
// The earliest decision_type='classification' row is the "original
// classification" Feature 3.1's auditor story asks for.
router.get('/tools/:id/decision-history', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM mcp_governance.mcp_tool_decision_history WHERE tool_id = $1 ORDER BY changed_at ASC`,
    [req.params.id]
  );
  res.json(rows);
}));

// GET /tools/:id/definition-history — previous definition snapshots, most
// recent first, for reviewing a tool's history before reapproval (Feature 3.3).
router.get('/tools/:id/definition-history', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM mcp_governance.mcp_tool_definition_history WHERE tool_id = $1 ORDER BY superseded_at DESC`,
    [req.params.id]
  );
  res.json(rows);
}));

// PUT /tools/:id — a description/schema change after approval does not keep
// its trust status automatically: if the recomputed definition hash differs
// from what's stored and the tool was 'allowed', it reverts to 'pending'.
// Epic 3, Feature 3.1: changing an *existing* classification is an override
// and requires classification_reason — a brand-new classification (existing
// value was null) isn't an override of anything, so no reason is required.
router.put('/tools/:id', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT * FROM mcp_governance.mcp_tools WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Tool not found' });

  const { description, classification, classification_reason, privilege_level, destructive, version, input_schema_json, output_schema_json } = req.body;

  const isClassificationOverride = classification && existing.classification && classification !== existing.classification;
  if (isClassificationOverride && !classification_reason) {
    return res.status(400).json({ error: 'classification_reason is required when overriding an existing classification' });
  }

  // EP-101-S4 — scan incoming fields before merging with the (already
  // redacted) stored values, same treatment as registration.
  const rawFields = { description: description ?? null, input_schema_json: input_schema_json ?? null, output_schema_json: output_schema_json ?? null };
  const { redactedFields, findings } = credentialScanner.redactFields(rawFields);

  const merged = {
    description: redactedFields.description ?? existing.description,
    input_schema_json: redactedFields.input_schema_json ?? existing.input_schema_json,
    output_schema_json: redactedFields.output_schema_json ?? existing.output_schema_json,
  };
  const newHash = computeDefinitionHash(merged);
  const drifted = newHash !== existing.definition_hash;
  const nextApprovalStatus = drifted && existing.approval_status === 'allowed' ? 'pending' : existing.approval_status;

  const { rows: [tool] } = await pool.query(
    `UPDATE mcp_governance.mcp_tools
        SET description     = $1,
            input_schema_json = $2,
            output_schema_json = $3,
            classification   = COALESCE($4, classification),
            privilege_level  = COALESCE($5, privilege_level),
            destructive      = COALESCE($6, destructive),
            version          = COALESCE($7, version),
            definition_hash  = $8,
            approval_status  = $9,
            last_drift_detected_at = CASE WHEN $11 THEN NOW() ELSE last_drift_detected_at END,
            updated_at       = NOW()
      WHERE id = $10
      RETURNING *`,
    [
      merged.description,
      merged.input_schema_json ? JSON.stringify(merged.input_schema_json) : null,
      merged.output_schema_json ? JSON.stringify(merged.output_schema_json) : null,
      classification ?? null, privilege_level ?? null, destructive ?? null, version ?? null,
      newHash, nextApprovalStatus, req.params.id, drifted,
    ]
  );

  if (classification && classification !== existing.classification) {
    await pool.query(
      `INSERT INTO mcp_governance.mcp_tool_decision_history (tool_id, decision_type, from_value, to_value, reason)
       VALUES ($1, 'classification', $2, $3, $4)`,
      [req.params.id, existing.classification, classification, classification_reason ?? null]
    );
    // EP-103-S2/S3 — "classification change" is one of the four decision
    // types this epic names as needing immutable preservation.
    await governanceClient.recordApprovalDecision({
      assetType: 'mcp_tool', assetId: req.params.id, decision: `classification:${classification}`,
      actor: req.user?.username ?? 'unknown', role: req.user?.roles?.[0] ?? null,
      supportingEvidence: classification_reason ?? null,
    });
  }

  // Epic 3, Feature 3.3 — snapshot the OLD definition (not the new one) so a
  // reviewer can inspect previous-vs-current before reapproving, and so
  // drift is recorded as a discrete governance event, not just a timestamp.
  if (drifted) {
    await pool.query(
      `INSERT INTO mcp_governance.mcp_tool_definition_history
         (tool_id, description, input_schema_json, output_schema_json, definition_hash, version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, existing.description ?? null, existing.input_schema_json ?? null, existing.output_schema_json ?? null, existing.definition_hash, existing.version ?? null]
    );
  }

  // EP-101-S9 — only touch findings for fields this request actually
  // rescanned; skip entirely if none were included (nothing to clear or re-flag).
  const scanned = scannedFieldNames(rawFields);
  if (scanned.length > 0) {
    await persistToolCredentialFindings(existing.server_id, req.params.id, scanned, findings);
  }
  // EP-105-S4/S9 — a description/schema update is exactly what the drift
  // evaluator watches for; re-evaluate unconditionally, not just when a
  // credential finding appeared.
  await governanceClient.evaluateServer(existing.server_id);
  res.json({ ...tool, definition_drifted: drifted, credential_exposure_detected: findings.length > 0 });
}));

// DELETE /tools/:id
// EP-103-S4/S5 — mcp_tool_decision_history/mcp_tool_definition_history are
// now append-only at the DB level (see migration 012); a tool that's ever
// been classified, approved/denied, or drifted can no longer cascade-delete.
// Denying (PATCH /:id/approval with approval_status: 'denied') is the
// intended way to disable a tool without losing its audit trail; this guard
// turns what would otherwise be a raw 500 from the DB trigger into a clear,
// deliberate 409.
router.delete('/tools/:id', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { rows: [history] } = await pool.query(
    `SELECT 1 FROM mcp_governance.mcp_tool_decision_history WHERE tool_id = $1
     UNION ALL
     SELECT 1 FROM mcp_governance.mcp_tool_definition_history WHERE tool_id = $1
     LIMIT 1`,
    [req.params.id]
  );
  if (history) {
    return res.status(409).json({
      error: 'This tool has decision/definition history and cannot be deleted — its audit trail is append-only. Deny it instead (PATCH /:id/approval with approval_status: "denied").',
    });
  }

  const { rowCount } = await pool.query('DELETE FROM mcp_governance.mcp_tools WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Tool not found' });
  res.status(204).end();
}));

// POST /tools/:id/containment — same shape and auth as servers.js's
// equivalent. No Kong side effect: tools aren't individually routed in Kong
// (only servers get their own service/route, see kong-provisioner.js) — a
// contained tool's state is tracked and audited, but there's no per-tool
// live enforcement point yet. A known, scoped gap, not a silent no-op.
const CONTAINMENT_STATES = ['active', 'suspended', 'quarantined', 'read_only'];
router.post('/tools/:id/containment', requirePermission('mcp:approve'), wrap(async (req, res) => {
  const { containment_state } = req.body;
  if (!CONTAINMENT_STATES.includes(containment_state)) {
    return res.status(400).json({ error: `containment_state must be one of: ${CONTAINMENT_STATES.join(', ')}` });
  }

  const { rows: [tool] } = await pool.query(
    `UPDATE mcp_governance.mcp_tools SET containment_state = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [containment_state, req.params.id]
  );
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  res.json(tool);
}));

// POST /tools/:id/rollback — EP-203-S5, restores the most recent
// mcp_tool_definition_history snapshot (the definition in place just before
// the last change — Feature 3.3's drift-tracking data, repurposed here as
// the rollback source). Snapshots the CURRENT definition before overwriting
// it, same pattern PUT /tools/:id already uses when drift is detected —
// a rollback is itself a definition change worth its own audit entry.
// Always reverts approval_status to 'pending': restoring a definition
// during an incident should be re-reviewed, not silently re-trusted.
router.post('/tools/:id/rollback', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { rows: [tool] } = await pool.query('SELECT * FROM mcp_governance.mcp_tools WHERE id = $1', [req.params.id]);
  if (!tool) return res.status(404).json({ error: 'Tool not found' });

  const { rows: [previous] } = await pool.query(
    `SELECT * FROM mcp_governance.mcp_tool_definition_history WHERE tool_id = $1 ORDER BY superseded_at DESC LIMIT 1`,
    [req.params.id]
  );
  if (!previous) return res.status(404).json({ error: 'No previous definition snapshot to roll back to' });

  await pool.query(
    `INSERT INTO mcp_governance.mcp_tool_definition_history
       (tool_id, description, input_schema_json, output_schema_json, definition_hash, version)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tool.id, tool.description, tool.input_schema_json, tool.output_schema_json, tool.definition_hash, tool.version]
  );

  const { rows: [restored] } = await pool.query(
    `UPDATE mcp_governance.mcp_tools
        SET description = $1, input_schema_json = $2, output_schema_json = $3,
            definition_hash = $4, version = $5, approval_status = 'pending', updated_at = NOW()
      WHERE id = $6
      RETURNING *`,
    [previous.description, previous.input_schema_json, previous.output_schema_json, previous.definition_hash, previous.version, req.params.id]
  );

  await pool.query(
    `INSERT INTO mcp_governance.mcp_tool_decision_history (tool_id, decision_type, from_value, to_value, reason)
     VALUES ($1, 'approval', $2, 'pending', 'Rolled back to previous definition — requires re-review')`,
    [req.params.id, tool.approval_status]
  );

  res.json({ ...restored, rolled_back_from_snapshot_at: previous.superseded_at });
}));

export default router;
