import { DEFAULT_SETTINGS, type Settings } from '@ideas-hub/core';
import { describe, expect, it } from 'vitest';
import { type BrowserSession, type SearchDeps, type SearchPage, TransientError, runSearch } from '../src';

// Payload builders: an embedded document and scroll pages with the given ad ids.
const ad = (id: string) => ({ ad_archive_id: id, snapshot: {} });
const conn = (ids: string[], hasNext: boolean, count?: number) => ({
  search_results_connection: { ...(count === undefined ? {} : { count }), edges: [{ node: { collated_results: ids.map(ad) } }], page_info: { has_next_page: hasNext } },
});
const embedded = (ids: string[], hasNext: boolean, count = 50001) =>
  JSON.stringify({ data: { ad_library_main: conn(ids, hasNext, count), xfb_ad_library_is_captcha_required: false } });
const page = (ids: string[], hasNext = true) => `for (;;);${JSON.stringify({ data: { ad_library_main: conn(ids, hasNext) } })}`;
const empty = () => JSON.stringify({ data: { ad_library_main: { search_results_connection: { edges: [], page_info: { has_next_page: true } } } } });
const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

type Step = string[] | null | Error;

/** A page whose embedded data and scroll responses follow a script, one script per attempt. */
function fakeSession(attempts: { open?: Error; embedded?: string | null; wall?: boolean; scrolls?: Step[] }[]) {
  let n = -1;
  let restarts = 0;
  const pageFor = (i: number): SearchPage => {
    const a = attempts[Math.min(i, attempts.length - 1)]!;
    const scrolls = [...(a.scrolls ?? [])];
    return {
      async open() {
        if (a.open) throw a.open;
      },
      async embeddedData() {
        return a.embedded === undefined ? embedded(range('e', 30), true) : a.embedded;
      },
      async loginWall() {
        return a.wall ?? false;
      },
      async scroll() {
        const s = scrolls.shift();
        if (s instanceof Error) throw s;
        return s === undefined ? [page(range('z', 10), false)] : s;
      },
    };
  };
  const session: BrowserSession = {
    async page() {
      n += 1;
      return pageFor(n);
    },
    async restart() {
      restarts += 1;
    },
  };
  return { session, restarts: () => restarts };
}

function deps(session: BrowserSession, over: Partial<SearchDeps> = {}) {
  const sleeps: number[] = [];
  let beats = 0;
  const d: SearchDeps = {
    settings: DEFAULT_SETTINGS as unknown as Settings,
    session,
    pageDelayMs: () => 500,
    scrollDelayMs: () => 1000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    beat: () => {
      beats += 1;
    },
    deadlinePassed: () => false,
    ...over,
  };
  return { d, sleeps, beats: () => beats };
}

