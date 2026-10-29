// The scheduler (plan Step 3): every minute it keeps 14 days of `schedule` rows written with their
// deadline, planned searches and job, records run-time changes, and rewrites future rows (and re-sends
// their jobs, cancel and send in one transaction) when settings change. It also sends the briefing
// builds of the next build time (briefing.ts scheduleBriefings) and the next angle tagging job (angles.ts). Settings that fail validation stop all of
// this and write a `settings_invalid` Alert.
import { crawlJobExpirySeconds, plannedSearches, scheduledDeadline, slotsBetween, validateSettings } from '@ideas-hub/core';
import { withTx } from '@ideas-hub/db/client';
import { sql } from 'drizzle-orm';
import { scheduleAngles } from './angles';
import { scheduleBriefings } from './briefing';
import { type Ctx, SOURCE, loadSettings } from './context';
import { CRAWL, jobState, sendCrawlJob } from './queues';
import { activePairs, insertAlert } from './runs';

const DAY = 86_400_000;
export const SCHEDULE_DAYS = 14;

export interface SchedulerHooks {
  /** Test hook: runs between cancel() and send() of a re-sent job. */
  betweenCancelAndSend?: () => Promise<void>;
}

const sameTimes = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();

export async function schedulerPass(ctx: Ctx, hooks: SchedulerHooks = {}) {
  const now = ctx.clock.now();
  const s = await loadSettings(ctx.db);
  const problems = validateSettings(s);
  if (problems.length) {
    ctx.log('scheduler: settings rejected, rows left as they are', { problems });
    // One per local day (alerts_settings_invalid_day_key); the watchdog sends it to Lark.
    await insertAlert(ctx.db, { kind: 'settings_invalid', detail: problems.join(', '), at: now });
    return { problems };
  }
  const planned = plannedSearches(s.searchBudget, (await activePairs(ctx.db, s)).length);

  // A change of run times is recorded once, effective now, and only future rows change.
  const { rows: last } = await ctx.db.execute<{ run_times: string[] }>(sql`select run_times from run_time_changes order by effective_from desc limit 1`);
  if (!last[0] || !sameTimes(last[0].run_times, s.runTimes)) {
    await ctx.db.execute(sql`
      insert into run_time_changes (id, run_times, effective_from) values (${`rtc_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`}, ${JSON.stringify(s.runTimes)}::jsonb, ${now})`);
  }

  const slots = slotsBetween(s.runTimes, now, new Date(now.getTime() + SCHEDULE_DAYS * DAY));
  const wanted = new Set(slots.map((d) => d.getTime()));
  const { rows: future } = await ctx.db.execute<{ id: string; scheduled_for: Date; deadline: Date; planned_searches: number; job_id: string | null }>(sql`
    select id, scheduled_for, deadline, planned_searches, job_id from crawl_runs
    where source = ${SOURCE} and trigger = 'schedule' and status = 'scheduled' and scheduled_for > ${now}`);

  let inserted = 0;
  let resent = 0;
  let removed = 0;
  for (const row of future) {
    const slot = new Date(row.scheduled_for);
    if (!wanted.has(slot.getTime())) {
      // A slot of the old run times: its future row and job go.
      await withTx(ctx.pool, async ({ db, bossDb }) => {
        if (row.job_id) await ctx.boss.cancel(CRAWL, row.job_id, { db: bossDb });
        await db.execute(sql`delete from crawl_runs where id = ${row.id} and status = 'scheduled'`);
      });
      removed += 1;
      continue;
    }
    const deadline = scheduledDeadline(slot, s);
    const job = row.job_id ? await jobState({ executeSql: (t, v) => ctx.pool.query(t, v as unknown[]) }, CRAWL, row.job_id) : null;
    const jobOk = job && job.state === 'created' && new Date(job.startAfter).getTime() === slot.getTime() && job.expireSeconds === crawlJobExpirySeconds(s);
    if (new Date(row.deadline).getTime() === deadline.getTime() && row.planned_searches === planned && jobOk) continue;
    await withTx(ctx.pool, async ({ db, bossDb }) => {
      await db.execute(sql`update crawl_runs set deadline = ${deadline}, planned_searches = ${planned} where id = ${row.id} and status = 'scheduled'`);
      if (jobOk) return;
      if (row.job_id) await ctx.boss.cancel(CRAWL, row.job_id, { db: bossDb });
      await hooks.betweenCancelAndSend?.();
      const jobId = await sendCrawlJob(ctx.boss, bossDb, row.id, slot, s);
      await db.execute(sql`update crawl_runs set job_id = ${jobId} where id = ${row.id}`);
      resent += 1;
    });
  }

  const have = new Set(future.map((r) => new Date(r.scheduled_for).getTime()));
  for (const slot of slots) {
    if (have.has(slot.getTime())) continue;
    await withTx(ctx.pool, async ({ db, bossDb }) => {
      const id = `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`;
      // The deadline is stored before the job is sent; the watchdog backfill may have the slot already.
      const { rows } = await db.execute(sql`
        insert into crawl_runs (id, source, trigger, scheduled_for, status, planned_searches, deadline)
        values (${id}, ${SOURCE}, 'schedule', ${slot}, 'scheduled', ${planned}, ${scheduledDeadline(slot, s)})
        on conflict (source, scheduled_for) where trigger = 'schedule' do nothing returning id`);
      if (rows.length === 0) return;
      const jobId = await sendCrawlJob(ctx.boss, bossDb, id, slot, s);
      await db.execute(sql`update crawl_runs set job_id = ${jobId} where id = ${id}`);
      inserted += 1;
    });
  }
  const { briefingsSent, briefingsResent } = await scheduleBriefings(ctx, s, now);
  const anglesSent = (await scheduleAngles(ctx, now)) !== null;
  return { problems, inserted, resent, removed, briefingsSent, briefingsResent, anglesSent };
}
