import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BRIEFING, CRAWL, LARK, jobState, sendCrawlJob } from '../src/queues';
import { recoverAtStartup } from '../src/recovery';
import { runCrawl } from '../src/run';
import { watchdogPass } from '../src/watchdog-pass';
import { type Harness, S, all, fakeSite, harness, insertRun, one, runDeps, seedKeywords, setSettings } from './helpers';

const HOUR = 3_600_000;
const MIN = 60_000;

describe.skipIf(!testDatabaseAvailable())('crash recovery', () => {
  let h: Harness;
  const bossDb = () => ({ executeSql: (t: string, v?: unknown[]) => h.pool.query(t, v) });
  /** Sends a job and takes it, as a worker that then crashed would have. */
  async function activeJob(name: string, data: object, opts: object = {}) {
    const id = await h.boss.send(name, data, opts);
    const [job] = await h.boss.fetch(name);
    expect(job?.id).toBe(id);
    return id!;
  }

  beforeAll(async () => {
    h = await harness();
    await seedKeywords(h, 1);
    await setSettings(h, { countries: ['US', 'GB'] });
  }, 60_000);
  afterAll(() => h?.close());
  beforeEach(async () => {
    await h.db.execute(sql`truncate crawl_runs, alerts cascade`);
    await h.db.execute(sql`delete from pgboss.job`);
  });

  it('closes a run left running: stopped, run_failed, running search interrupted, pending skipped, job failed', async () => {
    const id = await insertRun(h, { scheduledFor: h.clock.now(), deadline: new Date(h.clock.t + HOUR), status: 'running' });
    const jobId = await activeJob(CRAWL, { runId: id });
    await h.db.execute(sql`update crawl_runs set job_id = ${jobId} where id = ${id}`);
    await h.db.execute(sql`insert into crawl_searches (id, run_id, keyword_id, country, status) values ('s1', ${id}, 'kw_0', 'US', 'running'), ('s2', ${id}, 'kw_0', 'GB', 'pending')`);
    await recoverAtStartup(h);
    expect(await one(h, sql`select status from crawl_runs where id = ${id}`)).toEqual({ status: 'stopped' });
    expect(await all(h, sql`select status from crawl_searches order by id`)).toEqual([{ status: 'interrupted' }, { status: 'skipped' }]);
    expect(await all(h, sql`select kind from alerts`)).toEqual([{ kind: 'run_failed' }]);
    expect(await jobState(bossDb(), CRAWL, jobId)).toMatchObject({ state: 'failed' });
  });

  it('a row still scheduled with an active job: before its deadline a new job starts now; after, missed or not_started', async () => {
    const early = await insertRun(h, { scheduledFor: h.clock.now(), deadline: new Date(h.clock.t + HOUR) });
    const j1 = await activeJob(CRAWL, { runId: early });
    await h.db.execute(sql`update crawl_runs set job_id = ${j1} where id = ${early}`);
    await recoverAtStartup(h);
    const row = await one<{ job_id: string; status: string }>(h, sql`select job_id, status from crawl_runs where id = ${early}`);
    expect(row.status).toBe('scheduled');
    expect(row.job_id).not.toBe(j1);
    expect(await jobState(bossDb(), CRAWL, j1)).toMatchObject({ state: 'failed' });
    expect(await jobState(bossDb(), CRAWL, row.job_id)).toMatchObject({ state: 'created' });

    await h.db.execute(sql`delete from pgboss.job`);
    const late = await insertRun(h, { scheduledFor: new Date(h.clock.t - 2 * HOUR), deadline: new Date(h.clock.t - 1) });
    const manual = await insertRun(h, { trigger: 'manual', deadline: new Date(h.clock.t - 1), pairs: [] });
    for (const id of [late, manual]) {
      await h.db.execute(sql`update crawl_runs set job_id = ${await sendCrawlJob(h.boss, bossDb(), id, new Date(0), S)} where id = ${id}`);
    }
    // Take both jobs (singleton: fetch one, complete nothing; the second is fetched by a second call after the first fails).
    const [a] = await h.boss.fetch(CRAWL);
    await recoverAtStartup(h);
    const [b] = await h.boss.fetch(CRAWL);
    await recoverAtStartup(h);
    expect(a && b).toBeTruthy();
    expect(await one(h, sql`select status from crawl_runs where id = ${late}`)).toEqual({ status: 'missed' });
    expect(await one(h, sql`select status, close_reason from crawl_runs where id = ${manual}`)).toEqual({ status: 'stopped', close_reason: 'not_started' });
    expect(await all(h, sql`select kind from alerts where run_id = ${late}`)).toEqual([{ kind: 'missed_run' }]);
  });

  it('cancels an active briefing.build job so sending it again is accepted, and fails an active lark.send job so it retries', async () => {
    const key = { singletonKey: '2026-10-21:global' };
    const b = await activeJob(BRIEFING, { date: '2026-10-21' }, key);
    expect(await h.boss.send(BRIEFING, { date: '2026-10-21' }, key)).toBeNull();
    const l = await activeJob(LARK, { briefingId: 'brf_1' });
    await recoverAtStartup(h);
    expect(await jobState(bossDb(), BRIEFING, b)).toMatchObject({ state: 'cancelled' });
    expect(await h.boss.send(BRIEFING, { date: '2026-10-21' }, key)).not.toBeNull();
    expect(await jobState(bossDb(), LARK, l)).toMatchObject({ state: 'retry' });
  });

  it('a manual run that crashes or hangs before a slot is closed before it, and the scheduled run then runs normally', async () => {
    const slot = new Date(h.clock.t + 2 * HOUR);
    for (const mode of ['crash', 'hang'] as const) {
      await h.db.execute(sql`truncate crawl_runs, alerts cascade`);
      await h.db.execute(sql`update crawler_state set heartbeat_at = ${h.clock.now()}`);
      const manual = await insertRun(h, { trigger: 'manual', deadline: new Date(slot.getTime() - 25 * MIN), status: 'running', pairs: [] });
      if (mode === 'crash') await recoverAtStartup(h);
      else {
        // The watchdog closes it once deadline + grace has passed: 25 − 15 = 10 min before the slot at the latest.
        const t = h.clock.t;
        h.clock.t = slot.getTime() - 25 * MIN + 15 * MIN + 1;
        await h.db.execute(sql`update crawler_state set heartbeat_at = ${h.clock.now()}`);
        await watchdogPass(h, { restartWorker: async () => {} });
        expect(h.clock.t).toBeLessThan(slot.getTime());
        h.clock.t = t;
      }
      expect(await one(h, sql`select status from crawl_runs where id = ${manual}`)).toEqual({ status: 'stopped' });
      const scheduled = await insertRun(h, { scheduledFor: slot, deadline: new Date(slot.getTime() + 4 * HOUR) });
      const saved = h.clock.t;
      h.clock.t = slot.getTime();
      const site = fakeSite(() => ({ kind: 'ok', ids: ['a'] }));
      expect(await runCrawl(h, scheduled, runDeps(h, site))).toBe('done');
      h.clock.t = saved;
    }
  });
});
