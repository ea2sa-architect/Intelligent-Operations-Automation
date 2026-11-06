import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import governanceClient from '../src/lib/governance-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('checkEnforcement', () => {
  it('posts to governance-service /enforce with asset_type ai_model', async () => {
    global.fetch.mockResolvedValueOnce({ status: 200, json: async () => ({ decision: 'allow' }) });
    const result = await governanceClient.checkEnforcement({ modelId: 'model-1', dataClassification: 'confidential', correlationId: 'corr-1' });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/enforce');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      asset_type: 'ai_model', asset_id: 'model-1', correlation_id: 'corr-1',
      context: { dataClassification: 'confidential' },
    });
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
    expect(result.status).toBe(200);
    expect(result.body.decision).toBe('allow');
  });

  it('fails closed with a block decision when governance-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await governanceClient.checkEnforcement({ modelId: 'model-1' });
    expect(result.status).toBe(403);
    expect(result.body.decision).toBe('block');
    expect(result.body.reason).toBe('governance-service unreachable');
  });
});
