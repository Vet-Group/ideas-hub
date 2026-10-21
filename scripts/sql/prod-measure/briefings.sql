-- Phase 2 plan Step 7: the global briefings whose 07:00 Asia/Ho_Chi_Minh deadline falls inside the window,
-- so each is built from a window run, as counts per section; no ad, news or suggestion text.
-- Reads briefings (id, date, scope, sections, ready_at, llm_calls, ai_cost_usd), lark_messages (briefing_id, message_id).
set time zone 'UTC';
select b.date, b.ready_at,
  b.ready_at < (b.date + time '07:00') at time zone 'Asia/Ho_Chi_Minh' as ready_before_0700,
  (select count(*) from jsonb_object_keys(b.sections))::int as sections,
  b.sections #>> '{sourceRun,id}' as source_run,
  jsonb_array_length(coalesce(b.sections -> 'topAds', '[]')) as top_ads,
  jsonb_array_length(coalesce(b.sections -> 'risingAds', '[]')) as rising_ads,
  jsonb_array_length(coalesce(b.sections -> 'hotKeywords', '[]')) as hot_keywords,
  jsonb_array_length(coalesce(b.sections -> 'risingShops', '[]')) as rising_shops,
  b.sections #>> '{news,state}' as news_state,
  jsonb_array_length(coalesce(b.sections #> '{news,items}', '[]')) as news_items,
  b.sections #>> '{suggestions,state}' as suggestions_state,
  (b.sections #>> '{suggestions,count}')::int as suggestions,
  b.llm_calls, b.ai_cost_usd,
  exists (select 1 from lark_messages m where m.briefing_id = b.id and m.message_id is not null) as lark_sent
from briefings b
where b.scope = 'global'
  and (b.date + time '07:00') at time zone 'Asia/Ho_Chi_Minh' > '{{T_FIRST}}'
  and (b.date + time '07:00') at time zone 'Asia/Ho_Chi_Minh' < '{{T_FIRST}}'::timestamptz + interval '{{N}} days'
order by b.date;
