import { Router } from 'express';
import pool from '../../db.js';
import credentialScanner from '../lib/credential-scanner.js';
import governanceClient from '../lib/governance-client.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const SENSITIVITIES = ['public', 'internal', 'confidential', 'restricted'];

// Epic 5, Feature 5.3 — a resource's uri_template is the one field type this
// service has that n8n node parameters never do: connection-string-shaped
// credentials (postgres://user:pass@host/db). Same delete + reinsert pattern
// as servers.js's persistCredentialFindings, scoped to source_type='resource_uri'.
// EP-101-S9 — carries forward rotation_confirmed_at/by across a rescan when
// the exact same fingerprint reappears (see servers.js's persistCredentialFindings).
async function persistCredentialFindings(serverId, resourceId, findings) {
  const { rows: existing } = await pool.query(
    `SELECT fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by
       FROM mcp_governance.mcp_credential_exposure
      WHERE source_type = 'resource_uri' AND resource_id = $1`,
    [resourceId]
  );
  const priorByFingerprint = new Map(existing.map(e => [e.fingerprint_sha256, e]));

  await pool.query(
    `DELETE FROM mcp_governance.mcp_credential_exposure
      WHERE source_type = 'resource_uri' AND resource_id = $1`,
    [resourceId]
  );
  for (const f of findings) {
    const carried = priorByFingerprint.get(f.fingerprint_sha256);
    await pool.query(
      `INSERT INTO mcp_governance.mcp_credential_exposure
         (server_id, source_type, field_name, resource_id, secret_type, redacted_preview, fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by)
       VALUES ($1, 'resource_uri', 'uri_template', $2, $3, $4, $5, $6, $7)`,
      [serverId, resourceId, f.secret_type, f.redacted_preview, f.fingerprint_sha256,
       carried?.rotation_confirmed_at ?? null, carried?.rotation_confirmed_by ?? null]
    );
  }
}

// GET /servers/:serverId/resources
router.get('/servers/:serverId/resources', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM mcp_governance.mcp_resources WHERE server_id = $1 ORDER BY uri_template',
    [req.params.serverId]
  );
  res.json(rows);
}));

// POST /servers/:serverId/resources
router.post('/servers/:serverId/resources', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { uri_template, data_classification, data_owner, sensitivity, tenant_boundary, access_conditions, retention_requirements } = req.body;
  if (!uri_template) return res.status(400).json({ error: 'uri_template is required' });
  if (sensitivity && !SENSITIVITIES.includes(sensitivity)) {
    return res.status(400).json({ error: `sensitivity must be one of: ${SENSITIVITIES.join(', ')}` });
  }

  // Epic 5, Feature 5.3 — a URI template like postgres://user:pass@host/db
  // must never be persisted with the credential still in it.
  const { redactedFields, findings } = credentialScanner.redactFields({ uri_template });

  const { rows: [resource] } = await pool.query(
    `INSERT INTO mcp_governance.mcp_resources
       (server_id, uri_template, data_classification, data_owner, sensitivity, tenant_boundary, access_conditions, retention_requirements)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [req.params.serverId, redactedFields.uri_template.trim(), data_classification ?? null, data_owner ?? null,
     sensitivity ?? null, tenant_boundary ?? null, access_conditions ?? null, retention_requirements ?? null]
  );

  if (findings.length > 0) {
    await persistCredentialFindings(req.params.serverId, resource.id, findings);
    await governanceClient.evaluateServer(req.params.serverId);
  }
  res.status(201).json({ ...resource, credential_exposure_detected: findings.length > 0 });
}));

// PUT /resources/:id
router.put('/resources/:id', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { data_classification, data_owner, sensitivity, tenant_boundary, access_conditions, retention_requirements } = req.body;
  const { rows: [resource] } = await pool.query(
    `UPDATE mcp_governance.mcp_resources
        SET data_classification    = COALESCE($1, data_classification),
            data_owner             = COALESCE($2, data_owner),
            sensitivity            = COALESCE($3, sensitivity),
            tenant_boundary        = COALESCE($4, tenant_boundary),
            access_conditions      = COALESCE($5, access_conditions),
            retention_requirements = COALESCE($6, retention_requirements),
            updated_at             = NOW()
      WHERE id = $7
      RETURNING *`,
    [data_classification ?? null, data_owner ?? null, sensitivity ?? null,
     tenant_boundary ?? null, access_conditions ?? null, retention_requirements ?? null, req.params.id]
  );
  if (!resource) return res.status(404).json({ error: 'Resource not found' });
  res.json(resource);
}));

// DELETE /resources/:id
router.delete('/resources/:id', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM mcp_governance.mcp_resources WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Resource not found' });
  res.status(204).end();
}));

export default router;
