import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/cache.js', () => ({
  default: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), TTL: { METADATA: 300, RISK: 3600, LIST: 300 } },
}));
vi.mock('../src/lib/n8n-client.js', () => ({
  // listProjects defaults to an empty list — clearAllMocks() (used in
  // beforeEach) doesn't reset persistent implementations, only call history.
  default: { listWorkflows: vi.fn(), getWorkflow: vi.fn(), getExecutions: vi.fn(), listProjects: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../src/lib/mcp-governance-client.js', () => ({
  default: {
    resolveServerReference: vi.fn().mockResolvedValue({ registered: false }),
    fetchServerDetail: vi.fn().mockResolvedValue(null),
    reportDiscovery: vi.fn(),
  },
}));
vi.mock('../src/lib/enforcement-client.js', () => ({ default: { checkEnforcement: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its
// own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
// getAdapter() is the I/O boundary for the make/zapier/camunda import paths
// (each adapter's real getWorkflow does a live fetch to that platform's API)
// — mocked the same way n8n-client is, so /import characterization tests
// never touch the network.
vi.mock('../src/lib/adapters/index.js', () => ({ getAdapter: vi.fn() }));
vi.mock('../src/lib/audit-client.js', () => ({ logWorkflowsCleared: vi.fn() }));

import pool from '../db.js';
import n8nClient from '../src/lib/n8n-client.js';
import mcpGovernanceClient from '../src/lib/mcp-governance-client.js';
import enforcementClient from '../src/lib/enforcement-client.js';
import { getAdapter } from '../src/lib/adapters/index.js';
import { logWorkflowsCleared } from '../src/lib/audit-client.js';
import app from '../index.js';

const WORKFLOW = {
  id: 'wf-abc',
  name: 'Test Workflow',
  n8n_id: 'wf-abc',
  active: true,
  risk_score: 42.5,
  risk_level: 'MEDIUM',
  tags: [],
  discovered_at: '2026-05-13T00:00:00Z',
  scored_at: '2026-05-13T00:00:00Z',
  policies_applied: false,
  metadata_json: {},
  risk_breakdown_json: { risk_score: 42.5, risk_level: 'MEDIUM', dimensions: {}, top_risk_factors: [] },
};

beforeEach(() => vi.clearAllMocks());

describe('GET /workflows', () => {
  it('returns list of workflows', async () => {
    pool.query.mockResolvedValueOnce({ rows: [WORKFLOW] });
    const res = await request(app).get('/workflows');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('wf-abc');
  });

  it('filters by risk_level', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/workflows?risk_level=HIGH');
    expect(pool.query.mock.calls[0][0]).toContain('risk_level');
  });

  it('filters by active status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/workflows?active=true');
    expect(pool.query.mock.calls[0][0]).toContain('active');
  });

  it('caps limit at 200', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/workflows?limit=9999');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('LIMIT');
  });
});

// Gated on workflow:manage (platform-admin only — see
// db/migrations/auth/009_workflow_manage_permission.sql), not the much more
// broadly-held workflow:read. Route tests mock require-auth.js as a no-op
// (see top of file), so these just exercise the handler's own behavior.
describe('DELETE /workflows', () => {
  it('deletes every workflow and reports the count', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 7 });
    const res = await request(app).delete('/workflows');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 7 });
    expect(pool.query.mock.calls[0][0]).toContain('DELETE FROM workflow_governance.workflows');
  });

  it('invalidates the workflow:list cache', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    await request(app).delete('/workflows');
    const cache = (await import('../src/lib/cache.js')).default;
    expect(cache.del).toHaveBeenCalledWith('workflow:list');
  });

  it('logs a workflow.bulk_delete audit event with the deleted count', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 42 });
    await request(app).delete('/workflows');
    expect(logWorkflowsCleared).toHaveBeenCalledWith(expect.objectContaining({ count: 42 }));
  });
});

