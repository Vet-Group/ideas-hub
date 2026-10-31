// `angles.tag` (AC-A5, ADR 0008): once a day at 09:00 Asia/Ho_Chi_Minh, tags untagged proven ads with their
// angle, 25 per LLM call, with the briefing's model. It never touches a briefing: it spends only once the
// day's builds have ended, and only the leftover of the one daily AI cap (spentToday, under COST_LOCK).
import {
  ANGLES_TIME,
  ANGLE_BATCH,
  ANGLE_MAX_TOKENS,
  type AdAngle,
  anglePrompt,
  estimateCallUsd,
  fitsDailyCap,
  parseAngles,
  perAdUsd,
  vietnamDate,
  vietnamInstant,
} from '@ideas-hub/core';
import { adAngles as adAnglesTable } from '@ideas-hub/db';
import { type Db } from '@ideas-hub/db/client';
import { untaggedProvenAds } from '@ideas-hub/db/queries';
import { sql } from 'drizzle-orm';
import { bounded } from './bounded';
import { COST_LOCK, callLlm, spentToday } from './briefing';
import { type Ctx, loadSettings } from './context';
import { type LlmClient } from './llm';
import { ANGLES, ANGLES_EXPIRY_SECONDS, BRIEFING } from './queues';

/** While briefings are pending the job sends itself again this much later, the last start at ANGLES_CUTOFF_TIME. */
export const ANGLES_RETRY_MINUTES = 30;
export const ANGLES_CUTOFF_TIME = '12:00';
/** Failed calls in a row that end the job: a provider outage cannot spend the rest of the daily cap. */
export const ANGLES_MAX_FAILED_IN_A_ROW = 2;

export type AnglesOutcome = 'done' | 'briefings_pending' | 'cap' | 'unconfigured' | 'failed';

/** Whether a briefing of `date` is still being built: a row without `ready_at`, or a build queued, retrying or running. */
async function briefingsPending(db: Db, date: string): Promise<boolean> {
  const { rows } = await db.execute<{ pending: boolean }>(sql`
    select exists (select 1 from briefings where date = ${date} and ready_at is null)
      or exists (select 1 from pgboss.job where name = ${BRIEFING} and singleton_key like ${`${date}:%`} and state in ('created', 'retry', 'active')) as pending`);
  return rows[0]!.pending;
}

/**
 * Tags batches until none is left, the cap is reached, or ANGLES_MAX_FAILED_IN_A_ROW calls in a row fail
 * (outcome `failed`); a failed call (an error or a rejected reply) is counted in `failed` and the next batch is
 * sent. Each batch is reserved first, under the cost lock: the ready gate, the cap check and the `unclear` rows
 * carrying the call's estimate commit together, so a call cut by a crash or an error still counts and its ads
 * are not sent again that day; a later day reserves them again (untaggedProvenAds, before the new ads), up to
 * ANGLE_MAX_ATTEMPTS calls.
 */
