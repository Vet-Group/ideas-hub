// The Ctrl+K search (spec §6 "Global search"): case-insensitive ILIKE with the input's `%`, `_` and `\`
// escaped, backed by the pg_trgm indexes; from 3 characters, by similarity() then last seen, 5 per group.
import { sql } from 'drizzle-orm';
import { type Db } from '../client';

export const SEARCH_MIN_CHARS = 3;
export const SEARCH_PER_GROUP = 5;

/** `%`, `_` and `\` match themselves (`ESCAPE '\'`). */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface SearchResults {
  ads: { adArchiveId: string; caption: string | null; pageName: string | null; landingDomain: string | null }[];
  shops: { landingDomain: string; runningAds: number }[];
  keywords: { id: string; text: string }[];
}

export async function globalSearch(db: Db, input: string): Promise<SearchResults> {
  const q = input.trim();
  if (q.length < SEARCH_MIN_CHARS) return { ads: [], shops: [], keywords: [] };
  const like = `%${escapeLike(q)}%`;
  const [ads, shops, keywords] = await Promise.all([
    db.execute<{ ad_archive_id: string; caption: string | null; page_name: string | null; landing_domain: string | null }>(sql`
      select ad_archive_id, caption, page_name, landing_domain from ads
      where caption ilike ${like} escape '\\' or page_name ilike ${like} escape '\\' or landing_domain ilike ${like} escape '\\'
      order by greatest(similarity(coalesce(caption, ''), ${q}), similarity(coalesce(page_name, ''), ${q}), similarity(coalesce(landing_domain, ''), ${q})) desc,
        last_seen_date desc, ad_archive_id
      limit ${SEARCH_PER_GROUP}`),
    db.execute<{ landing_domain: string; running_ads: number }>(sql`
      select landing_domain, running_ads from shops where landing_domain ilike ${like} escape '\\'
      order by similarity(landing_domain, ${q}) desc, last_seen_date desc, landing_domain limit ${SEARCH_PER_GROUP}`),
    db.execute<{ id: string; text: string }>(sql`
      select id, text from keywords where text ilike ${like} escape '\\'
      order by similarity(text, ${q}) desc, created_at desc, id limit ${SEARCH_PER_GROUP}`),
  ]);
  return {
    ads: ads.rows.map((r) => ({ adArchiveId: r.ad_archive_id, caption: r.caption, pageName: r.page_name, landingDomain: r.landing_domain })),
    shops: shops.rows.map((r) => ({ landingDomain: r.landing_domain, runningAds: r.running_ads })),
    keywords: keywords.rows,
  };
}
