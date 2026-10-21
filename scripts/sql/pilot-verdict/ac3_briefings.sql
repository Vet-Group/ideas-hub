-- Pilot verdict, AC 3 (phase 2 plan Step 8, the day-14 runner). Fixed text: the runner prepends
--   set pilot.run_start = '<run-start, ISO 8601 UTC>';
-- and runs it through the read-only role (pnpm --silent ro-query). The run is [run-start, run-start + 14
-- days); without the setting the query fails. Counts and flags only, never ad text.
-- As scripts/acceptance.sql ac3_briefings over the run's 14 Asia/Ho_Chi_Minh dates, day 1 being
-- run-start's date: days_ok >= 13, unresolved_refs = 0, days_over_cap = 0. late_days lists the dates
-- that are not ok, for the report.
with days as (
  select (current_setting('pilot.run_start')::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date + i as date
  from generate_series(0, 13) i
), ok as (
  select d.date from days d join briefings b on b.date = d.date and b.scope = 'global'
  where b.ready_at < (d.date + time '07:00') at time zone 'Asia/Ho_Chi_Minh'
    and b.sections ?& array['sourceRun', 'kpi', 'topAds', 'risingAds', 'hotKeywords', 'risingShops', 'news', 'suggestions']
    and b.sections #>> '{news,state}' = 'ok' and b.sections #>> '{suggestions,state}' = 'ok'
    and exists (select 1 from lark_messages m where m.briefing_id = b.id and m.message_id is not null)
)
select
  (select count(*) from days)::int as days,
  (select count(*) from ok)::int as days_ok,
  (select coalesce(string_agg(date::text, ' ' order by date), '') from days where date not in (select date from ok)) as late_days,
  (select count(*) from suggestions s join briefings b on b.id = s.briefing_id
    where b.date in (select date from days)
      and (exists (select 1 from jsonb_array_elements_text(s.evidence -> 'ads') e where not exists (select 1 from ads where ad_archive_id = e))
        or exists (select 1 from jsonb_array_elements_text(s.evidence -> 'news') e where not exists (select 1 from news_items where id = e))))::int as unresolved_refs,
  (select count(*) from (
    select b.date from briefings b where b.date in (select date from days) group by b.date
    having sum(b.ai_cost_usd) > (select (value #>> '{}')::numeric from settings where key = 'aiDailyCostCapUsd')) x)::int as days_over_cap;
