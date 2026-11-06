// Scenario 1: login via auth-service -> authenticated call to audit-service ->
// the login is in the audit trail. Services are hit directly (no Kong hop).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const { AUTH_URL, AUDIT_URL, INTERNAL_SERVICE_KEY, IT_ADMIN_USERNAME, IT_ADMIN_PASSWORD } = process.env;

let cookie;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// auth-service emits audit events fire-and-forget, so poll briefly.
async function waitFor(fn, { tries = 20, delay = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(delay);
  }
  return null;
}

before(async () => {
  const res = await fetch(`${AUTH_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: IT_ADMIN_USERNAME, password: IT_ADMIN_PASSWORD }),
  });
  assert.equal(res.status, 200);
  cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.match(cookie, /ioa_session=/);
  const me = await fetch(`${AUTH_URL}/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
});

test('audit-service rejects unauthenticated reads', async () => {
  const res = await fetch(`${AUDIT_URL}/events`);
  assert.equal(res.status, 401);
});

test('login produces an auth.login audit event readable with the session', async () => {
  const hit = await waitFor(async () => {
    const res = await fetch(`${AUDIT_URL}/events?event_type=auth.login&limit=50`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    const rows = Array.isArray(body) ? body : body.events ?? body.data ?? [];
    return rows.find(e => e.resource_id === IT_ADMIN_USERNAME && e.outcome === 'success');
  });
  assert.ok(hit, 'no auth.login success event for the test admin');
});

test('audit-service accepts a custom event_type from a service caller and returns it', async () => {
  const eventType = `integration.custom.${Date.now()}`;
  const post = await fetch(`${AUDIT_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Service-Key': INTERNAL_SERVICE_KEY },
    body: JSON.stringify({
      event_type: eventType, actor_id: 'integration-harness', actor_type: 'service',
      resource_type: 'harness', resource_id: 'h1', action: 'probe', outcome: 'success',
      metadata_json: { source: 'tests/integration' },
    }),
  });
  assert.equal(post.status, 201);

  const get = await fetch(`${AUDIT_URL}/events?event_type=${encodeURIComponent(eventType)}`, { headers: { cookie } });
  assert.equal(get.status, 200);
  const body = await get.json();
  const rows = Array.isArray(body) ? body : body.events ?? body.data ?? [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_type, eventType);
});

test('a human session cannot forge another actor via POST /events', async () => {
  const res = await fetch(`${AUDIT_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie, 'x-csrf-token': cookie.match(/ioa_csrf=([^;]+)/)?.[1] ?? '' },
    body: JSON.stringify({
      event_type: 'integration.forge', actor_id: 'someone-else', actor_type: 'service',
      resource_type: 'harness', resource_id: 'h1', action: 'probe', outcome: 'success',
    }),
  });
  // Either rejected outright (no audit:write) or accepted with identity forced to the caller — never forged.
  assert.ok([201, 403].includes(res.status), `unexpected ${res.status}`);
  if (res.status === 201) assert.notEqual((await res.json()).actor_id, 'someone-else');
});
