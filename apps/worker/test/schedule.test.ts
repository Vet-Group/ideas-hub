import { vietnamInstant } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CRAWL, jobState } from '../src/queues';
import { schedulerPass } from '../src/schedule';
import { watchdogPass } from '../src/watchdog-pass';
import { type Harness, all, harness, insertRun, one, seedKeywords, setSettings } from './helpers';

describe.skipIf(!testDatabaseAvailable())('scheduler', () => {
  let h: Harness;
  const bossDb = () => ({ executeSql: (t: string, v?: unknown[]) => h.pool.query(t, v) });
  // drizzle's node-postgres driver returns timestamptz as text.
  const rows = async () =>
    (
      await all<{ id: string; scheduled_for: string; deadline: string; planned_searches: number; job_id: string }>(
        h,
        sql`select id, scheduled_for, deadline, planned_searches, job_id from crawl_runs where trigger = 'schedule' and status = 'scheduled' order by scheduled_for`,
      )
    ).map((r) => ({ ...r, scheduled_for: new Date(r.scheduled_for), deadline: new Date(r.deadline) }));

  beforeAll(async () => {
    h = await harness('2026-10-21T03:00:00Z'); // 10:00 Asia/Ho_Chi_Minh
    await seedKeywords(h, 2);
  }, 60_000);
  afterAll(() => h?.close());
  beforeEach(async () => {
    await h.db.execute(sql`truncate crawl_runs cascade`);
    await h.db.execute(sql`delete from settings where key in ('runTimes', 'morningHardStop', 'searchBudget', 'runDeadlineMinutes')`);
    // Keep only the row the first migration seeded.
    await h.db.execute(sql`delete from run_time_changes where id <> (select id from run_time_changes order by created_at limit 1)`);
  });

  it('keeps 14 days of rows written with deadline, planned searches and a job sent for the slot', async () => {
    await schedulerPass(h);
    const r = await rows();
    expect(r).toHaveLength(28);
    expect(r[0]!.scheduled_for).toEqual(vietnamInstant('2026-10-21', '13:00'));
    expect(r[0]!.planned_searches).toBe(8);
    expect(r[0]!.deadline).toEqual(vietnamInstant('2026-10-21', '17:30'));
    const job = await jobState(bossDb(), CRAWL, r[0]!.job_id);
    expect(job).toMatchObject({ state: 'created', expireSeconds: 17400 });
    expect(job!.startAfter).toEqual(r[0]!.scheduled_for);
    // A second pass changes nothing.
    expect(await schedulerPass(h)).toMatchObject({ inserted: 0, resent: 0, removed: 0 });
  });

  it('crawl.run jobs carry retryLimit 0, so a failed (expired) job is not run again', async () => {
    await schedulerPass(h);
    const r = (await rows())[0]!;
    expect(await one(h, sql`select retry_limit from pgboss.job where id = ${r.job_id}`)).toEqual({ retry_limit: 0 });
    await h.boss.fail(CRAWL, r.job_id);
    expect(await one(h, sql`select state from pgboss.job where id = ${r.job_id}`)).toEqual({ state: 'failed' });
  });

  it('changing run times rewrites only future rows and records the change once', async () => {
    const past = await insertRun(h, { scheduledFor: vietnamInstant('2026-10-21', '01:00'), deadline: vietnamInstant('2026-10-21', '05:30'), status: 'done' });
    await schedulerPass(h);
    await setSettings(h, { runTimes: ['02:00', '14:00'] });
    const res = await schedulerPass(h);
    expect(res).toMatchObject({ removed: 28, inserted: 28 });
    const r = await rows();
    expect(r[0]!.scheduled_for).toEqual(vietnamInstant('2026-10-21', '14:00'));
    expect(await one(h, sql`select status from crawl_runs where id = ${past}`)).toEqual({ status: 'done' });
    const changes = await all(h, sql`select run_times from run_time_changes order by effective_from`);
    expect(changes.at(-1)).toEqual({ run_times: ['02:00', '14:00'] });
    await schedulerPass(h);
    expect(await all(h, sql`select 1 from run_time_changes`)).toHaveLength(changes.length);
  });

  it('a 06:00 hard stop rewrites the deadline of future 02:00 rows from 06:05 and re-sends their jobs', async () => {
    await setSettings(h, { runTimes: ['02:00', '13:00'] });
    await schedulerPass(h);
    const before = (await rows()).find((x) => x.scheduled_for.getTime() === vietnamInstant('2026-10-22', '02:00').getTime())!;
    expect(before.deadline).toEqual(vietnamInstant('2026-10-22', '06:05'));
    await setSettings(h, { morningHardStop: '06:00' });
    await schedulerPass(h);
    const after = (await rows()).find((x) => x.id === before.id)!;
    expect(after.deadline).toEqual(vietnamInstant('2026-10-22', '06:00'));
  });

  it('changing the run deadline re-sends the jobs of future rows with the new expiry', async () => {
    await schedulerPass(h);
    const before = (await rows())[0]!;
    await setSettings(h, { runDeadlineMinutes: 240 });
    expect((await schedulerPass(h)).resent).toBe(28);
    const after = (await rows())[0]!;
    expect(after.job_id).not.toBe(before.job_id);
    expect(await jobState(bossDb(), CRAWL, before.job_id)).toMatchObject({ state: 'cancelled' });
    expect(await jobState(bossDb(), CRAWL, after.job_id)).toMatchObject({ state: 'created', expireSeconds: (240 + 20) * 60 });
  });

  it('changing the budget or keywords rewrites planned_searches of future rows', async () => {
    await schedulerPass(h);
    await setSettings(h, { searchBudget: 3 });
    await schedulerPass(h);
    expect((await rows()).every((r) => r.planned_searches === 3)).toBe(true);
  });

  it('a failure between cancel() and send() leaves the old job in place', async () => {
    await schedulerPass(h);
    const before = (await rows())[0]!;
    await setSettings(h, { runDeadlineMinutes: 240 });
    await expect(schedulerPass(h, { betweenCancelAndSend: async () => Promise.reject(new Error('injected')) })).rejects.toThrow('injected');
    const after = (await rows())[0]!;
    expect(after.job_id).toBe(before.job_id);
    expect(await jobState(bossDb(), CRAWL, before.job_id)).toMatchObject({ state: 'created' });
  });

  it('rewrites no manual or cli row', async () => {
    const m = await insertRun(h, { trigger: 'manual', deadline: new Date('2026-10-21T05:00:00Z'), planned: 1, pairs: [{ keywordId: 'kw_0', country: 'US' }] });
    await setSettings(h, { searchBudget: 3 });
    await schedulerPass(h);
    expect(await one(h, sql`select planned_searches, deadline = '2026-10-21T05:00:00Z' as same from crawl_runs where id = ${m}`)).toEqual({ planned_searches: 1, same: true });
  });

  it('rejected settings leave the rows as they are', async () => {
    await schedulerPass(h);
    await setSettings(h, { runTimes: ['01:00', '05:00'] });
    expect((await schedulerPass(h)).problems).toContain('slots_too_close');
    expect(await rows()).toHaveLength(28);
  });

  it('the scheduler and the watchdog backfill writing the same slot leave one row', async () => {
    // The watchdog backfills a past slot; the scheduler never writes past slots, and both use ON CONFLICT.
    h.clock.advance(-12 * 3_600_000); // 2026-10-20 22:00 VN
    await schedulerPass(h);
    h.clock.advance(12 * 3_600_000);
    await watchdogPass(h, { restartWorker: async () => {} });
    await schedulerPass(h);
    const slot = vietnamInstant('2026-10-21', '01:00');
    expect(await all(h, sql`select status from crawl_runs where scheduled_for = ${slot}`)).toEqual([{ status: 'missed' }]);
  });
});
