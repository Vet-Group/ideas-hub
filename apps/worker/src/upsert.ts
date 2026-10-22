// Ads, sightings and shops of one search (spec §2): insert or update the ad and its rollups, one
// sighting per (ad, run, keyword, country), shops by landing domain unless it is a non-shop domain.
import { isNonShopDomain } from '@ideas-hub/core';
import { type NormalizedAd } from '@ideas-hub/fb-ad-library';
import { sql } from 'drizzle-orm';
import { type Db } from '@ideas-hub/db/client';

export interface SearchSighting {
  runId: string;
  keywordId: string;
  country: string;
  crawlDay: string;
}

export async function upsertAds(db: Db, at: SearchSighting, ads: readonly NormalizedAd[], nonShopDomains: readonly string[]) {
  for (const [i, ad] of ads.entries()) {
    // Rollups count the run and the crawl day once, however many searches of the run see the ad.
    await db.execute(sql`
      insert into ads (ad_archive_id, collation_id, collation_count, page_id, page_name, caption, title, link,
        landing_domain, cta, media_type, start_date, end_date, is_active, seen_runs, seen_days,
        first_seen_date, last_seen_date, parsed)
      values (${ad.adArchiveId}, ${ad.collationId}, ${ad.collationCount}, ${ad.pageId}, ${ad.pageName}, ${ad.caption},
        ${ad.title}, ${ad.link}, ${ad.landingDomain}, ${ad.cta}, ${ad.mediaType}, ${ad.startDate}, ${ad.endDate},
        ${ad.isActive}, 1, 1, ${at.crawlDay}, ${at.crawlDay}, ${JSON.stringify(ad.parsed)}::jsonb)
      on conflict (ad_archive_id) do update set
        collation_id = excluded.collation_id, collation_count = excluded.collation_count,
        page_id = excluded.page_id, page_name = excluded.page_name, caption = excluded.caption, title = excluded.title,
        link = excluded.link, landing_domain = excluded.landing_domain, cta = excluded.cta, media_type = excluded.media_type,
        start_date = excluded.start_date, end_date = excluded.end_date, is_active = excluded.is_active,
        parsed = excluded.parsed, updated_at = now(),
        seen_runs = ads.seen_runs + case when exists (
          select 1 from ad_sightings s where s.ad_archive_id = excluded.ad_archive_id and s.run_id = ${at.runId}) then 0 else 1 end,
        seen_days = ads.seen_days + case when exists (
          select 1 from ad_sightings s where s.ad_archive_id = excluded.ad_archive_id and s.crawl_day = ${at.crawlDay}::date) then 0 else 1 end,
        last_seen_date = greatest(ads.last_seen_date, excluded.last_seen_date)`);
    await db.execute(sql`
      insert into ad_sightings (ad_archive_id, run_id, keyword_id, country, position, crawl_day, collation_count)
      values (${ad.adArchiveId}, ${at.runId}, ${at.keywordId}, ${at.country}, ${i + 1}, ${at.crawlDay}, ${ad.collationCount})
      on conflict do nothing`);
    if (ad.pageId && ad.pageLikeCount !== null) {
      await db.execute(sql`
        insert into page_days (page_id, crawl_day, like_count) values (${ad.pageId}, ${at.crawlDay}, ${ad.pageLikeCount})
        on conflict (page_id, crawl_day) do update set like_count = excluded.like_count`);
    }
    if (ad.landingDomain && !isNonShopDomain(ad.landingDomain, nonShopDomains)) {
      await db.execute(sql`
        insert into shops (landing_domain, page_ids, first_seen_date, last_seen_date)
        values (${ad.landingDomain}, ${ad.pageId ? sql`array[${ad.pageId}]::text[]` : sql`'{}'::text[]`}, ${at.crawlDay}, ${at.crawlDay})
        on conflict (landing_domain) do update set
          page_ids = (select array(select distinct unnest(shops.page_ids || excluded.page_ids))),
          last_seen_date = greatest(shops.last_seen_date, excluded.last_seen_date)`);
    }
  }
}

/** Ads of this search still without a thumbnail, for the download after the search. */
export async function missingThumbnails(db: Db, ads: readonly NormalizedAd[]) {
  const ids = ads.filter((a) => a.thumbnail).map((a) => a.adArchiveId);
  if (ids.length === 0) return [];
  const { rows } = await db.execute<{ ad_archive_id: string }>(
    sql`select ad_archive_id from ads where thumbnail_key is null and ad_archive_id = any(${sql.param(ids)}::text[])`,
  );
  const missing = new Set(rows.map((r) => r.ad_archive_id));
  return ads.filter((a) => a.thumbnail && missing.has(a.adArchiveId)).map((a) => ({ adArchiveId: a.adArchiveId, ...a.thumbnail! }));
}
