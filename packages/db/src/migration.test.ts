// Runs against DATABASE_URL after `pnpm db:migrate` (docker compose locally, a service in CI).
// Every write happens in a transaction that is rolled back.
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, isNonShopDomain } from '@ideas-hub/core';
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

  it('0005 removes the non-shop domains from shops and shop_days, as isNonShopDomain matches them', () =>
    rolledBack(async () => {
      const domains = ['ad.doubleclick.net', 'play.google.com', 'amazon.co.uk', 'a.co', 'dogmom.e2e-migration', 'notamazon.e2e-migration'];
      for (const d of domains) {
        await client.query(`insert into shops (landing_domain, first_seen_date, last_seen_date) values ($1, '2026-10-01', '2026-10-20') on conflict do nothing`, [d]);
        await client.query(`insert into shop_days (landing_domain, crawl_day, slot, running_ads) values ($1, '2026-10-20', '2026-10-20T18:00:00Z', 1) on conflict do nothing`, [d]);
      }
      const statements = readFileSync(new URL('../migrations/0005_non_shop_domains.sql', import.meta.url), 'utf8').split('--> statement-breakpoint');
      for (const st of statements) await client.query(st);
      const kept = domains.filter((d) => !isNonShopDomain(d, DEFAULT_SETTINGS.nonShopDomains));
      expect(kept).toEqual(['dogmom.e2e-migration', 'notamazon.e2e-migration']);
      for (const table of ['shops', 'shop_days']) {
        const { rows } = await client.query<{ d: string }>(`select landing_domain as d from ${table} where landing_domain = any($1) order by d`, [domains]);
        expect(rows.map((r) => r.d), table).toEqual(kept);
      }
    }));

  it('0012 limits API tokens to known scopes and a lifetime of at most 365 days, with unique hashes', () =>
    rolledBack(async () => {
      await client.query(`insert into users (id, email, name) values ('user_tok', 'tok@test.local', 'Tok')`);
      const insert = `insert into api_tokens (id, user_id, name, token_hash, scopes, created_at, expires_at)
        values ($1, 'user_tok', 'n', $2, $3, '2026-10-23T00:00:00Z', $4)`;
      await client.query(insert, ['tok_ok', 'h1', ['ideas:read'], '2027-10-23T00:00:00Z']);
      // A refused insert aborts the transaction, so each one runs behind a savepoint.
      const refused = async (values: unknown[], constraint: RegExp) => {
        await client.query('savepoint refused');
        await expect(client.query(insert, values)).rejects.toThrow(constraint);
        await client.query('rollback to savepoint refused');
      };
      await refused(['tok_dup', 'h1', ['ideas:read'], '2026-11-23T00:00:00Z'], /api_tokens_token_hash_unique/);
      await refused(['tok_long', 'h2', ['ideas:read'], '2027-10-23T00:00:01Z'], /api_tokens_expiry_check/);
      await refused(['tok_past', 'h3', ['ideas:read'], '2026-10-23T00:00:00Z'], /api_tokens_expiry_check/);
      await refused(['tok_none', 'h4', [], '2026-11-23T00:00:00Z'], /api_tokens_scopes_check/);
      await refused(['tok_bad', 'h5', ['ideas:write'], '2026-11-23T00:00:00Z'], /api_tokens_scopes_check/);
    }));

  it('0016 keeps one known angle per ad and drops it with the ad', () =>
    rolledBack(async () => {
      await client.query(`insert into ads (ad_archive_id, first_seen_date, last_seen_date, parsed) values ('ang_1', '2026-10-01', '2026-10-01', '{}')`);
      const insert = `insert into ad_angles (ad_archive_id, angle, model, cost_usd, tagged_on) values ('ang_1', $1, 'm', 0.0004, '2026-11-06')`;
      await client.query('savepoint refused');
      await expect(client.query(insert, ['fear'])).rejects.toThrow(/ad_angles_angle_check/);
      await client.query('rollback to savepoint refused');
      await client.query(insert, ['pain']);
      expect((await client.query(`select attempts from ad_angles where ad_archive_id = 'ang_1'`)).rows).toEqual([{ attempts: 1 }]);
      await client.query(`delete from ads where ad_archive_id = 'ang_1'`);
      expect((await client.query(`select 1 from ad_angles where ad_archive_id = 'ang_1'`)).rowCount).toBe(0);
    }));
});
