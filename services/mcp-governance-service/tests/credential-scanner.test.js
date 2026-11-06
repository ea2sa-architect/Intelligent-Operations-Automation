import { describe, it, expect } from 'vitest';
import credentialScanner from '../src/lib/credential-scanner.js';

describe('redactFields', () => {
  it('returns no findings and unchanged fields when nothing matches', () => {
    const { redactedFields, findings } = credentialScanner.redactFields({
      endpoint: 'https://api.example.com/mcp',
      integrity_info: 'sha256:abc123',
    });
    expect(findings).toEqual([]);
    expect(redactedFields.endpoint).toBe('https://api.example.com/mcp');
  });

  it('detects an OpenAI-shaped key and redacts it in the returned field', () => {
    const key = 'sk-' + 'a'.repeat(40);
    const { redactedFields, findings } = credentialScanner.redactFields({ endpoint: `https://api.example.com/mcp?key=${key}` });
    expect(findings).toHaveLength(1);
    expect(findings[0].secret_type).toBe('openai_key');
    expect(findings[0].redacted_preview).not.toContain(key);
    expect(redactedFields.endpoint).not.toContain(key);
    expect(redactedFields.endpoint).toContain('****');
  });

  it('never includes the raw matched value in a finding', () => {
    const key = 'AKIA' + '1234567890ABCDEF';
    const { findings } = credentialScanner.redactFields({ integrity_info: key });
    expect(findings[0].secret_type).toBe('aws_access_key');
    expect(JSON.stringify(findings[0])).not.toContain(key);
  });

  it('detects a basic-auth-style connection string (MCP-specific addition)', () => {
    const { redactedFields, findings } = credentialScanner.redactFields({
      uri_template: 'postgres://dbuser:sup3rSecret@db.internal:5432/prod',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].secret_type).toBe('basic_auth_url');
    expect(redactedFields.uri_template).not.toContain('sup3rSecret');
  });

  it('scans JSON-serializable fields (dependencies_json) and returns them as JSON, not a string', () => {
    const key = 'gh' + 'p_' + 'x'.repeat(35);
    const { redactedFields, findings } = credentialScanner.redactFields({
      dependencies_json: ['some-lib', key],
    });
    expect(findings).toHaveLength(1);
    expect(Array.isArray(redactedFields.dependencies_json)).toBe(true);
    expect(redactedFields.dependencies_json.join(' ')).not.toContain(key);
  });

  it('passes null/undefined fields through untouched', () => {
    const { redactedFields, findings } = credentialScanner.redactFields({ endpoint: null, integrity_info: undefined });
    expect(findings).toEqual([]);
    expect(redactedFields.endpoint).toBeNull();
    expect(redactedFields.integrity_info).toBeUndefined();
  });

  it('records which field a finding came from', () => {
    const token = 'xoxb-' + '1'.repeat(15);
    const { findings } = credentialScanner.redactFields({ authentication_method: `token: ${token}` });
    expect(findings[0].field_name).toBe('authentication_method');
    expect(findings[0].secret_type).toBe('slack_token');
  });

  // Epic 6, Feature 6.2 — configurable extra patterns
  it('detects a match using an administrator-configured extra pattern', () => {
    const extraPatterns = { internal_token: /internal-[a-f0-9]{16}/g };
    const { redactedFields, findings } = credentialScanner.redactFields(
      { endpoint: 'https://api.example.com?t=internal-1234567890abcdef' },
      extraPatterns
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].secret_type).toBe('internal_token');
    expect(redactedFields.endpoint).not.toContain('1234567890abcdef');
  });

  it('applies both built-in and extra patterns in the same scan', () => {
    const key = 'sk-' + 'a'.repeat(40);
    const extraPatterns = { internal_token: /internal-[a-f0-9]{16}/g };
    const { findings } = credentialScanner.redactFields(
      { endpoint: `${key} internal-1234567890abcdef` },
      extraPatterns
    );
    expect(findings.map(f => f.secret_type).sort()).toEqual(['internal_token', 'openai_key']);
  });
});

describe('compilePattern', () => {
  it('compiles a valid pattern', () => {
    expect(credentialScanner.compilePattern('foo-[0-9]+')).toBeInstanceOf(RegExp);
  });

  it('returns null for an invalid pattern rather than throwing', () => {
    expect(credentialScanner.compilePattern('foo-(unterminated')).toBeNull();
  });
});

describe('redactFieldsOrWithhold', () => {
  it('behaves like redactFields on success', () => {
    const result = credentialScanner.redactFieldsOrWithhold({ endpoint: 'https://clean.example.com' });
    expect(result.redactionFailed).toBe(false);
    expect(result.redactedFields.endpoint).toBe('https://clean.example.com');
  });

  // Epic 6, Feature 6.2 — "redaction failures handled without persisting
  // unredacted payloads." A field that can't be JSON.stringify'd (a
  // circular reference) must never fall back to the raw value.
  it('withholds the entire payload rather than persisting it unredacted on failure', () => {
    const circular = {};
    circular.self = circular;
    const result = credentialScanner.redactFieldsOrWithhold({ output: circular });
    expect(result.redactionFailed).toBe(true);
    expect(result.redactedFields.output).toBe('[REDACTION_FAILED - PAYLOAD_WITHHELD]');
    expect(JSON.stringify(result)).not.toContain('circular');
  });
});
