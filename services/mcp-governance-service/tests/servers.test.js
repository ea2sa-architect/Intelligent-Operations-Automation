import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import cryptoModule from 'crypto';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
// EP-101-S5 — avoid a real cross-service fetch to governance-service in route tests.
vi.mock('../src/lib/governance-client.js', () => ({ default: {
  evaluateServer: vi.fn(), recordApprovalDecision: vi.fn(),
  // Resolves to null by default — "no active approval chain for this risk
  // tier" — so existing approve tests fall through to a normal, immediate
  // approval unless a test explicitly overrides this.
  startApprovalChain: vi.fn().mockResolvedValue(null),
} }));
// EP-201-S4 — avoid real Kong Admin API calls in route tests.
vi.mock('../src/lib/kong-provisioner.js', () => ({ default: { provisionServer: vi.fn(), deprovisionServer: vi.fn() } }));
// EP-202-S8 — avoid a real cross-service fetch to escalation-service in route tests.
vi.mock('../src/lib/escalation-client.js', () => ({ default: { createIncident: vi.fn() } }));
import pool from '../db.js';
import governanceClient from '../src/lib/governance-client.js';
import kongProvisioner from '../src/lib/kong-provisioner.js';
import escalationClient from '../src/lib/escalation-client.js';
import app from '../index.js';

const SERVER = {
  id: 'srv-1', name: 'filesystem-mcp', transport: 'local', status: 'pending_review',
  trusted_publisher: false, dependencies_json: [],
};

beforeEach(() => vi.clearAllMocks());

describe('GET /servers', () => {
  it('lists registered servers', async () => {
    pool.query.mockResolvedValueOnce({ rows: [SERVER] });
    const res = await request(app).get('/servers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('filesystem-mcp');
  });

  it('filters by status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/servers?status=approved');
    expect(pool.query.mock.calls[0][0]).toContain('status');
    expect(pool.query.mock.calls[0][1]).toEqual(['approved']);
  });
});

