import 'server-only';
import { VIETNAM } from '@ideas-hub/core';
import { type BriefingRow, globalBriefing, latestReadyBriefing } from '@ideas-hub/db/queries';
import { db } from './db';

const vnDate = new Intl.DateTimeFormat('en-CA', { timeZone: VIETNAM, year: 'numeric', month: '2-digit', day: '2-digit' });
/** The Asia/Ho_Chi_Minh date of an instant, `YYYY-MM-DD`. */
export const vnDay = (at: Date) => vnDate.format(at);
/** `HH:mm` of a day in Asia/Ho_Chi_Minh as an instant. */
export const vnTimeOn = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`);

export type TodayState = 'ready' | 'before_ready' | 'late' | 'none';

/**
 * What `/briefing` shows (spec §6): today's global briefing once ready; before the ready time the latest
 * ready one ("Before the ready time"); after it the latest ready one under the "Briefing late" banner.
 */
export async function todayBriefing(at: Date, readyTime: string): Promise<{ state: TodayState; briefing: BriefingRow | null }> {
  const today = vnDay(at);
  const own = await globalBriefing(db, today);
  if (own?.readyAt) return { state: 'ready', briefing: own };
  const latest = await latestReadyBriefing(db, today);
  if (!latest) return { state: 'none', briefing: null };
  return { state: at < vnTimeOn(today, readyTime) ? 'before_ready' : 'late', briefing: latest };
}
