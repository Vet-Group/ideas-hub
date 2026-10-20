// One watchdog pass (spec §1 "Missed run", "Hung run", "Blocked slot"; plan Step 3 "Watchdog"): closes,
// marks, backfill and the heartbeat check first, then Alerts within a 60 s budget. Two passes never
// overlap (pg_try_advisory_lock).
import { type Settings, WATCHDOG_PERIOD_MINUTES, plannedSearches, rotate, slotsBetween, vietnamDate, vietnamInstant } from '@ideas-hub/core';
import { type Db, withTx } from '@ideas-hub/db/client';
import { sql } from 'drizzle-orm';
import { type Ctx, SOURCE, loadSettings } from './context';
import { CRAWL } from './queues';
import { activePairs, closeNotStarted, failRunningRun, insertAlert } from './runs';

const MINUTE = 60_000;
const DAY = 86_400_000;
export const WATCHDOG_LOCK = 4_242_001;
export const ALERT_BUDGET_MS = 60_000;
/** Unsent Alerts older than this are not sent to Lark but stay on the admin page (ADR 0004). */
export const ALERT_MAX_AGE_MS = DAY;
export const BACKFILL_DAYS = 14;
export const RESTART_EVERY_MS = WATCHDOG_PERIOD_MINUTES * MINUTE;

export type AlertRow = {
  id: string;
  kind: string;
  run_id: string | null;
  briefing_id: string | null;
  detail: string | null;
};

export interface WatchdogDeps {
  /** Restarts the worker service (its Task Scheduler task on Windows, the systemd unit on Linux). */
  restartWorker(): Promise<void>;
  /** Sends one Alert to Lark and returns its message id (the Lark bot, lark.ts alertSender). */
  sendAlert?(alert: AlertRow): Promise<string | null>;
  /** The global briefing checks (spec §3 "Delivery"), with the shared group the briefing is posted to. */
  briefings?: { sharedChat: string | null };
}

export async function watchdogPass(ctx: Ctx, deps: WatchdogDeps) {
  const lock = await ctx.pool.connect();
  try {
    const { rows } = await lock.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [WATCHDOG_LOCK]);
    if (!rows[0]!.ok) return { locked: true as const };
    try {
      return { locked: false as const, ...(await pass(ctx, deps)) };
    } finally {
      await lock.query('select pg_advisory_unlock($1)', [WATCHDOG_LOCK]);
    }
  } finally {
    lock.release();
  }
}

async function cancelJob(ctx: Ctx, jobId: string | null, bossDb: { executeSql(t: string, v?: unknown[]): Promise<{ rows: unknown[] }> }) {
  if (jobId) await ctx.boss.cancel(CRAWL, jobId, { db: bossDb });
}

/**
 * Whether a cool-down covers `slot`: from the end of a run that stopped on a block to the blocked_until it
 * set (spec §1 "Blocked slot"); for a row that is still `scheduled`, also the current blocked_until, since
 * its job may have waited behind the very run that set it.
 */
async function coolDownCovering(db: Db, slot: Date, current: boolean): Promise<boolean> {
  const { rows } = await db.execute(sql`
    select 1 from crawl_runs where blocked_until is not null and finished_at <= ${slot} and ${slot} < blocked_until
    union all select 1 from crawler_state where ${current} and blocked_until > ${slot} limit 1`);
  return rows.length > 0;
}

/** Closes a blocked slot: `stopped`, all its planned searches `skipped`, a `blocked` Alert. */
async function closeBlockedSlot(db: Db, runId: string, planned: number, s: Settings, at: Date) {
  const { rows } = await db.execute(sql`update crawl_runs set status = 'stopped', finished_at = ${at}, block_reason = 'cool-down' where id = ${runId} and status = 'scheduled' returning id`);
  if (rows.length === 0) return false;
  await insertSkipped(db, runId, planned, s);
  await insertAlert(db, { kind: 'blocked', runId, affected: planned, detail: 'slot inside a cool-down', at });
  return true;
}

async function insertSkipped(db: Db, runId: string, planned: number, s: Settings) {
  const { rows } = await db.execute<{ rotation_cursor: number | null }>(sql`select rotation_cursor from crawler_state where id = 1`);
  const pairs = rotate(await activePairs(db, s), planned, Number(rows[0]?.rotation_cursor ?? 0)).pairs;
  for (const p of pairs) {
    await db.execute(sql`
      insert into crawl_searches (id, run_id, keyword_id, country, status) values (${`srch_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`}, ${runId}, ${p.keywordId}, ${p.country}, 'skipped')
      on conflict do nothing`);
  }
  await db.execute(sql`update crawl_runs set planned_searches = ${pairs.length} where id = ${runId}`);
}

