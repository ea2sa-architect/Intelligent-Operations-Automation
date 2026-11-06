import { describe, it, expect } from 'vitest';
import extractor from '../src/lib/metadata-extractor.js';

const SAMPLE_WORKFLOW = {
  id: 'abc123',
  name: 'Email Processor',
  nodes: [
    {
      id: 'n1', name: 'Webhook', type: 'n8n-nodes-base.webhook',
      parameters: { path: '/inbound', method: 'POST' }, credentials: {}, disabled: false,
    },
    {
      id: 'n2', name: 'OpenAI', type: 'n8n-nodes-base.openAi',
      parameters: { operation: 'text', model: 'gpt-3.5-turbo', prompt: '{{$json.body.email}}' },
      credentials: { openAiApi: { id: 'cred1', name: 'OpenAI Key' } }, disabled: false,
    },
    {
      id: 'n3', name: 'Send Email', type: 'n8n-nodes-base.emailSend',
      parameters: { to: '{{$json.email}}', subject: 'Result' }, credentials: {}, disabled: false,
    },
    {
      id: 'n4', name: 'Postgres', type: 'n8n-nodes-base.postgres',
      parameters: { operation: 'executeQuery', query: 'SELECT * FROM users WHERE email = :email' },
      credentials: { postgres: { id: 'cred2', name: 'DB' } }, disabled: false,
    },
  ],
  connections: {
    Webhook: { main: [[{ node: 'OpenAI', type: 'main', index: 0 }]] },
    OpenAI:  { main: [[{ node: 'Send Email', type: 'main', index: 0 }]] },
    'Send Email': { main: [[{ node: 'Postgres', type: 'main', index: 0 }]] },
  },
};

describe('extractor.extract', () => {
  it('returns structured metadata', () => {
    const meta = extractor.extract(SAMPLE_WORKFLOW);
    expect(meta.id).toBe('abc123');
    expect(meta.name).toBe('Email Processor');
    expect(meta.nodes).toHaveLength(4);
    expect(meta.dag).toHaveLength(3);
    expect(meta.credentials).toHaveLength(2);
    expect(meta.discoveredAt).toBeTruthy();
  });

  it('classifies node types correctly', () => {
    const meta = extractor.extract(SAMPLE_WORKFLOW);
    const types = Object.fromEntries(meta.nodes.map(n => [n.node_name, n.governance_type]));
    expect(types.Webhook).toBe('webhook');
    expect(types.OpenAI).toBe('ai_inference');
    expect(types['Send Email']).toBe('notification');
    expect(types.Postgres).toBe('database');
  });

  it('detects deprecated model risk factor on gpt-3.5-turbo', () => {
    const meta = extractor.extract(SAMPLE_WORKFLOW);
    const aiNode = meta.nodes.find(n => n.node_name === 'OpenAI');
    expect(aiNode.risk_factors).toContain('deprecated_model');
  });

  it('detects raw_sql_execution risk on postgres executeQuery', () => {
    const meta = extractor.extract(SAMPLE_WORKFLOW);
    const dbNode = meta.nodes.find(n => n.node_name === 'Postgres');
    expect(dbNode.risk_factors).toContain('raw_sql_execution');
  });

  it('identifies webhook as trigger', () => {
    const meta = extractor.extract(SAMPLE_WORKFLOW);
    expect(meta.triggers).toHaveLength(1);
    expect(meta.triggers[0].node_name).toBe('Webhook');
  });

  it('detects PII (email) in node parameters', () => {
    const meta = extractor.extract(SAMPLE_WORKFLOW);
    expect(meta.piiExposure.hasPII).toBe(true);
    expect(meta.piiExposure.piiFields).toContain('email');
  });

  it('builds DAG edges correctly', () => {
    const meta = extractor.extract(SAMPLE_WORKFLOW);
    expect(meta.dag).toContainEqual({ source: 'Webhook', target: 'OpenAI', type: 'main' });
    expect(meta.dag).toContainEqual({ source: 'OpenAI', target: 'Send Email', type: 'main' });
  });

  it('extracts credentials without duplication', () => {
    const meta = extractor.extract(SAMPLE_WORKFLOW);
    const ids = meta.credentials.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });
});

