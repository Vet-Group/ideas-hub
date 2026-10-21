// What the host's ops scripts and the unattended report sessions call (phase 2 plan Step 2a, ADR 0006):
// ops Alerts deduplicated per key, the deploy's quiet gate, a read-only query runner and a Lark post that
// needs no database.
import { vietnamDate, vietnamInstant } from '@ideas-hub/core';
import { OPS_ALERT_KINDS } from '@ideas-hub/db';
import { type Db } from '@ideas-hub/db/client';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { loadSettings } from './context';
import { larkClientFor, larkConfigFromEnv, larkUuid } from './lark';
import { BRIEFING, CRAWL } from './queues';
import { insertAlert } from './runs';

const MIN = 60_000;
const DAY = 86_400_000;

/** `pnpm ops:alert <kind> <dedupe_key> <detail>`: true when inserted, false when the key already has one. */
export async function opsAlert(db: Db, kind: string, dedupeKey: string, detail: string, at: Date): Promise<boolean> {
  if (!(OPS_ALERT_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown ops Alert kind "${kind}" (${OPS_ALERT_KINDS.join(', ')})`);
  if (!dedupeKey) throw new Error('the dedupe key is empty');
  return insertAlert(db, { kind: kind as (typeof OPS_ALERT_KINDS)[number], dedupeKey, detail: detail.slice(0, 1000), at });
}

/**
 * Why a deploy must not restart anything at `at` (ADR 0006 quiet gate); empty when it may. Derived from the
 * database, so run times changed in /admin/settings are followed: a crawl run running, a scheduled run due
 * within 45 minutes or in the last 10 (a manual run waiting for the worker counts too), an active crawl or
 * briefing job, or 10 minutes before to 40 minutes after the briefing build time.
 */
export async function quietReasons(db: Db, at: Date): Promise<string[]> {
  const { rows } = await db.execute<{ reason: string }>(sql`
    select 'crawl run ' || id || ' is running' as reason from crawl_runs where status = 'running'
    union all
    select 'crawl run ' || id || ' is due ' || coalesce(to_char(scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), 'now (manual)')
    from crawl_runs
    where status = 'scheduled' and (scheduled_for is null or scheduled_for between ${new Date(at.getTime() - 10 * MIN)} and ${new Date(at.getTime() + 45 * MIN)})
    union all
    select name || ' job ' || id || ' is active' from pgboss.job where name in (${CRAWL}, ${BRIEFING}) and state = 'active'`);
  const reasons = rows.map((r) => r.reason);
  const { briefingBuildTime } = await loadSettings(db);
  const build = vietnamInstant(vietnamDate(at), briefingBuildTime).getTime();
  if ([build - DAY, build, build + DAY].some((b) => at.getTime() >= b - 10 * MIN && at.getTime() <= b + 40 * MIN)) {
    reasons.push(`briefing build at ${briefingBuildTime} Asia/Ho_Chi_Minh`);
  }
  return reasons;
}

const cell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180 CSV with a header line; values are Postgres' text forms. */
export const toCsv = (fields: readonly string[], rows: readonly unknown[][]) => [fields, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';

/**
 * `pnpm --silent ro-query`: one SQL text run as the role in `url` with the `pg` client (no psql, so no
 * meta-commands), every result with columns printed as CSV, results separated by a blank line. After
 * `timeoutMs` the query is cancelled from this side with pg_cancel_backend, so a `set statement_timeout = 0`
 * in the text cannot lift the limit. What the role may read or write is its grants' business, not this.
 */
export async function roQuery(url: string, text: string, timeoutMs = 60_000): Promise<string> {
  // Every value as Postgres prints it (dates, json, numerics), not as JavaScript would.
  const client = new pg.Client({ connectionString: url, types: { getTypeParser: () => (v: string) => v } });
  await client.connect();
  let timedOut = false;
  try {
    const pid = (await client.query<{ pid: string }>('select pg_backend_pid() as pid')).rows[0]!.pid;
    const timer = setTimeout(() => {
      timedOut = true;
      void cancelBackend(url, pid);
    }, timeoutMs);
    try {
      const res = (await client.query({ text, rowMode: 'array' })) as unknown as pg.QueryArrayResult | pg.QueryArrayResult[];
      return (Array.isArray(res) ? res : [res])
        .filter((r) => r.fields.length)
        .map((r) => toCsv(r.fields.map((f) => f.name), r.rows))
        .join('\n');
    } catch (e) {
      throw timedOut ? new Error(`query cancelled after ${timeoutMs / 1000} s`) : e;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await client.end();
  }
}

async function cancelBackend(url: string, pid: string) {
  const c = new pg.Client({ connectionString: url });
  try {
    await c.connect();
    await c.query('select pg_cancel_backend($1)', [pid]);
  } catch {
    // The caller's own hard exit covers a cancel that cannot be sent.
  } finally {
    await c.end().catch(() => {});
  }
}

/**
 * `pnpm --silent lark:post`: posts a text to the admin chat through the bot app or the webhook, reading
 * only the environment, so it works while the database is down (a failed restore, ADR 0006).
 */
export async function larkPost(text: string, env: NodeJS.ProcessEnv = process.env, timeoutMs = 30_000): Promise<string> {
  if (!text.trim()) throw new Error('nothing to post: stdin is empty');
  const cfg = larkConfigFromEnv(env);
  if (!cfg?.adminChat) throw new Error('Lark is not configured: set LARK_APP_ID, LARK_APP_SECRET and LARK_ADMIN_CHAT_ID, or LARK_WEBHOOK_URL');
  return larkClientFor(cfg).post(cfg.adminChat, larkUuid(text, String(Date.now())), text, AbortSignal.timeout(timeoutMs));
}
