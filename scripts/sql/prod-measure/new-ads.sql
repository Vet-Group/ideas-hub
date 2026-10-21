-- Phase 2 plan Step 7: new ads per crawl day (Pacific, as ads.first_seen_date) over the window, for the
-- growth estimate. Reads ads (first_seen_date) only: no ad text.
set time zone 'UTC';
select first_seen_date, count(*)::int as new_ads from ads
where first_seen_date >= ('{{T_FIRST}}'::timestamptz at time zone 'America/Los_Angeles')::date
  and first_seen_date <= (('{{T_FIRST}}'::timestamptz + interval '{{N}} days') at time zone 'America/Los_Angeles')::date
group by first_seen_date order by first_seen_date;
