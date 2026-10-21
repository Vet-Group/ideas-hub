// What every worker and watchdog step gets injected: database, queue, clock, object store, settings.
import { DEFAULT_SETTINGS, type Settings } from '@ideas-hub/core';
import { type Db } from '@ideas-hub/db/client';
import { settings as settingsTable } from '@ideas-hub/db';
import type pg from 'pg';
import { type PgBoss } from 'pg-boss';

export const SOURCE = 'fb_ad_library';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Object storage (MinIO in development); keys include their prefix (`thumbs/…`). */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Succeeds when the key has no object. */
  delete(key: string): Promise<void>;
}

export interface Ctx {
  pool: pg.Pool;
  db: Db;
  boss: PgBoss;
  clock: Clock;
  store: ObjectStore;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Settings rows over the defaults, so a key not stored yet keeps its default. */
export async function loadSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(settingsTable);
  return { ...(DEFAULT_SETTINGS as unknown as Settings), ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export const consoleLog: Ctx['log'] = (msg, extra) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));