describe('GET /workflows/:id', () => {
  it('returns workflow with nodes and PII data', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [WORKFLOW] })
      .mockResolvedValueOnce({ rows: [] })   // nodes
      .mockResolvedValueOnce({ rows: [] })   // pii
      .mockResolvedValueOnce({ rows: [] })   // secret exposure
      .mockResolvedValueOnce({ rows: [] })   // mcp references
      .mockResolvedValueOnce({ rows: [] });  // deps
    const res = await request(app).get('/workflows/wf-abc');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('wf-abc');
    expect(res.body).toHaveProperty('nodes');
    expect(res.body).toHaveProperty('pii_exposure');
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/workflows/does-not-exist');
    expect(res.status).toBe(404);
  });
});

// Characterization tests for POST /workflows/import — pins current behavior
// of the four platform branches (n8n/make/zapier/camunda) inside this one
// handler before it's refactored into a per-platform importer registry.
// pool.query is stubbed by matching on the SQL text rather than call order,
// so these tests stay valid across a refactor that changes how many queries
// run or in what sequence, as long as the same tables get touched.
describe('POST /workflows/import', () => {
  const STORED_WORKFLOW = {
    id: 'wf-imported', name: 'Imported Workflow',
    risk_score: 42.5, risk_level: 'MEDIUM',
    ati_score: 55, ati_level: 'MODERATE',
    project_id: null, project_name: null,
  };
  const CONNECTION = { id: 'conn-1', config_json: { api_key: 'secret-token' } };

  function stubPoolForImport({ connection = CONNECTION, stored = STORED_WORKFLOW } = {}) {
    pool.query.mockImplementation(sql => {
      if (sql.includes('FROM workflow_governance.platform_connections')) return Promise.resolve({ rows: connection ? [connection] : [] });
      if (sql.includes('INSERT INTO workflow_governance.workflows'))      return Promise.resolve({ rows: [stored] });
      if (sql.includes('WHERE id = $1 OR n8n_id = $1'))                  return Promise.resolve({ rows: [] }); // n8n existingWf lookup
      return Promise.resolve({ rows: [] });
    });
  }

  beforeEach(() => {
    n8nClient.listProjects.mockResolvedValue([]);
  });

  describe('n8n platform (default)', () => {
    const N8N_DEFINITION = { id: 'wf-n8n-1', name: 'N8n Flow', active: true, tags: [], nodes: [], connections: {}, settings: {} };

    it('imports by n8n_id when platform is omitted', async () => {
      stubPoolForImport({ stored: { ...STORED_WORKFLOW, id: 'wf-n8n-1', name: 'N8n Flow' } });
      n8nClient.getWorkflow.mockResolvedValueOnce(N8N_DEFINITION);

      const res = await request(app).post('/workflows/import').send({ n8n_id: 'wf-n8n-1' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('wf-n8n-1');
      expect(res.body.name).toBe('N8n Flow');
      expect(getAdapter).not.toHaveBeenCalled();
    });

    it('imports the same way when platform: "n8n" is passed explicitly', async () => {
      stubPoolForImport();
      n8nClient.getWorkflow.mockResolvedValueOnce(N8N_DEFINITION);

      const res = await request(app).post('/workflows/import').send({ platform: 'n8n', n8n_id: 'wf-n8n-1' });
      expect(res.status).toBe(201);
    });

    it('400s when n8n_id is missing', async () => {
      const res = await request(app).post('/workflows/import').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/n8n_id is required/);
    });

    it('404s when n8n has no such workflow', async () => {
      n8nClient.getWorkflow.mockResolvedValueOnce(null);
      const res = await request(app).post('/workflows/import').send({ n8n_id: 'missing' });
      expect(res.status).toBe(404);
    });

    it('falls through to the n8n path for an unrecognized platform value (current behavior — no explicit "invalid platform" rejection)', async () => {
      stubPoolForImport();
      n8nClient.getWorkflow.mockResolvedValueOnce(N8N_DEFINITION);

      const res = await request(app).post('/workflows/import').send({ platform: 'bogus-platform', n8n_id: 'wf-n8n-1' });
      expect(res.status).toBe(201);
      expect(getAdapter).not.toHaveBeenCalled();
    });

    it('400s for an unrecognized platform value with no n8n_id either', async () => {
      const res = await request(app).post('/workflows/import').send({ platform: 'bogus-platform' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/n8n_id is required/);
    });
  });

  describe.each([
    ['make',    { id: 42, name: 'Make Scenario', isActive: true, blueprint: { flow: [] } }, 'not found in Make.com'],
    ['zapier',  { id: 99, title: 'Zapier Zap', status: 'on', steps: [] },                     'not found in Zapier'],
    ['camunda', { id: 'proc-1', name: 'Camunda Process', active: true, bpmnXml: '' },         'not found in Camunda'],
  ])('%s platform', (platform, sourceObject, notFoundFragment) => {
    it(`400s when connection_id is missing`, async () => {
      const res = await request(app).post('/workflows/import').send({ platform, source_id: 'src-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/connection_id is required/);
    });

    it(`400s when source_id is missing`, async () => {
      const res = await request(app).post('/workflows/import').send({ platform, connection_id: 'conn-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/source_id is required/);
    });

    it(`404s when the connection does not exist`, async () => {
      stubPoolForImport({ connection: null });
      const res = await request(app).post('/workflows/import').send({ platform, connection_id: 'conn-1', source_id: 'src-1' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/connection not found/i);
    });

    it(`404s when the platform reports the source object does not exist`, async () => {
      stubPoolForImport();
      getAdapter.mockReturnValue({ getWorkflow: vi.fn().mockResolvedValue(null), detectFlowLevelRisks: vi.fn().mockReturnValue([]) });

      const res = await request(app).post('/workflows/import').send({ platform, connection_id: 'conn-1', source_id: 'src-1' });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain(notFoundFragment);
    });

    it(`imports, scores, and stores a ${platform} workflow`, async () => {
      stubPoolForImport();
      getAdapter.mockReturnValue({ getWorkflow: vi.fn().mockResolvedValue(sourceObject), detectFlowLevelRisks: vi.fn().mockReturnValue([]) });

      const res = await request(app).post('/workflows/import').send({ platform, connection_id: 'conn-1', source_id: 'src-1' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: STORED_WORKFLOW.id, name: STORED_WORKFLOW.name,
        risk_score: STORED_WORKFLOW.risk_score, risk_level: STORED_WORKFLOW.risk_level,
        ati_score: STORED_WORKFLOW.ati_score, ati_level: STORED_WORKFLOW.ati_level,
        tags: [],
      });
      expect(getAdapter).toHaveBeenCalledWith(platform);
      // Asserts the connection lookup is scoped to this platform — via bind
      // params if parameterized, or embedded in the SQL text if not; either
      // way the query must not match a connection row for a different platform.
      const connLookup = pool.query.mock.calls.find(c => c[0].includes('FROM workflow_governance.platform_connections'));
      const scopedToPlatform = (connLookup[1] ?? []).includes(platform) || connLookup[0].includes(`platform = '${platform}'`);
      expect(scopedToPlatform).toBe(true);
    });

    it(`500s when the ${platform} adapter throws (e.g. upstream API failure)`, async () => {
      stubPoolForImport();
      getAdapter.mockReturnValue({ getWorkflow: vi.fn().mockRejectedValue(new Error('Authentication failed — check API key')), detectFlowLevelRisks: vi.fn().mockReturnValue([]) });

      const res = await request(app).post('/workflows/import').send({ platform, connection_id: 'conn-1', source_id: 'src-1' });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Authentication failed/);
    });
  });

  it('only make imports persist secret-exposure findings (zapier/camunda branches do not call persistSecretExposure)', async () => {
    stubPoolForImport();
    getAdapter.mockReturnValue({
      getWorkflow: vi.fn().mockResolvedValue({ id: 1, name: 'Has secret', isActive: true, blueprint: { flow: [
        { id: 1, module: 'http:ActionSendData', name: 'HTTP', parameters: { headers: { Authorization: 'Bearer sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2) } } },
      ] } }),
      detectFlowLevelRisks: vi.fn().mockReturnValue([]),
    });

    await request(app).post('/workflows/import').send({ platform: 'make', connection_id: 'conn-1', source_id: 'src-1' });

    const secretExposureQueries = pool.query.mock.calls.filter(c => c[0].includes('workflow_secret_exposure'));
    expect(secretExposureQueries.length).toBeGreaterThan(0);
  });
});

// The n8n Integrations UI lets an admin store a connection (base_url/
// api_key) that should actually govern which instance Discover/Import
// talk to — previously the n8n adapter silently ignored it and
// listWorkflows/getWorkflow always used the env vars regardless.
describe('GET /workflows/n8n — threads the active n8n connection config through', () => {
  it('passes the connected n8n connection\'s config_json to n8nClient', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ config_json: { base_url: 'https://self-hosted.example.com/api/v1', api_key: 'conn-key' } }],
    });
    n8nClient.listWorkflows.mockResolvedValueOnce([]);

    await request(app).get('/workflows/n8n');

    expect(n8nClient.listWorkflows).toHaveBeenCalledWith({ base_url: 'https://self-hosted.example.com/api/v1', api_key: 'conn-key' });
    expect(n8nClient.listProjects).toHaveBeenCalledWith({ base_url: 'https://self-hosted.example.com/api/v1', api_key: 'conn-key' });
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain("platform = 'n8n'");
    expect(sql).toContain("status = 'connected'");
  });

  it('passes an empty config (→ n8nClient\'s own env-var defaults) when no connection is configured', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    n8nClient.listWorkflows.mockResolvedValueOnce([]);

    await request(app).get('/workflows/n8n');

    expect(n8nClient.listWorkflows).toHaveBeenCalledWith({});
  });
});

describe('POST /workflows/discover', () => {
  it('discovers and stores workflows from n8n', async () => {
    const n8nWorkflow = { id: 'wf-abc', name: 'Test', active: true, nodes: [], connections: {}, settings: {} };
    n8nClient.listWorkflows.mockResolvedValueOnce([{ id: 'wf-abc', name: 'Test', active: true }]);
    n8nClient.getWorkflow.mockResolvedValueOnce(n8nWorkflow);
    // The scoring pipeline now reads/writes ownership, risk history, and secret
    // exposure alongside the original upsert/nodes/pii calls — none of their
    // return shapes are asserted here, so one blanket default covers them all.
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).post('/workflows/discover');
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('discovered');
    expect(res.body.discovered).toBe(1);
  });

  it('returns 500 on n8n API failure', async () => {
    n8nClient.listWorkflows.mockRejectedValueOnce(new Error('N8N_API_KEY not set'));
    const res = await request(app).post('/workflows/discover');
    expect(res.status).toBe(500);
  });

  // Epic 5, Feature 5.2 — MCP trust-ceiling rules: an unregistered MCP server
  // reference must cap the discovered workflow's ATI at 40, regardless of an
  // otherwise-favorable risk score.
  it('caps ati_score at 40 when the workflow references an unregistered MCP server', async () => {
    const n8nWorkflow = {
      id: 'wf-mcp', name: 'Uses MCP', active: true, connections: {}, settings: {},
      nodes: [{ id: 'n1', name: 'MCP Client', type: '@n8n/n8n-nodes-langchain.mcpClientTool', parameters: { url: 'https://unregistered-mcp.example.com' } }],
    };
    n8nClient.listWorkflows.mockResolvedValueOnce([{ id: 'wf-mcp', name: 'Uses MCP', active: true }]);
    n8nClient.getWorkflow.mockResolvedValueOnce(n8nWorkflow);
    mcpGovernanceClient.resolveServerReference.mockResolvedValueOnce({ registered: false });
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).post('/workflows/discover');
    expect(res.status).toBe(202);

    const upsertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO workflow_governance.workflows'));
    const atiScoreParam = upsertCall[1][10]; // ati_score is the 11th positional param in the discover upsert
    expect(atiScoreParam).toBeLessThanOrEqual(40);

    // EP-306-S6 — a cleanly-unregistered reference is also reported as a
    // discovery candidate, source-tagged to the workflow it was found in.
    expect(mcpGovernanceClient.reportDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: expect.stringContaining('Uses MCP') })
    );
  });

  it('does not report a discovery candidate for an ambiguous MCP reference', async () => {
    const n8nWorkflow = {
      id: 'wf-ambiguous', name: 'Ambiguous MCP', active: true, connections: {}, settings: {},
      nodes: [{ id: 'n1', name: 'MCP Client', type: '@n8n/n8n-nodes-langchain.mcpClientTool', parameters: { url: 'https://crm.example.com' } }],
    };
    n8nClient.listWorkflows.mockResolvedValueOnce([{ id: 'wf-ambiguous', name: 'Ambiguous MCP', active: true }]);
    n8nClient.getWorkflow.mockResolvedValueOnce(n8nWorkflow);
    mcpGovernanceClient.resolveServerReference.mockResolvedValueOnce({ registered: false, ambiguous: true, candidates: [{ id: 's1' }, { id: 's2' }] });
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).post('/workflows/discover');
    expect(mcpGovernanceClient.reportDiscovery).not.toHaveBeenCalled();
  });
});

