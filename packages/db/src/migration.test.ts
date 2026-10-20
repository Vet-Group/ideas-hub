// Runs against DATABASE_URL after `pnpm db:migrate` (docker compose locally, a service in CI).
// Every write happens in a transaction that is rolled back.
import { DEFAULT_SETTINGS } from '@ideas-hub/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env: DATABASE_URL comes from the environment (CI).
}
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('first migration', () => {
  const client = new pg.Client({ connectionString: url });
  beforeAll(() => client.connect());
  afterAll(() => client.end());

  async function rolledBack(fn: () => Promise<void>) {
    await client.query('begin');
    try {
      await fn();
    } finally {
      await client.query('rollback');
    }
  }

  it('seeds the default settings', async () => {
    const { rows } = await client.query<{ key: string; value: unknown }>('select key, value from settings');
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual(DEFAULT_SETTINGS);
  });

  it('seeds the first run-time change and the crawler state row', async () => {
    const changes = await client.query('select run_times from run_time_changes');
    expect(changes.rows).toEqual([{ run_times: DEFAULT_SETTINGS.runTimes }]);
    const state = await client.query('select id, blocked_until from crawler_state');
    expect(state.rows).toEqual([{ id: 1, blocked_until: null }]);
  });

  it('creates pg_trgm with GIN trigram indexes for the Ctrl+K search', async () => {
    const ext = await client.query("select 1 from pg_extension where extname = 'pg_trgm'");
    expect(ext.rowCount).toBe(1);
    const { rows } = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename = 'ads' and indexdef like '%gin%gin_trgm_ops%' order by indexname",
    );
    expect(rows.map((r) => r.indexname)).toEqual(['ads_caption_trgm', 'ads_landing_domain_trgm', 'ads_page_name_trgm']);
  });

  it('keeps one scheduled row per (source, slot)', () =>
    rolledBack(async () => {
      const insert = `insert into crawl_runs (id, source, trigger, scheduled_for, planned_searches, deadline)
        values ($1, 'fb_ad_library', 'schedule', '2026-10-20T18:00:00Z', 160, '2026-10-20T22:30:00Z')
        on conflict (source, scheduled_for) where trigger = 'schedule' do nothing`;
      await client.query(insert, ['run_a']);
      await client.query(insert, ['run_b']);
      const { rows } = await client.query("select id from crawl_runs where id in ('run_a', 'run_b')");
      expect(rows).toEqual([{ id: 'run_a' }]);
    }));

  it('allows at most one manual or cli row scheduled or running', () =>
    rolledBack(async () => {
      const insert = `insert into crawl_runs (id, source, trigger, status, planned_searches, deadline)
        values ($1, 'fb_ad_library', $2, $3, 4, now())`;
      await client.query(insert, ['run_done', 'manual', 'done']);
      await client.query(insert, ['run_m', 'manual', 'scheduled']);
      await expect(client.query(insert, ['run_c', 'cli', 'running'])).rejects.toThrow(/crawl_runs_one_manual_key/);
    }));

  it('rejects a scheduled row without a slot', () =>
    rolledBack(async () => {
      await expect(
        client.query(
          `insert into crawl_runs (id, source, trigger, planned_searches, deadline) values ('run_x', 'fb_ad_library', 'schedule', 1, now())`,
        ),
      ).rejects.toThrow(/crawl_runs_slot_check/);
    }));

  it('keeps one open heartbeat_lost incident', () =>
    rolledBack(async () => {
      const insert = `insert into alerts (id, kind, resolved_at) values ($1, 'heartbeat_lost', $2)`;
      await client.query(insert, ['alert_old', '2026-10-01T00:00:00Z']);
      await client.query(insert, ['alert_open', null]);
      await expect(client.query(insert, ['alert_dup', null])).rejects.toThrow(/alerts_open_heartbeat_key/);
    }));
});
