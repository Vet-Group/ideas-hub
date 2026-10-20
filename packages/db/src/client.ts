// Connections and transactions shared by the worker, the watchdog and the web app.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/** What pg-boss calls with `{ db }`, so a job is sent in the caller's transaction. */
export interface BossDb {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface Tx {
  db: Db;
  client: pg.PoolClient;
  bossDb: BossDb;
}

export function createPool(connectionString: string, max = 5): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

const bossDbOf = (client: pg.PoolClient | pg.Pool): BossDb => ({
  executeSql: (text, values) => client.query(text, values as unknown[]),
});

/** One transaction on one connection, for drizzle queries and pg-boss calls alike. */
export async function withTx<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn({ db: drizzle(client, { schema }), client, bossDb: bossDbOf(client) });
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Reads DATABASE_URL, loading the repo's .env when present (local runs; CI sets the variable). */
export function databaseUrl(): string {
  try {
    process.loadEnvFile(new URL('../../../.env', import.meta.url));
  } catch {
    // No .env file.
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}