async function pass(ctx: Ctx, deps: WatchdogDeps) {
  const now = ctx.clock.now();
  const s = await loadSettings(ctx.db);
  const result = { notStarted: 0, missed: 0, blockedSlots: 0, backfilled: 0, hungRuns: 0, heartbeatLost: false, restarted: false, alertsSent: 0, alertsTooOld: 0, alertsLeft: 0 };

  // Manual and cli rows still `scheduled` after their deadline.
  const { rows: late } = await ctx.db.execute<{ id: string; job_id: string | null }>(sql`
    select id, job_id from crawl_runs where status = 'scheduled' and trigger in ('manual', 'cli') and deadline <= ${now}`);
  for (const r of late) {
    await withTx(ctx.pool, async ({ db, bossDb }) => {
      if (await closeNotStarted(db, r.id, now)) {
        await cancelJob(ctx, r.job_id, bossDb);
        result.notStarted += 1;
      }
    });
  }

  // Scheduled slots that passed without starting: a blocked slot, or `missed` 15 min after the slot.
  const { rows: due } = await ctx.db.execute<{ id: string; scheduled_for: Date; planned_searches: number; job_id: string | null }>(sql`
    select id, scheduled_for, planned_searches, job_id from crawl_runs
    where status = 'scheduled' and trigger = 'schedule' and scheduled_for <= ${now}`);
  for (const r of due) {
    await withTx(ctx.pool, async ({ db, bossDb }) => {
      const slot = new Date(r.scheduled_for);
      if (await coolDownCovering(db, slot, true)) {
        if (await closeBlockedSlot(db, r.id, r.planned_searches, s, now)) {
          await cancelJob(ctx, r.job_id, bossDb);
          result.blockedSlots += 1;
        }
      } else if (slot.getTime() + s.missedRunGraceMinutes * MINUTE <= now.getTime()) {
        const { rows } = await db.execute(sql`update crawl_runs set status = 'missed' where id = ${r.id} and status = 'scheduled' returning id`);
        if (rows.length) {
          await insertAlert(db, { kind: 'missed_run', runId: r.id, affected: r.planned_searches, at: now });
          await cancelJob(ctx, r.job_id, bossDb);
          result.missed += 1;
        }
      }
    });
  }

  result.backfilled = await backfill(ctx, s, now);

  // Hung runs: a stale heartbeat, or the deadline plus grace passed.
  const { rows: state } = await ctx.db.execute<{ heartbeat_at: Date | null; worker_restart_at: Date | null }>(sql`
    select heartbeat_at, worker_restart_at from crawler_state where id = 1`);
  const heartbeatAt = state[0]?.heartbeat_at ? new Date(state[0].heartbeat_at) : null;
  const stale = !heartbeatAt || now.getTime() - heartbeatAt.getTime() > s.heartbeatThresholdMinutes * MINUTE;
  const { rows: running } = await ctx.db.execute<{ id: string; deadline: Date; job_id: string | null }>(sql`
    select id, deadline, job_id from crawl_runs where status = 'running'`);
  for (const r of running) {
    const overrun = now.getTime() > new Date(r.deadline).getTime() + s.watchdogGraceMinutes * MINUTE;
    if (!stale && !overrun) continue;
    const closed = await withTx(ctx.pool, async ({ db, bossDb }) => {
      if (!(await failRunningRun(db, r.id, now, stale ? 'heartbeat lost' : 'deadline plus grace passed'))) return false;
      if (r.job_id) await ctx.boss.fail(CRAWL, r.job_id, { reason: 'watchdog' }, { db: bossDb });
      return true;
    });
    if (closed) result.hungRuns += 1;
  }

  // heartbeat_lost: one open incident from a missing heartbeat only, resolved by a fresh one.
  if (stale && heartbeatAt !== null) {
    await insertAlert(ctx.db, { kind: 'heartbeat_lost', detail: `last heartbeat ${heartbeatAt.toISOString()}`, at: now });
    result.heartbeatLost = true;
  } else if (!stale) {
    await ctx.db.execute(sql`update alerts set resolved_at = ${now} where kind = 'heartbeat_lost' and resolved_at is null`);
  }
  // Restart after closing a hung run, and on every pass while the heartbeat_lost incident is open (the
  // worker hung while idle, or an earlier restart failed or did not help), at most once per 5 min so a
  // worker that is still starting is left alone.
  const lastRestart = state[0]?.worker_restart_at ? new Date(state[0].worker_restart_at).getTime() : null;
  const restartDue = lastRestart === null || now.getTime() - lastRestart >= RESTART_EVERY_MS;
  if (result.hungRuns > 0 || (result.heartbeatLost && restartDue)) {
    await ctx.db.execute(sql`update crawler_state set worker_restart_at = ${now} where id = 1`);
    result.restarted = await deps.restartWorker().then(
      () => true,
      (e) => {
        ctx.log('worker restart failed', { error: String(e) });
        return false;
      },
    );
  }

  if (deps.briefings) await checkGlobalBriefing(ctx, s, now, deps.briefings.sharedChat);

  if (deps.sendAlert) {
    const started = ctx.clock.now().getTime();
    const skipped = await ctx.db.execute(sql`
      update alerts set lark_skipped_at = ${ctx.clock.now()}
      where sent_at is null and lark_skipped_at is null and created_at < ${new Date(started - ALERT_MAX_AGE_MS)}`);
    result.alertsTooOld = skipped.rowCount ?? 0;
    const { rows: unsent } = await ctx.db.execute<AlertRow>(sql`
      select id, kind, run_id, briefing_id, detail from alerts where sent_at is null and lark_skipped_at is null order by created_at`);
    for (const [i, a] of unsent.entries()) {
      if (ctx.clock.now().getTime() - started >= ALERT_BUDGET_MS) {
        result.alertsLeft = unsent.length - i;
        break;
      }
      const messageId = await deps.sendAlert(a).catch(() => null);
      if (messageId) {
        await ctx.db.execute(sql`update alerts set lark_message_id = ${messageId}, sent_at = ${ctx.clock.now()} where id = ${a.id}`);
        result.alertsSent += 1;
      }
    }
  }
  return result;
}

