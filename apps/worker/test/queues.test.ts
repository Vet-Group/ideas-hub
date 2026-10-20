import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CRAWL, sendCrawlJob } from '../src/queues';
import { type Harness, S, harness } from './helpers';

describe.skipIf(!testDatabaseAvailable())('crawl.run queue', () => {
  let h: Harness;
  const bossDb = () => ({ executeSql: (t: string, v?: unknown[]) => h.pool.query(t, v) });
  beforeAll(async () => {
    h = await harness();
  }, 60_000);
  afterAll(() => h?.close());

  it('a second crawl.run job waits while one is active (policy singleton)', async () => {
    const a = await sendCrawlJob(h.boss, bossDb(), 'run_a', new Date(0), S);
    const b = await sendCrawlJob(h.boss, bossDb(), 'run_b', new Date(0), S);
    const [first] = await h.boss.fetch(CRAWL);
    expect(first?.id).toBe(a);
    expect(await h.boss.fetch(CRAWL)).toEqual([]);
    await h.boss.complete(CRAWL, a);
    const [second] = await h.boss.fetch(CRAWL);
    expect(second?.id).toBe(b);
  });

  it('jobs carry retryLimit 0 and expireInSeconds 17400 with the defaults', async () => {
    const id = await sendCrawlJob(h.boss, bossDb(), 'run_c', new Date(0), S);
    const { rows } = await h.pool.query('select retry_limit, expire_seconds, policy from pgboss.job where id = $1', [id]);
    expect(rows[0]).toEqual({ retry_limit: 0, expire_seconds: 17400, policy: 'singleton' });
  });
});
