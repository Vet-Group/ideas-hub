// Run now and `pnpm crawl:run` (spec §1 "Run now"): one `scheduled` row with its requested pairs and
// deadline, and its job sent to start at once, in one transaction; refused in the cases below.
import { type Settings, manualDeadline, plannedSearches } from '@ideas-hub/core';
import { withTx } from '@ideas-hub/db/client';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { type PgBoss } from 'pg-boss';
import { SOURCE } from './context';
import { sendCrawlJob } from './queues';

export type RunRefusal = 'blocked' | 'run_running' | 'manual_pending' | 'no_time' | 'no_pairs';

export interface RunRequest {
  trigger: 'manual' | 'cli';
  pairs: { keywordId: string; country: string }[];
  /** The user for `manual` runs; null for `cli`. */
  triggeredBy: string | null;
  now: Date;
  /** Test hook: runs between the insert and the job send. */
  afterInsert?: () => Promise<void>;
}

export type RunRequestResult = { ok: true; runId: string; deadline: Date; blockedUntil?: never } | { ok: false; reason: RunRefusal; blockedUntil?: Date };

const UNIQUE_VIOLATION = '23505';

export async function requestRun(pool: pg.Pool, boss: PgBoss, s: Settings, req: RunRequest): Promise<RunRequestResult> {
  if (req.pairs.length === 0) return { ok: false, reason: 'no_pairs' };
  const deadline = manualDeadline(req.now, s);
  try {
    return await withTx(pool, async ({ db, bossDb }) => {
      const { rows } = await db.execute<{ blocked_until: Date | null; running: boolean; pending: boolean }>(sql`
        select (select blocked_until from crawler_state where id = 1) as blocked_until,
          exists (select 1 from crawl_runs where status = 'running') as running,
          exists (select 1 from crawl_runs where trigger in ('manual', 'cli') and status in ('scheduled', 'running')) as pending`);
      const state = rows[0]!;
      // A run's own cool-down reaching the next slot is never a reason to refuse it.
      if (state.blocked_until && new Date(state.blocked_until) > req.now) return { ok: false, reason: 'blocked', blockedUntil: new Date(state.blocked_until) };
      if (state.running) return { ok: false, reason: 'run_running' };
      if (state.pending) return { ok: false, reason: 'manual_pending' };
      if (deadline <= req.now) return { ok: false, reason: 'no_time' };
      const runId = `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`;
      // The partial unique index stops a second request that passed the checks at the same time.
      await db.execute(sql`
        insert into crawl_runs (id, source, trigger, triggered_by, status, requested_pairs, planned_searches, deadline)
        values (${runId}, ${SOURCE}, ${req.trigger}, ${req.triggeredBy}, 'scheduled', ${JSON.stringify(req.pairs)}::jsonb,
          ${plannedSearches(s.searchBudget, req.pairs.length)}, ${deadline})`);
      await req.afterInsert?.();
      const jobId = await sendCrawlJob(boss, bossDb, runId, req.now, s);
      await db.execute(sql`update crawl_runs set job_id = ${jobId} where id = ${runId}`);
      return { ok: true as const, runId, deadline };
    });
  } catch (e) {
    // drizzle wraps the pg error, so the code can sit on `cause`.
    const pgError = e as { code?: string; cause?: { code?: string } };
    if ((pgError.code ?? pgError.cause?.code) === UNIQUE_VIOLATION) return { ok: false, reason: 'manual_pending' };
    throw e;
  }
}