describe('POST /servers', () => {
  it('registers a new server as pending_review by default', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [SERVER] })
      .mockResolvedValueOnce({ rows: [] }); // existing credential findings (none)
    const res = await request(app).post('/servers').send({ name: 'filesystem-mcp', transport: 'local' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_review');
  });

  // EP-103-S4/S5 — no history row at registration (removed): status_history
  // is append-only at the DB level now, so a creation-stamp row would make
  // every server permanently undeletable. A never-reviewed server should
  // still be deletable outright.
  it('does not write a status_history row at registration', async () => {
    pool.query.mockResolvedValueOnce({ rows: [SERVER] });
    await request(app).post('/servers').send({ name: 'filesystem-mcp', transport: 'local' });
    expect(pool.query.mock.calls.some(c => c[0].includes('mcp_server_status_history'))).toBe(false);
  });

  it('rejects missing name', async () => {
    const res = await request(app).post('/servers').send({ transport: 'local' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid transport', async () => {
    const res = await request(app).post('/servers').send({ name: 'x', transport: 'carrier-pigeon' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /servers/:id/status', () => {
  it('approves a server with no risk_tier directly (no chain to check)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ risk_tier: null }] }) // risk_tier lookup for chain-gating
      .mockResolvedValueOnce({ rows: [{ status: 'pending_review' }] }) // existing-status lookup
      .mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'approved' }] }) // update
      .mockResolvedValueOnce({ rows: [] }); // status_history insert
    const res = await request(app).patch('/servers/srv-1/status').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  // EP-202 — a risk_tier with an active approval chain doesn't finalize
  // immediately; it starts the chain and returns 202 instead.
  it('starts an approval chain instead of approving directly when the risk_tier has an active chain', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ risk_tier: 'critical' }] }); // risk_tier lookup
    governanceClient.startApprovalChain.mockResolvedValueOnce({ id: 'req-1', status: 'pending' });

    const res = await request(app).patch('/servers/srv-1/status').send({ status: 'approved' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ chain_started: true, request: { id: 'req-1', status: 'pending' } });
    expect(governanceClient.startApprovalChain).toHaveBeenCalledWith(expect.objectContaining({
      riskTier: 'critical', assetType: 'mcp_server', assetId: 'srv-1',
    }));
    // only the one risk_tier lookup — finalizeStatusTransition's own
    // SELECT/UPDATE never ran
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('falls through to a direct approval when startApprovalChain finds no active chain (null)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ risk_tier: 'critical' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'pending_review' }] })
      .mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [] });
    governanceClient.startApprovalChain.mockResolvedValueOnce(null);

    const res = await request(app).patch('/servers/srv-1/status').send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  it('returns 404 for an unknown server before checking for an approval chain', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // risk_tier lookup finds nothing
    const res = await request(app).patch('/servers/unknown/status').send({ status: 'approved' });
    expect(res.status).toBe(404);
    expect(governanceClient.startApprovalChain).not.toHaveBeenCalled();
  });

  it('rejects an invalid status value', async () => {
    const res = await request(app).patch('/servers/srv-1/status').send({ status: 'trusted_forever' });
    expect(res.status).toBe(400);
  });

  // Epic 1, Feature 1.3 — status-change history and reject-reason
  it('records from/to status and an optional reason in status history', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'pending_review' }] })
      .mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'rejected' }] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app).patch('/servers/srv-1/status').send({ status: 'rejected', reason: 'Publisher not verified' });

    const historyInsert = pool.query.mock.calls.find(c => c[0].includes('mcp_server_status_history'));
    expect(historyInsert[1]).toEqual(['srv-1', 'pending_review', 'rejected', 'Publisher not verified']);
  });

  // EP-103-S2/S3
  it('mirrors the decision into governance-service via recordApprovalDecision', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'pending_review' }] })
      .mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'rejected' }] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app).patch('/servers/srv-1/status').send({ status: 'rejected', reason: 'Publisher not verified' });

    expect(governanceClient.recordApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({
      assetType: 'mcp_server', assetId: 'srv-1', decision: 'rejected', supportingEvidence: 'Publisher not verified',
    }));
  });

  // EP-201-S4
  it('provisions Kong routing when a server is approved', async () => {
    const approved = { ...SERVER, status: 'approved' };
    pool.query
      .mockResolvedValueOnce({ rows: [{ risk_tier: null }] }) // risk_tier lookup for chain-gating
      .mockResolvedValueOnce({ rows: [{ status: 'pending_review' }] })
      .mockResolvedValueOnce({ rows: [approved] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app).patch('/servers/srv-1/status').send({ status: 'approved' });

    expect(kongProvisioner.provisionServer).toHaveBeenCalledWith(approved);
    expect(kongProvisioner.deprovisionServer).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'retired'])('deprovisions Kong routing when a server is %s', async (status) => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [{ ...SERVER, status }] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app).patch('/servers/srv-1/status').send({ status, reason: 'no longer needed' });

    expect(kongProvisioner.deprovisionServer).toHaveBeenCalledWith('srv-1');
    expect(kongProvisioner.provisionServer).not.toHaveBeenCalled();
  });

  // EP-105-S4/S5 — a revocation (reject/retire) must re-evaluate immediately
  it('re-evaluates policies after a status change', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'retired' }] })
      .mockResolvedValueOnce({ rows: [] });
    await request(app).patch('/servers/srv-1/status').send({ status: 'retired' });
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
  });
});

// EP-202 — governance-service's callback once a multi-stage chain reaches
// a terminal state.
describe('POST /servers/:id/approval-chain-decided', () => {
  it('finalizes the server as approved when the chain approves', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'pending_review' }] })
      .mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/servers/srv-1/approval-chain-decided').send({ decision: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(kongProvisioner.provisionServer).toHaveBeenCalled();

    const historyInsert = pool.query.mock.calls.find(c => c[0].includes('mcp_server_status_history'));
    expect(historyInsert[1]).toEqual(['srv-1', 'pending_review', 'approved', 'Approval chain approved']);
    expect(governanceClient.recordApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({
      assetType: 'mcp_server', assetId: 'srv-1', decision: 'approved', actor: 'system:approval-chain',
    }));
  });

  it('finalizes the server as rejected when the chain rejects', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'pending_review' }] })
      .mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'rejected' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/servers/srv-1/approval-chain-decided').send({ decision: 'rejected' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(kongProvisioner.deprovisionServer).toHaveBeenCalledWith('srv-1');
  });

  it('rejects an invalid decision value', async () => {
    const res = await request(app).post('/servers/srv-1/approval-chain-decided').send({ decision: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown server', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/servers/unknown/approval-chain-decided').send({ decision: 'approved' });
    expect(res.status).toBe(404);
  });
});

