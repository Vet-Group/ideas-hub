-- Phase 2 plan Step 7: every scheduled run of [T_first, T_first + N days), counted or not, with its search
-- outcomes, duration (seconds per search that ran, against spec §1's ~61 s) and backoff counters.
-- Reads crawl_runs (id, trigger, scheduled_for, status, planned_searches, started_at, finished_at, deadline,
-- running_ads, network_cooldowns, transient_retries, browser_restarts, two_page_stops_with_next,
-- blocked_until, wait_limit_hits, close_reason), crawl_searches (run_id, status).
set time zone 'UTC';
select r.id, r.scheduled_for, r.status, r.status not in ('scheduled', 'running') as counted, r.planned_searches,
  s.ok, s.no_results, s.blocked, s.network_error, s.parse_error, s.interrupted, s.skipped, s.not_finished,
  r.started_at, r.finished_at, r.deadline,
  round(extract(epoch from r.finished_at - r.started_at))::int as duration_s,
  round(extract(epoch from r.finished_at - r.started_at) / nullif(s.ran, 0))::int as s_per_search,
  r.running_ads, r.network_cooldowns, r.transient_retries, r.browser_restarts, r.two_page_stops_with_next,
  r.blocked_until, r.wait_limit_hits, r.close_reason
from crawl_runs r
left join lateral (
  select count(*) filter (where status = 'ok')::int as ok,
         count(*) filter (where status = 'no_results')::int as no_results,
         count(*) filter (where status = 'blocked')::int as blocked,
         count(*) filter (where status = 'network_error')::int as network_error,
         count(*) filter (where status = 'parse_error')::int as parse_error,
         count(*) filter (where status = 'interrupted')::int as interrupted,
         count(*) filter (where status = 'skipped')::int as skipped,
         count(*) filter (where status in ('pending', 'running'))::int as not_finished,
         count(*) filter (where status not in ('pending', 'running', 'skipped'))::int as ran
  from crawl_searches where run_id = r.id
) s on true
where r.trigger = 'schedule' and r.scheduled_for >= '{{T_FIRST}}'
  and r.scheduled_for < '{{T_FIRST}}'::timestamptz + interval '{{N}} days'
order by r.scheduled_for;
