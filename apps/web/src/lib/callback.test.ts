import { describe, expect, it } from 'vitest';
import { safeCallback } from './callback';

const origin = 'http://localhost:3300';

describe('safeCallback', () => {
  it.each([
    ['//example.com', '/briefing'],
    ['/%09/example.com', '/briefing'],
    ['/\t/example.com', '/briefing'],
    ['/\\example.com', '/briefing'],
    ['%2F%2Fexample.com', '/briefing'],
    ['/..//example.com', '/briefing'],
    ['/.//example.com', '/briefing'],
    ['/%2e%2e//example.com', '/briefing'],
    ['https://example.com/x', '/briefing'],
    ['javascript:alert(1)', '/briefing'],
    ['/%E0%A4%A', '/briefing'],
    ['', '/briefing'],
    [null, '/briefing'],
    ['/ads?country=US#top', '/ads?country=US#top'],
    ['/shops/example.com', '/shops/example.com'],
    [`${origin}/runs`, '/runs'],
  ])('%s → %s', (cb, expected) => {
    expect(safeCallback(cb, origin)).toBe(expected);
  });
});
