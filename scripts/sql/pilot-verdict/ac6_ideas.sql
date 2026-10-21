-- Pilot verdict, AC 6 (phase 2 plan Step 8, the day-14 runner). Fixed text: the runner prepends
--   set pilot.run_start = '<run-start, ISO 8601 UTC>';
-- and runs it through the read-only role (pnpm --silent ro-query). The run is [run-start, run-start + 14
-- days); without the setting the query fails. Counts and flags only, never ad text.
-- As scripts/acceptance.sql ac6_ideas over the run: ideas by non-admin members with via = briefing,
-- counted per store row. Pass: ideas >= 30 and stores_with_10 >= 2.
select
  coalesce(sum(n), 0)::int as ideas,
  count(*) filter (where n >= 10)::int as stores_with_10,
  coalesce(jsonb_object_agg(name, n) filter (where n > 0), '{}'::jsonb) as per_store
from (
  select st.name, count(i.id)::int as n from stores st
  left join saved_ideas i on i.store_id = st.id and i.via = 'briefing'
    and i.created_at >= current_setting('pilot.run_start')::timestamptz
    and i.created_at < current_setting('pilot.run_start')::timestamptz + interval '14 days'
    and exists (select 1 from users u where u.id = i.created_by and u.role <> 'admin')
  group by st.name
) x;
