import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import escalationClient from '../src/lib/escalation-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('createIncident', () => {
  it('posts to escalation-service /incidents with the expected shape', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'incident-1' }) });
    const result = await escalationClient.createIncident({
      title: 'expires soon', severity: 'high', contextJson: { server_id: 'srv-1' },
    });
    expect(result).toEqual({ id: 'incident-1' });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/incidents');
    expect(JSON.parse(opts.body)).toEqual({ title: 'expires soon', severity: 'high', context_json: { server_id: 'srv-1' } });
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('returns null (fails soft) when escalation-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await escalationClient.createIncident({ title: 'x', severity: 'low' });
    expect(result).toBeNull();
  });

  it('returns null (fails soft) on a non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await escalationClient.createIncident({ title: 'x', severity: 'low' });
    expect(result).toBeNull();
  });
});