describe('GET /servers/resolve', () => {
  it('requires a ref query param', async () => {
    const res = await request(app).get('/servers/resolve');
    expect(res.status).toBe(400);
  });

  it('returns registered:false with a 404 when nothing matches', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/servers/resolve?ref=unknown-host');
    expect(res.status).toBe(404);
    expect(res.body.registered).toBe(false);
  });

  it('resolves an exact name match', async () => {
    pool.query.mockResolvedValueOnce({ rows: [SERVER] });
    const res = await request(app).get('/servers/resolve?ref=filesystem-mcp');
    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(true);
    expect(res.body.id).toBe('srv-1');
  });

  // Epic 2, Feature 2.2 — scheme/trailing-slash normalization + ambiguity
  it('normalizes scheme and trailing slash when comparing endpoints', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/servers/resolve?ref=http://mcp.example.com/fs/');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('REGEXP_REPLACE');
    expect(sql).toContain('RTRIM');
  });

  it('reports ambiguous matches with a 409 instead of silently picking one', async () => {
    pool.query.mockResolvedValueOnce({ rows: [
      { id: 'srv-1', name: 'filesystem-mcp', status: 'approved' },
      { id: 'srv-2', name: 'filesystem-mcp-2', status: 'pending_review' },
    ] });
    const res = await request(app).get('/servers/resolve?ref=filesystem');
    expect(res.status).toBe(409);
    expect(res.body.ambiguous).toBe(true);
    expect(res.body.candidates).toHaveLength(2);
  });
});

describe('GET /servers/:id', () => {
  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/servers/unknown');
    expect(res.status).toBe(404);
  });

  it('returns server detail with tools/resources/prompts/authorizations/credential_exposure/status_history/assurance_evidence/discovery_history', async () => {
    const historyRow = { metadata_json: { command: 'npx', args: [] }, recorded_at: '2026-01-01T00:00:00Z' };
    pool.query
      .mockResolvedValueOnce({ rows: [SERVER] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [historyRow] });
    const res = await request(app).get('/servers/srv-1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tools');
    expect(res.body).toHaveProperty('resources');
    expect(res.body).toHaveProperty('prompts');
    expect(res.body).toHaveProperty('authorizations');
    expect(res.body).toHaveProperty('credential_exposure');
    expect(res.body).toHaveProperty('assurance_evidence');
    expect(res.body).toHaveProperty('status_history');
    expect(res.body.discovery_history).toEqual([historyRow]);
  });
});

describe('POST /servers — credential exposure detection (Feature 5.3)', () => {
  it('redacts a hardcoded credential in the endpoint before persisting and flags it', async () => {
    const key = 'sk-' + 'a'.repeat(40);
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...SERVER, endpoint: `https://api.example.com/mcp?key=${key.slice(0, 4)}****${key.slice(-4)}` }] }) // insert
      .mockResolvedValueOnce({ rows: [] }) // credential_exposure insert
      .mockResolvedValueOnce({ rows: [] }); // status_history insert

    const res = await request(app).post('/servers').send({ name: 'filesystem-mcp', transport: 'local', endpoint: `https://api.example.com/mcp?key=${key}` });
    expect(res.status).toBe(201);
    expect(res.body.credential_exposure_detected).toBe(true);

    const insertArgs = pool.query.mock.calls[0][1];
    expect(insertArgs.join(' ')).not.toContain(key); // raw secret never reaches the INSERT params

    const findingsInsertCall = pool.query.mock.calls.find(c => c[0].includes('mcp_credential_exposure'));
    expect(findingsInsertCall).toBeTruthy();

    // EP-101-S5 — a confirmed finding auto-triggers governance-service's
    // rule evaluation rather than waiting for a manual /violations/evaluate call.
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith(SERVER.id);
  });

  it('does not flag or write findings when nothing matches', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [SERVER] })
      .mockResolvedValueOnce({ rows: [] }); // existing credential findings (none)
    const res = await request(app).post('/servers').send({ name: 'filesystem-mcp', transport: 'local' });
    expect(res.status).toBe(201);
    expect(res.body.credential_exposure_detected).toBe(false);
    // server insert + credential_exposure SELECT/DELETE (dependencies_json is
    // always scanned at registration, even when empty — touching the table
    // clears any stale finding, but nothing gets inserted; no status_history
    // row at registration — see EP-103-S4/S5).
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query.mock.calls.some(c => c[0].includes('INSERT INTO mcp_governance.mcp_credential_exposure'))).toBe(false);
    expect(governanceClient.evaluateServer).not.toHaveBeenCalled();
  });
});

