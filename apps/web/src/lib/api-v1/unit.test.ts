import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor';
import { ApiError } from './error';
import { createRateLimiter } from './rate-limit';
import { TOKEN_PATTERN, generateToken, hashToken } from './token';

describe('token format', () => {
  it('is ihp_ plus 40 base62 characters, unique per call, hashed as hex SHA-256', () => {
    const a = generateToken();
    expect(a).toMatch(TOKEN_PATTERN);
    expect(a).toHaveLength(44);
    expect(generateToken()).not.toBe(a);
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });
});

describe('rate limiter', () => {
  it('counts per token and per install in a fixed window and starts a new window after it', () => {
    const l = createRateLimiter({ perToken: 2, perInstall: 3, windowMs: 60_000 });
    expect(l.take('a', 0)).toEqual({ allowed: true, limit: 2, remaining: 1, resetSeconds: 60 });
    expect(l.take('a', 1000)).toMatchObject({ allowed: true, remaining: 0, resetSeconds: 59 });
    expect(l.take('a', 2000)).toMatchObject({ allowed: false, limit: 2, remaining: 0, resetSeconds: 58 });
    // The install has 1 left, so it is the tighter bucket for b.
    expect(l.take('b', 3000)).toMatchObject({ allowed: true, limit: 3, remaining: 0 });
    expect(l.take('c', 4000)).toMatchObject({ allowed: false, limit: 3 });
    // A request without a valid token only reports the install; it consumes nothing.
    expect(l.take(null, 5000)).toMatchObject({ allowed: true, limit: 3, remaining: 0 });
    expect(l.take('a', 61_000)).toMatchObject({ allowed: true, remaining: 1 });
  });
});

describe('cursor', () => {
  const valid = [/^\d{4}$/, /^[a-z]+$/];
  it('round-trips a key for the same filters and refuses other filters, shapes and parts', () => {
    const cursor = encodeCursor(['2026', 'abc'], { status: 'new' });
    expect(decodeCursor(cursor, { status: 'new' }, valid)).toEqual(['2026', 'abc']);
    expect(decodeCursor(null, {}, valid)).toBeUndefined();
    for (const [c, f] of [
      [cursor, { status: 'done' }],
      [cursor, {}],
      ['%%%', { status: 'new' }],
      [encodeCursor(['2026'], { status: 'new' }), { status: 'new' }],
      [encodeCursor(['2026', "x'; drop table"], { status: 'new' }), { status: 'new' }],
    ] as const) {
      expect(() => decodeCursor(c, f, valid)).toThrow(ApiError);
    }
  });
});
