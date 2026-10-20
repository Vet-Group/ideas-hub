import 'server-only';
import { type Settings, manualDeadline, nextSlotAfter } from '@ideas-hub/core';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { formatTime } from './format';
import { t } from './strings.vi';

export { mayRunNow } from './run-now-rules';

/**
 * Why Run now would be refused right now, as the worker's checks (apps/worker/src/manual.ts) would
 * refuse it, or null when it would start. The button stays visible but disabled with this reason.
 */
export async function runNowBlocker(s: Settings, at: Date): Promise<string | null> {
  const { rows } = await db.execute<{ blocked_until: string | null; running: boolean; pending: boolean }>(sql`
    select (select blocked_until from crawler_state where id = 1) as blocked_until,
      exists (select 1 from crawl_runs where status = 'running') as running,
      exists (select 1 from crawl_runs where trigger in ('manual', 'cli') and status in ('scheduled', 'running')) as pending`);
  const state = rows[0]!;
  if (state.blocked_until && new Date(state.blocked_until) > at) return t.runNow.blocked(formatTime(new Date(state.blocked_until)));
  if (state.running || state.pending) return t.runNow.running;
  if (manualDeadline(at, s) <= at) {
    const next = nextSlotAfter(s.runTimes, at);
    return t.runNow.noTime(next ? formatTime(next) : '');
  }
  return null;
}