describe('PUT /servers/:id — credential exposure detection (Feature 5.3)', () => {
  it('redacts a hardcoded credential in an updated field and flags it', async () => {
    const key = 'AKIA' + '1234567890ABCDEF';
    pool.query
      .mockResolvedValueOnce({ rows: [SERVER] }) // existing lookup
      .mockResolvedValueOnce({ rows: [{ ...SERVER, integrity_info: 'AKIA****CDEF' }] }) // update
      .mockResolvedValueOnce({ rows: [] }); // credential_exposure insert

    const res = await request(app).put('/servers/srv-1').send({ integrity_info: key });
    expect(res.status).toBe(200);
    expect(res.body.credential_exposure_detected).toBe(true);
    const updateArgs = pool.query.mock.calls[1][1];
    expect(updateArgs.join(' ')).not.toContain(key);
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
  });

  // EP-101-S9 — a credential claimed as rotated that's detected again (same
  // fingerprint) must keep showing its rotation-confirmed state, since that's
  // the signal that the claim didn't hold.
  it('carries forward rotation_confirmed_at/by when the same fingerprint reappears', async () => {
    const key = 'AKIA' + '1234567890ABCDEF';
    const crypto = await import('crypto');
    const fingerprint = crypto.createHash('sha256').update(key).digest('hex');

    pool.query
      .mockResolvedValueOnce({ rows: [SERVER] }) // existing lookup
      .mockResolvedValueOnce({ rows: [{ ...SERVER, integrity_info: 'AKIA****CDEF' }] }) // update
      .mockResolvedValueOnce({ rows: [{ fingerprint_sha256: fingerprint, rotation_confirmed_at: '2026-07-01T00:00:00Z', rotation_confirmed_by: 'jane@example.com' }] }); // existing findings

    const res = await request(app).put('/servers/srv-1').send({ integrity_info: key });
    expect(res.status).toBe(200);

    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO mcp_governance.mcp_credential_exposure'));
    expect(insertCall[1]).toEqual(['srv-1', 'integrity_info', 'aws_access_key', 'AKIA****CDEF', fingerprint, '2026-07-01T00:00:00Z', 'jane@example.com']);
  });

  // EP-105-S4 — a field a policy cares about (trusted_publisher,
  // expiration_date, ...) can change with no credential finding involved at
  // all; re-evaluation must not be gated on findings.length.
  it('re-evaluates policies even when no credential finding was produced', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [SERVER] }) // existing lookup
      .mockResolvedValueOnce({ rows: [{ ...SERVER, trusted_publisher: true }] }); // update, no fields scanned
    const res = await request(app).put('/servers/srv-1').send({ trusted_publisher: true });
    expect(res.status).toBe(200);
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
  });

  it('returns 404 for an unknown server', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/servers/unknown').send({ name: 'x' });
    expect(res.status).toBe(404);
  });
});

