// Settings checks the admin page and the worker apply before a change is used (spec §1, §3; plan Step 3).
// Returns problem codes; the UI maps them to Vietnamese text.
import { WATCHDOG_PERIOD_MINUTES, crawlJobExpirySeconds, minutesOf, morningRunTime } from './schedule';
import { type Settings } from './settings';

export type SettingsProblem =
  | 'crawl_expiry_over_24h'
  | 'margin_not_after_grace'
  | 'hard_stop_too_late'
  | 'morning_slot_after_hard_stop'
  | 'slots_too_close'
  | 'wait_limit_reaches_heartbeat'
  | 'llm_timeout_over_job_expiry'
  | 'briefing_expiry_over_24h'
  | 'feed_refresh_over_job_expiry'
  | 'ready_before_build_ends'
  | 'no_run_times';

const DAY_MINUTES = 24 * 60;
const MAX_EXPIRY_SECONDS = 24 * 3600;
/** The global briefing job refreshes the RSS feeds (in parallel, each under this timeout) before its LLM calls. */
export const FEED_TIMEOUT_SECONDS = 15;
/** LLM calls one briefing may make (the worker's reservation limit); each may take the LLM call timeout. */
export const MAX_LLM_CALLS = 2;

export function validateSettings(s: Settings): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  const guard = s.watchdogGraceMinutes + WATCHDOG_PERIOD_MINUTES;

  if (crawlJobExpirySeconds(s) > MAX_EXPIRY_SECONDS) problems.push('crawl_expiry_over_24h');
  // A hung manual run must be closed (deadline + grace + one watchdog period) before the slot.
  if (s.manualRunMarginMinutes <= guard) problems.push('margin_not_after_grace');
  if (minutesOf(s.morningHardStop) + guard >= minutesOf(s.briefingBuildTime)) problems.push('hard_stop_too_late');

  const times = [...s.runTimes].map(minutesOf).sort((a, b) => a - b);
  if (times.length === 0) problems.push('no_run_times');
  const morning = morningRunTime(s);
  if (morning !== null && minutesOf(morning) >= minutesOf(s.morningHardStop)) problems.push('morning_slot_after_hard_stop');
  const gaps = times.map((t, i) => (i + 1 < times.length ? times[i + 1]! - t : times[0]! + DAY_MINUTES - t));
  if (times.length > 0 && Math.min(...gaps) < s.runDeadlineMinutes + guard) problems.push('slots_too_close');

  // One bounded wait writes no heartbeat, so it must stay under the threshold.
  if (Object.values(s.waitLimitsSeconds).some((v) => v >= s.heartbeatThresholdMinutes * 60)) problems.push('wait_limit_reaches_heartbeat');

  if (MAX_LLM_CALLS * s.llmCallTimeoutSeconds > s.briefingJobExpirySeconds) problems.push('llm_timeout_over_job_expiry');
  else if (FEED_TIMEOUT_SECONDS + MAX_LLM_CALLS * s.llmCallTimeoutSeconds > s.briefingJobExpirySeconds) problems.push('feed_refresh_over_job_expiry');
  if (s.briefingJobExpirySeconds > MAX_EXPIRY_SECONDS) problems.push('briefing_expiry_over_24h');
  // The page and the watchdog judge today's briefing at the ready time, so one build attempt must fit before it.
  if (minutesOf(s.briefingBuildTime) * 60 + s.briefingJobExpirySeconds > minutesOf(s.briefingReadyTime) * 60) problems.push('ready_before_build_ends');
  return problems;
}
