import { describe, expect, it } from 'vitest';
import { safeCallback } from './callback';

const origin = 'http://localhost:3300';

const cases: [string | null, string][] = [
  ['//example.com', '/briefing'],
  ['/%09/example.com', '/briefing'],
  ['/\t/example.com', '/briefing'],
  ['/\\example.com', '/briefing'],
  ['%2F%2Fexample.com', '/briefing'],
  ['/..//example.com', '/briefing'],
  ['/.//example.com', '/briefing'],
  ['/%2e%2e//example.com', '/briefing'],
  // Normalises to `/%2fexample.com`, which a second check decodes to `//example.com`.
  ['/%2e%2e/%2fexample.com', '/briefing'],
  ['https://example.com/x', '/briefing'],
  ['javascript:alert(1)', '/briefing'],
  ['/%E0%A4%A', '/briefing'],
  ['', '/briefing'],
  [null, '/briefing'],
  ['/ads?country=US#top', '/ads?country=US#top'],
  ['/shops/example.com', '/shops/example.com'],
  [`${origin}/runs`, '/runs'],
];

describe('safeCallback', () => {
  it.each(cases)('%s → %s', (cb, expected) => {
    expect(safeCallback(cb, origin)).toBe(expected);
  });

  // The login page passes its result to the form, and the sign-in action checks it again.
  it.each(cases)('is idempotent for %s', (cb) => {
    const once = safeCallback(cb, origin);
    expect(safeCallback(once, origin)).toBe(once);
  });
});
