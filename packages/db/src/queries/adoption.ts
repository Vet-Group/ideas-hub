import { sql } from 'drizzle-orm';
import { type Db } from '../client';

/** The pilot's run start (docs/ops/production.md, tracking issue #55); the AC 6 window opens here. */
export const PILOT_RUN_START = new Date('2026-10-22T17:00:00Z');
/** AC 6 targets: at least 10 briefing saves per store row and 30 in total. */
export const AC6_STORE_TARGET = 10;
export const AC6_TOTAL_TARGET = 30;

export type UserAdoption = {
  userId: string;
  /** Latest session created/refreshed time: approximate, a session only refreshes now and then. */
  lastActiveAt: Date | null;
  /** Briefing saves since the pilot start, per store row as in AC 6; 0 for an admin (AC 6 ignores admins). */
  ideas: number;
};
export type StoreAdoption = { storeId: string; name: string; ideas: number };

/**
 * Admin adoption view. Mirrors scripts/acceptance.sql `ac6_ideas`: ideas by non-admin creators with
 * via = 'briefing', one row per store (a save to two stores counts once in each), but over
 * [PILOT_RUN_START, now) instead of the last 14 days.
 */
export async function userAdoption(db: Db): Promise<UserAdoption[]> {
  const res = await db.execute<{ userId: string; lastActiveAt: string | null; ideas: number }>(sql`
    select u.id as "userId",
      (select max(greatest(s.updated_at, s.created_at)) from sessions s where s.user_id = u.id) as "lastActiveAt",
      case when u.role = 'admin' then 0 else (
        select count(*)::int from saved_ideas i
        where i.created_by = u.id and i.via = 'briefing' and i.created_at >= ${PILOT_RUN_START.toISOString()}::timestamptz
      ) end as ideas
    from users u`);
  // Raw rows carry timestamptz as text.
  return res.rows.map((r) => ({ ...r, lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt) : null }));
}

export async function storeAdoption(db: Db): Promise<StoreAdoption[]> {
  const res = await db.execute<StoreAdoption>(sql`
    select st.id as "storeId", st.name, count(i.id)::int as ideas
    from stores st
    left join saved_ideas i on i.store_id = st.id and i.via = 'briefing'
      and i.created_at >= ${PILOT_RUN_START.toISOString()}::timestamptz
      and exists (select 1 from users u where u.id = i.created_by and u.role <> 'admin')
    group by st.id, st.name
    order by st.name`);
  return res.rows;
}
