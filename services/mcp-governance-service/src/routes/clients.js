import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const CLIENT_TYPES  = ['claude_desktop', 'ide', 'agent', 'n8n_workflow', 'custom_application', 'other'];
const ENVIRONMENTS  = ['development', 'test', 'production'];

// GET /clients
router.get('/', wrap(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM mcp_governance.mcp_clients ORDER BY name');
  res.json(rows);
}));

// GET /clients/:id — includes connected servers
router.get('/:id', wrap(async (req, res) => {
  const { rows: [client] } = await pool.query('SELECT * FROM mcp_governance.mcp_clients WHERE id = $1', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { rows: servers } = await pool.query(
    `SELECT s.id, s.name, s.status, cs.enabled_capabilities
       FROM mcp_governance.mcp_client_servers cs
       JOIN mcp_governance.mcp_servers s ON s.id = cs.server_id
      WHERE cs.client_id = $1
      ORDER BY s.name`,
    [req.params.id]
  );
  res.json({ ...client, servers });
}));

// POST /clients
router.post('/', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { name, client_type, identity, environment, approval_configuration } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (client_type && !CLIENT_TYPES.includes(client_type)) {
    return res.status(400).json({ error: `client_type must be one of: ${CLIENT_TYPES.join(', ')}` });
  }
  if (environment && !ENVIRONMENTS.includes(environment)) {
    return res.status(400).json({ error: `environment must be one of: ${ENVIRONMENTS.join(', ')}` });
  }

  const { rows: [client] } = await pool.query(
    `INSERT INTO mcp_governance.mcp_clients (name, client_type, identity, environment, approval_configuration)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [name.trim(), client_type ?? null, identity ?? null, environment ?? null, JSON.stringify(approval_configuration ?? {})]
  );
  res.status(201).json(client);
}));

// PUT /clients/:id/servers/:serverId — connect a client to a server
router.put('/:id/servers/:serverId', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { enabled_capabilities } = req.body;
  const { rows: [link] } = await pool.query(
    `INSERT INTO mcp_governance.mcp_client_servers (client_id, server_id, enabled_capabilities)
     VALUES ($1, $2, $3)
     ON CONFLICT (client_id, server_id) DO UPDATE SET enabled_capabilities = EXCLUDED.enabled_capabilities
     RETURNING *`,
    [req.params.id, req.params.serverId, enabled_capabilities ?? null]
  );
  res.json(link);
}));

// DELETE /clients/:id/servers/:serverId — disconnect
router.delete('/:id/servers/:serverId', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM mcp_governance.mcp_client_servers WHERE client_id = $1 AND server_id = $2',
    [req.params.id, req.params.serverId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Connection not found' });
  res.status(204).end();
}));

// DELETE /clients/:id
router.delete('/:id', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM mcp_governance.mcp_clients WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Client not found' });
  res.status(204).end();
}));

export default router;
