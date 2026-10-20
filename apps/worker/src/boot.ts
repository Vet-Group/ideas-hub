// Shared start-up of the worker, the watchdog and the CLI: environment, pool, pg-boss, context.
import { createDb, createPool, databaseUrl } from '@ideas-hub/db/client';
import { PgBoss } from 'pg-boss';
import { type Ctx, type ObjectStore, consoleLog, systemClock } from './context';
import { s3StoreFromEnv } from './s3';

// pg-boss polling stays at its defaults (2 s and 30 s); 120 s or more would starve the idle heartbeat.
export async function boot(opts: { store?: ObjectStore; poolSize?: number } = {}): Promise<Ctx & { stop: () => Promise<void> }> {
  const url = databaseUrl();
  const pool = createPool(url, opts.poolSize ?? 5);
  const boss = new PgBoss({ connectionString: url });
  boss.on('error', (e) => consoleLog('pg-boss error', { error: String(e) }));
  await boss.start();
  const ctx: Ctx = { pool, db: createDb(pool), boss, clock: systemClock, store: opts.store ?? s3StoreFromEnv(), log: consoleLog };
  return {
    ...ctx,
    stop: async () => {
      await boss.stop({ graceful: false });
      await pool.end();
    },
  };
}
