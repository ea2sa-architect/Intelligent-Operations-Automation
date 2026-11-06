import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import telemetryClient from '../src/lib/telemetry-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('recordInvocationEvent', () => {
  it('posts to telemetry-service with the expected shape', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordInvocationEvent({
      correlationId: 'corr-1', serverId: 'srv-1', toolId: 'tool-1', toolName: 'search',
      outcome: 'success', durationMs: 120,
    });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/metrics');
    const body = JSON.parse(opts.body);
    expect(body.service_name).toBe('mcp_tool:tool-1');
    expect(body.metric_name).toBe('mcp_tool_invocation');
    expect(body.value).toBe(1);
    expect(body.labels_json.correlation_id).toBe('corr-1');
    // EP-102-S2/S3 — also a top-level field (what actually lands in
    // telemetry.metrics' first-class correlation_id column) and forwarded
    // as the x-correlation-id request header, consistent with the
    // platform-wide standard.
    expect(body.correlation_id).toBe('corr-1');
    expect(opts.headers['x-correlation-id']).toBe('corr-1');
    // AUTH-201 (extended) — carries no browser session, authenticates with
    // the shared internal service key instead
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('carries delegation_id in labels_json when the caller used an agent-issued token (EP-204-S5)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordInvocationEvent({
      correlationId: 'corr-1', serverId: 'srv-1', toolId: 'tool-1', outcome: 'success', delegationId: 'delegation-1',
    });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.labels_json.delegation_id).toBe('delegation-1');
  });

  it('records a value of 0 for a non-success outcome', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordInvocationEvent({ correlationId: 'c', serverId: 's', toolId: 't', outcome: 'denied' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.value).toBe(0);
  });

  it('does not throw when telemetry-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(telemetryClient.recordInvocationEvent({ correlationId: 'c', serverId: 's', toolId: 't', outcome: 'success' })).resolves.toBeUndefined();
  });
});

describe('queryInvocations', () => {
  it('builds label_ query params for each filter', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    await telemetryClient.queryInvocations({ correlation_id: 'c1', server_id: 's1', tool_id: 't1', client_id: 'cl1', workflow_id: 'w1' });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('label_correlation_id=c1');
    expect(url).toContain('label_server_id=s1');
    expect(url).toContain('label_tool_id=t1');
    expect(url).toContain('label_client_id=cl1');
    expect(url).toContain('label_workflow_id=w1');
    expect(url).toContain('metric_name=mcp_tool_invocation');
    expect(global.fetch.mock.calls[0][1].headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('returns an empty array on failure rather than throwing', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await telemetryClient.queryInvocations({});
    expect(result).toEqual([]);
  });

  it('returns an empty array on a non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false });
    const result = await telemetryClient.queryInvocations({});
    expect(result).toEqual([]);
  });
});
