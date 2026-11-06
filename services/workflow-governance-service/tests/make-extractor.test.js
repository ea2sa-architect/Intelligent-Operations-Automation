import { describe, it, expect } from 'vitest';
import extractor from '../src/lib/make-extractor.js';

const SAMPLE_SCENARIO = {
  id: 42,
  name: 'Lead Enrichment',
  isActive: true,
  blueprint: {
    flow: [
      { id: 1, module: 'webhook:CustomWebHook', name: 'Trigger', parameters: {} },
      {
        id: 2, module: 'openai:CreateCompletion', name: 'OpenAI',
        parameters: { model: 'gpt-4', prompt: '{{1.email}}' },
      },
      {
        id: 3, module: 'postgresql:ExecuteQuery', name: 'Postgres',
        parameters: { query: 'SELECT * FROM leads' },
      },
    ],
  },
};

describe('make-extractor.extract', () => {
  it('returns structured metadata with secretExposure', () => {
    const meta = extractor.extract(SAMPLE_SCENARIO);
    expect(meta.id).toBe('42');
    expect(meta.name).toBe('Lead Enrichment');
    expect(meta.nodes).toHaveLength(3);
    expect(meta.secretExposure).toBeDefined();
    expect(meta.secretExposure.hasSecrets).toBe(false);
  });
});

describe('make-extractor.classifyModule', () => {
  it('detects a hardcoded OpenAI-shaped key and redacts it before storage', () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    const node = extractor.classifyModule({
      id: 9, module: 'http:ActionSendData', name: 'HTTP',
      parameters: { headers: { Authorization: `Bearer ${rawKey}` } },
    });
    expect(node.risk_factors).toContain('hardcoded_secret');
    expect(node.secret_findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(node.parameters_json)).not.toContain(rawKey);
    expect(node.secret_findings[0].redacted_preview).not.toContain(rawKey);
  });

  it('detects a database connection string with embedded credentials', () => {
    const node = extractor.classifyModule({
      id: 10, module: 'postgresql:ExecuteQuery', name: 'Postgres',
      parameters: { connectionString: 'postgres://dbuser:s3cr3tPass@db.internal:5432/leads' },
    });
    expect(node.risk_factors).toContain('hardcoded_secret');
    expect(node.secret_findings.some(f => f.secret_type === 'basic_auth_url')).toBe(true);
    expect(JSON.stringify(node.parameters_json)).not.toContain('s3cr3tPass');
  });

  it('does not flag a module with no secret-shaped values', () => {
    const node = extractor.classifyModule({
      id: 11, module: 'http:ActionSendData', name: 'HTTP',
      parameters: { url: 'https://example.com/api' },
    });
    expect(node.risk_factors).not.toContain('hardcoded_secret');
    expect(node.secret_findings).toHaveLength(0);
  });
});

describe('make-extractor.detectHardcodedSecrets', () => {
  it('aggregates secret_findings across modules into the risks shape workflows.js expects', () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    const classified = [
      extractor.classifyModule({
        id: 1, module: 'http:ActionSendData', name: 'HTTP',
        parameters: { headers: { Authorization: `Bearer ${rawKey}` } },
      }),
      extractor.classifyModule({ id: 2, module: 'webhook:CustomWebHook', name: 'Trigger', parameters: {} }),
    ];
    const { hasSecrets, risks } = extractor.detectHardcodedSecrets(classified);
    expect(hasSecrets).toBe(true);
    expect(risks.every(r => r.node_name === 'HTTP')).toBe(true);
    expect(risks.some(r => r.secret_type === 'bearer_token')).toBe(true);
    expect(risks[0].fingerprint_sha256).toBeTruthy();
  });
});