describe('runSearch pagination', () => {
  it('reads embedded ads then scroll pages until the end of results', async () => {
    const { session } = fakeSession([{ scrolls: [[page(range('a', 10))], [page(range('b', 10), false)]] }]);
    const r = await runSearch('dog mom shirt', 'US', deps(session).d);
    expect(r).toMatchObject({ status: 'ok', signal: 'ok', embeddedCount: 30, embeddedHasNext: true, totalCount: 50001, pagesRead: 2, lastHasNext: false, stopReason: 'end_of_results', attempts: 1 });
    expect(r.ads).toHaveLength(50);
  });

  it('keeps scrolling past a page with some repeated ads until 100 unique', async () => {
    const scrolls: Step[] = [[page([...range('e', 5), ...range('a', 5)])], ...[1, 2, 3, 4, 5, 6, 7].map((i) => [page(range(`p${i}-`, 10))])];
    const { session } = fakeSession([{ scrolls }]);
    const r = await runSearch('q', 'US', deps(session).d);
    expect(r.ads).toHaveLength(100);
    expect(new Set(r.ads.map((a) => a.ad_archive_id)).size).toBe(100);
    expect(r).toMatchObject({ status: 'ok', stopReason: 'cap', lastHasNext: true });
  });

  it('stops after 2 non-empty scroll pages with no new ad, as ok and neutral', async () => {
    const { session } = fakeSession([{ scrolls: [[page(range('e', 10))], [page(range('e', 10))]] }]);
    const r = await runSearch('q', 'US', deps(session).d);
    expect(r).toMatchObject({ status: 'ok', stopReason: 'no_new_ads', lastHasNext: true, signal: 'neutral', pagesRead: 2 });
  });

  it('repeat, empty, repeat stops with no_new_ads (an empty page neither counts nor resets the rule)', async () => {
    const { session } = fakeSession([{ scrolls: [[page(range('e', 10))], [empty()], [page(range('e', 5))]] }]);
    const r = await runSearch('q', 'US', deps(session).d);
    expect(r).toMatchObject({ status: 'ok', stopReason: 'no_new_ads', pagesRead: 3 });
  });

  it('2 empty scroll payloads keep it scrolling; a third makes it blocked with its ads kept', async () => {
    const { session } = fakeSession([{ scrolls: [[empty()], [empty()], [page(range('a', 10), false)]] }]);
    expect((await runSearch('q', 'US', deps(session).d)).status).toBe('ok');
    const blocked = fakeSession([{ scrolls: [[page(range('a', 10))], [empty()], [empty()], [empty()]] }]);
    const r = await runSearch('q', 'US', deps(blocked.session).d);
    expect(r).toMatchObject({ status: 'blocked', signal: 'blocked', reason: 'empty_payloads' });
    expect(r.ads).toHaveLength(40);
  });

  it('an empty body or a payload of errors counts as empty; 3 in a row are blocked', async () => {
    const errors = JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] });
    const { session } = fakeSession([{ scrolls: [[page(range('a', 10))], [''], [errors], ['  ']] }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'blocked', reason: 'empty_payloads' });
  });

  it('an unreadable scroll payload is a parse_error, not an empty payload', async () => {
    const { session } = fakeSession([{ scrolls: [[page(range('a', 10))], ['<html>not json']] }]);
    const r = await runSearch('q', 'US', deps(session).d);
    expect(r).toMatchObject({ status: 'parse_error', signal: 'neutral', attempts: 1 });
    const noConn = fakeSession([{ scrolls: [[JSON.stringify({ data: { something_else: {} } })]] }]);
    expect((await runSearch('q', 'US', deps(noConn.session).d)).status).toBe('parse_error');
  });

  it('a captcha flag in a scroll payload stops the search as captcha', async () => {
    const captcha = JSON.stringify({ data: { ad_library_main: conn(range('a', 10), true), xfb_ad_library_is_captcha_required: true } });
    const { session } = fakeSession([{ scrolls: [[captcha]] }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'blocked', signal: 'captcha', reason: 'captcha' });
  });

  it('reaching the cap inside one scroll stops as cap even when later bodies bring nothing new', async () => {
    const scrolls: Step[] = [[page(range('a', 40)), page(range('b', 40)), page(range('c', 10)), page(range('d', 10))]];
    const { session } = fakeSession([{ scrolls }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'ok', stopReason: 'cap', signal: 'ok' });
  });

  it('a failing heartbeat write is not a search error: it propagates', async () => {
    const { session } = fakeSession([{}]);
    const dbDown = new Error('Connection terminated unexpectedly');
    await expect(runSearch('q', 'US', deps(session, { beat: () => Promise.reject(dbDown) }).d)).rejects.toBe(dbDown);
  });

  it('waits the page delay after load and a scroll delay before each scroll', async () => {
    const { session } = fakeSession([{ scrolls: [[page(range('a', 10), false)]] }]);
    const { d, sleeps } = deps(session);
    await runSearch('q', 'US', d);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('writes the heartbeat at every step', async () => {
    const { session } = fakeSession([{ scrolls: [[page(range('a', 10))], [page(range('b', 10), false)]] }]);
    const { d, beats } = deps(session);
    await runSearch('q', 'US', d);
    // attempt start, page load, two scrolls
    expect(beats()).toBe(4);
  });
});

