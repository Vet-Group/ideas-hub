-- Pilot verdict, AC 1 Alerts (phase 2 plan Step 8, the day-14 runner). Fixed text: the runner prepends
--   set pilot.run_start = '<run-start, ISO 8601 UTC>';
-- and runs it through the read-only role (pnpm --silent ro-query). The run is [run-start, run-start + 14
-- days); without the setting the query fails. Counts and flags only, never ad text.
-- As scripts/acceptance.sql ac1_alerts, over the runs of the run (by slot, or creation for manual runs):
-- runs breaking each Alert rule; all three must be 0.
select
  count(*) filter (where r.has_blocked and not r.blocked_sent)::int as blocked_unsent,
  count(*) filter (where r.has_parse_error and not r.parse_error_sent)::int as parse_error_unsent,
  count(*) filter (where r.network_alerts <> r.network_cooldowns or r.network_unsent > 0)::int as network_mismatch
from (
  select cr.network_cooldowns,
    exists (select 1 from crawl_searches s where s.run_id = cr.id and s.status = 'blocked') as has_blocked,
    exists (select 1 from alerts a where a.run_id = cr.id and a.kind = 'blocked' and a.lark_message_id is not null) as blocked_sent,
    exists (select 1 from crawl_searches s where s.run_id = cr.id and s.status = 'parse_error') as has_parse_error,
    exists (select 1 from alerts a where a.run_id = cr.id and a.kind = 'parse_error' and a.lark_message_id is not null) as parse_error_sent,
    (select count(*) from alerts a where a.run_id = cr.id and a.kind = 'network_error')::int as network_alerts,
    (select count(*) from alerts a where a.run_id = cr.id and a.kind = 'network_error' and a.lark_message_id is null)::int as network_unsent
  from crawl_runs cr
  where coalesce(cr.scheduled_for, cr.created_at) >= current_setting('pilot.run_start')::timestamptz
    and coalesce(cr.scheduled_for, cr.created_at) < current_setting('pilot.run_start')::timestamptz + interval '14 days'
) r;
