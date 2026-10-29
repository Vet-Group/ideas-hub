// Settings checks the admin page and the worker apply before a change is used (spec §1, §3; plan Step 3).
// Returns problem codes; the UI maps them to Vietnamese text.
import { ANGLES_TIME } from './angles';
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
  | 'build_not_before_angles'
  | 'no_run_times';

const DAY_MINUTES = 24 * 60;
const MAX_EXPIRY_SECONDS = 24 * 3600;
/** The global briefing job refreshes the RSS feeds (in parallel, each under this timeout) before its LLM calls. */
export const FEED_TIMEOUT_SECONDS = 15;
/** LLM calls one briefing may make (the worker's reservation limit); each may take the LLM call timeout. */
export const MAX_LLM_CALLS = 2;
/** lark.send retries after the first attempt (pg-boss retryLimit), each after a fixed delay. */
export const LARK_RETRY_LIMIT = 3;
export const LARK_RETRY_DELAY_SECONDS = 30;
/** pg-boss work() poll interval of briefing.build and lark.send (the pg-boss 12.37.0 default, set explicitly in main.ts). */
export const QUEUE_POLL_SECONDS = 2;

/**
 * Room after build time + job expiry for the global briefing's Lark post, which the watchdog also judges
 * at the ready time: one pickup of the lark.send job per attempt (first + retries), each attempt bounded
 * by the Lark send timeout, the retry delays, and the briefing job's own pickup.
 * Decided by the owner's delegate on 2026-10-21, reversible.
 */
export const briefingReadyMarginSeconds = (s: Pick<Settings, 'larkSendTimeoutSeconds'>) =>
  QUEUE_POLL_SECONDS + (LARK_RETRY_LIMIT + 1) * (QUEUE_POLL_SECONDS + s.larkSendTimeoutSeconds) + LARK_RETRY_LIMIT * LARK_RETRY_DELAY_SECONDS;

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
  // The page and the watchdog judge today's briefing and its Lark post at the ready time, so one build attempt and the post must fit before it.
  if (minutesOf(s.briefingBuildTime) * 60 + s.briefingJobExpirySeconds + briefingReadyMarginSeconds(s) > minutesOf(s.briefingReadyTime) * 60) {
    problems.push('ready_before_build_ends');
  }
  // The angle job waits while a build of the day is queued, so a build at or after it would hold it back every day.
  if (minutesOf(s.briefingBuildTime) >= minutesOf(ANGLES_TIME)) problems.push('build_not_before_angles');
  return problems;
}
