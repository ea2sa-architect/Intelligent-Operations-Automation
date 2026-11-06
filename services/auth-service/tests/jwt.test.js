import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import jwtLib from '../src/lib/jwt.js';

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  // Mirrors the \n-escaped single-line storage format used in .env
  process.env.AUTH_JWT_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
  process.env.AUTH_JWT_PUBLIC_KEY = publicKey.replace(/\n/g, '\\n');
});

afterAll(() => { process.env = { ...ORIGINAL_ENV }; });

describe('signAccessToken / verifyAccessToken', () => {
  it('signs a token that verifies successfully and carries the expected claims', () => {
    const token = jwtLib.signAccessToken({ id: 'user-1', username: 'admin' });
    const payload = jwtLib.verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.username).toBe('admin');
    expect(payload.iss).toBe(jwtLib.ISSUER);
    expect(payload.aud).toBe(jwtLib.AUDIENCE);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('rejects a token signed with a different key pair', () => {
    const { privateKey: otherPrivateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const savedPrivateKey = process.env.AUTH_JWT_PRIVATE_KEY;
    process.env.AUTH_JWT_PRIVATE_KEY = otherPrivateKey.replace(/\n/g, '\\n');
    const tokenFromOtherKey = jwtLib.signAccessToken({ id: 'user-1', username: 'admin' });
    process.env.AUTH_JWT_PRIVATE_KEY = savedPrivateKey;

    expect(() => jwtLib.verifyAccessToken(tokenFromOtherKey)).toThrow();
  });

  it('rejects a malformed token', () => {
    expect(() => jwtLib.verifyAccessToken('not-a-real-token')).toThrow();
  });

  it('rejects an expired token', () => {
    // Sign directly with jsonwebtoken to force an already-expired token —
    // signAccessToken always uses the fixed 60m TTL.
    const privateKey = process.env.AUTH_JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
    const expiredToken = jwt.sign(
      { sub: 'user-1', username: 'admin' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '-10s', issuer: jwtLib.ISSUER, audience: jwtLib.AUDIENCE }
    );
    expect(() => jwtLib.verifyAccessToken(expiredToken)).toThrow(/expired/i);
  });

  it('rejects a token with the wrong audience', () => {
    const privateKey = process.env.AUTH_JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
    const wrongAudienceToken = jwt.sign(
      { sub: 'user-1', username: 'admin' },
      privateKey,
      { algorithm: 'RS256', expiresIn: '60m', issuer: jwtLib.ISSUER, audience: 'some-other-app' }
    );
    expect(() => jwtLib.verifyAccessToken(wrongAudienceToken)).toThrow(/audience/i);
  });
});
