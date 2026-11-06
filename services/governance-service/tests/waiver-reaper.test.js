import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
import pool from '../db.js';
import waiverReaper from '../src/lib/waiver-reaper.js';

beforeEach(() => vi.clearAllMocks());

describe('reopenExpiredWaivers', () => {
  it('does nothing when no waivers are expired', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const count = await waiverReaper.reopenExpiredWaivers();
    expect(count).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("w.status = 'approved'");
    expect(sql).toContain('w.expires_at < NOW()');
    expect(sql).toContain("v.status = 'waived_temporarily'");
  });

  it('marks an expired waiver as expired and reopens its violation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', violation_id: 'v-1' }] }) // select expired
      .mockResolvedValueOnce({ rows: [] })                                   // update waivers
      .mockResolvedValueOnce({ rows: [{ status: 'waived_temporarily', policy_version: 2 }] }) // transitionViolation's select
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'reopened' }] })   // transitionViolation's update ... RETURNING
      .mockResolvedValueOnce({ rows: [] });                                  // violation_history insert

    const count = await waiverReaper.reopenExpiredWaivers();
    expect(count).toBe(1);

    const waiverUpdateSql = pool.query.mock.calls[1][0];
    expect(waiverUpdateSql).toContain("SET status = 'expired'");
    expect(pool.query.mock.calls[1][1]).toEqual(['w-1']);

    const violationUpdateSql = pool.query.mock.calls[3][0];
    expect(violationUpdateSql).toContain('SET status = $1');
    expect(pool.query.mock.calls[3][1]).toEqual(['reopened', null, 'Waiver expired', 'v-1']);

    const historyInsertSql = pool.query.mock.calls[4][0];
    expect(historyInsertSql).toContain('INSERT INTO violation_history');
    expect(pool.query.mock.calls[4][1]).toEqual(['v-1', 'waived_temporarily', 'reopened', 'system', 'Waiver expired', 2, null]);
  });

  it('reopens multiple expired waivers independently', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', violation_id: 'v-1' }, { id: 'w-2', violation_id: 'v-2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'waived_temporarily', policy_version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'waived_temporarily', policy_version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-2' }] })
      .mockResolvedValueOnce({ rows: [] });

    const count = await waiverReaper.reopenExpiredWaivers();
    expect(count).toBe(2);
    expect(pool.query).toHaveBeenCalledTimes(9);
  });
});
