import { vietnamInstant } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CRAWL, jobState, sendCrawlJob } from '../src/queues';
import { WATCHDOG_LOCK, watchdogPass } from '../src/watchdog-pass';
import { type Harness, S, all, harness, insertRun, one, seedKeywords, setSettings } from './helpers';

const HOUR = 3_600_000;
const MIN = 60_000;

describe.skipIf(!testDatabaseAvailable())('watchdog', () => {
  let h: Harness;
  let restarts = 0;
  const deps = { restartWorker: async () => void (restarts += 1) };
  const bossDb = () => ({ executeSql: (t: string, v?: unknown[]) => h.pool.query(t, v) });
  const fresh = () => h.db.execute(sql`update crawler_state set heartbeat_at = ${h.clock.now()}`);

  beforeAll(async () => {
    h = await harness('2026-10-21T03:00:00Z'); // 10:00 Asia/Ho_Chi_Minh
    await seedKeywords(h, 1);
    await setSettings(h, { countries: ['US', 'GB'] });
  }, 60_000);
  afterAll(() => h?.close());
  beforeEach(async () => {
    restarts = 0;
    h.clock.t = Date.parse('2026-10-21T03:00:00Z');
    await h.db.execute(sql`truncate crawl_runs, alerts cascade`);
    await h.db.execute(sql`update crawler_state set blocked_until = null, heartbeat_at = ${h.clock.now()}`);
    // A run-time history that starts 2026-10-20 13:00 VN, so the backfill window is known.
    await h.db.execute(sql`update run_time_changes set effective_from = ${vietnamInstant('2026-10-20', '12:00')}`);
  });

  const slot1300 = vietnamInstant('2026-10-20', '13:00');
  const slot0100 = vietnamInstant('2026-10-21', '01:00');

  it('marks an overdue scheduled row missed with a missed_run Alert and cancels its job', async () => {
    const id = await insertRun(h, { scheduledFor: slot0100, deadline: vietnamInstant('2026-10-21', '05:30'), planned: 2 });
    const jobId = await sendCrawlJob(h.boss, bossDb(), id, slot0100, S);
    await h.db.execute(sql`update crawl_runs set job_id = ${jobId} where id = ${id}`);
    await watchdogPass(h, deps);
    expect(await one(h, sql`select status from crawl_runs where id = ${id}`)).toEqual({ status: 'missed' });
    expect(await all(h, sql`select kind from alerts where run_id = ${id}`)).toEqual([{ kind: 'missed_run' }]);
    expect(await jobState(bossDb(), CRAWL, jobId)).toMatchObject({ state: 'cancelled' });
  });

  it('writes a missed row for a past slot with no row, by the run times then, never before the first change', async () => {
    const r = await watchdogPass(h, deps);
    expect(r).toMatchObject({ backfilled: 2 });
    const rows = await all<{ scheduled_for: string; status: string }>(h, sql`select scheduled_for, status from crawl_runs order by scheduled_for`);
    expect(rows.map((x) => [new Date(x.scheduled_for).toISOString(), x.status])).toEqual([
      [slot1300.toISOString(), 'missed'],
      [slot0100.toISOString(), 'missed'],
    ]);
    // Run times then: a change at 2026-10-20 20:00 VN to 02:00 only.
    await h.db.execute(sql`truncate crawl_runs, alerts cascade`);
    await h.db.execute(sql`insert into run_time_changes (id, run_times, effective_from) values ('rtc_t', '["02:00"]', ${vietnamInstant('2026-10-20', '20:00')})`);
    await watchdogPass(h, deps);
    const after = await all<{ scheduled_for: string }>(h, sql`select scheduled_for from crawl_runs order by scheduled_for`);
    expect(after.map((x) => new Date(x.scheduled_for).toISOString())).toEqual([slot1300.toISOString(), vietnamInstant('2026-10-21', '02:00').toISOString()]);
    await h.db.execute(sql`delete from run_time_changes where id = 'rtc_t'`);
  });

  it('looks back at most 14 days', async () => {
    await h.db.execute(sql`update run_time_changes set effective_from = '2026-09-01T00:00:00Z'`);
    expect(await watchdogPass(h, deps)).toMatchObject({ backfilled: 28 });
  });

  it('closes a scheduled slot that comes before blocked_until as stopped, searches skipped, a blocked Alert, no missed_run', async () => {
    await h.db.execute(sql`update crawler_state set blocked_until = ${new Date(h.clock.t + HOUR)}`);
    const id = await insertRun(h, { scheduledFor: new Date(h.clock.t - MIN), deadline: new Date(h.clock.t + 4 * HOUR), planned: 2 });
    const jobId = await sendCrawlJob(h.boss, bossDb(), id, new Date(h.clock.t - MIN), S);
    await h.db.execute(sql`update crawl_runs set job_id = ${jobId} where id = ${id}`);
    await watchdogPass(h, deps);
    expect(await one(h, sql`select status from crawl_runs where id = ${id}`)).toEqual({ status: 'stopped' });
    expect(await all(h, sql`select status from crawl_searches where run_id = ${id}`)).toEqual([{ status: 'skipped' }, { status: 'skipped' }]);
    expect(await all(h, sql`select kind from alerts where run_id = ${id}`)).toEqual([{ kind: 'blocked' }]);
    expect(await jobState(bossDb(), CRAWL, jobId)).toMatchObject({ state: 'cancelled' });
  });

  it('backfills a past slot with no row inside a cool-down as stopped with skipped searches, not missed', async () => {
    // A run stopped on a block at 2026-10-20 12:30 VN with a 6 h cool-down covers the 13:00 slot.
    const blocker = await insertRun(h, { trigger: 'cli', deadline: slot1300, status: 'stopped', pairs: [] });
    await h.db.execute(sql`update crawl_runs set finished_at = ${vietnamInstant('2026-10-20', '12:30')}, blocked_until = ${vietnamInstant('2026-10-20', '18:30')} where id = ${blocker}`);
    await watchdogPass(h, deps);
    const rows = await all<{ id: string; status: string; scheduled_for: string }>(h, sql`select id, status, scheduled_for from crawl_runs where trigger = 'schedule' order by scheduled_for`);
    expect(rows.map((r) => r.status)).toEqual(['stopped', 'missed']);
    expect(await all(h, sql`select kind from alerts where run_id = ${rows[0]!.id}`)).toEqual([{ kind: 'blocked' }]);
    expect(await all(h, sql`select status from crawl_searches where run_id = ${rows[0]!.id}`)).toEqual([{ status: 'skipped' }, { status: 'skipped' }]);
  });

  it('closes a run with a stale heartbeat: stopped, run_failed, job failed, worker restarted, heartbeat_lost opened', async () => {
    const id = await insertRun(h, { scheduledFor: slot0100, deadline: vietnamInstant('2026-10-21', '05:30'), status: 'running' });
    const jobId = await sendCrawlJob(h.boss, bossDb(), id, new Date(0), S);
    await h.boss.fetch(CRAWL);
    await h.db.execute(sql`update crawl_runs set job_id = ${jobId}, deadline = ${new Date(h.clock.t + HOUR)} where id = ${id}`);
    await h.db.execute(sql`insert into crawl_searches (id, run_id, keyword_id, country, status) values ('s1', ${id}, 'kw_0', 'US', 'running'), ('s2', ${id}, 'kw_0', 'GB', 'pending')`);
    await h.db.execute(sql`update crawler_state set heartbeat_at = ${new Date(h.clock.t - 31 * MIN)}`);
    const r = await watchdogPass(h, deps);
    expect(r).toMatchObject({ hungRuns: 1, heartbeatLost: true, restarted: true });
    expect(restarts).toBe(1);
    expect(await one(h, sql`select status from crawl_runs where id = ${id}`)).toEqual({ status: 'stopped' });
    expect(await all(h, sql`select status from crawl_searches order by id`)).toEqual([{ status: 'interrupted' }, { status: 'skipped' }]);
    expect(await jobState(bossDb(), CRAWL, jobId)).toMatchObject({ state: 'failed' });
    const kinds = (await all<{ kind: string }>(h, sql`select kind from alerts`)).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['heartbeat_lost', 'run_failed']));
  });

  it('closes a running run with a fresh heartbeat once deadline plus grace has passed, and restarts the worker', async () => {
    const id = await insertRun(h, { trigger: 'cli', deadline: new Date(h.clock.t - 16 * MIN), status: 'running', pairs: [] });
    const r = await watchdogPass(h, deps);
    expect(r).toMatchObject({ hungRuns: 1, heartbeatLost: false, restarted: true });
    expect(await all(h, sql`select kind from alerts where run_id = ${id}`)).toEqual([{ kind: 'run_failed' }]);
  });

  it('a stale heartbeat with no run opens one heartbeat_lost incident and restarts the worker once; a fresh one resolves it', async () => {
    await h.db.execute(sql`update crawler_state set heartbeat_at = ${new Date(h.clock.t - 40 * MIN)}`);
    await watchdogPass(h, deps);
    h.clock.advance(5 * MIN);
    await watchdogPass(h, deps);
    expect(await all(h, sql`select resolved_at from alerts where kind = 'heartbeat_lost'`)).toEqual([{ resolved_at: null }]);
    expect(restarts).toBe(1);
    await fresh();
    await watchdogPass(h, deps);
    const open = await all(h, sql`select 1 from alerts where kind = 'heartbeat_lost' and resolved_at is null`);
    expect(open).toEqual([]);
  });

  it('opens no heartbeat_lost between runs while heartbeats arrive', async () => {
    for (let i = 0; i < 3; i++) {
      h.clock.advance(5 * MIN);
      await fresh();
      await watchdogPass(h, deps);
    }
    expect(await all(h, sql`select 1 from alerts where kind = 'heartbeat_lost'`)).toEqual([]);
    expect(restarts).toBe(0);
  });

  it('closes a manual row still scheduled after its deadline as stopped not_started', async () => {
    const id = await insertRun(h, { trigger: 'manual', deadline: new Date(h.clock.t - MIN), pairs: [] });
    await watchdogPass(h, deps);
    expect(await one(h, sql`select status, close_reason from crawl_runs where id = ${id}`)).toEqual({ status: 'stopped', close_reason: 'not_started' });
  });

  it('its closes change no row whose status moved on', async () => {
    const id = await insertRun(h, { scheduledFor: slot0100, deadline: vietnamInstant('2026-10-21', '05:30'), status: 'done' });
    await watchdogPass(h, deps);
    expect(await one(h, sql`select status from crawl_runs where id = ${id}`)).toEqual({ status: 'done' });
  });

  it('a second pass started while one holds the advisory lock exits at once', async () => {
    const c = await h.pool.connect();
    try {
      await c.query('select pg_advisory_lock($1)', [WATCHDOG_LOCK]);
      expect(await watchdogPass(h, deps)).toEqual({ locked: true });
    } finally {
      await c.query('select pg_advisory_unlock($1)', [WATCHDOG_LOCK]);
      c.release();
    }
  });

  it('sends Alerts within a 60 s budget and leaves the rest for the next pass', async () => {
    await h.db.execute(sql`update run_time_changes set effective_from = ${h.clock.now()}`);
    for (let i = 0; i < 5; i++) {
      const run = await insertRun(h, { trigger: 'cli', deadline: h.clock.now(), status: 'done', pairs: [] });
      await h.db.execute(sql`insert into alerts (id, kind, run_id, created_at) values (${`alert_${i}`}, 'parse_error', ${run}, ${new Date(h.clock.t + i)})`);
    }
    let sent = 0;
    const sendAlert = async () => {
      h.clock.advance(25_000);
      sent += 1;
      return `om_${sent}`;
    };
    const first = await watchdogPass(h, { ...deps, sendAlert });
    expect(first).toMatchObject({ alertsSent: 3, alertsLeft: 2 });
    const second = await watchdogPass(h, { ...deps, sendAlert });
    expect(second).toMatchObject({ alertsSent: 2, alertsLeft: 0 });
    expect(await all(h, sql`select 1 from alerts where lark_message_id is null and kind = 'parse_error'`)).toEqual([]);
  });
});
