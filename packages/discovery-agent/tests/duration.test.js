import { describe, it, expect } from 'vitest';
import { parseDuration } from '../src/duration.js';

describe('parseDuration', () => {
  it('parses seconds, minutes, hours, and days', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('30m')).toBe(30 * 60_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('2d')).toBe(2 * 86_400_000);
  });

  it('throws a descriptive error on an unrecognized unit', () => {
    expect(() => parseDuration('1w')).toThrow(/Invalid duration/);
  });

  it('throws on a bare number with no unit', () => {
    expect(() => parseDuration('60')).toThrow(/Invalid duration/);
  });

  it('throws on garbage input', () => {
    expect(() => parseDuration('soon')).toThrow(/Invalid duration/);
  });
});