// EP-202-S7/S8
describe('PUT /servers/:id — materiality drift', () => {
  const MATERIAL_FIELDS = { endpoint: 'https://old.example.com', authentication_method: null, risk_tier: 'low', trusted_publisher: false };

  const APPROVED_WITH_HASH = {
    ...SERVER, status: 'approved', materiality_hash: cryptoModule.createHash('sha256').update(JSON.stringify(MATERIAL_FIELDS)).digest('hex'),
    ...MATERIAL_FIELDS,
  };

  it('reverts an approved server to pending_review, notifies, and deprovisions Kong when a material field changes', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [APPROVED_WITH_HASH] }) // existing lookup
      .mockResolvedValueOnce({ rows: [{ ...APPROVED_WITH_HASH, endpoint: 'https://new.example.com', status: 'pending_review' }] }) // update
      .mockResolvedValueOnce({ rows: [] }) // persistCredentialFindings: existing findings
      .mockResolvedValueOnce({ rows: [] }) // persistCredentialFindings: delete
      .mockResolvedValueOnce({ rows: [] }) // applyMaterialityDrift: status UPDATE
      .mockResolvedValueOnce({ rows: [] }); // status_history insert

    const res = await request(app).put('/servers/srv-1').send({ endpoint: 'https://new.example.com' });
    expect(res.status).toBe(200);
    expect(res.body.material_change_detected).toBe(true);

    const updateArgs = pool.query.mock.calls[1][1];
    expect(updateArgs.at(-2)).toBe(true); // revertToPending param

    const historyInsert = pool.query.mock.calls.find(c => c[0].includes('mcp_server_status_history'));
    expect(historyInsert[1]).toEqual(['srv-1', expect.stringMatching(/material change detected/i)]);
    expect(historyInsert[0]).toContain("'approved', 'pending_review'");

    expect(governanceClient.recordApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({
      assetType: 'mcp_server', assetId: 'srv-1', decision: 'pending_review', actor: 'system:materiality-drift',
    }));
    expect(kongProvisioner.deprovisionServer).toHaveBeenCalledWith('srv-1');
    expect(escalationClient.createIncident).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'high', contextJson: { server_id: 'srv-1', previous_status: 'approved' },
    }));
  });

  it('does not revert a pending_review server even if material fields change (nothing approved to protect)', async () => {
    const pending = { ...APPROVED_WITH_HASH, status: 'pending_review' };
    pool.query
      .mockResolvedValueOnce({ rows: [pending] })
      .mockResolvedValueOnce({ rows: [{ ...pending, endpoint: 'https://new.example.com' }] })
      .mockResolvedValueOnce({ rows: [] }) // persistCredentialFindings: existing findings
      .mockResolvedValueOnce({ rows: [] }); // persistCredentialFindings: delete

    const res = await request(app).put('/servers/srv-1').send({ endpoint: 'https://new.example.com' });
    expect(res.status).toBe(200);
    expect(res.body.material_change_detected).toBe(true); // detected...
    expect(kongProvisioner.deprovisionServer).not.toHaveBeenCalled(); // ...but nothing to revert
    expect(escalationClient.createIncident).not.toHaveBeenCalled();
  });

  it('does not treat a non-material field change (e.g. business_owner) as drift', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [APPROVED_WITH_HASH] })
      .mockResolvedValueOnce({ rows: [{ ...APPROVED_WITH_HASH, business_owner: 'new-owner' }] });

    const res = await request(app).put('/servers/srv-1').send({ business_owner: 'new-owner' });
    expect(res.status).toBe(200);
    expect(res.body.material_change_detected).toBe(false);
    expect(kongProvisioner.deprovisionServer).not.toHaveBeenCalled();
  });

  it('backfills a NULL materiality_hash without treating it as drift', async () => {
    const legacyServer = { ...SERVER, status: 'approved', materiality_hash: null };
    pool.query
      .mockResolvedValueOnce({ rows: [legacyServer] })
      .mockResolvedValueOnce({ rows: [{ ...legacyServer, endpoint: 'https://new.example.com' }] })
      .mockResolvedValueOnce({ rows: [] }) // persistCredentialFindings: existing findings
      .mockResolvedValueOnce({ rows: [] }); // persistCredentialFindings: delete

    const res = await request(app).put('/servers/srv-1').send({ endpoint: 'https://new.example.com' });
    expect(res.status).toBe(200);
    expect(res.body.material_change_detected).toBe(false);
    expect(kongProvisioner.deprovisionServer).not.toHaveBeenCalled();
  });
});

