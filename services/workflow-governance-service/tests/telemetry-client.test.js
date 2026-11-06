import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import telemetryClient from '../src/lib/telemetry-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('fetchExecutionSummary', () => {
  it('returns the summary on success and authenticates with the internal service key', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ total_executions_7d: 5 }) });
    const result = await telemetryClient.fetchExecutionSummary('wf-1');
    expect(result).toEqual({ total_executions_7d: 5 });
    // AUTH-201 (extended) — carries no browser session, authenticates with
    // the shared internal service key instead
    expect(global.fetch.mock.calls[0][1].headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('returns null when telemetry-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await telemetryClient.fetchExecutionSummary('wf-1');
    expect(result).toBeNull();
  });
});

describe('recordExecutionEvent', () => {
  it('posts with the internal service key header', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordExecutionEvent('wf-1', { status: 'success', duration_ms: 100 });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('does not throw when telemetry-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(telemetryClient.recordExecutionEvent('wf-1', { status: 'failure' })).resolves.toBeUndefined();
  });

  // EP-102-S3 — threads the workflow execution's correlation id both as the
  // metric's own correlation_id field and as the x-correlation-id request
  // header, so an MCP tool invocation the same execution triggers can join
  // the same chain in telemetry-service.
  it('threads correlationId into the payload and the x-correlation-id header', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordExecutionEvent('wf-1', { status: 'success', correlationId: 'corr-1' });
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.correlation_id).toBe('corr-1');
    expect(opts.headers['x-correlation-id']).toBe('corr-1');
  });
});
