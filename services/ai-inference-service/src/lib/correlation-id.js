// EP-102-S1 — platform-wide correlation ID standard. Every request gets a
// stable correlation_id: honors an upstream x-correlation-id header if
// present (continuing an existing chain from workflow-governance-service or
// mcp-governance-service), otherwise mints a new UUID (this request starts
// a new chain). Echoed back on the response header so a caller that didn't
// set one can still see what its request was assigned, and so a
// cross-service client (see telemetry-client.js) can read it off the
// response and thread it into whatever it calls next.
//
// Deliberately duplicated per service rather than a shared package — same
// reasoning as require-auth.js and credential-scanner.js: each service is a
// separate deployable with no shared package.

import crypto from 'crypto';

// The standard is UUID (telemetry.metrics.correlation_id is a UUID column,
// added in migration 003) — an upstream caller sending a non-UUID value
// (or nothing at all) must not break ingestion, so a malformed header is
// treated the same as a missing one: mint a fresh chain rather than 500 on
// a Postgres type error three services downstream.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function correlationId(req, res, next) {
  const incoming = req.headers['x-correlation-id'];
  req.correlationId = (typeof incoming === 'string' && UUID_RE.test(incoming.trim()))
    ? incoming.trim()
    : crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}
