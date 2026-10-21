-- Phase 2 plan Step 7, "What is left out, and named": every scheduled row before T_first. `backfilled` marks
-- the slots the host's first watchdog pass wrote as missed (status missed, a missed_run Alert with detail
-- 'no row for this slot'); the others ran before the measurement. Neither is counted. Flags only, no text.
-- Reads crawl_runs (id, trigger, scheduled_for, status), alerts (run_id, kind, detail).
set time zone 'UTC';
select r.id, r.scheduled_for, r.status, a.run_id is not null as missed_run_alert,
  coalesce(r.status = 'missed' and a.detail = 'no row for this slot', false) as backfilled
from crawl_runs r
left join alerts a on a.run_id = r.id and a.kind = 'missed_run'
where r.trigger = 'schedule' and r.scheduled_for < '{{T_FIRST}}' order by r.scheduled_for;
