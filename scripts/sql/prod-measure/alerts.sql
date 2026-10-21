-- Phase 2 plan Step 7: Alerts created in [T_first, T_first + N days) per kind, with how many reached Lark.
-- Reads alerts (kind, created_at, lark_message_id, lark_skipped_at, resolved_at).
set time zone 'UTC';
select kind, count(*)::int as alerts, count(lark_message_id)::int as sent, count(lark_skipped_at)::int as lark_skipped,
  count(resolved_at)::int as resolved
from alerts
where created_at >= '{{T_FIRST}}' and created_at < '{{T_FIRST}}'::timestamptz + interval '{{N}} days'
group by kind order by kind;