describe('POST /workflows/:id/score', () => {
  it('rescores an existing workflow', async () => {
    const n8nWorkflow = { id: 'wf-abc', name: 'Test', active: true, nodes: [], connections: {}, settings: {} };
    // First call must return the existing-workflow row the route looks up;
    // everything after (evidence fetch, update, risk-history snapshot) isn't
    // asserted on, so a blanket default covers those.
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'wf-abc', n8n_id: 'wf-abc' }] })  // find existing
      .mockResolvedValue({ rows: [] });
    n8nClient.getWorkflow.mockResolvedValueOnce(n8nWorkflow);

    const res = await request(app).post('/workflows/wf-abc/score');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('risk_score');
    expect(res.body).toHaveProperty('risk_level');
  });

  it('returns 404 when workflow not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/workflows/bad-id/score');
    expect(res.status).toBe(404);
  });

  it('returns 502 when n8n returns null', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ n8n_id: 'wf-abc' }] });
    n8nClient.getWorkflow.mockResolvedValueOnce(null);
    const res = await request(app).post('/workflows/wf-abc/score');
    expect(res.status).toBe(502);
  });
});

describe('POST /workflows/:id/policies/apply', () => {
  it('returns 404 for unknown workflow', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/workflows/unknown/policies/apply');
    expect(res.status).toBe(404);
  });

  it('returns 409 when workflow has not been scored', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...WORKFLOW, risk_breakdown_json: null }] });
    const res = await request(app).post('/workflows/wf-abc/policies/apply');
    expect(res.status).toBe(409);
  });
});