describe('extractor.classifyNode', () => {
  it('maps unknown node type to unknown', () => {
    const node = extractor.classifyNode({ id: 'x', name: 'Custom', type: 'custom-node', parameters: {}, credentials: {} });
    expect(node.governance_type).toBe('unknown');
  });

  it('flags unencrypted HTTP', () => {
    const node = extractor.classifyNode({
      id: 'h1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest',
      parameters: { url: 'http://example.com/api' }, credentials: {},
    });
    expect(node.risk_factors).toContain('unencrypted_http');
  });

  it('detects a hardcoded OpenAI-shaped key and redacts it before storage', () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    const node = extractor.classifyNode({
      id: 'h2', name: 'HTTP', type: 'n8n-nodes-base.httpRequest',
      parameters: { headers: { Authorization: `Bearer ${rawKey}` } }, credentials: {},
    });
    expect(node.risk_factors).toContain('hardcoded_secret');
    expect(node.secret_findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(node.parameters_json)).not.toContain(rawKey);
    expect(node.secret_findings[0].redacted_preview).not.toContain(rawKey);
  });

  it('detects a database connection string with embedded credentials', () => {
    const node = extractor.classifyNode({
      id: 'h4', name: 'Postgres', type: 'n8n-nodes-base.postgres',
      parameters: { connectionString: 'postgres://dbuser:s3cr3tPass@db.internal:5432/leads' },
      credentials: {},
    });
    expect(node.risk_factors).toContain('hardcoded_secret');
    expect(node.secret_findings.some(f => f.secret_type === 'basic_auth_url')).toBe(true);
    expect(JSON.stringify(node.parameters_json)).not.toContain('s3cr3tPass');
  });

  it('does not flag a node with no secret-shaped values', () => {
    const node = extractor.classifyNode({
      id: 'h3', name: 'HTTP', type: 'n8n-nodes-base.httpRequest',
      parameters: { url: 'https://example.com/api' }, credentials: {},
    });
    expect(node.risk_factors).not.toContain('hardcoded_secret');
    expect(node.secret_findings).toHaveLength(0);
  });

  it('classifies a known MCP-client node type and extracts its server endpoint', () => {
    const node = extractor.classifyNode({
      id: 'm1', name: 'Filesystem MCP', type: '@n8n/n8n-nodes-langchain.mcpClientTool',
      parameters: { endpointUrl: 'https://mcp.internal.example.com/filesystem' }, credentials: {},
    });
    expect(node.governance_type).toBe('mcp_client');
    expect(node.mcp_server_reference).toBe('https://mcp.internal.example.com/filesystem');
  });

  it('falls back to name-based matching for unlisted MCP node type variants', () => {
    const node = extractor.classifyNode({
      id: 'm2', name: 'Custom MCP Node', type: 'some-vendor.mcpConnector',
      parameters: {}, credentials: {},
    });
    expect(node.governance_type).toBe('mcp_client');
    // No recognized endpoint parameter present — degrades to the node name
    // rather than losing the reference entirely.
    expect(node.mcp_server_reference).toBe('Custom MCP Node');
  });

  // Epic 2, Feature 2.1 — malformed/unsupported MCP node reporting
  it('flags a name-fallback-matched MCP node type as malformed', () => {
    const node = extractor.classifyNode({
      id: 'm2', name: 'Custom MCP Node', type: 'some-vendor.mcpConnector',
      parameters: { endpointUrl: 'https://custom.example.com' }, credentials: {},
    });
    expect(node.mcp_reference_malformed).toBe(true);
    expect(node.mcp_reference_malformed_reason).toContain('not a recognized MCP client type');
  });

  it('flags a known MCP node type with no recognized reference parameter as malformed', () => {
    const node = extractor.classifyNode({
      id: 'm3', name: 'Filesystem MCP', type: '@n8n/n8n-nodes-langchain.mcpClientTool',
      parameters: {}, credentials: {},
    });
    expect(node.mcp_reference_malformed).toBe(true);
    expect(node.mcp_reference_malformed_reason).toContain('No recognized server-reference parameter');
  });

  it('does not flag a known MCP node type with a recognized reference parameter as malformed', () => {
    const node = extractor.classifyNode({
      id: 'm1', name: 'Filesystem MCP', type: '@n8n/n8n-nodes-langchain.mcpClientTool',
      parameters: { endpointUrl: 'https://mcp.internal.example.com/filesystem' }, credentials: {},
    });
    expect(node.mcp_reference_malformed).toBe(false);
    expect(node.mcp_reference_malformed_reason).toBeNull();
  });
});

describe('extractor.detectMcpReferences', () => {
  it('collects references only from mcp_client nodes', () => {
    const classified = [
      extractor.classifyNode({ id: 'm1', name: 'MCP A', type: '@n8n/n8n-nodes-langchain.mcpClientTool', parameters: { endpointUrl: 'https://a.example.com' }, credentials: {} }),
      extractor.classifyNode({ id: 'h1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', parameters: {}, credentials: {} }),
    ];
    const refs = extractor.detectMcpReferences(classified);
    expect(refs).toEqual([{ node_name: 'MCP A', server_reference: 'https://a.example.com', malformed: false, malformed_reason: null }]);
  });

  it('carries the malformed flag through for a name-fallback-matched node', () => {
    const classified = [
      extractor.classifyNode({ id: 'm1', name: 'Custom MCP Node', type: 'some-vendor.mcpConnector', parameters: {}, credentials: {} }),
    ];
    const refs = extractor.detectMcpReferences(classified);
    expect(refs[0].malformed).toBe(true);
    expect(refs[0].malformed_reason).toContain('not a recognized MCP client type');
  });
});
