// AUTH-501/505 — resolves a user's roles and effective permissions from
// auth.user_roles/auth.role_permissions at login and on /me, so the JWT
// (and the SPA) always reflect current role assignments rather than a
// value cached at some earlier point.

import pool from '../../db.js';

export async function getRolesAndPermissions(userId) {
  const { rows } = await pool.query(
    `SELECT r.name AS role, p.name AS permission
     FROM auth.user_roles ur
     JOIN auth.roles r ON r.id = ur.role_id
     LEFT JOIN auth.role_permissions rp ON rp.role_id = ur.role_id
     LEFT JOIN auth.permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1`,
    [userId]
  );
  const roles = [...new Set(rows.map(r => r.role))];
  const permissions = [...new Set(rows.map(r => r.permission).filter(Boolean))];
  return { roles, permissions };
}