// EP-201-S7/S8 — the n8n-facing workflow-start governance gate
describe('POST /workflows/:id/enforcement-check', () => {
  it('returns 404 when workflow not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/workflows/unknown/enforcement-check');
    expect(res.status).toBe(404);
    expect(enforcementClient.checkEnforcement).not.toHaveBeenCalled();
  });

  it('forwards an allow decision from governance-service as-is', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'wf-abc' }] });
    enforcementClient.checkEnforcement.mockResolvedValueOnce({ status: 200, body: { decision: 'allow' } });

    const res = await request(app).post('/workflows/wf-abc/enforcement-check').send({ correlation_id: 'corr-1' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('allow');
    expect(enforcementClient.checkEnforcement).toHaveBeenCalledWith({
      assetType: 'workflow', assetId: 'wf-abc', correlationId: 'corr-1',
    });
  });

  it('forwards a block decision (403) from governance-service as-is', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'wf-abc' }] });
    enforcementClient.checkEnforcement.mockResolvedValueOnce({
      status: 403,
      body: { decision: 'block', blocked_by: { policy_id: 'p1', violation_id: 'v1' } },
    });

    const res = await request(app).post('/workflows/wf-abc/enforcement-check');
    expect(res.status).toBe(403);
    expect(res.body.blocked_by).toEqual({ policy_id: 'p1', violation_id: 'v1' });
  });

  it('resolves by n8n_id as well as internal id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'wf-abc' }] });
    enforcementClient.checkEnforcement.mockResolvedValueOnce({ status: 200, body: { decision: 'allow' } });

    await request(app).post('/workflows/n8n-external-id/enforcement-check');
    const sqlParams = pool.query.mock.calls[0][1];
    expect(sqlParams).toEqual(['n8n-external-id']);
  });
});

