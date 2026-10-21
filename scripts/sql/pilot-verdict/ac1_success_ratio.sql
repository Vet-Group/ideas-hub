-- Pilot verdict, AC 1 (phase 2 plan Step 8, the day-14 runner). Fixed text: the runner prepends
--   set pilot.run_start = '<run-start, ISO 8601 UTC>';
-- and runs it through the read-only role (pnpm --silent ro-query). The run is [run-start, run-start + 14
-- days); without the setting the query fails. Counts and flags only, never ad text.
-- As scripts/acceptance.sql ac1_success_ratio: Σ ok + no_results ÷ Σ planned_searches over the scheduled
-- rows whose slot is in the run; a row missed or still scheduled counts all its planned searches as failed.
select
  coalesce(sum(case when r.status in ('scheduled', 'missed') then 0 else s.ok end), 0)::int as ok_searches,
  coalesce(sum(r.planned_searches), 0)::int as planned_searches,
  round(coalesce(sum(case when r.status in ('scheduled', 'missed') then 0 else s.ok end), 0)::numeric
    / nullif(sum(r.planned_searches), 0), 4) as success_ratio
from crawl_runs r
left join lateral (
  select count(*) filter (where status in ('ok', 'no_results'))::int as ok from crawl_searches where run_id = r.id
) s on true
where r.trigger = 'schedule'
  and r.scheduled_for >= current_setting('pilot.run_start')::timestamptz
  and r.scheduled_for < current_setting('pilot.run_start')::timestamptz + interval '14 days';