export async function tagAngles(
  ctx: Ctx,
  llm: LlmClient,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ outcome: AnglesOutcome; calls: number; tagged: number; failed: number }> {
  const s = await bounded(ctx.pool, ({ db }) => loadSettings(db));
  let calls = 0;
  let tagged = 0;
  let failed = 0;
  let failedInARow = 0;
  const end = (outcome: AnglesOutcome) => ({ outcome, calls, tagged, failed });
  if (llm.configured === false) return end('unconfigured');
  for (;;) {
    signal.throwIfAborted();
    const today = vietnamDate(ctx.clock.now());
    const ads = await bounded(ctx.pool, ({ db }) => untaggedProvenAds(db, ANGLE_BATCH, today));
    if (ads.length === 0) return end('done');
    const prompt = anglePrompt(ads);
    const perAd = perAdUsd(estimateCallUsd(s.llmModel, prompt, ANGLE_MAX_TOKENS), ads.length);
    const reserved = await bounded(ctx.pool, async ({ db }) => {
      await db.execute(sql`select pg_advisory_xact_lock(${COST_LOCK})`);
      if (await briefingsPending(db, today)) return 'briefings_pending' as const;
      if (!fitsDailyCap(await spentToday(db, today), perAd * ads.length, s.aiDailyCostCapUsd)) return 'cap' as const;
      await db
        .insert(adAnglesTable)
        .values(ads.map((a) => ({ adArchiveId: a.adArchiveId, angle: 'unclear' as const, model: s.llmModel, costUsd: String(perAd), taggedOn: today })))
        .onConflictDoUpdate({
          target: adAnglesTable.adArchiveId,
          // A retry moves its cost to today, out of the failed day's total: only spentToday reads it, and only for today.
          set: { model: sql`excluded.model`, costUsd: sql`excluded.cost_usd`, taggedOn: sql`excluded.tagged_on`, attempts: sql`${adAnglesTable.attempts} + 1` },
          // A row another worker reserved or tagged today is left alone.
          setWhere: sql`${adAnglesTable.taggedAt} is null and ${adAnglesTable.taggedOn} < excluded.tagged_on`,
        });
      return 'reserved' as const;
    });
    if (reserved !== 'reserved') return end(reserved);
    calls += 1;
    let angles: Map<string, AdAngle> | null = null;
    try {
      const reply = await callLlm(llm, { model: s.llmModel, system: prompt.system, user: prompt.user, maxTokens: ANGLE_MAX_TOKENS }, s.llmCallTimeoutSeconds, signal);
      const parsed = parseAngles(reply, new Set(ads.map((a) => a.adArchiveId)));
      if (parsed.ok) angles = parsed.angles;
      else ctx.log('angles: LLM reply rejected', { problem: parsed.problem, replyChars: reply.length });
    } catch (e) {
      if (signal.aborted) throw e;
      ctx.log('angles: LLM call failed', { error: String(e) });
    }
    if (angles === null) {
      // Its ads stay reserved for today (tagged_at null): a later day retries them.
      failed += 1;
      failedInARow += 1;
      if (failedInARow >= ANGLES_MAX_FAILED_IN_A_ROW) return end('failed');
      continue;
    }
    failedInARow = 0;
    const at = ctx.clock.now();
    await bounded(ctx.pool, async ({ db }) => {
      for (const a of ads) await db.execute(sql`update ad_angles set angle = ${angles.get(a.adArchiveId) ?? 'unclear'}, tagged_at = ${at} where ad_archive_id = ${a.adArchiveId}`);
    });
    tagged += ads.length;
  }
}

/** The angles.tag handler: while briefings are pending it sends itself again ANGLES_RETRY_MINUTES later, until ANGLES_CUTOFF_TIME of `date`. */
export async function runAnglesJob(ctx: Ctx, llm: LlmClient, date: string, signal?: AbortSignal) {
  const result = await tagAngles(ctx, llm, signal);
  if (result.outcome !== 'briefings_pending') return { ...result, resent: false };
  const at = new Date(ctx.clock.now().getTime() + ANGLES_RETRY_MINUTES * 60_000);
  if (at > vietnamInstant(date, ANGLES_CUTOFF_TIME)) return { ...result, resent: false };
  // Its own key: exclusive allows one queued or active job per key, and this one is still active.
  const id = await ctx.boss.send(ANGLES, { date }, { singletonKey: `${date}:${at.toISOString()}`, startAfter: at, retryLimit: 0, expireInSeconds: ANGLES_EXPIRY_SECONDS });
  return { ...result, resent: id !== null };
}

/** The scheduler's angle step: queues the job of the next 09:00 not yet reached; null while it is queued already. */
export async function scheduleAngles(ctx: Ctx, now: Date): Promise<string | null> {
  const today = vietnamDate(now);
  const date = now < vietnamInstant(today, ANGLES_TIME) ? today : vietnamDate(new Date(now.getTime() + 86_400_000));
  return ctx.boss.send(ANGLES, { date }, { singletonKey: date, startAfter: vietnamInstant(date, ANGLES_TIME), retryLimit: 0, expireInSeconds: ANGLES_EXPIRY_SECONDS });
}
