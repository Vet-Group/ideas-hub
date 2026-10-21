// Data retention (ADR 0007, phase 2 plan Step 2b), run daily by `pnpm retention` under ops.lock: sightings
// older than 180 crawl days, and thumbnails of ads not seen for 90, except those a saved idea shows.
import { SIGHTINGS_RETENTION_DAYS, THUMBNAIL_RETENTION_DAYS, addDays, pacificDate } from '@ideas-hub/core';
import { type Db } from '@ideas-hub/db/client';
import { sql } from 'drizzle-orm';
import { type ObjectStore } from './context';
import { THUMB_PREFIX } from './thumbnails';

export const SIGHTINGS_BATCH = 10_000;
const THUMBS_BATCH = 500;

export interface RetentionResult {
  sightings: number;
  thumbnails: number;
}

/** Deletes what is past retention at `at`; a second run on the same day deletes nothing more. */
export async function retention(db: Db, store: Pick<ObjectStore, 'delete'>, at: Date, batch = SIGHTINGS_BATCH): Promise<RetentionResult> {
  // crawl_day and last_seen_date are Pacific dates.
  const today = pacificDate(at);
  const sightingsBefore = addDays(today, -SIGHTINGS_RETENTION_DAYS);
  let sightings = 0;
  for (;;) {
    const r = await db.execute(sql`
      delete from ad_sightings where ctid = any(array(
        select ctid from ad_sightings where crawl_day < ${sightingsBefore} limit ${batch}))`);
    sightings += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) < batch) break;
  }

  const thumbsBefore = addDays(today, -THUMBNAIL_RETENTION_DAYS);
  let thumbnails = 0;
  for (;;) {
    const { rows } = await db.execute<{ ad_archive_id: string; thumbnail_key: string }>(sql`
      select ad_archive_id, thumbnail_key from ads a
      where last_seen_date < ${thumbsBefore} and thumbnail_key is not null
        and not exists (select 1 from saved_ideas s where s.snapshot->>'thumbnailKey' = a.thumbnail_key)
      order by ad_archive_id limit ${THUMBS_BATCH}`);
    for (const r of rows) {
      // Object first: a failure leaves the key, so the next run tries again (a missing object deletes fine).
      await store.delete(THUMB_PREFIX + r.thumbnail_key);
      // Unless the ad was seen again meanwhile; the 09:00 run is outside the crawl windows anyway.
      const u = await db.execute(sql`
        update ads set thumbnail_key = null
        where ad_archive_id = ${r.ad_archive_id} and thumbnail_key = ${r.thumbnail_key} and last_seen_date < ${thumbsBefore}`);
      thumbnails += u.rowCount ?? 0;
    }
    if (rows.length < THUMBS_BATCH) break;
  }
  return { sightings, thumbnails };
}
