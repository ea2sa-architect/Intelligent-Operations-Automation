import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import governancePostureClient from '../src/lib/governance-posture-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('fetchViolations', () => {
  it('returns violations on success and authenticates with the internal service key', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'v-1' }] });
    const result = await governancePostureClient.fetchViolations('wf-1');
    expect(result).toEqual([{ id: 'v-1' }]);
    // AUTH-201 (extended) — carries no browser session, authenticates with
    // the shared internal service key instead
    expect(global.fetch.mock.calls[0][1].headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('returns an empty array on a non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false });
    const result = await governancePostureClient.fetchViolations('wf-1');
    expect(result).toEqual([]);
  });

  it('fails soft to an empty array when governance-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await governancePostureClient.fetchViolations('wf-1');
    expect(result).toEqual([]);
  });
});
