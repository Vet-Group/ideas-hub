import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CACHE_MS, EtsyUnavailable, createEtsyClient, summarize } from '../src/index';

const body = readFileSync(new URL('./fixtures/listings-mixed.json', import.meta.url), 'utf8');
const ok = () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
const tooMany = (retryAfter: string) => new Response('{"error":"rate limited"}', { status: 429, headers: { 'retry-after': retryAfter } });

/** A fake clock: `sleep` moves it, so pacing is checked without waiting. */
function harness(responses: Array<() => Response>) {
  let clock = 1_000_000;
  const calls: { url: string; at: number; headers: Headers }[] = [];
  const sleeps: number[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), at: clock, headers: new Headers(init?.headers) });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  }) as typeof globalThis.fetch;
  const client = createEtsyClient({
    apiKey: 'test-keystring',
    sharedSecret: 'test-secret',
    fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { client, calls, sleeps, advance: (ms: number) => (clock += ms) };
}

describe('summarize', () => {
  it('bands prices per currency, never across currencies, and counts tags once per listing', () => {
    const s = summarize(JSON.parse(body).results, 1234);
    expect(s.total).toBe(1234);
    expect(s.sampled).toBe(6); // the listing without a price is skipped
    expect(s.priceBands).toEqual([
      { currency: 'USD', listings: 4, p25: 18.74, p75: 28.74 },
      { currency: 'EUR', listings: 1, p25: 22, p75: 22 },
      { currency: 'GBP', listings: 1, p25: 18, p75: 18 },
    ]);
    expect(s.topTags).toEqual([
      { tag: 'dog mom', listings: 5 },
      { tag: 'dog lover', listings: 2 },
      { tag: 'gift for her', listings: 2 },
      { tag: 'dog mum', listings: 1 },
      { tag: 'hoodie', listings: 1 },
      { tag: 'hundemama', listings: 1 },
      { tag: 'sweatshirt', listings: 1 },
    ]);
    expect(s.medianFavorers).toBe(52.5);
    expect(s.listings.map((l) => [l.url, l.favorers])).toEqual([
      ['https://www.etsy.com/listing/1004/hundemama-shirt', 300],
      ['https://www.etsy.com/listing/1001/dog-mom-shirt', 120],
      ['https://www.etsy.com/listing/1006/dog-mom-hoodie', 60],
      ['https://www.etsy.com/listing/1002/dog-mama-sweatshirt', 45],
      ['https://www.etsy.com/listing/1003/dog-mom-tee', 10],
      ['https://www.etsy.com/listing/1005/dog-mum-t-shirt', 7],
    ]);
    expect(s.listings[0]).toMatchObject({ price: 22, currency: 'EUR', title: 'Hundemama Shirt' });
  });

  it('is empty without listings', () => {
    expect(summarize([], 0)).toEqual({ total: 0, sampled: 0, priceBands: [], topTags: [], medianFavorers: null, listings: [] });
  });
});

describe('etsy client', () => {
  it('searches active listings by keyword, 100 a page, with keystring:secret in x-api-key', async () => {
    const h = harness([ok]);
    const r = await h.client.search('Dog Mom Shirt');
    const url = new URL(h.calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://openapi.etsy.com/v3/application/listings/active');
    expect(Object.fromEntries(url.searchParams)).toEqual({ keywords: 'dog mom shirt', limit: '100', offset: '0', sort_on: 'score' });
    expect(h.calls[0]!.headers.get('x-api-key')).toBe('test-keystring:test-secret');
    expect(r.total).toBe(1234);
    expect(r.fetchedAt).toEqual(new Date(1_000_000));
  });

  it('spaces requests 1 s apart, also when they start together', async () => {
    const h = harness([ok, ok, ok]);
    await Promise.all([h.client.search('a'), h.client.search('b'), h.client.search('c')]);
    expect(h.calls.map((c) => c.at - h.calls[0]!.at)).toEqual([0, 1000, 2000]);
  });

  it('caches a keyword for at most 6 hours', async () => {
    const h = harness([ok, ok]);
    await h.client.search('dog mom');
    await h.client.search('  DOG MOM ');
    expect(h.calls).toHaveLength(1);
    h.advance(CACHE_MS);
    await h.client.search('dog mom');
    expect(h.calls).toHaveLength(2);
    expect(CACHE_MS).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
  });

  it('retries once after Retry-After on 429', async () => {
    const h = harness([() => tooMany('3'), ok]);
    const r = await h.client.search('dog mom');
    expect(r.sampled).toBe(6);
    expect(h.calls[1]!.at - h.calls[0]!.at).toBeGreaterThanOrEqual(3000);
  });

  it('is unavailable after a second 429 or a long Retry-After, and does not cache the failure', async () => {
    const h = harness([() => tooMany('1'), () => tooMany('1'), () => tooMany('3600'), ok]);
    await expect(h.client.search('dog mom')).rejects.toBeInstanceOf(EtsyUnavailable);
    await expect(h.client.search('dog mom')).rejects.toThrow('HTTP 429');
    expect(h.calls).toHaveLength(3);
    expect((await h.client.search('dog mom')).sampled).toBe(6);
  });

  it('never puts the key in an error', async () => {
    const h = harness([() => new Response('forbidden', { status: 403 })]);
    const err = await h.client.search('dog mom').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EtsyUnavailable);
    expect(String(err)).toContain('HTTP 403');
    expect(String(err)).not.toMatch(/test-keystring|test-secret/);
  });
});
