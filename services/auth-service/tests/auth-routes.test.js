import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  process.env.AUTH_JWT_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
  process.env.AUTH_JWT_PUBLIC_KEY = publicKey.replace(/\n/g, '\\n');
});
afterAll(() => { process.env = { ...ORIGINAL_ENV }; });

import pool from '../db.js';
import jwtLib from '../src/lib/jwt.js';
import app from '../index.js';

const USER = { id: 'user-1', username: 'admin', status: 'active' };

beforeEach(() => vi.clearAllMocks());

describe('POST /login', () => {
  it('rejects a request with no username or password', async () => {
    const res = await request(app).post('/login').send({});
    expect(res.status).toBe(400);
  });

  // AUTH-104 — generic response prevents username enumeration
  it('returns the same generic error for an unknown username as for a wrong password', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // unknown user
    const unknownRes = await request(app).post('/login').send({ username: 'nobody', password: 'x' });

    const passwordHash = await bcrypt.hash('correct-password', 4);
    pool.query.mockResolvedValueOnce({ rows: [{ ...USER, password_hash: passwordHash }] });
    const wrongPasswordRes = await request(app).post('/login').send({ username: 'admin', password: 'wrong' });

    expect(unknownRes.status).toBe(401);
    expect(wrongPasswordRes.status).toBe(401);
    expect(unknownRes.body).toEqual(wrongPasswordRes.body);
  });

  it('logs in successfully, sets the session cookie, and updates last_login_at', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...USER, password_hash: passwordHash }] }) // lookup
      .mockResolvedValueOnce({ rows: [] }) // last_login_at update
      .mockResolvedValueOnce({ rows: [{ role: 'admin', permission: 'read' }, { role: 'admin', permission: 'write' }] }); // roles/permissions

    const res = await request(app).post('/login').send({ username: 'admin', password: 'correct-password' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'admin', status: 'active', roles: ['admin'], permissions: ['read', 'write'] });

    const cookies = res.headers['set-cookie'];
    const sessionCookie = cookies.find(c => c.startsWith('ioa_session='));
    const csrfCookie = cookies.find(c => c.startsWith('ioa_csrf='));
    expect(sessionCookie).toContain('HttpOnly');
    // AUTH-305 — the CSRF cookie is deliberately readable by SPA JS (double-submit pattern)
    expect(csrfCookie).toBeTruthy();
    expect(csrfCookie).not.toContain('HttpOnly');

    const updateCall = pool.query.mock.calls.find(c => c[0].includes('last_login_at'));
    expect(updateCall).toBeTruthy();
  });

  it('does not authenticate a disabled user (the active-status filter excludes them)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // WHERE status = 'active' excludes disabled users
    const res = await request(app).post('/login').send({ username: 'admin', password: 'whatever' });
    expect(res.status).toBe(401);
  });
});

describe('POST /logout', () => {
  it('clears the session and CSRF cookies and is idempotent', async () => {
    const res1 = await request(app).post('/logout');
    expect(res1.status).toBe(200);
    expect(res1.body).toEqual({ loggedOut: true });
    const cookies = res1.headers['set-cookie'];
    expect(cookies.some(c => c.startsWith('ioa_session=;') || c.includes('ioa_session=;'))).toBe(true);
    expect(cookies.some(c => c.startsWith('ioa_csrf=;') || c.includes('ioa_csrf=;'))).toBe(true);

    // AUTH-106 — idempotent even with no CSRF cookie left to present
    const res2 = await request(app).post('/logout');
    expect(res2.status).toBe(200);
  });
});

describe('GET /me', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a malformed token', async () => {
    const res = await request(app).get('/me').set('Cookie', 'ioa_session=not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid session', async () => {
    const token = jwtLib.signAccessToken(USER);
    pool.query
      .mockResolvedValueOnce({ rows: [{ username: 'admin', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ role: 'admin', permission: 'read' }, { role: 'admin', permission: 'write' }] });

    const res = await request(app).get('/me').set('Cookie', `ioa_session=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'admin', status: 'active', roles: ['admin'], permissions: ['read', 'write'] });
  });

  it('returns 401 when the token is valid but the user no longer exists or is disabled', async () => {
    const token = jwtLib.signAccessToken(USER);
    pool.query.mockResolvedValueOnce({ rows: [] }); // active-status lookup finds nothing
    const res = await request(app).get('/me').set('Cookie', `ioa_session=${token}`);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /me/password', () => {
  const CSRF = 'matching-csrf-value';
  function authedRequest(token) {
    return request(app)
      .patch('/me/password')
      .set('Cookie', [`ioa_session=${token}`, `ioa_csrf=${CSRF}`])
      .set('X-CSRF-Token', CSRF);
  }

  it('returns 401 with no session', async () => {
    const res = await request(app).patch('/me/password').send({ current_password: 'a', new_password: 'newpassword123' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when current_password is missing', async () => {
    const token = jwtLib.signAccessToken(USER);
    const res = await authedRequest(token).send({ new_password: 'newpassword123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when new_password is shorter than the minimum length', async () => {
    const token = jwtLib.signAccessToken(USER);
    const res = await authedRequest(token).send({ current_password: 'x', new_password: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when current_password does not match', async () => {
    const token = jwtLib.signAccessToken(USER);
    const passwordHash = await bcrypt.hash('correct-password', 4);
    pool.query.mockResolvedValueOnce({ rows: [{ id: USER.id, username: USER.username, password_hash: passwordHash }] });

    const res = await authedRequest(token).send({ current_password: 'wrong', new_password: 'newpassword123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  it('changes the password when current_password is correct', async () => {
    const token = jwtLib.signAccessToken(USER);
    const passwordHash = await bcrypt.hash('correct-password', 4);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: USER.id, username: USER.username, password_hash: passwordHash }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await authedRequest(token).send({ current_password: 'correct-password', new_password: 'newpassword123' });
    expect(res.status).toBe(204);

    const updateCall = pool.query.mock.calls.find(c => c[0].includes('UPDATE auth.users SET password_hash'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1][1]).toBe(USER.id);
  });

  it('enforces CSRF like every other mutating route', async () => {
    const token = jwtLib.signAccessToken(USER);
    const res = await request(app)
      .patch('/me/password')
      .set('Cookie', `ioa_session=${token}`) // no CSRF cookie/header
      .send({ current_password: 'x', new_password: 'newpassword123' });
    expect(res.status).toBe(403);
  });
});