/**
 * Once today's ready time has passed: `briefing_late` when the global briefing has no `ready_at` by then
 * (its row is created if no build started, since the Alert points at it), else `lark_send_failed` when the
 * shared group has no Lark message id (retries run out, an expired or a cancelled job). One of each per
 * briefing (alerts_briefing_kind_key).
 */
async function checkGlobalBriefing(ctx: Ctx, s: Settings, now: Date, sharedChat: string | null) {
  const today = vietnamDate(now);
  const readyBy = vietnamInstant(today, s.briefingReadyTime);
  if (now < readyBy) return;
  await ctx.db.execute(sql`
    insert into briefings (id, date, scope, created_at) values (${`brf_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`}, ${today}, 'global', ${now})
    on conflict on constraint briefings_date_scope_key do nothing`);
  const { rows } = await ctx.db.execute<{ id: string; ready_at: Date | null; posted: boolean }>(sql`
    select b.id, b.ready_at, exists (select 1 from lark_messages m where m.briefing_id = b.id and m.message_id is not null
      and (${sharedChat}::text is null or m.chat = ${sharedChat})) as posted
    from briefings b where b.date = ${today} and b.scope = 'global'`);
  const b = rows[0]!;
  if (!b.ready_at || new Date(b.ready_at) > readyBy) {
    await insertAlert(ctx.db, { kind: 'briefing_late', briefingId: b.id, detail: `global briefing ${today} not ready by ${s.briefingReadyTime}`, at: now });
  } else if (!b.posted) {
    await insertAlert(ctx.db, { kind: 'lark_send_failed', briefingId: b.id, detail: `global briefing ${today} has no Lark message id for the shared group by ${s.briefingReadyTime}`, at: now });
  }
}

/**
 * A row for every past slot without one, judged by the run times in force then (run_time_changes),
 * at most 14 days back and never before the first change: `missed`, or a blocked slot inside a cool-down.
 */
async function backfill(ctx: Ctx, s: Settings, now: Date): Promise<number> {
  const { rows: changes } = await ctx.db.execute<{ run_times: string[]; effective_from: Date }>(sql`
    select run_times, effective_from from run_time_changes order by effective_from`);
  if (changes.length === 0) return 0;
  const until = new Date(now.getTime() - s.missedRunGraceMinutes * MINUTE);
  const from = new Date(Math.max(now.getTime() - BACKFILL_DAYS * DAY, new Date(changes[0]!.effective_from).getTime()));
  const planned = plannedSearches(s.searchBudget, (await activePairs(ctx.db, s)).length);
  let n = 0;
  for (const [i, c] of changes.entries()) {
    const start = new Date(Math.max(from.getTime(), new Date(c.effective_from).getTime()));
    const end = new Date(Math.min(until.getTime(), changes[i + 1] ? new Date(changes[i + 1]!.effective_from).getTime() : until.getTime()));
    if (start >= end) continue;
    for (const slot of slotsBetween(c.run_times, start, end)) {
      await withTx(ctx.pool, async ({ db }) => {
        const blocked = await coolDownCovering(db, slot, false);
        const id = `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`;
        const { rows } = await db.execute(sql`
          insert into crawl_runs (id, source, trigger, scheduled_for, status, planned_searches, deadline)
          values (${id}, ${SOURCE}, 'schedule', ${slot}, 'scheduled', ${planned}, ${slot})
          on conflict (source, scheduled_for) where trigger = 'schedule' do nothing returning id`);
        if (rows.length === 0) return;
        if (blocked) await closeBlockedSlot(db, id, planned, s, now);
        else {
          await db.execute(sql`update crawl_runs set status = 'missed' where id = ${id}`);
          await insertAlert(db, { kind: 'missed_run', runId: id, affected: planned, detail: 'no row for this slot', at: now });
        }
        n += 1;
      });
    }
  }
  return n;
}
