import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roQuery } from '../src/ops';
import { type Harness, harness, seedKeywords } from './helpers';
import { Host, scriptPath } from './ops-host';

const checks = Object.fromEntries(
  readFileSync(new URL('../../../scripts/acceptance.sql', import.meta.url), 'utf8')
    .split(/^-- name: /m)
    .slice(1)
    .map((part) => [part.slice(0, part.indexOf('\n')).trim(), part.slice(part.indexOf('\n'))]),
);

describe.skipIf(!testDatabaseAvailable())('scripts/acceptance.sql', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await seedKeywords(h, 1);
  }, 60_000);
  afterAll(() => h?.close());
  const q = async (name: string) => (await h.pool.query(checks[name]!)).rows[0];
  const run = async (id: string, status: string, planned: number, searches: { status: string; embedded?: number; hasNext?: boolean; pages?: number; ads?: number; last?: boolean | null; stop?: string }[], ago = 1) => {
    await h.pool.query(
      `insert into crawl_runs (id, source, trigger, scheduled_for, status, planned_searches, deadline) values ($1, 'fb_ad_library', 'schedule', now() - make_interval(hours => $2), $3, $4, now())`,
      [id, ago, status, planned],
    );
    for (const [i, s] of searches.entries()) {
      await h.pool.query(
        `insert into crawl_searches (id, run_id, keyword_id, country, status, embedded_count, embedded_has_next, pages_read, ads_found, last_has_next, stop_reason)
         values ($1, $2, 'kw_0', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [`${id}_${i}`, id, `C${i}`, s.status, s.embedded ?? 30, s.hasNext ?? true, s.pages ?? 7, s.ads ?? 100, s.last === undefined ? true : s.last, s.stop ?? (s.status === 'ok' ? 'cap' : null)],
      );
    }
  };

  it('AC 1 counts missed rows and the skipped searches of a blocked slot as failed', async () => {
    await run('r_done', 'done', 4, [{ status: 'ok' }, { status: 'ok' }, { status: 'no_results', embedded: 0, hasNext: false, pages: 0, ads: 0, last: false }, { status: 'network_error' }], 2);
    await run('r_missed', 'missed', 4, [], 3);
    await run('r_blocked_slot', 'stopped', 4, [{ status: 'skipped' }, { status: 'skipped' }, { status: 'skipped' }, { status: 'skipped' }], 4);
    expect(await q('ac1_success_ratio')).toEqual({ ok_searches: 3, planned_searches: 12, success_ratio: '0.2500' });
  });

  it('AC 2 finds ok searches that stopped silently', async () => {
    await run('r_ac2', 'done', 3, [
      { status: 'ok', ads: 40, last: true, stop: 'cap' },
      { status: 'ok', ads: 40, last: true, stop: 'no_new_ads' },
      { status: 'ok', embedded: 0 },
      { status: 'ok', ads: 40, last: null, stop: 'end_of_results' },
    ], 5);
    expect(await q('ac2_violations')).toEqual({ ok_without_embedded: 1, has_next_without_page: 0, silent_stops: 2 });
  });

  it('AC 1 Alerts: blocked and parse_error runs need a sent Alert; network_error Alerts must equal network_cooldowns, all sent', async () => {
    await run('r_blocked_ok', 'stopped', 1, [{ status: 'blocked' }], 6);
    await run('r_parse_unsent', 'done', 1, [{ status: 'parse_error' }], 6);
    await run('r_net_ok', 'done', 2, [{ status: 'network_error' }, { status: 'network_error' }], 6);
    await run('r_net_unsent', 'done', 1, [{ status: 'network_error' }], 6);
    await run('r_net_missing', 'done', 1, [{ status: 'network_error' }], 6);
    await h.pool.query(`update crawl_runs set network_cooldowns = case id when 'r_net_ok' then 2 else 1 end where id like 'r_net_%'`);
    await h.pool.query(`insert into alerts (id, kind, run_id, cooldown_seq, lark_message_id) values
      ('a1', 'blocked', 'r_blocked_ok', null, 'om_1'), ('a2', 'parse_error', 'r_parse_unsent', null, null),
      ('a3', 'network_error', 'r_net_ok', 1, 'om_3'), ('a4', 'network_error', 'r_net_ok', 2, 'om_4'),
      ('a5', 'network_error', 'r_net_unsent', 1, null)`);
    expect(await q('ac1_alerts')).toEqual({ blocked_unsent: 0, parse_error_unsent: 1, network_mismatch: 2 });
  });

  it('AC 3 counts the days whose global briefing was ready before 07:00 with 6 generated sections and a Lark message id', async () => {
    const full = JSON.stringify({ sourceRun: {}, kpi: {}, topAds: [], risingAds: [], hotKeywords: [], risingShops: [], news: { state: 'ok' }, suggestions: { state: 'ok', count: 2 } });
    // Today's is late (07:50), day 3 is over the cap, day 5 has AI skipped and day 7 no Lark message id.
    await h.pool.query(
      `insert into briefings (id, date, scope, sections, ai_cost_usd, ready_at)
       select 'brf_d' || i, d, 'global', $1::jsonb, case when i = 3 then 5 else 0.5 end,
         ((d + time '06:50') at time zone 'Asia/Ho_Chi_Minh') + case when i = 0 then interval '1 hour' else interval '0' end
       from (select i, (now() at time zone 'Asia/Ho_Chi_Minh')::date - i as d from generate_series(0, 13) i) x`,
      [full],
    );
    await h.pool.query(`update briefings set sections = jsonb_set(sections, '{suggestions}', '{"state":"skipped","reason":"cost_cap"}') where id = 'brf_d5'`);
    await h.pool.query(`insert into lark_messages (id, briefing_id, chat, uuid, message_id) select 'lm_' || id, id, 'oc', 'u_' || id, 'om_' || id from briefings where id like 'brf_d%' and id <> 'brf_d7'`);
    await h.pool.query(`insert into ads (ad_archive_id, first_seen_date, last_seen_date, parsed) values ('ad_ok', '2026-10-01', '2026-10-01', '{}');
      insert into news_feeds (id, url) values ('feed_x', 'https://x.test/rss');
      insert into news_items (id, feed_id, title, link) values ('news_ok', 'feed_x', 't', 'https://x.test/1');
      insert into suggestions (id, briefing_id, kind, text, reason, evidence) values
        ('s_ok', 'brf_d1', 'idea', 't', 'r', '{"ads":["ad_ok"],"news":["news_ok"]}'),
        ('s_bad', 'brf_d2', 'idea', 't', 'r', '{"ads":["ad_ok"],"news":["news_gone"]}')`);
    expect(await q('ac3_briefings')).toEqual({ days: 14, days_ok: 11, unresolved_refs: 1, days_over_cap: 1 });
  });

  it('AC 6 counts ideas saved from briefings by non-admin members in 14 days, per store row', async () => {
    await h.pool.query(`insert into users (id, email, name, role) values ('u_admin', 'a@t', 'A', 'admin'), ('u_m1', 'm1@t', 'M1', 'member'), ('u_m2', 'm2@t', 'M2', 'member');
      insert into stores (id, name) values ('st_1', 'S1'), ('st_2', 'S2'), ('st_3', 'S3')`);
    const ideas = (store: string, user: string, n: number, via = 'briefing', daysAgo = 1, ref = `${store}_${user}_${via}_${daysAgo}`) =>
      h.pool.query(
        `insert into saved_ideas (id, store_id, source, source_ref, via, title, created_by, created_at)
         select 'idea_' || $1 || '_' || $5 || '_' || i, $1, 'ad', $5 || '_' || i, $3, 't', $2, now() - make_interval(days => $4) from generate_series(1, $6::int) i`,
        [store, user, via, daysAgo, ref, n],
      );
    await ideas('st_1', 'u_m1', 10);
    await ideas('st_2', 'u_m2', 9);
    // One save to two stores counts once in each.
    await ideas('st_1', 'u_m2', 1, 'briefing', 1, 'both');
    await ideas('st_2', 'u_m2', 1, 'briefing', 1, 'both');
    await ideas('st_1', 'u_admin', 5);
    await ideas('st_1', 'u_m1', 3, 'ads');
    await ideas('st_3', 'u_m1', 2, 'briefing', 20);
    expect(await q('ac6_ideas')).toEqual({ ideas: 21, stores_with_10: 2, per_store: { S1: 11, S2: 10 } });
  });

  // Phase 2 plan Step 8 on the data above: the checks through a role holding only RO_GRANTS, the day-14
  // verdict files, and the daily script on the real output.
  describe('through the read-only role', () => {
    const role = `ih_acc_${randomBytes(4).toString('hex')}`;
    let roUrl: string;
    beforeAll(async () => {
      await h.pool.query(`create role ${role} login password 'ro-test-only'`);
      for (const [table, cols] of Object.entries(RO_GRANTS)) await h.pool.query(`grant select (${cols}) on ${table} to ${role}`);
      const u = new URL(h.url);
      u.username = role;
      u.password = 'ro-test-only';
      roUrl = u.toString();
    });
    afterAll(async () => {
      // The role outlives the test database otherwise.
      await h.pool.query(`drop owned by ${role}`);
      await h.pool.query(`drop role ${role}`);
    });
    const vnDay = (daysAgo: number) => new Date(Date.parse(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })) - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const verdict = (name: string) => readFileSync(new URL(`../../../scripts/sql/pilot-verdict/${name}.sql`, import.meta.url), 'utf8');
    const withStart = (start: Date, text: string) => `set pilot.run_start = '${start.toISOString()}';\n${text}`;

    it('the verdict files give the daily figures when the run is the last 14 days, and need run-start', async () => {
      // Day 1 is 13 days ago, so AC 3's 14 dates are the daily query's; every seeded row is inside both windows.
      const start = new Date(Date.now() - 13 * 86_400_000);
      for (const name of ['ac1_success_ratio', 'ac1_alerts', 'ac2_violations', 'ac6_ideas']) {
        expect(await roQuery(roUrl, withStart(start, verdict(name))), name).toBe(await roQuery(roUrl, checks[name]!));
      }
      expect(await roQuery(roUrl, checks.ac3_briefings!)).toBe('days,days_ok,unresolved_refs,days_over_cap\n14,11,1,1\n');
      expect(await roQuery(roUrl, withStart(start, verdict('ac3_briefings')))).toBe(
        `days,days_ok,late_days,unresolved_refs,days_over_cap\n14,11,${vnDay(7)} ${vnDay(5)} ${vnDay(0)},1,1\n`,
      );
      await expect(roQuery(roUrl, verdict('ac1_success_ratio'))).rejects.toThrow('unrecognized configuration parameter');
    });

    it('the verdict window ends 14 days after run-start', async () => {
      // A run starting tomorrow sees none of the rows; one that ended 2 days ago neither (the seeded ideas
      // are 1 and 20 days old).
      for (const start of [new Date(Date.now() + 86_400_000), new Date(Date.now() - 16 * 86_400_000)]) {
        expect(await roQuery(roUrl, withStart(start, verdict('ac1_success_ratio')))).toBe('ok_searches,planned_searches,success_ratio\n0,0,\n');
        expect(await roQuery(roUrl, withStart(start, verdict('ac6_ideas')))).toBe('ideas,stores_with_10,per_store\n0,0,{}\n');
      }
    });

    it('the daily script Alerts every failed threshold of the real output', async () => {
      const acceptanceSql = readFileSync(new URL('../../../scripts/acceptance.sql', import.meta.url), 'utf8');
      const host = new Host({ 'scripts/acceptance.sql': acceptanceSql }, scriptPath('ideashub-acceptance'));
      try {
        writeFileSync(`${host.fake}/ro.csv`, await roQuery(roUrl, acceptanceSql));
        const r = host.run([], { RO_DATABASE_URL: roUrl });
        expect(r.status, r.out).toBe(0);
        expect(host.alerts('acceptance_failed')).toEqual([
          `${vnDay(0)} AC 1: success_ratio 0.3333 (7/21) < 0.90; AC 1: parse_error_unsent 1; AC 1: network_mismatch 2; ` +
            `AC 2: ok_without_embedded 1; AC 2: silent_stops 2; AC 3: today's briefing ready at 07:50, not before 07:00`,
        ]);
      } finally {
        host.close();
      }
    });
  });

  it('ac3_today reads today\'s global briefing alone', async () => {
    expect(await q('ac3_today')).toMatchObject({ ready_at: '07:50', on_time: false, sections_ok: true });
    await h.pool.query(`update briefings set ready_at = ready_at - interval '1 hour', sections = sections - 'news' where id = 'brf_d0'`);
    expect(await q('ac3_today')).toMatchObject({ ready_at: '06:50', on_time: true, sections_ok: false });
    await h.pool.query(`update briefings set date = date - 30 where id = 'brf_d0'`);
    expect(await q('ac3_today')).toMatchObject({ ready_at: null, on_time: false, sections_ok: false });
  });
});

/**
 * The column grants these queries need, and all the pilot's read-only role needs for them (phase 2 plan
 * Step 8): counts and flags only, no ad text, no personal data beyond a user's role.
 */
const RO_GRANTS: Record<string, string> = {
  crawl_runs: 'id, trigger, scheduled_for, created_at, status, planned_searches, network_cooldowns',
  crawl_searches: 'run_id, status, embedded_count, embedded_has_next, pages_read, ads_found, last_has_next, stop_reason',
  alerts: 'run_id, kind, lark_message_id',
  settings: 'key, value',
  briefings: 'id, date, scope, ready_at, sections, ai_cost_usd',
  lark_messages: 'briefing_id, message_id',
  suggestions: 'briefing_id, evidence',
  ads: 'ad_archive_id',
  news_items: 'id',
  stores: 'id, name',
  saved_ideas: 'id, store_id, via, created_at, created_by',
  users: 'id, role',
};
