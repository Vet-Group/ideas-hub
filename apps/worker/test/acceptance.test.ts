import { readFileSync } from 'node:fs';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, harness, seedKeywords } from './helpers';

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
  const run = async (id: string, status: string, planned: number, searches: { status: string; embedded?: number; hasNext?: boolean; pages?: number; ads?: number; last?: boolean; stop?: string }[], ago = 1) => {
    await h.pool.query(
      `insert into crawl_runs (id, source, trigger, scheduled_for, status, planned_searches, deadline) values ($1, 'fb_ad_library', 'schedule', now() - make_interval(hours => $2), $3, $4, now())`,
      [id, ago, status, planned],
    );
    for (const [i, s] of searches.entries()) {
      await h.pool.query(
        `insert into crawl_searches (id, run_id, keyword_id, country, status, embedded_count, embedded_has_next, pages_read, ads_found, last_has_next, stop_reason)
         values ($1, $2, 'kw_0', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [`${id}_${i}`, id, `C${i}`, s.status, s.embedded ?? 30, s.hasNext ?? true, s.pages ?? 7, s.ads ?? 100, s.last ?? true, s.stop ?? (s.status === 'ok' ? 'cap' : null)],
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
    ], 5);
    expect(await q('ac2_violations')).toEqual({ ok_without_embedded: 1, has_next_without_page: 0, silent_stops: 1 });
  });
});
