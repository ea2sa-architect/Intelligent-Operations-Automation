// EP-306-S12 — Scoped API keys for machine clients (starting with the discovery-agent
// CLI). Follows users.js's manual per-route requireAuth pattern (auth-service doesn't
// apply requireAuth globally — it's the issuer, not a consumer). /exchange is the one
// route with no requireAuth: the raw key itself is the credential, same as /login
// takes a password with no prior auth.

import { Router } from 'express';
import pool from '../../db.js';
import requireAuth, { requirePermission, asUserId } from '../lib/require-auth.js';
import jwtLib from '../lib/jwt.js';
import { generateApiKey, hashApiKey, keyPrefix } from '../lib/api-keys.js';
import { logApiKeyEvent } from '../lib/audit-client.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const canManage = [requireAuth, requirePermission('user:manage')];

const EXCHANGE_TOKEN_TTL = '15m';
const EXCHANGE_TOKEN_TTL_SECONDS = 15 * 60;

// GET /api-keys — list, redacted (never key_hash or the raw key)
router.get('/', ...canManage, wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, key_prefix, scopes, created_by, created_at, last_used_at, revoked_at
       FROM auth.api_keys
      ORDER BY created_at DESC`
  );
  res.json(rows);
}));

// POST /api-keys — create; returns the raw key once, never retrievable again
router.post('/', ...canManage, wrap(async (req, res) => {
  const { name, scopes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return res.status(400).json({ error: 'scopes must be a non-empty array of permission names' });
  }

  const { rows: permRows } = await pool.query(
    'SELECT name FROM auth.permissions WHERE name = ANY($1::text[])',
    [scopes]
  );
  if (permRows.length !== scopes.length) {
    const found = permRows.map(p => p.name);
    const missing = scopes.filter(s => !found.includes(s));
    return res.status(400).json({ error: `Unknown scopes: ${missing.join(', ')}` });
  }

  const rawKey = generateApiKey();
  const { rows: [key] } = await pool.query(
    `INSERT INTO auth.api_keys (name, key_hash, key_prefix, scopes, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, key_prefix, scopes, created_by, created_at`,
    [name.trim(), hashApiKey(rawKey), keyPrefix(rawKey), scopes, asUserId(req.user?.id)]
  );

  logApiKeyEvent({
    action: 'create', keyId: key.id, keyName: key.name, actorId: req.user?.id,
    outcome: 'success', ip: req.ip || req.headers['x-forwarded-for'], metadata: { scopes },
  });

  res.status(201).json({ ...key, api_key: rawKey });
}));

// DELETE /api-keys/:id — revoke (soft-delete, same convention as users.js)
router.delete('/:id', ...canManage, wrap(async (req, res) => {
  const { rows: [key] } = await pool.query(
    `UPDATE auth.api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id, name`,
    [req.params.id]
  );
  if (!key) return res.status(404).json({ error: 'API key not found or already revoked' });

  logApiKeyEvent({
    action: 'revoke', keyId: key.id, keyName: key.name, actorId: req.user?.id,
    outcome: 'success', ip: req.ip || req.headers['x-forwarded-for'],
  });

  res.status(204).end();
}));

// POST /api-keys/exchange — trade a raw API key for a short-lived JWT. No requireAuth:
// the raw key is the credential. Generic error on any failure to prevent key-prefix
// enumeration, same reasoning as /login's generic "Invalid username or password".
router.post('/exchange', wrap(async (req, res) => {
  const { api_key } = req.body;
  const genericError = { error: 'Invalid or revoked API key' };
  const ip = req.ip || req.headers['x-forwarded-for'];

  if (!api_key) return res.status(400).json({ error: 'api_key is required' });

  const { rows: [key] } = await pool.query(
    `SELECT * FROM auth.api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hashApiKey(api_key)]
  );
  if (!key) {
    logApiKeyEvent({ action: 'exchange', keyName: 'unknown', outcome: 'failure', ip });
    return res.status(401).json(genericError);
  }

  await pool.query('UPDATE auth.api_keys SET last_used_at = NOW() WHERE id = $1', [key.id]);

  const token = jwtLib.signAccessToken(
    { id: `api-key:${key.id}`, username: key.name, roles: [], permissions: key.scopes },
    { expiresIn: EXCHANGE_TOKEN_TTL }
  );

  logApiKeyEvent({ action: 'exchange', keyId: key.id, keyName: key.name, outcome: 'success', ip });

  res.json({ token, scopes: key.scopes, expires_in: EXCHANGE_TOKEN_TTL_SECONDS });
}));

export default router;
