import { desc, sql } from 'drizzle-orm';
import { type Db } from '../client';
import { alerts } from '../schema';

/** The admin alerts page: open Alerts first, then the latest resolved ones, whatever their Lark state. */
export function adminAlerts(db: Db, limit = 200) {
  return db
    .select()
    .from(alerts)
    .orderBy(sql`${alerts.resolvedAt} is not null`, desc(alerts.createdAt))
    .limit(limit);
}
