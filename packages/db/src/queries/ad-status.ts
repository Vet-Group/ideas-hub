// SQL form of adStatus (packages/core measures.ts; spec §1 "Measures"), for running-ad counts, the ads
// grid and the briefing. ad-status.test.ts checks it against the TypeScript rule.
import { type SQL, sql } from 'drizzle-orm';

/**
 * A subquery with one row per ad: `ad_archive_id`, `status` ('running', 'out_of_top' or
 * 'stopped_or_unknown'). `today` is a Pacific crawl day; `countries` the active countries.
 */
export function adStatusQuery(today: string, staleAfterDays: number, countries: readonly string[]): SQL {
  return sql`
    select a.ad_archive_id, a.landing_domain, case
      when a.last_seen_date >= ${today}::date - ${staleAfterDays}::int then 'running'
      when not exists (
        select 1 from ad_sightings s join keywords k on k.id = s.keyword_id
        where s.ad_archive_id = a.ad_archive_id and k.active and s.country = any(${sql.param([...countries])}::text[])
      ) then 'stopped_or_unknown'
      when exists (
        select 1 from (select distinct keyword_id, country from ad_sightings where ad_archive_id = a.ad_archive_id) p
        join crawl_searches cs on cs.keyword_id = p.keyword_id and cs.country = p.country
        join crawl_runs cr on cr.id = cs.run_id
        where (cr.started_at at time zone 'America/Los_Angeles')::date > a.last_seen_date
          and (cs.status = 'no_results' or (cs.status = 'ok' and cs.last_has_next = false))
      ) then 'stopped_or_unknown'
      when exists (
        select 1 from (select distinct keyword_id, country from ad_sightings where ad_archive_id = a.ad_archive_id) p
        join crawl_searches cs on cs.keyword_id = p.keyword_id and cs.country = p.country
        join crawl_runs cr on cr.id = cs.run_id
        where (cr.started_at at time zone 'America/Los_Angeles')::date > a.last_seen_date
          and cs.status = 'ok' and cs.last_has_next = true
      ) then 'out_of_top'
      else 'running'
    end as status
    from ads a`;
}
