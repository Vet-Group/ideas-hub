import { vietnamInstant } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestRun } from '../src/manual';
import { CRAWL, jobState } from '../src/queues';
import { type Harness, S, all, harness, insertRun, one, seedKeywords } from './helpers';

const pairs = ['kw_0', 'kw_1'].flatMap((keywordId) => ['US', 'GB'].map((country) => ({ keywordId, country })));

describe.skipIf(!testDatabaseAvailable())('Run now and pnpm crawl:run', () => {
  let h: Harness;
  const req = (over: Partial<Parameters<typeof requestRun>[3]> = {}) =>
    requestRun(h.pool, h.boss, S, { trigger: 'cli', pairs, triggeredBy: null, now: vietnamInstant('2026-10-21', '09:00'), ...over });

  beforeAll(async () => {
    h = await harness();
    await seedKeywords(h, 2);
  }, 60_000);
  afterAll(() => h?.close());
  beforeEach(async () => {
    await h.db.execute(sql`truncate crawl_runs cascade`);
    await h.db.execute(sql`update crawler_state set blocked_until = null`);
  });

  it('a cli run for 2 keywords × 2 countries plans 4 searches, trigger cli, triggered_by null, the manual deadline and a job', async () => {
    const r = await req();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await one<{ trigger: string; triggered_by: string | null; planned_searches: number; status: string; deadline: string; job_id: string }>(
      h,
      sql`select trigger, triggered_by, planned_searches, status, deadline, job_id from crawl_runs where id = ${r.runId}`,
    );
    expect(row).toMatchObject({ trigger: 'cli', triggered_by: null, planned_searches: 4, status: 'scheduled' });
    // The earlier of 09:00 + 4 h 30 and 13:00 − 25 min.
    expect(new Date(row.deadline)).toEqual(vietnamInstant('2026-10-21', '12:35'));
    expect(await jobState({ executeSql: (t, v) => h.pool.query(t, v) }, CRAWL, row.job_id)).toMatchObject({ state: 'created' });
  });

  it('a manual run deadline is the run deadline after the request when the next slot is far', async () => {
    const r = await req({ trigger: 'manual', now: vietnamInstant('2026-10-21', '05:00') });
    expect(r.ok && r.deadline).toEqual(vietnamInstant('2026-10-21', '09:30'));
  });

  it('is refused while blocked_until is in the future, but not because its own cool-down could reach the slot', async () => {
    await h.db.execute(sql`update crawler_state set blocked_until = ${vietnamInstant('2026-10-21', '09:30')}`);
    expect(await req()).toMatchObject({ ok: false, reason: 'blocked' });
    await h.db.execute(sql`update crawler_state set blocked_until = ${vietnamInstant('2026-10-21', '08:59')}`);
    // 12:35 deadline; a 6 h cool-down from a block would run past 13:00, which is no reason to refuse.
    expect((await req()).ok).toBe(true);
  });

  it('is refused while another run is running', async () => {
    await insertRun(h, { scheduledFor: vietnamInstant('2026-10-21', '01:00'), deadline: vietnamInstant('2026-10-21', '05:30'), status: 'running' });
    expect(await req()).toMatchObject({ ok: false, reason: 'run_running' });
  });

  it('is refused while another manual or cli row is scheduled or running, also when two arrive at once', async () => {
    expect((await req()).ok).toBe(true);
    expect(await req({ trigger: 'manual' })).toMatchObject({ ok: false, reason: 'manual_pending' });
    await h.db.execute(sql`truncate crawl_runs cascade`);
    const both = await Promise.all([req(), req({ trigger: 'manual' })]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'manual_pending' }]);
    expect(await all(h, sql`select 1 from crawl_runs`)).toHaveLength(1);
  });

  it('is refused inside the margin before the next slot', async () => {
    expect(await req({ now: vietnamInstant('2026-10-21', '12:40') })).toMatchObject({ ok: false, reason: 'no_time' });
  });

  it('a failure between inserting the row and sending its job leaves neither', async () => {
    const jobs = async () => (await all(h, sql`select 1 from pgboss.job where name = 'crawl.run'`)).length;
    const before = await jobs();
    await expect(req({ afterInsert: async () => Promise.reject(new Error('injected')) })).rejects.toThrow('injected');
    expect(await all(h, sql`select 1 from crawl_runs`)).toEqual([]);
    expect(await jobs()).toBe(before);
  });
});
