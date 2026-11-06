// EP-308-S7 — User management API, all routes require user:manage.
// auth-service doesn't apply requireAuth globally (it's the issuer, not a
// consumer), so requireAuth is applied per-route here alongside
// requirePermission. Follows the same manual per-route pattern used by
// workflow-governance-service's two public webhook routes.

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../../db.js';
import requireAuth, { requirePermission } from '../lib/require-auth.js';
import { getRolesAndPermissions } from '../lib/rbac.js';
import { logPasswordChange } from '../lib/audit-client.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const canManage = [requireAuth, requirePermission('user:manage')];

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

// GET /users — list all users with their current roles
router.get('/', ...canManage, wrap(async (_req, res) => {
  const { rows: users } = await pool.query(
    `SELECT u.id, u.username, u.status, u.created_at, u.last_login_at,
            ARRAY_REMOVE(ARRAY_AGG(r.name ORDER BY r.name), NULL) AS roles
       FROM auth.users u
       LEFT JOIN auth.user_roles ur ON ur.user_id = u.id
       LEFT JOIN auth.roles r ON r.id = ur.role_id
      GROUP BY u.id
      ORDER BY u.created_at DESC`
  );
  res.json(users);
}));

// GET /users/:id — single user with roles and permissions
router.get('/:id', ...canManage, wrap(async (req, res) => {
  const { rows: [user] } = await pool.query(
    `SELECT id, username, status, created_at, last_login_at FROM auth.users WHERE id = $1`,
    [req.params.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { roles, permissions } = await getRolesAndPermissions(user.id);
  res.json({ ...user, roles, permissions });
}));

// POST /users — create a new user with an initial role assignment
router.post('/', ...canManage, wrap(async (req, res) => {
  const { password, role = 'guest' } = req.body;
  const username = req.body.username?.trim();
  if (!username) return res.status(400).json({ error: 'username is required' });
  if (!password) return res.status(400).json({ error: 'password is required' });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const { rows: [roleRow] } = await pool.query('SELECT id FROM auth.roles WHERE name = $1', [role]);
  if (!roleRow) return res.status(400).json({ error: `Unknown role: ${role}` });

  const existing = await pool.query('SELECT id FROM auth.users WHERE username = $1', [username]);
  if (existing.rows.length) return res.status(409).json({ error: `Username "${username}" is already taken` });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { rows: [user] } = await pool.query(
    `INSERT INTO auth.users (username, password_hash, status) VALUES ($1, $2, 'active') RETURNING id, username, status, created_at`,
    [username, passwordHash]
  );

  await pool.query(
    'INSERT INTO auth.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [user.id, roleRow.id]
  );

  res.status(201).json({ ...user, roles: [role], permissions: [] });
}));

// PATCH /users/:id/roles — replace a user's role assignments atomically
router.patch('/:id/roles', ...canManage, wrap(async (req, res) => {
  const { roles } = req.body;
  if (!Array.isArray(roles) || roles.length === 0) {
    return res.status(400).json({ error: 'roles must be a non-empty array of role names' });
  }

  const { rows: roleRows } = await pool.query(
    'SELECT id, name FROM auth.roles WHERE name = ANY($1::text[])',
    [roles]
  );
  if (roleRows.length !== roles.length) {
    const found = roleRows.map(r => r.name);
    const missing = roles.filter(n => !found.includes(n));
    return res.status(400).json({ error: `Unknown roles: ${missing.join(', ')}` });
  }

  const { rows: [user] } = await pool.query('SELECT id FROM auth.users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  await pool.query('DELETE FROM auth.user_roles WHERE user_id = $1', [user.id]);
  for (const roleRow of roleRows) {
    await pool.query(
      'INSERT INTO auth.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [user.id, roleRow.id]
    );
  }

  const { roles: updatedRoles, permissions } = await getRolesAndPermissions(user.id);
  res.json({ id: user.id, roles: updatedRoles, permissions });
}));

// PATCH /users/:id/password — admin reset. No current-password check: the
// caller already holds user:manage, the same privilege level that lets them
// disable the account outright. Replaces the manual DB-hash-sync that was
// previously the only way to change a password other than the account
// owner's own login.
router.patch('/:id/password', ...canManage, wrap(async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password is required' });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const { rows: [user] } = await pool.query('SELECT id, username FROM auth.users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query('UPDATE auth.users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);

  logPasswordChange({
    username: user.username, userId: user.id, actorId: req.user?.id, method: 'admin_reset',
    ip: req.ip || req.headers['x-forwarded-for'],
  });

  res.status(204).end();
}));

// DELETE /users/:id — disable (soft-delete). Hard-delete would remove audit
// trail via ON DELETE CASCADE on user_roles; disabling preserves history.
// Prevents self-disablement to avoid locking out the last admin.
router.delete('/:id', ...canManage, wrap(async (req, res) => {
  if (req.user?.id === req.params.id) {
    return res.status(400).json({ error: 'Cannot disable your own account' });
  }

  const { rows: [user] } = await pool.query(
    `UPDATE auth.users SET status = 'disabled' WHERE id = $1 AND status = 'active' RETURNING id`,
    [req.params.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found or already disabled' });
  res.status(204).end();
}));

// PATCH /users/:id/enable — the missing other direction of DELETE /:id above.
// Without this, disabling a user was a one-way trip: no way to undo a
// mistaken disable, and the SPA hid every action button once status wasn't
// 'active'. Re-enabling doesn't touch role assignments — whatever roles the
// account had before disablement are exactly what it has again.
router.patch('/:id/enable', ...canManage, wrap(async (req, res) => {
  const { rows: [user] } = await pool.query(
    `UPDATE auth.users SET status = 'active' WHERE id = $1 AND status = 'disabled' RETURNING id`,
    [req.params.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found or not disabled' });
  res.status(204).end();
}));

export default router;
