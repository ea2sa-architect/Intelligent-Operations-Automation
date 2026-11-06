// AUTH-105/202 — RS256 signing and verification. auth-service is the only
// place AUTH_JWT_PRIVATE_KEY is ever read; verification uses only the public
// key, deliberately the same call shape every other service's shared
// middleware will use in Epic 2 — proving the contract is uniform rather
// than auth-service special-casing its own /me endpoint.

import jwt from 'jsonwebtoken';

export const ISSUER = 'ioa-auth-service';
export const AUDIENCE = 'ioa-platform';
const ACCESS_TOKEN_TTL = '60m';

// PEM values are stored in .env with literal \n sequences (multi-line
// secrets don't survive KEY=value env-file format otherwise) — unescape
// before handing to jsonwebtoken.
function unescapePem(value) {
  return value ? value.replace(/\\n/g, '\n') : value;
}

// EP-306-S12 — optional expiresIn override so the API-key exchange endpoint can mint
// a shorter-lived token (15m) than a browser session (60m) without a parallel signing
// path. Login's call site passes no options and keeps the default ACCESS_TOKEN_TTL.
//
// EP-204-S5 — an agent credential optionally carries delegation_id, the
// auth.delegation_records row created alongside it. Downstream services'
// require-auth.js read it back into req.user.delegationId so any telemetry
// an agent's action emits can be tagged with the specific delegation that
// authorized it. Absent for every other caller (login, API-key exchange).
function signAccessToken(user, { expiresIn = ACCESS_TOKEN_TTL } = {}) {
  const privateKey = unescapePem(process.env.AUTH_JWT_PRIVATE_KEY);
  if (!privateKey) throw new Error('AUTH_JWT_PRIVATE_KEY is not configured');

  const payload = { sub: user.id, username: user.username, roles: user.roles, permissions: user.permissions };
  if (user.delegationId) payload.delegation_id = user.delegationId;

  return jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn, issuer: ISSUER, audience: AUDIENCE });
}

function verifyAccessToken(token) {
  const publicKey = unescapePem(process.env.AUTH_JWT_PUBLIC_KEY);
  if (!publicKey) throw new Error('AUTH_JWT_PUBLIC_KEY is not configured');

  return jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer: ISSUER, audience: AUDIENCE });
}

export default { signAccessToken, verifyAccessToken, ISSUER, AUDIENCE, ACCESS_TOKEN_TTL };
