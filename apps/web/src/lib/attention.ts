import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { formatTime } from './format';
import { now } from './now';

/** The crawler attention state for admins: a cool-down still running, and Alerts not marked "Đã xử lý". */
export async function crawlerAttention(): Promise<{ blockedUntil: string | null; openAlerts: number }> {
  const at = now();
  const { rows } = await db.execute<{ blocked_until: string | null; open: number }>(sql`
    select (select blocked_until from crawler_state where id = 1 and blocked_until > ${at}) as blocked_until,
      (select count(*)::int from alerts where resolved_at is null) as open`);
  const r = rows[0];
  return { blockedUntil: r?.blocked_until ? formatTime(new Date(r.blocked_until)) : null, openAlerts: r?.open ?? 0 };
}
