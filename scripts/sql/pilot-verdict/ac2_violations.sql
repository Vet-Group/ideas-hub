-- Pilot verdict, AC 2 (phase 2 plan Step 8, the day-14 runner). Fixed text: the runner prepends
--   set pilot.run_start = '<run-start, ISO 8601 UTC>';
-- and runs it through the read-only role (pnpm --silent ro-query). The run is [run-start, run-start + 14
-- days); without the setting the query fails. Counts and flags only, never ad text.
-- As scripts/acceptance.sql ac2_violations, but only the ok searches of the run's runs (by slot, or
-- creation for manual runs), so data from before the pilot does not decide it; all three must be 0.
select
  count(*) filter (where coalesce(s.embedded_count, 0) = 0)::int as ok_without_embedded,
  count(*) filter (where s.embedded_has_next and s.pages_read < 1)::int as has_next_without_page,
  count(*) filter (where s.ads_found < (select (value #>> '{}')::int from settings where key = 'adsPerSearchCap')
    and not (s.last_has_next is false or s.stop_reason = 'no_new_ads'))::int as silent_stops
from crawl_searches s join crawl_runs r on r.id = s.run_id
where s.status = 'ok'
  and coalesce(r.scheduled_for, r.created_at) >= current_setting('pilot.run_start')::timestamptz
  and coalesce(r.scheduled_for, r.created_at) < current_setting('pilot.run_start')::timestamptz + interval '14 days';
