// Crash recovery at worker startup, before it takes any job (spec §1 "Crash recovery").
import { withTx } from '@ideas-hub/db/client';
import { sql } from 'drizzle-orm';
import { resendUnfinished } from './briefing';
import { type Ctx, loadSettings } from './context';
import { BRIEFING, CRAWL, LARK, activeJobIds, sendCrawlJob } from './queues';
import { closeNotStarted, failRunningRun, insertAlert } from './runs';

export async function recoverAtStartup(ctx: Ctx) {
  const now = ctx.clock.now();
  const s = await loadSettings(ctx.db);
  const pool = { executeSql: (t: string, v?: unknown[]) => ctx.pool.query(t, v) };

  // Runs left `running` by a crash: stopped with run_failed, their job failed so the singleton is free.
  const { rows: running } = await ctx.db.execute<{ id: string; job_id: string | null }>(sql`select id, job_id from crawl_runs where status = 'running'`);
  for (const run of running) {
    await withTx(ctx.pool, async ({ db, bossDb }) => {
      await failRunningRun(db, run.id, now, 'worker restarted while the run was running');
      if (run.job_id) await ctx.boss.fail(CRAWL, run.job_id, { reason: 'crash recovery' }, { db: bossDb });
    });
  }

  // A row still `scheduled` whose job is active: the crash came between taking the job and the start.
  const active = new Set(await activeJobIds(pool, CRAWL));
  const { rows: scheduled } = await ctx.db.execute<{ id: string; trigger: string; deadline: Date; job_id: string }>(sql`
    select id, trigger, deadline, job_id from crawl_runs where status = 'scheduled' and job_id is not null`);
  for (const row of scheduled.filter((r) => active.has(r.job_id))) {
    await withTx(ctx.pool, async ({ db, bossDb }) => {
      await ctx.boss.fail(CRAWL, row.job_id, { reason: 'crash recovery' }, { db: bossDb });
      if (now < new Date(row.deadline)) {
        const jobId = await sendCrawlJob(ctx.boss, bossDb, row.id, now, s);
        await db.execute(sql`update crawl_runs set job_id = ${jobId} where id = ${row.id}`);
      } else if (row.trigger === 'schedule') {
        const { rows } = await db.execute(sql`update crawl_runs set status = 'missed' where id = ${row.id} and status = 'scheduled' returning id`);
        if (rows.length) await insertAlert(db, { kind: 'missed_run', runId: row.id, at: now });
      } else {
        await closeNotStarted(db, row.id, now);
      }
    });
  }
  for (const id of active) if (!scheduled.some((r) => r.job_id === id) && !running.some((r) => r.job_id === id)) {
    // An active job with no row left to run.
    await ctx.boss.fail(CRAWL, id, { reason: 'crash recovery' });
  }

  // briefing.build is cancelled, not failed: fail() would move it to `retry`, which job_i6 still
  // covers, so sending it again would return null. lark.send is failed so it retries with its uuid.
  const briefing = await activeJobIds(pool, BRIEFING);
  if (briefing.length) await ctx.boss.cancel(BRIEFING, briefing);
  const lark = await activeJobIds(pool, LARK);
  if (lark.length) await ctx.boss.fail(LARK, lark, { reason: 'crash recovery' });
  // Then today's briefings without ready_at are built again, once today's build time has passed.
  const briefingResent = await resendUnfinished(ctx, s, now);
  return { failedRuns: running.length, briefingCancelled: briefing.length, larkFailed: lark.length, briefingResent };
}
