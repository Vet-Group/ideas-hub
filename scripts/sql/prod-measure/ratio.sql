-- Phase 2 plan Step 7: the figures the runner decides pass / extend / fail on. AC 1's ratio (a missed row
-- counts all its planned searches as failed) and the blocked searches over the counted runs of
-- [T_first, T_first + N days); a run of the window still scheduled or running is listed, never counted.
-- Reads crawl_runs (id, trigger, scheduled_for, status, planned_searches, deadline), crawl_searches (run_id, status).
set time zone 'UTC';
with w as (
  select r.id, r.status, r.planned_searches, r.deadline, r.status not in ('scheduled', 'running') as counted from crawl_runs r
  where r.trigger = 'schedule' and r.scheduled_for >= '{{T_FIRST}}'
    and r.scheduled_for < '{{T_FIRST}}'::timestamptz + interval '{{N}} days'
)
select
  count(*) filter (where w.counted)::int as counted_runs,
  count(*) filter (where not w.counted)::int as unfinished_runs,
  coalesce(sum(case when w.status = 'missed' then 0 else s.ok end) filter (where w.counted), 0)::int as ok_searches,
  coalesce(sum(w.planned_searches) filter (where w.counted), 0)::int as planned_searches,
  round(coalesce(sum(case when w.status = 'missed' then 0 else s.ok end) filter (where w.counted), 0)::numeric
    / nullif(sum(w.planned_searches) filter (where w.counted), 0), 4) as success_ratio,
  coalesce(sum(s.blocked) filter (where w.counted), 0)::int as blocked_searches,
  max(w.deadline) filter (where w.counted) as last_counted_deadline
from w
left join lateral (
  select count(*) filter (where status in ('ok', 'no_results'))::int as ok,
         count(*) filter (where status = 'blocked')::int as blocked
  from crawl_searches where run_id = w.id
) s on true;
