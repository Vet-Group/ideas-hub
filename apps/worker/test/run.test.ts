import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCrawl } from '../src/run';
import { THUMB_KEY } from '../src/thumbnails';
import { type Harness, type Script, all, fakeSite, harness, images, insertRun, one, runDeps, seedKeywords, setSettings } from './helpers';

const HOUR = 3_600_000;
const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe.skipIf(!testDatabaseAvailable())('crawl run', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await seedKeywords(h, 3);
  }, 60_000);
  afterAll(() => h?.close());
  beforeEach(async () => {
    await h.db.execute(sql`truncate crawl_runs, ads, shops, keyword_days, shop_days, alerts cascade`);
    await h.db.execute(sql`update crawler_state set blocked_until = null, rotation_cursor = null, heartbeat_at = null`);
    await h.db.execute(sql`update keywords set active = true`);
    await h.db.execute(sql`delete from settings where key in ('countries', 'searchBudget', 'runTimes')`);
    await setSettings(h, { countries: ['US', 'GB'] });
  });

  const scheduled = (over: Parameters<typeof insertRun>[1] = { deadline: new Date(h.clock.t + 4 * HOUR) }) => insertRun(h, { ...over, scheduledFor: h.clock.now() });
  const run = (runId: string, script: (q: string, c: string, a: number) => Script, over = {}) => {
    const site = fakeSite(script);
    return { site, outcome: runCrawl(h, runId, runDeps(h, site, over)) };
  };
  const searches = (runId: string) => all<{ status: string; keyword_id: string; country: string; ads_found: number; stop_reason: string | null }>(h, sql`select status, keyword_id, country, ads_found, stop_reason from crawl_searches where run_id = ${runId} order by started_at nulls last, id`);
  const runRow = (runId: string) => one<Record<string, unknown>>(h, sql`select * from crawl_runs where id = ${runId}`);
  const alertsOf = (runId: string) => all<{ kind: string; cooldown_seq: number | null }>(h, sql`select kind, cooldown_seq from alerts where run_id = ${runId} order by created_at, cooldown_seq`);

  it('stores ads, sightings, thumbnails and a run whose search rows add up to the planned total', async () => {
    const id = await scheduled();
    const { outcome } = run(id, (q, c) => ({ kind: 'ok', ids: ids(`${q}${c}-`, 5) }));
    expect(await outcome).toBe('done');
    const r = await runRow(id);
    expect(r).toMatchObject({ status: 'done', planned_searches: 6, ok_searches: 6, running_ads: 30 });
    const s = await searches(id);
    expect(s).toHaveLength(6);
    expect(s.every((x) => x.status === 'ok' && x.stop_reason === 'end_of_results')).toBe(true);
    expect(await one(h, sql`select count(*)::int as n from ads`)).toEqual({ n: 30 });
    expect(await one(h, sql`select count(*)::int as n from ad_sightings where run_id = ${id}`)).toEqual({ n: 30 });
    expect(await one(h, sql`select count(*)::int as n from ads where thumbnail_key is not null`)).toEqual({ n: 30 });
    expect([...h.objects.keys()].every((k) => k.startsWith('thumbs/') && THUMB_KEY.test(k.slice(7)))).toBe(true);
  });

  it('writes keyword_days and shop_days for a scheduled run, none for a manual or cli run', async () => {
    const id = await scheduled();
    await run(id, (q, c) => ({ kind: 'ok', ids: ids(`${q}${c}-`, 2) })).outcome;
    expect(await one(h, sql`select count(*)::int as n, sum(running_ads)::int as ads from keyword_days`)).toEqual({ n: 3, ads: 12 });
    expect(await one(h, sql`select count(*)::int as n from shop_days`)).toEqual({ n: 12 });
    const m = await insertRun(h, { trigger: 'cli', deadline: new Date(h.clock.t + HOUR), pairs: [{ keywordId: 'kw_0', country: 'US' }] });
    await h.db.execute(sql`truncate keyword_days, shop_days`);
    await run(m, () => ({ kind: 'ok', ids: ['m1'] })).outcome;
    expect(await one(h, sql`select count(*)::int as n from keyword_days`)).toEqual({ n: 0 });
    expect(await one(h, sql`select running_ads, ok_searches from crawl_runs where id = ${m}`)).toEqual({ running_ads: 13, ok_searches: 1 });
  });

  it('running_ads counts overlapping ads once and includes running ads outside the run', async () => {
    // An old running ad of another keyword, seen today.
    await h.db.execute(sql`insert into ads (ad_archive_id, first_seen_date, last_seen_date, parsed) values ('other', '2026-10-20', '2026-10-20', '{}')`);
    // A stale ad that an end-of-results search proved stopped.
    const id = await scheduled();
    await run(id, () => ({ kind: 'ok', ids: ['a', 'b', 'c'] })).outcome;
    expect((await runRow(id)).running_ads).toBe(4);
  });

  it('a block mid-scroll leaves one blocked search with its ads, an Alert, a backoff, then the next search', async () => {
    const id = await scheduled();
    const t0 = h.clock.t;
    const { outcome } = run(id, (q, c) => (q === 'k0' && c === 'US' ? { kind: 'empty_scrolls', ids: ids('b', 30) } : { kind: 'ok', ids: ids(`${q}${c}`, 1) }));
    expect(await outcome).toBe('done');
    const s = await searches(id);
    expect(s[0]).toMatchObject({ status: 'blocked', ads_found: 30 });
    expect(s.slice(1).every((x) => x.status === 'ok')).toBe(true);
    expect(await alertsOf(id)).toEqual([{ kind: 'blocked', cooldown_seq: null }]);
    expect(await one(h, sql`select count(*)::int as n from ad_sightings where run_id = ${id} and keyword_id = 'kw_0' and country = 'US'`)).toEqual({ n: 30 });
    // 45 s backoff on top of the gaps
    expect(h.clock.t - t0).toBeGreaterThan(45_000);
  });

  it('a block streak of 3 stops the run: stopped, the rest skipped, the 6 h cool-down and a blocked Alert', async () => {
    const id = await scheduled();
    expect(await run(id, () => ({ kind: 'empty_embedded' })).outcome).toBe('stopped');
    const s = await searches(id);
    expect(s.map((x) => x.status)).toEqual(['blocked', 'blocked', 'blocked', 'skipped', 'skipped', 'skipped']);
    const r = await runRow(id);
    expect(r.block_reason).toBe('block_streak');
    const { blocked_until } = await one<{ blocked_until: Date }>(h, sql`select blocked_until from crawler_state`);
    expect(new Date(blocked_until).getTime()).toBe(new Date(r.blocked_until as Date).getTime());
    expect(new Date(blocked_until).getTime() - h.clock.t).toBeGreaterThan(5.9 * HOUR);
    expect(await alertsOf(id)).toEqual([{ kind: 'blocked', cooldown_seq: null }]);
  });

  it('a captcha or a login wall stops the run the same way', async () => {
    for (const kind of ['captcha', 'login_wall'] as const) {
      await h.db.execute(sql`update crawler_state set blocked_until = null`);
      h.clock.advance(1000);
      const id = await scheduled();
      expect(await run(id, () => ({ kind })).outcome).toBe('stopped');
      expect((await searches(id)).map((x) => x.status)).toEqual(['blocked', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
      expect((await runRow(id)).block_reason).toBe('captcha');
    }
  });

  it('blocked, no_results, blocked, blocked stops the run (neutral searches do not reset the streak)', async () => {
    await setSettings(h, { countries: ['US', 'GB', 'CA', 'AU'] });
    const id = await scheduled();
    const order = ['blocked', 'no_results', 'blocked', 'blocked'];
    let n = 0;
    await run(id, () => ({ kind: order[n++] === 'blocked' ? 'empty_embedded' : 'no_results' })).outcome;
    expect((await searches(id)).slice(0, 5).map((x) => x.status)).toEqual(['blocked', 'no_results', 'blocked', 'blocked', 'skipped']);
  });

  it('6 blocked searches in a run stop it even with ok searches between', async () => {
    await setSettings(h, { countries: ['US', 'GB', 'CA', 'AU'] });
    const id = await scheduled();
    let n = 0;
    await run(id, () => ({ ...(n++ % 2 === 0 ? { kind: 'empty_embedded' } : { kind: 'ok', ids: [`x${n}`] }) }) as Script).outcome;
    const s = await searches(id);
    expect(s.filter((x) => x.status === 'blocked')).toHaveLength(6);
    expect((await runRow(id)).block_reason).toBe('blocked_searches');
  });

  it('six 2-page stops in a run do not stop it; each stays ok and is counted', async () => {
    const id = await scheduled();
    expect(await run(id, (q, c) => ({ kind: 'two_page', ids: ids(`${q}${c}`, 30) })).outcome).toBe('done');
    expect((await searches(id)).every((x) => x.status === 'ok' && x.stop_reason === 'no_new_ads')).toBe(true);
    expect((await runRow(id)).two_page_stops_with_next).toBe(6);
  });

  it('a network streak of 3 gives one network cool-down and Alert; two cool-downs give two', async () => {
    await setSettings(h, { countries: ['US', 'GB', 'CA', 'AU'] });
    const id = await scheduled();
    const t0 = h.clock.t;
    const { outcome } = run(id, () => ({ kind: 'timeout' }));
    expect(await outcome).toBe('done');
    const r = await runRow(id);
    expect(r.network_cooldowns).toBe(4);
    expect((await alertsOf(id)).map((a) => [a.kind, a.cooldown_seq])).toEqual([
      ['network_error', 1],
      ['network_error', 2],
      ['network_error', 3],
      ['network_error', 4],
    ]);
    expect((await searches(id)).every((x) => x.status === 'network_error')).toBe(true);
    expect(r.transient_retries).toBe(24);
    expect(r.browser_restarts).toBe(24);
    expect(r.wait_limit_hits).toEqual({ pageLoad: 36 });
    // No 6 h cool-down.
    expect(await one(h, sql`select blocked_until from crawler_state`)).toEqual({ blocked_until: null });
    expect(h.clock.t - t0).toBeGreaterThan(4 * 10 * 60_000);
  });

  it('6 network_error searches spread over a run do not stop it', async () => {
    await setSettings(h, { countries: ['US', 'GB', 'CA', 'AU'] });
    const id = await scheduled();
    let n = 0;
    await run(id, (q, c, a) => {
      if (a === 1) n += 1;
      return n % 2 === 1 ? { kind: 'timeout' } : { kind: 'ok', ids: [`${q}${c}`] };
    }).outcome;
    const s = await searches(id);
    expect(s.filter((x) => x.status === 'network_error')).toHaveLength(6);
    expect((await runRow(id)).network_cooldowns).toBe(0);
  });

  it('a failure after the cool-down counter update leaves neither the increment nor the Alert', async () => {
    await h.db.execute(sql`create function fail_network_alert() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$`);
    await h.db.execute(sql`create trigger fail_network_alert before insert on alerts for each row when (new.kind = 'network_error') execute function fail_network_alert()`);
    try {
      const id = await scheduled();
      await run(id, () => ({ kind: 'timeout' })).outcome;
      const r = await runRow(id);
      expect(r.network_cooldowns).toBe(0);
      expect((await alertsOf(id)).map((a) => a.kind)).toEqual(['run_failed']);
      expect(r.status).toBe('stopped');
    } finally {
      await h.db.execute(sql`drop trigger fail_network_alert on alerts`);
      await h.db.execute(sql`drop function fail_network_alert()`);
    }
  });

  it('a parse error writes a parse_error Alert, has no retry and the run goes on', async () => {
    const id = await scheduled();
    let first = true;
    const { site, outcome } = run(id, (q, c) => {
      const kind = first ? 'parse' : 'ok';
      first = false;
      return kind === 'parse' ? { kind: 'parse' } : { kind: 'ok', ids: [`${q}${c}`] };
    });
    expect(await outcome).toBe('done');
    expect((await searches(id)).map((x) => x.status)).toEqual(['parse_error', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(await alertsOf(id)).toEqual([{ kind: 'parse_error', cooldown_seq: null }]);
    expect(site.calls).toHaveLength(6);
  });

  it('a browser that does not start when the run starts stops it with run_failed', async () => {
    const id = await scheduled();
    expect(await run(id, () => ({ kind: 'ok', ids: ['a'] }), { startFails: true }).outcome).toBe('stopped');
    expect(await alertsOf(id)).toEqual([{ kind: 'run_failed', cooldown_seq: null }]);
    expect((await searches(id)).every((x) => x.status === 'skipped')).toBe(true);
  });

  it('a database error outside the search loop stops the run with run_failed, and writes no snapshot', async () => {
    const id = await scheduled();
    await h.db.execute(sql`create function fail_kd() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$`);
    await h.db.execute(sql`create trigger fail_kd before insert on keyword_days for each row execute function fail_kd()`);
    try {
      expect(await run(id, () => ({ kind: 'ok', ids: ['a'] })).outcome).toBe('stopped');
      expect(await alertsOf(id)).toEqual([{ kind: 'run_failed', cooldown_seq: null }]);
      expect(await one(h, sql`select count(*)::int as n from shop_days`)).toEqual({ n: 0 });
    } finally {
      await h.db.execute(sql`drop trigger fail_kd on keyword_days`);
      await h.db.execute(sql`drop function fail_kd()`);
    }
  });

  it('a run that reaches its deadline is done, the search in progress interrupted and the rest skipped', async () => {
    const id = await scheduled({ deadline: new Date(h.clock.t + 150_000) });
    expect(await run(id, (q, c) => ({ kind: 'ok', ids: [`${q}${c}`] })).outcome).toBe('done');
    const s = (await searches(id)).map((x) => x.status);
    expect(s.filter((x) => x === 'ok').length).toBeGreaterThan(0);
    expect(s.filter((x) => x === 'skipped').length).toBeGreaterThan(0);
    expect((await runRow(id)).status).toBe('done');
  });

  it('a deadline mid-scroll leaves one interrupted search that keeps its ads', async () => {
    const id = await scheduled({ deadline: new Date(h.clock.t + 1500) });
    const pages = [ids('p', 10), ids('q', 10)];
    await run(id, () => ({ kind: 'ok', ids: ids('e', 30), pages })).outcome;
    const s = await searches(id);
    // 30 embedded ads and the first scroll page, read before the deadline came.
    expect(s[0]).toMatchObject({ status: 'interrupted', ads_found: 40 });
    expect(s.slice(1).every((x) => x.status === 'skipped')).toBe(true);
  });

  it('counts a final browser close over its limit on the run', async () => {
    const id = await scheduled();
    const site = fakeSite((q, c) => ({ kind: 'ok', ids: ids(`${q}${c}-`, 2) }));
    const deps = runDeps(h, site, {
      createSession: (_s, onCloseTimeout) => ({ ...site.session(), close: async () => onCloseTimeout() }),
    });
    expect(await runCrawl(h, id, deps)).toBe('done');
    expect((await runRow(id)).wait_limit_hits).toEqual({ browserClose: 1 });
  });

  it('a late finish after a watchdog close writes no snapshot, Alert or blocked_until, and the run is dropped', async () => {
    const id = await scheduled();
    // A block found after the close: its Alert and cool-down must not be written.
    const site = fakeSite(() => ({ kind: 'empty_scrolls', ids: ['a'] }));
    let closed = false;
    const outcome = await runCrawl(h, id, runDeps(h, site, {
      // The watchdog closes the run while the worker waits inside its first search.
      sleep: async (ms) => {
        h.clock.advance(ms);
        if (!closed) await h.db.execute(sql`update crawl_runs set status = 'stopped' where id = ${id}`);
        closed = true;
      },
    }));
    expect(outcome).toBe('dropped');
    expect(await one(h, sql`select count(*)::int as n from keyword_days`)).toEqual({ n: 0 });
    expect(await alertsOf(id)).toEqual([]);
    expect(await one(h, sql`select blocked_until from crawler_state`)).toEqual({ blocked_until: null });
    expect(await one(h, sql`select count(*)::int as n from ad_sightings where run_id = ${id}`)).toEqual({ n: 0 });
  });

  it('a run whose settings changed after its row was written recomputes planned_searches at start', async () => {
    const id = await scheduled({ deadline: new Date(h.clock.t + 4 * HOUR), planned: 160 });
    await setSettings(h, { searchBudget: 4 });
    await run(id, (q, c) => ({ kind: 'ok', ids: [`${q}${c}`] })).outcome;
    expect((await runRow(id)).planned_searches).toBe(4);
    expect(await searches(id)).toHaveLength(4);
  });

  it('budget rotation: the next scheduled run starts where the last one stopped', async () => {
    await setSettings(h, { searchBudget: 4 });
    const a = await scheduled();
    await run(a, (q, c) => ({ kind: 'ok', ids: [`${q}${c}`] })).outcome;
    const b = await insertRun(h, { scheduledFor: new Date(h.clock.t + HOUR), deadline: new Date(h.clock.t + 4 * HOUR) });
    await run(b, (q, c) => ({ kind: 'ok', ids: [`${q}${c}`] })).outcome;
    const pairs = (await searches(b)).map((x) => `${x.keyword_id}/${x.country}`);
    expect(pairs).toEqual(['kw_2/US', 'kw_2/GB', 'kw_0/US', 'kw_0/GB']);
  });

  it('a cli run for 2 keywords × 2 countries with one keyword deactivated plans 2 searches', async () => {
    const pairs = ['kw_0', 'kw_1'].flatMap((keywordId) => ['US', 'GB'].map((country) => ({ keywordId, country })));
    const id = await insertRun(h, { trigger: 'cli', deadline: new Date(h.clock.t + HOUR), pairs, planned: 4 });
    await h.db.execute(sql`update keywords set active = false where id = 'kw_1'`);
    await run(id, (q, c) => ({ kind: 'ok', ids: [`${q}${c}`] })).outcome;
    expect((await runRow(id)).planned_searches).toBe(2);
    expect((await searches(id)).map((x) => x.keyword_id)).toEqual(['kw_0', 'kw_0']);
  });

  it('a late job of a missed row, of a blocked slot, and a manual job after its deadline are no-ops', async () => {
    const missed = await scheduled({ deadline: new Date(h.clock.t + HOUR), status: 'missed' });
    expect(await run(missed, () => ({ kind: 'ok', ids: ['a'] })).outcome).toBe('noop');
    expect(await searches(missed)).toEqual([]);

    await h.db.execute(sql`update crawler_state set blocked_until = ${new Date(h.clock.t + HOUR)}`);
    const blocked = await insertRun(h, { scheduledFor: new Date(h.clock.t - 1), deadline: new Date(h.clock.t + HOUR) });
    expect(await run(blocked, () => ({ kind: 'ok', ids: ['a'] })).outcome).toBe('noop');
    expect((await runRow(blocked)).status).toBe('scheduled');
    expect(await searches(blocked)).toEqual([]);
    await h.db.execute(sql`update crawler_state set blocked_until = null`);

    const manual = await insertRun(h, { trigger: 'manual', deadline: new Date(h.clock.t - 1), pairs: [{ keywordId: 'kw_0', country: 'US' }] });
    expect(await run(manual, () => ({ kind: 'ok', ids: ['a'] })).outcome).toBe('noop');
    expect(await runRow(manual)).toMatchObject({ status: 'stopped', close_reason: 'not_started' });
    expect(await searches(manual)).toEqual([]);
  });

  it('a manual row whose start is a no-op because of blocked_until ends stopped not_started', async () => {
    await h.db.execute(sql`update crawler_state set blocked_until = ${new Date(h.clock.t + HOUR)}`);
    const id = await insertRun(h, { trigger: 'manual', deadline: new Date(h.clock.t + HOUR), pairs: [{ keywordId: 'kw_0', country: 'US' }] });
    expect(await run(id, () => ({ kind: 'ok', ids: ['a'] })).outcome).toBe('noop');
    expect(await runRow(id)).toMatchObject({ status: 'stopped', close_reason: 'not_started' });
  });

  it('a run starts normally when blocked_until is NULL or in the past', async () => {
    await h.db.execute(sql`update crawler_state set blocked_until = ${new Date(h.clock.t - 1)}`);
    expect(await run(await scheduled(), () => ({ kind: 'no_results' })).outcome).toBe('done');
  });

  it('writes the heartbeat at every step and at least once a minute during pauses', async () => {
    const beats: number[] = [];
    await h.db.execute(sql`create table beats (at timestamptz)`);
    await h.db.execute(sql`create function log_beat() returns trigger language plpgsql as $$ begin insert into beats values (new.heartbeat_at); return new; end $$`);
    await h.db.execute(sql`create trigger log_beat after update of heartbeat_at on crawler_state for each row execute function log_beat()`);
    try {
      const id = await scheduled();
      // A block gives a 45 s backoff; a network streak a 10 min cool-down.
      let n = 0;
      await run(id, () => (n++ < 3 ? { kind: 'timeout' } : { kind: 'ok', ids: ['a'] })).outcome;
      const rows = await all<{ at: Date }>(h, sql`select at from beats order by at`);
      for (const r of rows) beats.push(new Date(r.at).getTime());
      const gaps = beats.slice(1).map((b, i) => b - beats[i]!);
      expect(beats.length).toBeGreaterThan(20);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(60_000);
    } finally {
      await h.db.execute(sql`drop trigger log_beat on crawler_state`);
      await h.db.execute(sql`drop function log_beat()`);
      await h.db.execute(sql`drop table beats`);
    }
  });
});

describe.skipIf(!testDatabaseAvailable())('thumbnails in a run', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await seedKeywords(h, 1);
    await setSettings(h, { countries: ['US'] });
  }, 60_000);
  afterAll(() => h?.close());

  it('stores every key in the /thumbs pattern, a PNG and WebP bytes behind a .jpg URL included', async () => {
    const img = await images();
    const bodies: Record<string, Buffer> = { a: img.jpg, b: img.png, c: img.webp };
    const site = fakeSite(() => ({ kind: 'ok', ids: ['a', 'b', 'c'] }));
    const id = await insertRun(h, { scheduledFor: h.clock.now(), deadline: new Date(h.clock.t + HOUR) });
    const fetchImg = (async (url: string) => new Response(new Uint8Array(bodies[url.match(/\/(\w)\.jpg$/)![1]!]!))) as unknown as typeof fetch;
    await runCrawl(h, id, runDeps(h, site, { fetch: fetchImg }));
    const keys = await all<{ ad_archive_id: string; thumbnail_key: string }>(h, sql`select ad_archive_id, thumbnail_key from ads order by 1`);
    expect(keys).toEqual([
      { ad_archive_id: 'a', thumbnail_key: 'a_image.jpg' },
      { ad_archive_id: 'b', thumbnail_key: 'b_image.webp' },
      { ad_archive_id: 'c', thumbnail_key: 'c_image.webp' },
    ]);
    expect(h.objects.get('thumbs/b_image.webp')?.contentType).toBe('image/webp');
    expect(h.objects.get('thumbs/b_image.webp')?.body.subarray(8, 12).toString()).toBe('WEBP');
  });

  it('a download over its limit leaves the thumbnail missing, downloaded again at the next sighting', async () => {
    await h.db.execute(sql`truncate crawl_runs, ads cascade`);
    const site = fakeSite(() => ({ kind: 'ok', ids: ['slow'] }));
    const hang = (async (_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))))) as unknown as typeof fetch;
    await setSettings(h, { waitLimitsSeconds: { browserStart: 60, pageLoad: 60, embeddedData: 15, scrollResponse: 15, thumbnailDownload: 0.05, browserClose: 15 } });
    const a = await insertRun(h, { scheduledFor: h.clock.now(), deadline: new Date(h.clock.t + HOUR) });
    await runCrawl(h, a, runDeps(h, site, { fetch: hang }));
    expect(await one(h, sql`select thumbnail_key from ads where ad_archive_id = 'slow'`)).toEqual({ thumbnail_key: null });
    expect((await one<{ wait_limit_hits: object }>(h, sql`select wait_limit_hits from crawl_runs where id = ${a}`)).wait_limit_hits).toEqual({ thumbnailDownload: 1 });
    const b = await insertRun(h, { scheduledFor: new Date(h.clock.t + 1000), deadline: new Date(h.clock.t + HOUR) });
    await runCrawl(h, b, runDeps(h, site));
    expect(await one(h, sql`select thumbnail_key from ads where ad_archive_id = 'slow'`)).toEqual({ thumbnail_key: 'slow_image.jpg' });
  });
});
