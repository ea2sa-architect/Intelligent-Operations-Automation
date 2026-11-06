import { Router } from 'express';
import pool from '../../db.js';
import requireAuth, { requirePermission } from '../lib/require-auth.js';
import { getAdapter } from '../lib/adapters/index.js';

const router = Router();
// AUTH-201 (extended) — this router is entirely SPA-facing, no external
// (n8n) callers, so a single router-level requireAuth is sufficient.
router.use(requireAuth);
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

// GET /platforms — list all connections
router.get('/', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, platform, name, status, last_tested_at, error_message, workflow_count,
            created_at, updated_at,
            -- Strip secrets from config before returning
            (config_json - 'api_key' - 'client_secret') AS config_json
       FROM workflow_governance.platform_connections
      ORDER BY platform, name`
  );
  res.json(rows);
}));

// POST /platforms — create a connection
router.post('/', requirePermission('workflow:read'), wrap(async (req, res) => {
  const { platform, name, config_json = {} } = req.body;
  if (!platform) return res.status(400).json({ error: 'platform is required' });
  if (!name)     return res.status(400).json({ error: 'name is required' });

  const VALID = ['n8n', 'zapier', 'make', 'power_automate', 'camunda'];
  if (!VALID.includes(platform)) {
    return res.status(400).json({ error: `platform must be one of: ${VALID.join(', ')}` });
  }

  const { rows: [conn] } = await pool.query(
    `INSERT INTO workflow_governance.platform_connections (platform, name, config_json)
     VALUES ($1, $2, $3)
     RETURNING id, platform, name, status, last_tested_at, error_message, workflow_count, created_at, updated_at,
               (config_json - 'api_key' - 'client_secret') AS config_json`,
    [platform, name.trim(), config_json]
  );
  res.status(201).json(conn);
}));

// PUT /platforms/:id — update name or config
router.put('/:id', requirePermission('workflow:read'), wrap(async (req, res) => {
  const { name, config_json } = req.body;
  const { rows: [conn] } = await pool.query(
    `UPDATE workflow_governance.platform_connections
        SET name        = COALESCE($1, name),
            config_json = CASE WHEN $2::jsonb IS NOT NULL
                               THEN config_json || $2::jsonb
                               ELSE config_json END,
            updated_at  = NOW()
      WHERE id = $3
      RETURNING id, platform, name, status, last_tested_at, error_message, workflow_count, created_at, updated_at,
                (config_json - 'api_key' - 'client_secret') AS config_json`,
    [name ?? null, config_json ? JSON.stringify(config_json) : null, req.params.id]
  );
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  res.json(conn);
}));

// DELETE /platforms/:id
router.delete('/:id', requirePermission('workflow:read'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM workflow_governance.platform_connections WHERE id = $1',
    [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Connection not found' });
  res.status(204).end();
}));

// POST /platforms/:id/test — test live connectivity, update status in DB
router.post('/:id/test', requirePermission('workflow:read'), wrap(async (req, res) => {
  const { rows: [conn] } = await pool.query(
    'SELECT * FROM workflow_governance.platform_connections WHERE id = $1',
    [req.params.id]
  );
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  let result;
  try {
    const adapter = getAdapter(conn.platform);
    result = await adapter.testConnection(conn.config_json);
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  // Power Automate: auto-populate environment_id and dataverse_url
  let configPatch = null;
  if (result.ok && conn.platform === 'power_automate') {
    const envs = result.details?.environments ?? [];
    if (envs.length > 0) {
      const env = envs.find(e => e.id === conn.config_json.environment_id) ?? envs[0];
      const patch = {};
      if (!conn.config_json.environment_id) patch.environment_id = env.id;
      if (env.dataverse_url) patch.dataverse_url = env.dataverse_url;
      if (Object.keys(patch).length > 0) configPatch = JSON.stringify(patch);
    }
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE workflow_governance.platform_connections
        SET status         = $1,
            error_message  = $2,
            last_tested_at = NOW(),
            config_json    = CASE WHEN $4::jsonb IS NOT NULL
                                  THEN config_json || $4::jsonb
                                  ELSE config_json END,
            updated_at     = NOW()
      WHERE id = $3
      RETURNING id, platform, name, status, last_tested_at, error_message, workflow_count, created_at, updated_at,
                (config_json - 'api_key' - 'client_secret') AS config_json`,
    [result.ok ? 'connected' : 'error', result.error ?? null, req.params.id, configPatch]
  );
  res.json({ ...updated, test: result });
}));

export default router;
