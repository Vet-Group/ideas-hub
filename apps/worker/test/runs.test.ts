import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markSearchRunning } from '../src/runs';
import { type Harness, harness, insertRun, one, seedKeywords } from './helpers';

describe.skipIf(!testDatabaseAvailable())('markSearchRunning', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await seedKeywords(h, 1);
  }, 60_000);
  afterAll(() => h?.close());

  it('waits for a close in progress and then refuses, so no search is left running on a stopped run', async () => {
    const id = await insertRun(h, { scheduledFor: h.clock.now(), deadline: new Date(h.clock.t + 3_600_000), status: 'running' });
    await h.db.execute(sql`insert into crawl_searches (id, run_id, keyword_id, country, status) values ('m1', ${id}, 'kw_0', 'US', 'pending')`);
    // A watchdog close, half done and not committed yet (failRunningRun's statements, in order).
    const closer = await h.pool.connect();
    try {
      await closer.query('begin');
      await closer.query(`update crawl_runs set status = 'stopped' where id = $1 and status = 'running'`, [id]);
      await closer.query(`update crawl_searches set status = 'interrupted' where run_id = $1 and status = 'running'`, [id]);
      const marking = markSearchRunning(h.pool, id, 'm1', h.clock.now());
      await new Promise((r) => setTimeout(r, 300));
      await closer.query(`update crawl_searches set status = 'skipped' where run_id = $1 and status = 'pending'`, [id]);
      await closer.query('commit');
      expect(await marking).toBe(false);
    } finally {
      closer.release();
    }
    expect(await one(h, sql`select status from crawl_searches where id = 'm1'`)).toEqual({ status: 'skipped' });
  });

  it('marks a pending search of a running run', async () => {
    const id = await insertRun(h, { scheduledFor: new Date(h.clock.t + 60_000), deadline: new Date(h.clock.t + 3_600_000), status: 'running' });
    await h.db.execute(sql`insert into crawl_searches (id, run_id, keyword_id, country, status) values ('m2', ${id}, 'kw_0', 'US', 'pending')`);
    expect(await markSearchRunning(h.pool, id, 'm2', h.clock.now())).toBe(true);
    expect(await one(h, sql`select status from crawl_searches where id = 'm2'`)).toEqual({ status: 'running' });
  });
});
