-- Phase 2 plan Step 7, run first by scripts/windows/ops-report.ps1: T_first, the first scheduled slot after
-- T_start and not before 2026-10-23 13:00 Asia/Ho_Chi_Minh (after the Windows probe). Empty until it exists.
-- {{T_START}} is filled in by the runner from a checked UTC time. Reads crawl_runs (trigger, scheduled_for).
set time zone 'UTC';
select min(scheduled_for) as t_first from crawl_runs
where trigger = 'schedule' and scheduled_for > '{{T_START}}' and scheduled_for >= '2026-10-23T06:00:00Z';
