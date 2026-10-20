// The three pg-boss queues (plan Step 3 "Queues"; ADR 0001 "Jobs and schedule"), checked in the pinned
// pg-boss 12.37.0: `singleton` is index job_i2 (one active job, any number queued), `exclusive` job_i6
// (one queued or active per singletonKey), `standard` has none (dist/migrationStore.js).
import { type Settings, crawlJobExpirySeconds } from '@ideas-hub/core';
import { type BossDb } from '@ideas-hub/db/client';
import { type PgBoss } from 'pg-boss';

export const CRAWL = 'crawl.run';
export const BRIEFING = 'briefing.build';
export const LARK = 'lark.send';

export async function createQueues(boss: PgBoss, s: Settings) {
  // retryLimit 0: the pg-boss default of 2 (dist/plans.js QUEUE_DEFAULTS) would run an expired run again.
  await boss.createQueue(CRAWL, { policy: 'singleton', retryLimit: 0, expireInSeconds: crawlJobExpirySeconds(s) });
  await boss.createQueue(BRIEFING, { policy: 'exclusive', retryLimit: 1, expireInSeconds: s.briefingJobExpirySeconds });
  await boss.createQueue(LARK, { policy: 'standard', retryLimit: LARK_RETRY_LIMIT, retryDelay: 30 });
}

export interface CrawlJob {
  runId: string;
}

/** Sends a run's job in the caller's transaction; returns its id for `crawl_runs.job_id`. */
export async function sendCrawlJob(boss: PgBoss, db: BossDb, runId: string, startAfter: Date, s: Settings): Promise<string> {
  const id = await boss.send(CRAWL, { runId } satisfies CrawlJob, {
    startAfter,
    retryLimit: 0,
    expireInSeconds: crawlJobExpirySeconds(s),
    db,
  });
  if (!id) throw new Error(`crawl.run job for ${runId} was not queued`);
  return id;
}

export interface BriefingJob {
  /** Asia/Ho_Chi_Minh date of the briefing. */
  date: string;
  scope: 'global' | 'keyword';
  keywordId?: string;
}

export const briefingKey = (j: BriefingJob) => (j.scope === 'global' ? `${j.date}:global` : `${j.date}:kw:${j.keywordId}`);

/** pg-boss fetches by priority desc, then created_on, so the global job goes first even when sent together. */
export const GLOBAL_PRIORITY = 10;

/** Sends one briefing's build (exclusive queue): null while a job of the same key is queued or active. */
export async function sendBriefingJob(boss: PgBoss, db: BossDb, job: BriefingJob, startAfter: Date, s: Settings): Promise<string | null> {
  return boss.send(BRIEFING, job, {
    singletonKey: briefingKey(job),
    priority: job.scope === 'global' ? GLOBAL_PRIORITY : 0,
    startAfter,
    retryLimit: 1,
    expireInSeconds: s.briefingJobExpirySeconds,
    db,
  });
}

export interface LarkJob {
  briefingId: string;
  chat: string;
}

export const LARK_RETRY_LIMIT = 3;

export async function sendLarkJob(boss: PgBoss, db: BossDb, job: LarkJob): Promise<string | null> {
  return boss.send(LARK, job, { retryLimit: LARK_RETRY_LIMIT, retryDelay: 30, db });
}

/** Ids of a queue's active jobs (pg-boss keeps them in pgboss.job). */
export async function activeJobIds(db: BossDb, name: string): Promise<string[]> {
  const { rows } = await db.executeSql(`select id from pgboss.job where name = $1 and state = 'active'`, [name]);
  return (rows as { id: string }[]).map((r) => r.id);
}

export async function jobState(db: BossDb, name: string, id: string): Promise<{ state: string; startAfter: Date; expireSeconds: number } | null> {
  const { rows } = await db.executeSql(
    `select state, start_after as "startAfter", expire_seconds as "expireSeconds" from pgboss.job where name = $1 and id = $2`,
    [name, id],
  );
  return (rows[0] as { state: string; startAfter: Date; expireSeconds: number } | undefined) ?? null;
}
