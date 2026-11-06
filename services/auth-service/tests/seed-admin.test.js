import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
import pool from '../db.js';
import bcrypt from 'bcryptjs';
import seedAdmin from '../src/lib/seed-admin.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => vi.clearAllMocks());
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('ensureAdminSeeded', () => {
  it('skips seeding when env vars are not set', async () => {
    delete process.env.AUTH_ADMIN_USERNAME;
    delete process.env.AUTH_ADMIN_PASSWORD;
    await seedAdmin.ensureAdminSeeded();
    expect(pool.query).not.toHaveBeenCalled();
  });

  // AUTH-103 — idempotent: does nothing when the account already exists
  it('does not insert when the admin account already exists', async () => {
    process.env.AUTH_ADMIN_USERNAME = 'admin';
    process.env.AUTH_ADMIN_PASSWORD = 'correct-horse-battery-staple';
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] });

    await seedAdmin.ensureAdminSeeded();
    expect(pool.query).toHaveBeenCalledTimes(1); // only the existence check, no insert
  });

  // AUTH-103 — stored value is a bcrypt hash, never plaintext
  it('creates the admin account with a bcrypt-hashed password when absent', async () => {
    process.env.AUTH_ADMIN_USERNAME = 'admin';
    process.env.AUTH_ADMIN_PASSWORD = 'correct-horse-battery-staple';
    pool.query
      .mockResolvedValueOnce({ rows: [] })                      // no existing account
      .mockResolvedValueOnce({ rows: [{ id: 'new-user-id' }] }) // insert, RETURNING id
      .mockResolvedValueOnce({ rows: [] });                      // role assignment

    await seedAdmin.ensureAdminSeeded();

    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO auth.users');
    const [username, passwordHash] = insertCall[1];
    expect(username).toBe('admin');
    expect(passwordHash).not.toBe('correct-horse-battery-staple');
    expect(await bcrypt.compare('correct-horse-battery-staple', passwordHash)).toBe(true);
  });
});

describe('ensureSecondaryAdminSeeded', () => {
  it('skips seeding when env vars are not set', async () => {
    delete process.env.AUTH_ADMIN2_USERNAME;
    delete process.env.AUTH_ADMIN2_PASSWORD;
    await seedAdmin.ensureSecondaryAdminSeeded();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('does not insert when the account already exists', async () => {
    process.env.AUTH_ADMIN2_USERNAME = 'admin-admin';
    process.env.AUTH_ADMIN2_PASSWORD = 'a-strong-break-glass-password';
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] });

    await seedAdmin.ensureSecondaryAdminSeeded();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("creates the account with the 'admin' role and a bcrypt-hashed password when absent", async () => {
    process.env.AUTH_ADMIN2_USERNAME = 'admin-admin';
    process.env.AUTH_ADMIN2_PASSWORD = 'a-strong-break-glass-password';
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-user-id' }] })
      .mockResolvedValueOnce({ rows: [] });

    await seedAdmin.ensureSecondaryAdminSeeded();

    const insertCall = pool.query.mock.calls[1];
    const [username, passwordHash] = insertCall[1];
    expect(username).toBe('admin-admin');
    expect(await bcrypt.compare('a-strong-break-glass-password', passwordHash)).toBe(true);

    const roleCall = pool.query.mock.calls[2];
    expect(roleCall[0]).toContain('auth.user_roles');
    expect(roleCall[1]).toEqual(['new-user-id', 'admin']);
  });
});
