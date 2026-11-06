import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/require-auth.js', () => ({
  default: (req, _res, next) => { req.user = { id: 'admin-id', username: 'admin', roles: ['admin'], permissions: ['user:manage'] }; next(); },
  requirePermission: () => (_req, _res, next) => next(),
}));
vi.mock('../src/lib/rbac.js', () => ({
  getRolesAndPermissions: vi.fn().mockResolvedValue({ roles: ['auditor'], permissions: ['mcp:read'] }),
}));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed-pw'), compare: vi.fn() } }));

import pool from '../db.js';
import app from '../index.js';

const USER = { id: 'u1', username: 'testuser', status: 'active', created_at: new Date().toISOString(), last_login_at: null };

beforeEach(() => vi.clearAllMocks());

describe('GET /users', () => {
  it('returns list of users with roles', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...USER, roles: ['auditor'] }] });
    const res = await request(app).get('/users');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe('testuser');
  });
});

describe('GET /users/:id', () => {
  it('returns 404 for unknown user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/users/nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('returns user with roles and permissions', async () => {
    pool.query.mockResolvedValueOnce({ rows: [USER] });
    const res = await request(app).get(`/users/${USER.id}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('testuser');
    expect(res.body.roles).toEqual(['auditor']);
  });
});

describe('POST /users', () => {
  it('returns 400 when username is missing', async () => {
    const res = await request(app).post('/users').send({ password: 'pw123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app).post('/users').send({ username: 'new' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('returns 400 for unknown role', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // role lookup
    const res = await request(app).post('/users').send({ username: 'new', password: 'password123', role: 'nonexistent-role' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown role/i);
  });

  it('creates a new user', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'role-1' }] }) // role lookup
      .mockResolvedValueOnce({ rows: [] })                  // duplicate check
      .mockResolvedValueOnce({ rows: [{ ...USER, id: 'new-id' }] }) // insert user
      .mockResolvedValueOnce({ rows: [] });                  // assign role
    const res = await request(app).post('/users').send({ username: 'testuser', password: 'password123', role: 'auditor' });
    expect(res.status).toBe(201);
    expect(res.body.username).toBe('testuser');
  });

  it('returns 409 when username already taken', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'role-1' }] }) // role lookup
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }] }); // duplicate found
    const res = await request(app).post('/users').send({ username: 'existing', password: 'password123', role: 'auditor' });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /users/:id/roles', () => {
  it('returns 400 when roles is not a non-empty array', async () => {
    const res = await request(app).patch('/users/u1/roles').send({ roles: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown roles', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // role lookup returns nothing
    const res = await request(app).patch('/users/u1/roles').send({ roles: ['invalid-role'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown roles/i);
  });

  it('replaces roles and returns updated assignments', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'role-1', name: 'auditor' }] }) // roles lookup
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }] })                      // user exists
      .mockResolvedValueOnce({ rows: [] })                                   // delete old roles
      .mockResolvedValueOnce({ rows: [] });                                  // insert new role
    const res = await request(app).patch(`/users/${USER.id}/roles`).send({ roles: ['auditor'] });
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(['auditor']);
  });
});

describe('PATCH /users/:id/password', () => {
  it('returns 400 when password is missing', async () => {
    const res = await request(app).patch(`/users/${USER.id}/password`).send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is shorter than the minimum length', async () => {
    const res = await request(app).patch(`/users/${USER.id}/password`).send({ password: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/users/nonexistent/password').send({ password: 'newpassword123' });
    expect(res.status).toBe(404);
  });

  it('resets the password without requiring the current one (admin privilege)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: USER.id, username: USER.username }] }) // lookup
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await request(app).patch(`/users/${USER.id}/password`).send({ password: 'newpassword123' });
    expect(res.status).toBe(204);

    const updateCall = pool.query.mock.calls.find(c => c[0].includes('UPDATE auth.users SET password_hash'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1][1]).toBe(USER.id);
  });
});

describe('DELETE /users/:id', () => {
  it('disables an active user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: USER.id }] });
    const res = await request(app).delete(`/users/${USER.id}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 when user not found or already disabled', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/users/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /users/:id/enable', () => {
  it('re-enables a disabled user', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: USER.id }] });
    const res = await request(app).patch(`/users/${USER.id}/enable`);
    expect(res.status).toBe(204);
    const updateCall = pool.query.mock.calls[0];
    expect(updateCall[0]).toMatch(/SET status = 'active' WHERE id = \$1 AND status = 'disabled'/);
  });

  it('returns 404 when user not found or not currently disabled', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/users/nonexistent/enable');
    expect(res.status).toBe(404);
  });
});
