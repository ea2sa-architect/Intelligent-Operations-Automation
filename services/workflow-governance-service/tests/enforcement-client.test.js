import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import enforcementClient from '../src/lib/enforcement-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('checkEnforcement', () => {
  it('forwards the decision and status from governance-service, authenticating with the internal service key', async () => {
    global.fetch.mockResolvedValueOnce({ status: 200, json: async () => ({ decision: 'allow' }) });
    const result = await enforcementClient.checkEnforcement({ assetType: 'workflow', assetId: 'wf-1', correlationId: 'corr-1' });
    expect(result).toEqual({ status: 200, body: { decision: 'allow' } });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/enforce');
    expect(options.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
    expect(JSON.parse(options.body)).toEqual({ asset_type: 'workflow', asset_id: 'wf-1', correlation_id: 'corr-1' });
  });

  it('forwards a 403 block decision as-is', async () => {
    global.fetch.mockResolvedValueOnce({ status: 403, json: async () => ({ decision: 'block', blocked_by: { policy_id: 'p1' } }) });
    const result = await enforcementClient.checkEnforcement({ assetType: 'workflow', assetId: 'wf-1' });
    expect(result.status).toBe(403);
    expect(result.body.blocked_by).toEqual({ policy_id: 'p1' });
  });

  // Deliberately NOT the fail-soft-to-allow pattern other clients in this
  // service use — an enforcement gate that fails open defeats its own purpose.
  it('fails CLOSED (403 block) when governance-service is unreachable, distinguishable from a real policy block', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await enforcementClient.checkEnforcement({ assetType: 'workflow', assetId: 'wf-1' });
    expect(result.status).toBe(403);
    expect(result.body.decision).toBe('block');
    expect(result.body.reason).toBe('governance-service unreachable');
  });
});