describe('runSearch detection', () => {
  it('no results is no_results with a neutral signal', async () => {
    const { session } = fakeSession([{ embedded: embedded([], false, 0) }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'no_results', signal: 'neutral', lastHasNext: false, embeddedHasNext: false });
  });

  it('empty embedded data without the marker is blocked', async () => {
    const { session } = fakeSession([{ embedded: embedded([], true, 50001) }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'blocked', signal: 'blocked', reason: 'empty_embedded' });
  });

  it('a login wall is blocked with the captcha signal', async () => {
    const { session } = fakeSession([{ wall: true }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'blocked', signal: 'captcha', reason: 'login_wall' });
  });

  it('a captcha flag is blocked with the captcha signal', async () => {
    const { session } = fakeSession([{ embedded: embedded(range('e', 30), true).replace('"xfb_ad_library_is_captcha_required":false', '"xfb_ad_library_is_captcha_required":true') }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'blocked', signal: 'captcha', reason: 'captcha' });
  });

  it('an unparseable embedded payload is parse_error, neutral, without a retry', async () => {
    const { session, restarts } = fakeSession([{ embedded: '<html>' }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'parse_error', signal: 'neutral', attempts: 1 });
    expect(restarts()).toBe(0);
  });

  it('a permanent error tied to the page is parse_error', async () => {
    const { session } = fakeSession([{ open: new Error('page.goto: Protocol error: unknown') }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'parse_error', signal: 'neutral', attempts: 1 });
  });
});

describe('runSearch retries', () => {
  it('a first attempt that times out and a second that succeeds is ok with one retry and one restart', async () => {
    const { session, restarts } = fakeSession([{ open: new TransientError('pageLoad', 'Timeout 60000ms exceeded') }, {}]);
    const { d, sleeps } = deps(session);
    const r = await runSearch('q', 'US', d);
    expect(r).toMatchObject({ status: 'ok', attempts: 2, retries: 1, browserRestarts: 1, waitLimitHits: { pageLoad: 1 } });
    expect(restarts()).toBe(1);
    expect(sleeps[0]).toBe(5000);
  });

  it('3 failed attempts give network_error with the network signal, after 5 s and 15 s', async () => {
    const t = () => ({ open: new Error('page.goto: net::ERR_CONNECTION_RESET') });
    const { session, restarts } = fakeSession([t(), t(), t()]);
    const { d, sleeps } = deps(session);
    const r = await runSearch('q', 'US', d);
    expect(r).toMatchObject({ status: 'network_error', signal: 'network', attempts: 3, retries: 2, browserRestarts: 2 });
    expect(sleeps).toEqual([5000, 15000]);
    expect(restarts()).toBe(2);
  });

  it('embedded data that never arrives is a transient error of the attempt', async () => {
    const { session } = fakeSession([{ embedded: null }, {}]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'ok', attempts: 2, waitLimitHits: { embeddedData: 1 } });
  });

  it('a scroll response that never arrives is a transient error, counted per wait', async () => {
    const { session } = fakeSession([{ scrolls: [null] }, { scrolls: [null] }, { scrolls: [null] }]);
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'network_error', waitLimitHits: { scrollResponse: 3 } });
  });

  it('a browser that does not restart in time is a transient error of that attempt', async () => {
    const { session } = fakeSession([{ open: new TransientError('pageLoad', 'slow') }, {}]);
    session.restart = async () => {
      throw new TransientError('browserStart', 'Timeout 60000ms exceeded');
    };
    expect(await runSearch('q', 'US', deps(session).d)).toMatchObject({ status: 'network_error', waitLimitHits: { pageLoad: 1, browserStart: 2 } });
  });
});

describe('runSearch deadline', () => {
  it('a deadline mid-scroll leaves the search interrupted with its ads', async () => {
    const { session } = fakeSession([{ scrolls: [[page(range('a', 10))], [page(range('b', 10))]] }]);
    let scrolls = 0;
    const r = await runSearch('q', 'US', deps(session, { deadlinePassed: () => scrolls++ >= 1 }).d);
    expect(r.status).toBe('interrupted');
    expect(r.ads).toHaveLength(40);
  });
});
