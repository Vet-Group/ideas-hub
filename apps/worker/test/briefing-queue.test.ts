import { DEFAULT_SETTINGS, type Settings, vietnamInstant } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { type Job } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBriefing, scheduleBriefings } from '../src/briefing';
import { loadSettings } from '../src/context';
import { BRIEFING, type BriefingJob, GLOBAL_PRIORITY, jobState, sendBriefingJob } from '../src/queues';
import { recoverAtStartup } from '../src/recovery';
import { BUILD, SHARED_CHAT, resetBriefings, seedBriefingData } from './briefing-data';
import { fakeLlm } from './fakes';
import { type Harness, S, all, harness, one, setSettings } from './helpers';

const MIN = 60_000;
const DATE = '2026-10-21';

describe.skipIf(!testDatabaseAvailable())('briefing.build queue, scheduler and recovery', () => {
  let h: Harness;
  const bossDb = () => ({ executeSql: (t: string, v?: unknown[]) => h.pool.query(t, v) });
  const queued = () =>
    all<{ id: string; singleton_key: string; priority: number; start_after: Date; state: string; retry_limit: number; expire_seconds: number }>(
      h,
      sql`select id, singleton_key, priority, start_after, state, retry_limit, expire_seconds from pgboss.job where name = ${BRIEFING} order by priority desc, created_on`,
    );
  const valid = () => fakeLlm(() => 'valid');

  beforeAll(async () => {
    h = await harness('2026-10-18T18:00:00Z');
    await seedBriefingData(h);
  }, 120_000);
  afterAll(() => h?.close());
  beforeEach(() => resetBriefings(h));

  it('validates the LLM timeout against the job expiry: two attempts must fit; 120 s is accepted', async () => {
    const { validateSettings } = await import('@ideas-hub/core');
    const s = DEFAULT_SETTINGS as unknown as Settings;
    expect(validateSettings({ ...s, llmCallTimeoutSeconds: 451 })).toContain('llm_timeout_over_job_expiry');
    expect(validateSettings({ ...s, llmCallTimeoutSeconds: 120 })).toEqual([]);
  });

  it('a second briefing.build for the same key is not queued (exclusive: send() returns null)', async () => {
    const job: BriefingJob = { date: DATE, scope: 'global' };
    expect(await sendBriefingJob(h.boss, bossDb(), job, BUILD, S)).not.toBeNull();
    expect(await sendBriefingJob(h.boss, bossDb(), job, BUILD, S)).toBeNull();
    const [j] = await queued();
    expect(j).toMatchObject({ singleton_key: `${DATE}:global`, priority: GLOBAL_PRIORITY, retry_limit: 1, expire_seconds: 900 });
  });

  it('the scheduler sends one build per briefing at the build time, the global one first; all 4 are queued, fetched global first and built', async () => {
    h.clock.t = vietnamInstant(DATE, '05:00').getTime();
    const r = await scheduleBriefings(h, await loadSettings(h.db), h.clock.now());
    expect(r).toEqual({ briefingsSent: 4, briefingsResent: 0 });
    const jobs = await queued();
    expect(jobs[0]!.singleton_key).toBe(`${DATE}:global`);
    expect(jobs.slice(1).map((j) => j.singleton_key).sort()).toEqual([`${DATE}:kw:kw_0`, `${DATE}:kw:kw_1`, `${DATE}:kw:kw_2`]);
    expect(jobs.every((j) => new Date(j.start_after).getTime() === BUILD.getTime())).toBe(true);
    // The next pass sends nothing new.
    expect(await scheduleBriefings(h, await loadSettings(h.db), h.clock.now())).toEqual({ briefingsSent: 0, briefingsResent: 0 });

    await h.db.execute(sql`update pgboss.job set start_after = now() where name = ${BRIEFING}`);
    h.clock.t = BUILD.getTime();
    const llm = valid();
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const [job] = (await h.boss.fetch<BriefingJob>(BRIEFING)) as Job<BriefingJob>[];
      order.push(job!.data.scope === 'global' ? 'global' : job!.data.keywordId!);
      expect(await buildBriefing(h, job!.data, { llm: llm.client, sharedChat: SHARED_CHAT })).toBe('built');
      await h.boss.complete(BRIEFING, job!.id);
    }
    expect(order[0]).toBe('global');
    expect(order.slice(1).sort()).toEqual(['kw_0', 'kw_1', 'kw_2']);
    expect(await all(h, sql`select scope from briefings where ready_at is not null order by scope`)).toHaveLength(4);
  });

  it('a failed build is retried once', async () => {
    const id = (await sendBriefingJob(h.boss, bossDb(), { date: DATE, scope: 'global' }, new Date(0), S))!;
    for (const expected of ['retry', 'failed']) {
      const [job] = await h.boss.fetch(BRIEFING);
      expect(job?.id).toBe(id);
      await h.boss.fail(BRIEFING, id, { reason: 'test' });
      expect(await jobState(bossDb(), BRIEFING, id)).toMatchObject({ state: expected });
    }
    expect(await h.boss.fetch(BRIEFING)).toEqual([]);
  });

  it('a change of build time re-sends that day’s jobs with the new startAfter', async () => {
    h.clock.t = vietnamInstant(DATE, '05:00').getTime();
    await scheduleBriefings(h, await loadSettings(h.db), h.clock.now());
    const old = await queued();
    await setSettings(h, { briefingBuildTime: '06:40' });
    expect(await scheduleBriefings(h, await loadSettings(h.db), h.clock.now())).toEqual({ briefingsSent: 0, briefingsResent: 4 });
    const now = await queued();
    const live = now.filter((j) => j.state === 'created');
    expect(live).toHaveLength(4);
    expect(live.every((j) => new Date(j.start_after).getTime() === vietnamInstant(DATE, '06:40').getTime())).toBe(true);
    expect(live.map((j) => j.priority)).toEqual([GLOBAL_PRIORITY, 0, 0, 0]);
    for (const o of old) expect(await jobState(bossDb(), BRIEFING, o.id)).toMatchObject({ state: 'cancelled' });
    // Moved into the past while still queued: they start now.
    h.clock.t = vietnamInstant(DATE, '06:35').getTime();
    await setSettings(h, { briefingBuildTime: '06:30' });
    await scheduleBriefings(h, await loadSettings(h.db), h.clock.now());
    const today = (await queued()).filter((j) => j.state === 'created' && j.singleton_key.startsWith(DATE));
    expect(today.every((j) => new Date(j.start_after).getTime() === h.clock.t)).toBe(true);
  });

  it('a briefing.build handler that overruns its expiry is aborted through job.signal', async () => {
    const llm = fakeLlm(() => 'hang_until_abort');
    const id = (await sendBriefingJob(h.boss, bossDb(), { date: DATE, scope: 'global' }, new Date(0), { ...S, briefingJobExpirySeconds: 1 }))!;
    const errors: unknown[] = [];
    const worker = await h.boss.work<BriefingJob>(BRIEFING, { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      try {
        await buildBriefing(h, job!.data, { llm: llm.client, sharedChat: null }, job!.signal);
      } catch (e) {
        errors.push(e);
        throw e;
      }
    });
    try {
      // Both attempts (retryLimit 1) overrun and are aborted; the LLM timeout (120 s) never fires.
      await expect.poll(async () => (await jobState(bossDb(), BRIEFING, id))?.state, { timeout: 15_000 }).toBe('failed');
    } finally {
      await h.boss.offWork(BRIEFING, { id: worker });
    }
    expect(errors).toHaveLength(2);
    expect(llm.calls.map((c) => c.signal.aborted)).toEqual([true, true]);
    expect((await one<{ llm_calls: number }>(h, sql`select llm_calls from briefings where date = ${DATE}`)).llm_calls).toBe(2);
  });

  it('at startup: an active build is cancelled and today’s unfinished briefings are sent again; the rerun spends no second AI charge', async () => {
    h.clock.t = BUILD.getTime() + 5 * MIN;
    const llm = valid();
    await buildBriefing(h, { date: DATE, scope: 'global' }, { llm: llm.client, sharedChat: null });
    // The worker died after storing the AI sections, before ready_at, with the job active.
    await h.db.execute(sql`update briefings set ready_at = null`);
    const id = (await sendBriefingJob(h.boss, bossDb(), { date: DATE, scope: 'global' }, new Date(0), S))!;
    await h.boss.fetch(BRIEFING);
    const r = await recoverAtStartup(h);
    expect(r).toMatchObject({ briefingCancelled: 1, briefingResent: 1 });
    expect(await jobState(bossDb(), BRIEFING, id)).toMatchObject({ state: 'cancelled' });
    // pg-boss compares startAfter with the database clock, not the test's.
    await h.db.execute(sql`update pgboss.job set start_after = now() where name = ${BRIEFING} and state = 'created'`);
    const [job] = (await h.boss.fetch<BriefingJob>(BRIEFING)) as Job<BriefingJob>[];
    expect(job?.data).toEqual({ date: DATE, scope: 'global' });
    const again = valid();
    expect(await buildBriefing(h, job!.data, { llm: again.client, sharedChat: null })).toBe('built');
    expect(again.calls).toHaveLength(0);
    expect(await one(h, sql`select llm_calls from briefings where date = ${DATE}`)).toEqual({ llm_calls: 1 });
  });

  it('at startup before today’s build time nothing is re-sent', async () => {
    h.clock.t = vietnamInstant(DATE, '06:00').getTime();
    await h.db.execute(sql`insert into briefings (id, date, scope) values ('brf_x', ${DATE}, 'global')`);
    expect(await recoverAtStartup(h)).toMatchObject({ briefingResent: 0 });
    expect(await queued()).toEqual([]);
  });
});
