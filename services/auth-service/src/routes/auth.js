import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../../db.js';
import jwtLib from '../lib/jwt.js';
import { getRolesAndPermissions } from '../lib/rbac.js';
import { logLogin, logLogout, logAuthFailure, logPasswordChange } from '../lib/audit-client.js';
import requireAuth from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

// AUTH-306 — cookie name/domain/path/SameSite/Secure are configurable so
// shared Kong infrastructure doesn't leak this cookie to sibling apps.
export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'ioa_session';
// AUTH-305 — the CSRF cookie is deliberately NOT httpOnly: the SPA must be
// able to read it with JS to echo it back as the X-CSRF-Token header
// (double-submit pattern). It carries no authority on its own — only the
// session cookie (httpOnly) does — so this is safe to expose to JS.
export const CSRF_COOKIE_NAME = process.env.AUTH_CSRF_COOKIE_NAME || 'ioa_csrf';
const COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN || undefined;
const isProd = process.env.NODE_ENV === 'production';

function cookieOptions(extra = {}) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    domain: COOKIE_DOMAIN,
    maxAge: 60 * 60 * 1000, // matches the 60m access-token TTL
    ...extra,
  };
}

// AUTH-104/105 — a generic rejection message for both "no such user" and
// "wrong password" prevents username enumeration via response differences.
router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  const genericError = { error: 'Invalid username or password' };
  const ip = req.ip || req.headers['x-forwarded-for'];

  if (!username || !password) return res.status(400).json(genericError);

  const { rows: [user] } = await pool.query(
    `SELECT * FROM auth.users WHERE username = $1 AND status = 'active'`,
    [username]
  );
  if (!user) {
    logAuthFailure({ reason: 'unknown_user', username, ip });
    return res.status(401).json(genericError);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    logAuthFailure({ reason: 'wrong_password', username, ip });
    return res.status(401).json(genericError);
  }

  await pool.query('UPDATE auth.users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  const { roles, permissions } = await getRolesAndPermissions(user.id);
  const token = jwtLib.signAccessToken({ ...user, roles, permissions });
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.cookie(CSRF_COOKIE_NAME, crypto.randomBytes(32).toString('hex'), cookieOptions({ httpOnly: false }));
  logLogin({ username: user.username, userId: user.id, outcome: 'success', ip, metadata: { roles } });
  res.json({ username: user.username, status: user.status, roles, permissions });
}));

// AUTH-106 — idempotent: clearing an already-absent cookie is not an error.
// Deliberately NOT CSRF-checked: forcing a logout is low-severity (the
// worst outcome is the victim has to log back in), and a CSRF requirement
// here would break the idempotency AUTH-106 explicitly asks for — a second
// call would have no CSRF cookie left to present after the first call
// cleared it.
router.post('/logout', wrap(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwtLib.verifyAccessToken(token);
      logLogout({ username: payload.username, userId: payload.sub, ip: req.ip || req.headers['x-forwarded-for'] });
    } catch { /* expired token — log without identity */ }
  }
  res.clearCookie(COOKIE_NAME, { path: '/', domain: COOKIE_DOMAIN });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/', domain: COOKIE_DOMAIN });
  res.status(200).json({ loggedOut: true });
}));

// AUTH-107 — lets the SPA restore authenticated state after a page refresh.
router.get('/me', wrap(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  let payload;
  try {
    payload = jwtLib.verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { rows: [user] } = await pool.query(
    `SELECT username, status FROM auth.users WHERE id = $1 AND status = 'active'`,
    [payload.sub]
  );
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  // AUTH-505 — resolved fresh from the DB rather than trusted from the
  // token, so a mid-session role change takes effect the next time the SPA
  // calls /me (e.g. on refresh), not only after the 60m token expires.
  const { roles, permissions } = await getRolesAndPermissions(payload.sub);
  res.json({ username: user.username, status: user.status, roles, permissions });
}));

// PATCH /me/password — self-service password change. Requires the current
// password (unlike PATCH /users/:id/password's admin reset in users.js) —
// anyone with an active session could otherwise silently lock out the
// legitimate account owner. Uses requireAuth (not /me's own manual token
// check above) so this mutating route gets CSRF protection for free, same
// as every other mutating route in this codebase.
router.patch('/me/password', requireAuth, wrap(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password) return res.status(400).json({ error: 'current_password is required' });
  if (!new_password) return res.status(400).json({ error: 'new_password is required' });
  if (new_password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `new_password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const { rows: [user] } = await pool.query(
    'SELECT id, username, password_hash FROM auth.users WHERE id = $1',
    [req.user.id]
  );
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const passwordHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
  await pool.query('UPDATE auth.users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);

  logPasswordChange({
    username: user.username, userId: user.id, actorId: user.id, method: 'self_service',
    ip: req.ip || req.headers['x-forwarded-for'],
  });

  res.status(204).end();
}));

export default router;
