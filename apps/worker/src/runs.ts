// Run-row helpers shared by the crawl job, crash recovery, the scheduler and the watchdog.
import { type Settings, plannedSearches } from '@ideas-hub/core';
import { type Db } from '@ideas-hub/db/client';
import { sql } from 'drizzle-orm';

export type AlertKind = 'blocked' | 'network_error' | 'parse_error' | 'missed_run' | 'run_failed' | 'heartbeat_lost' | 'briefing_late' | 'lark_send_failed';

/** Inserts an Alert unless its dedupe key already has one (spec §2 "Alert"). */
export async function insertAlert(
  db: Db,
  a: { kind: AlertKind; runId?: string | null; briefingId?: string | null; cooldownSeq?: number | null; affected?: number | null; detail?: string | null; at: Date },
) {
  await db.execute(sql`
    insert into alerts (id, kind, run_id, briefing_id, cooldown_seq, affected_searches, detail, created_at)
    values (${`alert_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`}, ${a.kind}, ${a.runId ?? null}, ${a.briefingId ?? null},
      ${a.cooldownSeq ?? null}, ${a.affected ?? null}, ${a.detail ?? null}, ${a.at})
    on conflict do nothing`);
}

export interface ActivePair {
  keywordId: string;
  text: string;
  country: string;
}

/** Active keyword × country pairs in a stable order: keyword creation, then the settings' country order. */
export async function activePairs(db: Db, s: Pick<Settings, 'countries'>): Promise<ActivePair[]> {
  const { rows } = await db.execute<{ id: string; text: string }>(sql`select id, text from keywords where active order by created_at, id`);
  return rows.flatMap((k) => s.countries.map((country) => ({ keywordId: k.id, text: k.text, country })));
}

export async function plannedForSchedule(db: Db, s: Settings): Promise<number> {
  return plannedSearches(s.searchBudget, (await activePairs(db, s)).length);
}

export async function blockedUntil(db: Db): Promise<Date | null> {
  const { rows } = await db.execute<{ blocked_until: Date | null }>(sql`select blocked_until from crawler_state where id = 1`);
  return rows[0]?.blocked_until ?? null;
}

/**
 * Closes a `running` run as `stopped` with `run_failed` (hung run, crash recovery, unexpected error):
 * its running search becomes `interrupted`, its pending ones `skipped`. Applies only while the row is
 * still `running`; returns whether it did.
 */
export async function failRunningRun(db: Db, runId: string, at: Date, detail: string): Promise<boolean> {
  const { rows } = await db.execute(sql`
    update crawl_runs set status = 'stopped', finished_at = ${at} where id = ${runId} and status = 'running' returning id`);
  if (rows.length === 0) return false;
  await db.execute(sql`update crawl_searches set status = 'interrupted', finished_at = ${at} where run_id = ${runId} and status = 'running'`);
  await db.execute(sql`update crawl_searches set status = 'skipped' where run_id = ${runId} and status = 'pending'`);
  await insertAlert(db, { kind: 'run_failed', runId, detail: detail.slice(0, 1000), at });
  return true;
}

/** Closes a manual or `cli` row that never started (spec §1 "Run now"). */
export async function closeNotStarted(db: Db, runId: string, at: Date): Promise<boolean> {
  const { rows } = await db.execute(sql`
    update crawl_runs set status = 'stopped', close_reason = 'not_started', finished_at = ${at}
    where id = ${runId} and status = 'scheduled' and trigger in ('manual', 'cli') returning id`);
  return rows.length > 0;
}
