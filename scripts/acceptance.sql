-- Acceptance checks (plan "Acceptance criteria"), run daily during the 14-day run:
--   psql "$DATABASE_URL" -f scripts/acceptance.sql
-- Each query is one check; apps/worker/test/acceptance.test.ts runs them on seeded data.
-- Step 7 adds AC 1's Alert checks, AC 3 and AC 6.

-- name: ac1_success_ratio
-- AC 1: Σ ok + no_results ÷ Σ planned_searches over the scheduled rows of the last 14 days. A row
-- still scheduled after its slot or missed counts all its planned searches as failed, and so do the
-- skipped searches of a blocked slot (they are simply not ok).
select
  coalesce(sum(case when r.status in ('scheduled', 'missed') then 0 else s.ok end), 0)::int as ok_searches,
  coalesce(sum(r.planned_searches), 0)::int as planned_searches,
  round(coalesce(sum(case when r.status in ('scheduled', 'missed') then 0 else s.ok end), 0)::numeric
    / nullif(sum(r.planned_searches), 0), 4) as success_ratio
from crawl_runs r
left join lateral (
  select count(*) filter (where status in ('ok', 'no_results'))::int as ok from crawl_searches where run_id = r.id
) s on true
where r.trigger = 'schedule' and r.scheduled_for <= now() and r.scheduled_for > now() - interval '14 days';

-- name: ac2_violations
-- AC 2: every ok search has embedded_count > 0; pages_read >= 1 when embedded_has_next; fewer than the cap (100)
-- ads only with last_has_next false or stop_reason = no_new_ads. Interrupted searches are not ok.
select
  count(*) filter (where coalesce(embedded_count, 0) = 0)::int as ok_without_embedded,
  count(*) filter (where embedded_has_next and pages_read < 1)::int as has_next_without_page,
  count(*) filter (where ads_found < (select (value #>> '{}')::int from settings where key = 'adsPerSearchCap')
    and not (last_has_next is false or stop_reason = 'no_new_ads'))::int as silent_stops
from crawl_searches where status = 'ok';
