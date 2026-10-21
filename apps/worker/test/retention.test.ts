import { addDays, pacificDate } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { retention } from '../src/retention';
import { type Harness, all, harness, insertRun, seedKeywords } from './helpers';

describe.skipIf(!testDatabaseAvailable())('retention', () => {
  let h: Harness;
  let today: string;
  const ago = (days: number) => addDays(today, -days);
  const ad = (id: string, lastSeenDaysAgo: number, key: string | null = `${id}_image.jpg`) =>
    h.db.execute(sql`insert into ads (ad_archive_id, first_seen_date, last_seen_date, seen_runs, seen_days, thumbnail_key, parsed)
      values (${id}, ${ago(400)}, ${ago(lastSeenDaysAgo)}, 7, 5, ${key}, '{}'::jsonb)`);
  const sighting = (adId: string, country: string, daysAgo: number) =>
    h.db.execute(sql`insert into ad_sightings (ad_archive_id, run_id, keyword_id, country, position, crawl_day)
      values (${adId}, 'run_r', 'kw_0', ${country}, 1, ${ago(daysAgo)})`);
  const thumb = (id: string) => h.objects.set(`thumbs/${id}_image.jpg`, { body: Buffer.from(id), contentType: 'image/jpeg' });
  const keys = async () => Object.fromEntries((await all<{ id: string; k: string | null }>(h, sql`select ad_archive_id as id, thumbnail_key as k from ads order by 1`)).map((r) => [r.id, r.k]));

  beforeAll(async () => {
    h = await harness();
    today = pacificDate(h.clock.now());
    await seedKeywords(h, 1);
    await insertRun(h, { id: 'run_r', deadline: h.clock.now(), status: 'done' });
    await h.db.execute(sql`insert into users (id, email, name, role) values ('u_1', 'u1@t', 'U1', 'member'); insert into stores (id, name) values ('st_1', 'S1')`);
  }, 60_000);
  afterAll(() => h?.close());
  beforeEach(async () => {
    await h.db.execute(sql`truncate ads, saved_ideas cascade`);
    h.objects.clear();
  });

  it('deletes sightings over 180 crawl days in batches and leaves the ads as they were', async () => {
    await ad('ad_s', 10);
    for (const [i, d] of [181, 182, 183, 200, 400].entries()) await sighting('ad_s', `O${i}`, d);
    await sighting('ad_s', 'K180', 180);
    await sighting('ad_s', 'K179', 179);
    const before = await all(h, sql`select * from ads`);

    expect(await retention(h.db, h.store, h.clock.now(), 2)).toEqual({ sightings: 5, thumbnails: 0 });
    expect(await all(h, sql`select country from ad_sightings order by country`)).toEqual([{ country: 'K179' }, { country: 'K180' }]);
    expect(await all(h, sql`select * from ads`)).toEqual(before);
  });

  it('deletes the thumbnail of an ad not seen for 90 days, except one a saved idea shows', async () => {
    for (const [id, days] of [['ad_old', 91], ['ad_saved', 120], ['ad_90', 90], ['ad_recent', 3]] as const) {
      await ad(id, days);
      thumb(id);
    }
    await ad('ad_none', 200, null);
    await h.db.execute(sql`insert into saved_ideas (id, store_id, source, source_ref, via, title, created_by, snapshot)
      values ('idea_1', 'st_1', 'ad', 'ad_saved', 'ads', 't', 'u_1', ${JSON.stringify({ thumbnailKey: 'ad_saved_image.jpg' })}::jsonb)`);

    expect(await retention(h.db, h.store, h.clock.now())).toEqual({ sightings: 0, thumbnails: 1 });
    expect(await keys()).toEqual({ ad_90: 'ad_90_image.jpg', ad_none: null, ad_old: null, ad_recent: 'ad_recent_image.jpg', ad_saved: 'ad_saved_image.jpg' });
    expect([...h.objects.keys()].sort()).toEqual(['thumbs/ad_90_image.jpg', 'thumbs/ad_recent_image.jpg', 'thumbs/ad_saved_image.jpg']);

    // A second run on the same day deletes nothing more.
    expect(await retention(h.db, h.store, h.clock.now())).toEqual({ sightings: 0, thumbnails: 0 });
    expect(h.objects.size).toBe(3);
  });

  it('keeps the key when the object cannot be deleted, so the next run tries again', async () => {
    await ad('ad_old', 91);
    const failing = { delete: async () => Promise.reject(new Error('connect ECONNREFUSED')) };
    await expect(retention(h.db, failing, h.clock.now())).rejects.toThrow('ECONNREFUSED');
    expect(await keys()).toEqual({ ad_old: 'ad_old_image.jpg' });
    // A key whose object is already gone is cleared all the same.
    expect(await retention(h.db, h.store, h.clock.now())).toEqual({ sightings: 0, thumbnails: 1 });
  });
});
