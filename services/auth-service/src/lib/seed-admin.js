// AUTH-103 — seeds exactly one administrator account on startup, only when
// absent. Password comes from env (AUTH_ADMIN_PASSWORD), never hardcoded or
// logged; stored value is always a bcrypt hash. Matches the platform's
// existing default-deny registration philosophy (manual MCP server
// registration, no self-service signup) — there is no public registration
// endpoint anywhere in this service.
//
// AUTH-501 — extended to also seed an optional guest account (read-only
// role) the same idempotent way. Both share seedUser(): create-if-absent,
// never touch an existing account's password, assign the named role via
// auth.user_roles once at creation time.

import bcrypt from 'bcryptjs';
import pool from '../../db.js';

const BCRYPT_ROUNDS = 12;

async function seedUser({ username, password, role, envLabel }) {
  if (!username || !password) {
    console.warn(`[seed-admin] ${envLabel} not set — skipping ${role} seed`);
    return;
  }

  const { rows: [existing] } = await pool.query('SELECT id FROM auth.users WHERE username = $1', [username]);
  if (existing) return;

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { rows: [user] } = await pool.query(
    `INSERT INTO auth.users (username, password_hash, status) VALUES ($1, $2, 'active') RETURNING id`,
    [username, passwordHash]
  );
  await pool.query(
    `INSERT INTO auth.user_roles (user_id, role_id)
     SELECT $1, id FROM auth.roles WHERE name = $2
     ON CONFLICT DO NOTHING`,
    [user.id, role]
  );
  console.log(`[seed-admin] Seeded ${role} account "${username}"`);
}

async function ensureAdminSeeded() {
  await seedUser({
    username: process.env.AUTH_ADMIN_USERNAME,
    password: process.env.AUTH_ADMIN_PASSWORD,
    role: 'admin',
    envLabel: 'AUTH_ADMIN_USERNAME/AUTH_ADMIN_PASSWORD',
  });
}

async function ensureGuestSeeded() {
  await seedUser({
    username: process.env.AUTH_GUEST_USERNAME,
    password: process.env.AUTH_GUEST_PASSWORD,
    role: 'guest',
    envLabel: 'AUTH_GUEST_USERNAME/AUTH_GUEST_PASSWORD',
  });
}

// A second, independent admin account (e.g. "admin-admin") for
// break-glass/special-case access — separate credentials from the primary
// admin so one can be rotated or disabled without touching the other. Same
// idempotent, optional-if-unset seeding as the guest account.
async function ensureSecondaryAdminSeeded() {
  await seedUser({
    username: process.env.AUTH_ADMIN2_USERNAME,
    password: process.env.AUTH_ADMIN2_PASSWORD,
    role: 'admin',
    envLabel: 'AUTH_ADMIN2_USERNAME/AUTH_ADMIN2_PASSWORD',
  });
}

export default { ensureAdminSeeded, ensureGuestSeeded, ensureSecondaryAdminSeeded };
