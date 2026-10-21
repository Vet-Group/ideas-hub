-- Phase 2 plan Step 7: the searches of the counted runs of [T_first, T_first + N days): outcomes, ads and
-- pages per ok search, stop reasons, and seconds per search (without the delays between searches).
-- Reads crawl_runs (id, trigger, scheduled_for, status), crawl_searches (run_id, status, ads_found,
-- pages_read, stop_reason, started_at, finished_at).
set time zone 'UTC';
with s as (
  select cs.status, cs.ads_found, cs.pages_read, cs.stop_reason, extract(epoch from cs.finished_at - cs.started_at) as secs
  from crawl_searches cs
  join crawl_runs r on r.id = cs.run_id
  where r.trigger = 'schedule' and r.status not in ('scheduled', 'running') and r.scheduled_for >= '{{T_FIRST}}'
    and r.scheduled_for < '{{T_FIRST}}'::timestamptz + interval '{{N}} days'
)
select
  count(*)::int as searches,
  count(*) filter (where status = 'ok')::int as ok,
  count(*) filter (where status = 'no_results')::int as no_results,
  count(*) filter (where status = 'blocked')::int as blocked,
  count(*) filter (where status = 'network_error')::int as network_error,
  count(*) filter (where status = 'parse_error')::int as parse_error,
  count(*) filter (where status = 'interrupted')::int as interrupted,
  count(*) filter (where status = 'skipped')::int as skipped,
  count(*) filter (where status in ('pending', 'running'))::int as not_finished,
  round(avg(ads_found) filter (where status = 'ok'), 1) as ads_per_ok_search,
  percentile_disc(0.5) within group (order by ads_found) filter (where status = 'ok') as ads_per_ok_search_median,
  round(avg(pages_read) filter (where status = 'ok'), 1) as pages_per_ok_search,
  count(*) filter (where stop_reason = 'cap')::int as stop_cap,
  count(*) filter (where stop_reason = 'end_of_results')::int as stop_end_of_results,
  count(*) filter (where stop_reason = 'no_new_ads')::int as stop_no_new_ads,
  round((percentile_cont(0.5) within group (order by secs))::numeric) as search_s_median,
  round((percentile_cont(0.9) within group (order by secs))::numeric) as search_s_p90,
  round(max(secs)) as search_s_max
from s;
