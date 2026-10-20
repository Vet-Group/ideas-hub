// Failed sign-ins per client IP and per email. better-auth 1.7.7 rate-limits only requests through its
// HTTP handler (dist/api/index.mjs, router onRequest → onRequestRateLimit); the sign-in server action calls
// auth.api.signInEmail directly, which skips that limiter, so the action applies this one.
import { loginFailures } from '@ideas-hub/db';
import { and, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { db } from './db';

export const MAX_FAILURES = 10;
export const WINDOW_MS = 10 * 60_000;

/**
 * Counts one sign-in attempt on every key, in Postgres so every server process sees it, and says whether it
 * may go ahead. The count goes up before the password check and a success clears it, so attempts sent in
 * parallel cannot all pass a stale read; a key that is already over the limit is refused without a write.
 */
export async function takeAttempt(keys: string[], now = new Date()): Promise<boolean> {
  const live = and(inArray(loginFailures.key, keys), gt(loginFailures.resetAt, now));
  const blocked = await db.select({ key: loginFailures.key }).from(loginFailures).where(and(live, gte(loginFailures.count, MAX_FAILURES))).limit(1);
  if (blocked.length) return false;

  const resetAt = new Date(now.getTime() + WINDOW_MS);
  const expired = sql`${loginFailures.resetAt} <= ${now.toISOString()}::timestamptz`;
  const rows = await db
    .insert(loginFailures)
    .values(keys.map((key) => ({ key, count: 1, resetAt })))
    .onConflictDoUpdate({
      target: loginFailures.key,
      set: {
        count: sql`case when ${expired} then 1 else ${loginFailures.count} + 1 end`,
        resetAt: sql`case when ${expired} then ${resetAt.toISOString()}::timestamptz else ${loginFailures.resetAt} end`,
      },
    })
    .returning({ count: loginFailures.count });
  // Prunes expired rows; skips those a concurrent attempt has locked, so it never waits on them.
  await db.execute(
    sql`delete from ${loginFailures} where ${loginFailures.key} in (select ${loginFailures.key} from ${loginFailures} where ${loginFailures.resetAt} <= ${now.toISOString()}::timestamptz for update skip locked)`,
  );
  return rows.every((r) => r.count <= MAX_FAILURES);
}

export async function clearFailures(keys: string[]) {
  // One row per statement: a two-row delete could lock in the other order than takeAttempt's upsert and deadlock.
  for (const key of keys) await db.delete(loginFailures).where(eq(loginFailures.key, key));
}
