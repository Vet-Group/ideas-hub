'use server';

import { getKeyword } from '@ideas-hub/db/queries';
import { requestRun } from '@ideas-hub/worker/manual';
import { revalidatePath } from 'next/cache';
import { boss } from '@/lib/boss';
import { db, pool } from '@/lib/db';
import { formatTime } from '@/lib/format';
import { now } from '@/lib/now';
import { mayRunNow } from '@/lib/run-now';
import { requireUser } from '@/lib/session';
import { loadSettings } from '@/lib/settings';
import { t } from '@/lib/strings.vi';

/** Run now on a keyword page: the same checks as the worker's (spec §1 "Run now"), for every active country. */
export async function runNowAction(keywordId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const keyword = await getKeyword(db, keywordId);
  if (!keyword || !mayRunNow(user, keyword)) return { ok: false, error: t.runNow.refused };
  const s = await loadSettings();
  const r = await requestRun(pool, await boss(), s, {
    trigger: 'manual',
    pairs: s.countries.map((country) => ({ keywordId, country })),
    triggeredBy: user.userId,
    now: now(),
  });
  revalidatePath(`/keywords/${keywordId}`);
  if (r.ok) return { ok: true };
  const error =
    r.reason === 'blocked' && r.blockedUntil
      ? t.runNow.blocked(formatTime(r.blockedUntil))
      : r.reason === 'run_running' || r.reason === 'manual_pending'
        ? t.runNow.running
        : r.reason === 'no_pairs'
          ? t.runNow.noPairs
          : t.runNow.refused;
  return { ok: false, error };
}
