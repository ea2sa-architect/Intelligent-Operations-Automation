import { describe, it, expect, vi } from 'vitest';
import correlationId from '../src/lib/correlation-id.js';

function mockRes() {
  const headers = {};
  return { headers, setHeader: (k, v) => { headers[k] = v; } };
}

describe('correlationId middleware', () => {
  it('mints a new UUID when no x-correlation-id header is present', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = vi.fn();

    correlationId(req, res, next);

    expect(req.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(res.headers['x-correlation-id']).toBe(req.correlationId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('honors an incoming x-correlation-id header to continue an existing chain', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const req = { headers: { 'x-correlation-id': id } };
    const res = mockRes();
    const next = vi.fn();

    correlationId(req, res, next);

    expect(req.correlationId).toBe(id);
    expect(res.headers['x-correlation-id']).toBe(id);
  });

  it('mints a new UUID for a blank/whitespace-only header rather than propagating an empty chain id', () => {
    const req = { headers: { 'x-correlation-id': '   ' } };
    const res = mockRes();
    const next = vi.fn();

    correlationId(req, res, next);

    expect(req.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  // The DB column is typed UUID (telemetry.metrics.correlation_id) — a
  // malformed upstream value must not reach an INSERT and 500 the ingest.
  it('mints a new UUID when the incoming header is not UUID-shaped', () => {
    const req = { headers: { 'x-correlation-id': 'not-a-real-uuid' } };
    const res = mockRes();
    const next = vi.fn();

    correlationId(req, res, next);

    expect(req.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(req.correlationId).not.toBe('not-a-real-uuid');
  });
});