describe('POST /servers/:id/score', () => {
  it('computes and persists a risk score, returning all 8 dimensions', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [SERVER] })  // fetch server
      .mockResolvedValueOnce({ rows: [] })         // tools
      .mockResolvedValueOnce({ rows: [] })         // resources
      .mockResolvedValueOnce({ rows: [] })         // prompts
      .mockResolvedValueOnce({ rows: [] })         // authorizations
      .mockResolvedValueOnce({ rows: [] });        // update

    const res = await request(app).post('/servers/srv-1/score');
    expect(res.status).toBe(200);
    expect(res.body.server_id).toBe('srv-1');
    expect(Object.keys(res.body.dimensions)).toHaveLength(8);

    const updateCall = pool.query.mock.calls.find(c => c[0].includes('UPDATE mcp_governance.mcp_servers'));
    expect(updateCall[0]).toContain('risk_score');
    expect(updateCall[0]).toContain('risk_breakdown_json');
  });

  it('returns 404 for an unknown server', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/servers/unknown/score');
    expect(res.status).toBe(404);
  });
});

// EP-103-S4/S5 — mcp_server_status_history is append-only at the DB level;
// a server with any history can no longer cascade-delete.
describe('DELETE /servers/:id', () => {
  it('deletes a server with no status history', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })          // history check — none
      .mockResolvedValueOnce({ rowCount: 1 });      // delete
    const res = await request(app).delete('/servers/srv-1');
    expect(res.status).toBe(204);
  });

  it('rejects deletion with 409 when status history exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // history check — found
    const res = await request(app).delete('/servers/srv-1');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('append-only');
  });

  it('returns 404 for an unknown server', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })          // history check — none
      .mockResolvedValueOnce({ rowCount: 0 });      // delete — nothing matched
    const res = await request(app).delete('/servers/unknown');
    expect(res.status).toBe(404);
  });
});

// EP-203 — governance-service's kill-switch callback
describe('POST /servers/:id/containment', () => {
  it('sets containment_state and deprovisions Kong when suspended', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'approved', containment_state: 'suspended' }] });

    const res = await request(app).post('/servers/srv-1/containment').send({ containment_state: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.containment_state).toBe('suspended');
    expect(kongProvisioner.deprovisionServer).toHaveBeenCalledWith('srv-1');
    expect(kongProvisioner.provisionServer).not.toHaveBeenCalled();
  });

  it('deprovisions Kong when quarantined', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'approved', containment_state: 'quarantined' }] });
    await request(app).post('/servers/srv-1/containment').send({ containment_state: 'quarantined' });
    expect(kongProvisioner.deprovisionServer).toHaveBeenCalledWith('srv-1');
  });

  it('re-provisions Kong on restore-to-active only when the server is still approved', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'approved', containment_state: 'active' }] });
    const res = await request(app).post('/servers/srv-1/containment').send({ containment_state: 'active' });
    expect(res.status).toBe(200);
    expect(kongProvisioner.provisionServer).toHaveBeenCalled();
    expect(kongProvisioner.deprovisionServer).not.toHaveBeenCalled();
  });

  it('does not re-provision Kong on restore-to-active if the server was separately rejected', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...SERVER, status: 'rejected', containment_state: 'active' }] });
    await request(app).post('/servers/srv-1/containment').send({ containment_state: 'active' });
    expect(kongProvisioner.provisionServer).not.toHaveBeenCalled();
    expect(kongProvisioner.deprovisionServer).not.toHaveBeenCalled();
  });

  it('rejects an invalid containment_state', async () => {
    const res = await request(app).post('/servers/srv-1/containment').send({ containment_state: 'disabled' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown server', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/servers/unknown/containment').send({ containment_state: 'suspended' });
    expect(res.status).toBe(404);
  });
});

