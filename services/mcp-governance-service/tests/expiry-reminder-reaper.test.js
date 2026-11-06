import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/escalation-client.js', () => ({ default: { createIncident: vi.fn() } }));
import pool from '../db.js';
import escalationClient from '../src/lib/escalation-client.js';
import expiryReminderReaper from '../src/lib/expiry-reminder-reaper.js';

beforeEach(() => vi.clearAllMocks());

describe('sendExpiryReminders', () => {
  it('does nothing when no server is within any threshold window', async () => {
    pool.query.mockResolvedValue({ rows: [] }); // all three threshold queries return empty
    const sent = await expiryReminderReaper.sendExpiryReminders();
    expect(sent).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(3); // one SELECT per threshold (30/7/1)
    expect(escalationClient.createIncident).not.toHaveBeenCalled();

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("status = 'approved'");
    expect(sql).toContain('NOT EXISTS');
  });

  it('creates an incident and marks the reminder sent for a server due at the 30-day threshold', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'srv-1', name: 'filesystem-mcp', expiration_date: '2026-08-15T00:00:00Z' }] }) // 30d SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'reminder-1' }] }) // dedup insert
      .mockResolvedValueOnce({ rows: [] }) // 7d SELECT
      .mockResolvedValueOnce({ rows: [] }); // 1d SELECT
    escalationClient.createIncident.mockResolvedValueOnce({ id: 'incident-1' });

    const sent = await expiryReminderReaper.sendExpiryReminders();
    expect(sent).toBe(1);

    expect(escalationClient.createIncident).toHaveBeenCalledWith({
      title: 'MCP server "filesystem-mcp" approval expires in 30 day(s)',
      severity: 'medium',
      contextJson: { server_id: 'srv-1', expiration_date: '2026-08-15T00:00:00Z', threshold_days: 30 },
    });

    const insertArgs = pool.query.mock.calls[1][1];
    expect(insertArgs).toEqual(['srv-1', 30]);
  });

  it('uses critical severity for the 1-day threshold', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // 30d
      .mockResolvedValueOnce({ rows: [] }) // 7d
      .mockResolvedValueOnce({ rows: [{ id: 'srv-2', name: 'urgent-mcp', expiration_date: '2026-07-21T00:00:00Z' }] }) // 1d
      .mockResolvedValueOnce({ rows: [{ id: 'reminder-2' }] });
    escalationClient.createIncident.mockResolvedValueOnce({ id: 'incident-2' });

    await expiryReminderReaper.sendExpiryReminders();
    expect(escalationClient.createIncident).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
  });

  it('does not mark a reminder sent when escalation-service is unreachable (retries next tick)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'srv-1', name: 'filesystem-mcp', expiration_date: '2026-08-15T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    escalationClient.createIncident.mockResolvedValueOnce(null); // fail-soft client returns null

    const sent = await expiryReminderReaper.sendExpiryReminders();
    expect(sent).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(3); // no dedup INSERT attempted
  });
});
