-- Acceptance checks (plan "Acceptance criteria"), run daily during the 14-day run by
-- scripts/linux/ideashub-acceptance through the read-only role, or by hand:
--   psql "$DATABASE_URL" -f scripts/acceptance.sql
-- Each query is one check; apps/worker/test/acceptance.test.ts runs them on seeded data.

-- When `pilot.run_start` is set (the daily script sets it), AC 1 and AC 6 also ignore rows before it, so days
-- 1-13 are not read against slots missed before the pilot; unset, the windows are the plain last 14 days.

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
where r.trigger = 'schedule' and r.scheduled_for <= now() and r.scheduled_for > now() - interval '14 days'
  and r.scheduled_for >= coalesce(nullif(current_setting('pilot.run_start', true), '')::timestamptz, '-infinity');

-- name: ac2_violations
-- AC 2: every ok search has embedded_count > 0; pages_read >= 1 when embedded_has_next; fewer than the cap (100)
-- ads only with last_has_next false or stop_reason = no_new_ads. Interrupted searches are not ok.
select
  count(*) filter (where coalesce(embedded_count, 0) = 0)::int as ok_without_embedded,
  count(*) filter (where embedded_has_next and pages_read < 1)::int as has_next_without_page,
  count(*) filter (where ads_found < (select (value #>> '{}')::int from settings where key = 'adsPerSearchCap')
    and not (last_has_next is false or stop_reason = 'no_new_ads'))::int as silent_stops
from crawl_searches where status = 'ok';

-- name: ac1_alerts
-- AC 1, Alerts: every run with a blocked or parse_error search has an Alert of that kind with a Lark
-- message id, and every run's network_error Alerts equal its network_cooldowns, each with a Lark message
-- id. Counts the runs of the last 14 days that break each rule; all three must be 0.
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
  where coalesce(cr.scheduled_for, cr.created_at) <= now() and coalesce(cr.scheduled_for, cr.created_at) > now() - interval '14 days'
    and coalesce(cr.scheduled_for, cr.created_at) >= coalesce(nullif(current_setting('pilot.run_start', true), '')::timestamptz, '-infinity')
) r;

-- name: ac3_briefings
-- AC 3 over the 14 Asia/Ho_Chi_Minh days ending today (run after 07:00): days_ok counts the days whose
-- global briefing has ready_at before 07:00, all sections stored with 5 and 6 generated (not skipped or
-- failed: AI) and a Lark message id; pass at days_ok >= 13. Every suggestion's evidence refs resolve
-- (unresolved_refs = 0) and no day's AI cost is over the cap (days_over_cap = 0). Keyword briefings have
-- no deadline.
with days as (
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date - i as date from generate_series(0, 13) i
)
select
  (select count(*) from days)::int as days,
  (select count(*) from days d join briefings b on b.date = d.date and b.scope = 'global'
    where b.ready_at < (d.date + time '07:00') at time zone 'Asia/Ho_Chi_Minh'
      and b.sections ?& array['sourceRun', 'kpi', 'topAds', 'risingAds', 'hotKeywords', 'risingShops', 'news', 'suggestions']
      and b.sections #>> '{news,state}' = 'ok' and b.sections #>> '{suggestions,state}' = 'ok'
      and exists (select 1 from lark_messages m where m.briefing_id = b.id and m.message_id is not null))::int as days_ok,
  (select count(*) from suggestions s join briefings b on b.id = s.briefing_id
    where b.date in (select date from days)
      and (exists (select 1 from jsonb_array_elements_text(s.evidence -> 'ads') e where not exists (select 1 from ads where ad_archive_id = e))
        or exists (select 1 from jsonb_array_elements_text(s.evidence -> 'news') e where not exists (select 1 from news_items where id = e))))::int as unresolved_refs,
  (select count(*) from (
    select b.date from briefings b where b.date in (select date from days) group by b.date
    having sum(b.ai_cost_usd) > (select (value #>> '{}')::numeric from settings where key = 'aiDailyCostCapUsd')) x)::int as days_over_cap;

-- name: ac3_today
-- AC 3 for today's Asia/Ho_Chi_Minh date alone (scripts/linux/ideashub-acceptance, 07:30): on_time when the
-- global briefing's ready_at is before 07:00, sections_ok when all 6 sections are stored with 5 and 6
-- generated. No briefing yet is neither.
select d.date,
  to_char(b.ready_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') as ready_at,
  coalesce(b.ready_at < (d.date + time '07:00') at time zone 'Asia/Ho_Chi_Minh', false) as on_time,
  coalesce(b.sections ?& array['sourceRun', 'kpi', 'topAds', 'risingAds', 'hotKeywords', 'risingShops', 'news', 'suggestions']
    and b.sections #>> '{news,state}' = 'ok' and b.sections #>> '{suggestions,state}' = 'ok', false) as sections_ok
from (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as date) d
left join briefings b on b.date = d.date and b.scope = 'global';

-- name: ac6_ideas
-- AC 6: ideas created by non-admin members with via = briefing in the last 14 days, counted per store row
-- (one save to two stores counts once in each). Pass: ideas >= 30 and stores_with_10 >= 2.
select
  coalesce(sum(n), 0)::int as ideas,
  count(*) filter (where n >= 10)::int as stores_with_10,
  coalesce(jsonb_object_agg(name, n) filter (where n > 0), '{}'::jsonb) as per_store
from (
  select st.name, count(i.id)::int as n from stores st
  left join saved_ideas i on i.store_id = st.id and i.via = 'briefing' and i.created_at > now() - interval '14 days'
    and i.created_at >= coalesce(nullif(current_setting('pilot.run_start', true), '')::timestamptz, '-infinity')
    and exists (select 1 from users u where u.id = i.created_by and u.role <> 'admin')
  group by st.name
) x;