describe('POST /servers/discovery-import', () => {
  it('returns 400 when discovered is not an array', async () => {
    const res = await request(app).post('/servers/discovery-import').send({ discovered: 'nope' });
    expect(res.status).toBe(400);
  });

  it('skips an entry with no name', async () => {
    const res = await request(app).post('/servers/discovery-import').send({
      discovered: [{ command: 'node' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.created).toBe(0);
  });

  it('skips an entry with neither command nor url', async () => {
    const res = await request(app).post('/servers/discovery-import').send({
      discovered: [{ name: 'bare' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.skipped).toEqual([{ name: 'bare', reason: 'missing name, or neither command nor url' }]);
  });

  it('creates a new discovered server (command-based, local transport)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // not already tracked at a real status
      .mockResolvedValueOnce({ rows: [] }) // no existing 'discovered' row either
      .mockResolvedValueOnce({ rows: [{ id: 'new-1' }] }); // insert
    const res = await request(app).post('/servers/discovery-import').send({
      discovered: [{ name: 'filesystem', command: 'npx', args: ['-y', '@mcp/fs'], env_hints: [], source: 'claude_desktop', source_path: '/fake/path.json' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    const insertCall = pool.query.mock.calls[2];
    expect(insertCall[0]).toMatch(/status, discovery_metadata_json/);
    expect(insertCall[1]).toEqual(['filesystem', 'local', null, JSON.stringify({
      command: 'npx', args: ['-y', '@mcp/fs'], env_hints: [], source: 'claude_desktop', source_path: '/fake/path.json',
    })]);

    // EP-306-S9 — a genuinely new candidate alerts the governance officer.
    expect(escalationClient.createIncident).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'low',
      contextJson: { discovered_names: ['filesystem'] },
    }));
  });

  it('fires exactly one incident for a batch that creates several servers, not one per server', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'n1' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'n2' }] });
    const res = await request(app).post('/servers/discovery-import').send({
      discovered: [
        { name: 'server-a', command: 'npx' },
        { name: 'server-b', command: 'node' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(escalationClient.createIncident).toHaveBeenCalledTimes(1);
    expect(escalationClient.createIncident).toHaveBeenCalledWith(expect.objectContaining({
      contextJson: { discovered_names: ['server-a', 'server-b'] },
    }));
  });

  it('does not fire an incident when nothing new was created (only refreshed/already-tracked)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'approved-1' }] }) // already tracked
      .mockResolvedValueOnce({ rows: [] });
    await request(app).post('/servers/discovery-import').send({
      discovered: [{ name: 'filesystem', command: 'npx' }],
    });
    expect(escalationClient.createIncident).not.toHaveBeenCalled();
  });

  // EP-201-S14 — proactive drift detection: the discovery-agent's own
  // periodic re-scan is the signal, since this codebase has no live
  // server-probing mechanism. Reuses the exact same reaction PUT /:id's
  // materiality-drift check already triggers.
  describe('drift detection on re-scan of an approved server', () => {
    it('reverts to pending_review and deprovisions Kong when the re-scanned command differs', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'srv-1', status: 'approved', discovery_metadata_json: { command: 'npx', args: ['-y', '@mcp/fs'] } }] }) // tracked lookup
        .mockResolvedValueOnce({ rows: [] }) // last_discovery_at update
        .mockResolvedValueOnce({ rows: [] }) // applyMaterialityDrift: status UPDATE
        .mockResolvedValueOnce({ rows: [] }); // status_history insert

      const res = await request(app).post('/servers/discovery-import').send({
        discovered: [{ name: 'filesystem', command: 'curl', args: ['evil.example.com'] }],
      });
      expect(res.status).toBe(201);
      expect(res.body.already_tracked).toBe(1);

      const historyInsert = pool.query.mock.calls.find(c => c[0].includes('mcp_server_status_history'));
      expect(historyInsert[1][0]).toBe('srv-1');
      expect(historyInsert[1][1]).toMatch(/discovery re-scan/i);
      expect(kongProvisioner.deprovisionServer).toHaveBeenCalledWith('srv-1');
      expect(escalationClient.createIncident).toHaveBeenCalledWith(expect.objectContaining({ severity: 'high' }));
      expect(governanceClient.recordApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({
        assetType: 'mcp_server', assetId: 'srv-1', decision: 'pending_review', actor: 'system:materiality-drift',
      }));
    });

    it('does nothing when the re-scan matches the approved config exactly', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'srv-1', status: 'approved', discovery_metadata_json: { command: 'npx', args: ['-y', '@mcp/fs'] } }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app).post('/servers/discovery-import').send({
        discovered: [{ name: 'filesystem', command: 'npx', args: ['-y', '@mcp/fs'] }],
      });
      expect(res.status).toBe(201);
      expect(kongProvisioner.deprovisionServer).not.toHaveBeenCalled();
      expect(escalationClient.createIncident).not.toHaveBeenCalled();
    });

    it('does nothing for a non-approved (e.g. pending_review) server even if the command differs', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'srv-1', status: 'pending_review', discovery_metadata_json: { command: 'npx' } }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app).post('/servers/discovery-import').send({
        discovered: [{ name: 'filesystem', command: 'curl' }],
      });
      expect(kongProvisioner.deprovisionServer).not.toHaveBeenCalled();
    });

    it('does nothing when the approved server predates discovery_metadata_json (nothing to compare against)', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 'srv-1', status: 'approved', discovery_metadata_json: null }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app).post('/servers/discovery-import').send({
        discovered: [{ name: 'filesystem', command: 'curl' }],
      });
      expect(kongProvisioner.deprovisionServer).not.toHaveBeenCalled();
    });
  });

  it('creates a new discovered server (url-based, remote transport)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-1' }] });
    const res = await request(app).post('/servers/discovery-import').send({
      discovered: [{ name: 'remote-api', url: 'https://mcp.example.com', source: 'vscode' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    const insertCall = pool.query.mock.calls[2];
    expect(insertCall[1][1]).toBe('remote'); // transport
    expect(insertCall[1][2]).toBe('https://mcp.example.com'); // endpoint
  });

  it('refreshes an existing discovered row and snapshots the old metadata into discovery_scan_history first', async () => {
    const oldMetadata = { command: 'npx', args: ['-y', '@mcp/old-version'], env_hints: [], source: 'claude_desktop', source_path: '/old/path.json' };
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // not tracked at a real status
      .mockResolvedValueOnce({ rows: [{ id: 'existing-discovered-1', discovery_metadata_json: oldMetadata }] }) // already a 'discovered' row, has prior metadata
      .mockResolvedValueOnce({ rows: [] }) // snapshot insert
      .mockResolvedValueOnce({ rows: [] }); // update
    const res = await request(app).post('/servers/discovery-import').send({
      discovered: [{ name: 'filesystem', command: 'npx', args: [] }],
    });
    expect(res.status).toBe(201);
    expect(res.body.refreshed).toBe(1);
    expect(res.body.created).toBe(0);

    const snapshotCall = pool.query.mock.calls[2];
    expect(snapshotCall[0]).toMatch(/INSERT INTO mcp_governance\.discovery_scan_history/);
    expect(snapshotCall[1]).toEqual(['existing-discovered-1', oldMetadata]);

    const updateCall = pool.query.mock.calls[3];
    expect(updateCall[0]).toMatch(/UPDATE mcp_governance\.mcp_servers/);
    expect(updateCall[1]).toEqual(['local', null, JSON.stringify({ command: 'npx', args: [], env_hints: [], source: null, source_path: null }), 'existing-discovered-1']);
  });

  it('does not write a history row when the discovered server has no prior metadata to snapshot', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-discovered-1', discovery_metadata_json: null }] })
      .mockResolvedValueOnce({ rows: [] }); // update — no snapshot insert in between
    await request(app).post('/servers/discovery-import').send({
      discovered: [{ name: 'filesystem', command: 'npx' }],
    });
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query.mock.calls[2][0]).toMatch(/UPDATE mcp_governance\.mcp_servers/);
  });

  it('leaves an already-tracked (non-discovered) server untouched, only bumping last_discovery_at', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'approved-server-1' }] }) // found at a real status
      .mockResolvedValueOnce({ rows: [] }); // last_discovery_at update
    const res = await request(app).post('/servers/discovery-import').send({
      discovered: [{ name: 'filesystem', command: 'npx' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.already_tracked).toBe(1);
    expect(res.body.created).toBe(0);
    expect(res.body.refreshed).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(2);
    const updateCall = pool.query.mock.calls[1];
    expect(updateCall[0]).toMatch(/SET last_discovery_at = NOW\(\)/);
  });

  it('processes a batch with mixed outcomes in one request', async () => {
    pool.query
      // first item: bare (no name) — skipped before any query
      // second item: already tracked
      .mockResolvedValueOnce({ rows: [{ id: 'tracked-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      // third item: brand new
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-1' }] });

    const res = await request(app).post('/servers/discovery-import').send({
      discovered: [
        { command: 'no-name-here' },
        { name: 'tracked-server', command: 'npx' },
        { name: 'new-server', command: 'node' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 1, refreshed: 0, already_tracked: 1 });
    expect(res.body.skipped).toHaveLength(1);
  });
});
