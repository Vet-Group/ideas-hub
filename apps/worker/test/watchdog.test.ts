import { vietnamInstant } from '@ideas-hub/core';
import { adminAlerts } from '@ideas-hub/db/queries';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CRAWL, jobState, sendCrawlJob } from '../src/queues';
import { type AlertRow, WATCHDOG_LOCK, watchdogPass } from '../src/watchdog-pass';
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
    await h.db.execute(sql`update crawler_state set blocked_until = null, heartbeat_at = ${h.clock.now()}, worker_restart_at = null`);
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

  it('a stale heartbeat with no run opens one heartbeat_lost incident and restarts the worker at most once per 5 min; a fresh one resolves it', async () => {
    await h.db.execute(sql`update crawler_state set heartbeat_at = ${new Date(h.clock.t - 40 * MIN)}`);
    await watchdogPass(h, deps);
    h.clock.advance(4 * MIN);
    await watchdogPass(h, deps);
    expect(await all(h, sql`select resolved_at from alerts where kind = 'heartbeat_lost'`)).toEqual([{ resolved_at: null }]);
    expect(restarts).toBe(1);
    h.clock.advance(MIN);
    expect(await watchdogPass(h, deps)).toMatchObject({ heartbeatLost: true, restarted: true });
    expect(restarts).toBe(2);
    await fresh();
    await watchdogPass(h, deps);
    const open = await all(h, sql`select 1 from alerts where kind = 'heartbeat_lost' and resolved_at is null`);
    expect(open).toEqual([]);
  });

  it('retries a failed worker restart on a later pass while heartbeat_lost is open', async () => {
    await h.db.execute(sql`update crawler_state set heartbeat_at = ${new Date(h.clock.t - 40 * MIN)}`);
    let calls = 0;
    const flaky = {
      restartWorker: async () => {
        calls += 1;
        if (calls === 1) throw new Error('schtasks /Run failed');
      },
    };
    expect(await watchdogPass(h, flaky)).toMatchObject({ heartbeatLost: true, restarted: false });
    h.clock.advance(2 * MIN);
    expect(await watchdogPass(h, flaky)).toMatchObject({ heartbeatLost: true, restarted: false });
    expect(calls).toBe(1);
    h.clock.advance(3 * MIN);
    expect(await watchdogPass(h, flaky)).toMatchObject({ heartbeatLost: true, restarted: true });
    expect(calls).toBe(2);
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
    // Another transaction moves the row on after the pass read it; the pass's guarded update waits on the
    // row lock, then finds the row in another status and changes nothing.
    const race = async (id: string, status: string) => {
      const c = await h.pool.connect();
      try {
        await c.query('begin');
        await c.query('update crawl_runs set status = $2 where id = $1', [id, status]);
        const pass = watchdogPass(h, deps);
        for (let i = 0; ; i++) {
          const { rows } = await h.pool.query(`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);
          if (rows.length) break;
          if (i > 400) throw new Error('the pass never waited on the row lock');
          await new Promise((r) => setTimeout(r, 25));
        }
        await c.query('commit');
        await pass;
      } finally {
        c.release();
      }
    };
    // An overdue slot that the worker starts meanwhile is not marked missed.
    const slot = await insertRun(h, { scheduledFor: slot0100, deadline: new Date(h.clock.t + HOUR), planned: 2 });
    await race(slot, 'running');
    expect(await one(h, sql`select status from crawl_runs where id = ${slot}`)).toEqual({ status: 'running' });
    await h.db.execute(sql`update crawl_runs set status = 'done' where id = ${slot}`);
    // A run past its deadline plus grace that finishes meanwhile is not closed, and the worker is left alone.
    const late = await insertRun(h, { trigger: 'cli', deadline: new Date(h.clock.t - 16 * MIN), status: 'running', pairs: [] });
    await race(late, 'done');
    expect(await one(h, sql`select status from crawl_runs where id = ${late}`)).toEqual({ status: 'done' });
    expect(await all(h, sql`select kind from alerts where run_id in (${slot}, ${late})`)).toEqual([]);
    expect(restarts).toBe(0);
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

  it('sends only unsent Alerts of the last 24 h, marks older ones as not sent to Lark for good, and still lists them for admins', async () => {
    await h.db.execute(sql`update run_time_changes set effective_from = ${h.clock.now()}`);
    // A backlog written before Lark was configured; alert_edge is 2 min short of the cut-off.
    const ages = { alert_old: 30 * HOUR, alert_edge: 24 * HOUR - 2 * MIN, alert_new: HOUR };
    for (const [id, age] of Object.entries(ages)) {
      const run = await insertRun(h, { trigger: 'cli', deadline: h.clock.now(), status: 'done', pairs: [] });
      await h.db.execute(sql`insert into alerts (id, kind, run_id, created_at) values (${id}, 'parse_error', ${run}, ${new Date(h.clock.t - age)})`);
    }
    const sent: string[] = [];
    let larkDown = true; // the first pass's post of alert_edge fails
    const sendAlert = async (a: AlertRow) => {
      if (a.id === 'alert_edge' && larkDown) return null;
      sent.push(a.id);
      return `om_${a.id}`;
    };
    expect(await watchdogPass(h, { ...deps, sendAlert })).toMatchObject({ alertsSent: 1, alertsTooOld: 1, alertsLeft: 0 });
    expect(sent).toEqual(['alert_new']);

    // A later pass, once alert_edge has passed the cut-off and Lark works: nothing old is sent.
    larkDown = false;
    h.clock.advance(5 * MIN);
    await fresh();
    expect(await watchdogPass(h, { ...deps, sendAlert })).toMatchObject({ alertsSent: 0, alertsTooOld: 1, alertsLeft: 0 });
    h.clock.advance(5 * MIN);
    await fresh();
    expect(await watchdogPass(h, { ...deps, sendAlert })).toMatchObject({ alertsSent: 0, alertsTooOld: 0, alertsLeft: 0 });
    expect(sent).toEqual(['alert_new']);
    expect(
      await all(h, sql`select id, lark_message_id, sent_at is not null as sent, lark_skipped_at is not null as skipped from alerts order by id`),
    ).toEqual([
      { id: 'alert_edge', lark_message_id: null, sent: false, skipped: true },
      { id: 'alert_new', lark_message_id: 'om_alert_new', sent: true, skipped: false },
      { id: 'alert_old', lark_message_id: null, sent: false, skipped: true },
    ]);
    expect((await adminAlerts(h.db)).map((a) => a.id)).toEqual(['alert_new', 'alert_edge', 'alert_old']);
  });
});