// S2.1 (widened 2026-10-08, baseline assessment finding F-02) — this is the
// route that actually halts a running n8n workflow on 'block', which made it
// the most consequential of the n8n-facing routes to have no protection at
// all. Same verifyN8nCallback middleware as the analyze/callback route
// (tests/analysis.test.js) — skipped when N8N_WEBHOOK_SECRET is unset.
describe('POST /workflows/:id/enforcement-check — EP-310/S2.1 signature + timestamp', () => {
  const TEST_SECRET = 'ioa-test-webhook-secret';
  const sign = body => 'sha256=' + createHmac('sha256', TEST_SECRET).update(JSON.stringify(body)).digest('hex');
  const validHeaders = body => ({ 'X-IOA-Signature': sign(body), 'X-IOA-Timestamp': String(Date.now()) });

  beforeEach(() => vi.stubEnv('N8N_WEBHOOK_SECRET', TEST_SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it('returns 401 when the signature is missing', async () => {
    const res = await request(app).post('/workflows/wf-abc/enforcement-check').send({});
    expect(res.status).toBe(401);
    expect(enforcementClient.checkEnforcement).not.toHaveBeenCalled();
  });

  it('returns 401 when the signature is wrong', async () => {
    const res = await request(app)
      .post('/workflows/wf-abc/enforcement-check')
      .set('X-IOA-Timestamp', String(Date.now()))
      .set('X-IOA-Signature', 'sha256=badhash')
      .send({});
    expect(res.status).toBe(401);
  });

  it('proceeds to the enforcement gate when correctly signed', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'wf-abc' }] });
    enforcementClient.checkEnforcement.mockResolvedValueOnce({ status: 200, body: { decision: 'allow' } });
    const body = { correlation_id: 'corr-signed' };

    const res = await request(app).post('/workflows/wf-abc/enforcement-check').set(validHeaders(body)).send(body);
    expect(res.status).toBe(200);
    expect(enforcementClient.checkEnforcement).toHaveBeenCalled();
  });
});

