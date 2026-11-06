import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import telemetryClient from '../src/lib/telemetry-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('recordInferenceEvent', () => {
  it('batches the inference outcome plus one row per known metric, sharing correlation_id', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordInferenceEvent({
      correlationId: 'corr-1', modelId: 'model-1', modelName: 'gpt-4', provider: 'openai',
      status: 'completed', latencyMs: 42, inputTokens: 120, outputTokens: 45, estimatedCostUsd: 0.0031,
    });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/metrics');
    expect(opts.headers['x-correlation-id']).toBe('corr-1');
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');

    const items = JSON.parse(opts.body);
    expect(items).toHaveLength(4);
    const byMetric = Object.fromEntries(items.map(i => [i.metric_name, i]));
    expect(byMetric.model_inference.value).toBe(1);
    expect(byMetric.input_tokens.value).toBe(120);
    expect(byMetric.output_tokens.value).toBe(45);
    expect(byMetric.estimated_cost_usd.value).toBe(0.0031);
    for (const item of items) {
      expect(item.correlation_id).toBe('corr-1');
      expect(item.service_name).toBe('ai_model:model-1');
      expect(item.labels_json.model_name).toBe('gpt-4');
    }
  });

  it('records value 0 for a failed inference', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordInferenceEvent({ correlationId: 'c', modelId: 'm', status: 'failed' });
    const items = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(items).toHaveLength(1); // no token/cost rows when none given
    expect(items[0].value).toBe(0);
  });

  it('omits token/cost rows that were not provided', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordInferenceEvent({ correlationId: 'c', modelId: 'm', status: 'completed', inputTokens: 10 });
    const items = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(items.map(i => i.metric_name)).toEqual(['model_inference', 'input_tokens']);
  });

  it('does not throw when telemetry-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(telemetryClient.recordInferenceEvent({ correlationId: 'c', modelId: 'm', status: 'completed' })).resolves.toBeUndefined();
  });

  // Lineage n8n-execution linkage — lineage-builder.js spreads labels_json
  // verbatim into lineage_nodes.metadata_json, so these keys are what let
  // the Data Lineage UI resolve back to the triggering n8n execution/node.
  it('includes n8n_execution_id and n8n_node_name in labels_json when supplied', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordInferenceEvent({
      correlationId: 'c', modelId: 'm', status: 'completed',
      n8nExecutionId: 'exec-4821', n8nNodeName: 'OpenAI — Summarize Invoice',
    });
    const items = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(items[0].labels_json.n8n_execution_id).toBe('exec-4821');
    expect(items[0].labels_json.n8n_node_name).toBe('OpenAI — Summarize Invoice');
  });
});

describe('recordPolicyDecisionEvent', () => {
  it('posts a policy_decision metric with value 1 for an approved outcome', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordPolicyDecisionEvent({
      correlationId: 'corr-1', modelId: 'model-1', inferenceRequestId: 'req-1', policyId: 'pol-1', outcome: 'approved', confidence: 0.9,
    });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.metric_name).toBe('policy_decision');
    expect(body.value).toBe(1);
    expect(body.labels_json.outcome).toBe('approved');
  });

  it('posts value 0 for a non-approved outcome', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await telemetryClient.recordPolicyDecisionEvent({ correlationId: 'c', modelId: 'm', outcome: 'denied' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.value).toBe(0);
  });

  it('does not throw when telemetry-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(telemetryClient.recordPolicyDecisionEvent({ correlationId: 'c', modelId: 'm', outcome: 'denied' })).resolves.toBeUndefined();
  });
});