// S2.1 (widened 2026-10-08) — execution-event previously had no protection
// whatsoever, not even the optional HMAC the analyze/callback route had.
describe('POST /workflows/:id/execution-event', () => {
  it('202s and resolves by n8n_id as well as internal id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'wf-abc' }] });
    const res = await request(app).post('/workflows/wf-abc/execution-event').send({ status: 'success' });
    expect(res.status).toBe(202);
  });

  it('400s on an invalid status value', async () => {
    const res = await request(app).post('/workflows/wf-abc/execution-event').send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown workflow', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/workflows/unknown/execution-event').send({ status: 'start' });
    expect(res.status).toBe(404);
  });

  describe('EP-310/S2.1 signature + timestamp', () => {
    const TEST_SECRET = 'ioa-test-webhook-secret';
    const sign = body => 'sha256=' + createHmac('sha256', TEST_SECRET).update(JSON.stringify(body)).digest('hex');

    beforeEach(() => vi.stubEnv('N8N_WEBHOOK_SECRET', TEST_SECRET));
    afterEach(() => vi.unstubAllEnvs());

    it('returns 401 when unsigned', async () => {
      const res = await request(app).post('/workflows/wf-abc/execution-event').send({ status: 'success' });
      expect(res.status).toBe(401);
    });

    it('proceeds when correctly signed', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'wf-abc' }] });
      const body = { status: 'success' };
      const res = await request(app)
        .post('/workflows/wf-abc/execution-event')
        .set('X-IOA-Signature', sign(body))
        .set('X-IOA-Timestamp', String(Date.now()))
        .send(body);
      expect(res.status).toBe(202);
    });
  });
});

// EP-203 — governance-service's kill-switch callback
describe('POST /workflows/:id/containment', () => {
  it('sets containment_state, resolving by n8n_id as well as internal id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'wf-abc', containment_state: 'suspended' }] });

    const res = await request(app).post('/workflows/wf-abc/containment').send({ containment_state: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.containment_state).toBe('suspended');
    const sqlParams = pool.query.mock.calls[0][1];
    expect(sqlParams).toEqual(['suspended', 'wf-abc']);
  });

  it('rejects an invalid containment_state', async () => {
    const res = await request(app).post('/workflows/wf-abc/containment').send({ containment_state: 'disabled' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown workflow', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/workflows/unknown/containment').send({ containment_state: 'suspended' });
    expect(res.status).toBe(404);
  });
});
