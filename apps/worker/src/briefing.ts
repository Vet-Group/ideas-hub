// `briefing.build` (spec §3, plan Step 7): one job per briefing, the global one and one per active
// store-tracked keyword. Sections are stored one by one into `briefings.sections` (contract in
// packages/core briefing/sections.ts) and stored keys are kept, so a rerun spends no AI cost twice.
// Sections 5 and 6 come from at most 2 LLM calls per briefing ever: each call's count and estimated cost
// are committed before it is made, so a call cut by a crash still counts.
import {
  type AiMissing,
  type BriefingAd,
  type BriefingSections,
  type PromptInput,
  type Settings,
  BRIEFING_MAX_TOKENS,
  briefingPrompt,
  estimateCallUsd,
  fitsDailyCap,
  keepResolved,
  parseBriefingOutput,
  promptRefs,
  vietnamDate,
  vietnamInstant,
} from '@ideas-hub/core';
import { suggestions as suggestionsTable } from '@ideas-hub/db';
import { type Db, type BossDb, withTx } from '@ideas-hub/db/client';
import {
  type AdRow,
  briefingKpi,
  briefingNews,
  briefingSourceRun,
  hotKeywords,
  risingNewAds,
  risingShops,
  sourceRun,
  sourceRunById,
  topTrendingAds,
  upcomingHolidays,
} from '@ideas-hub/db/queries';
import { sql } from 'drizzle-orm';
import { bounded } from './bounded';
import { type Ctx, loadSettings } from './context';
import { type LlmClient } from './llm';
import { BRIEFING, type BriefingJob, briefingKey, sendBriefingJob, sendLarkJob } from './queues';

export const MAX_LLM_CALLS = 2;
/** Serializes the daily-cap check and the reservation of a call across briefings. */
const COST_LOCK = 4_242_002;

export interface BriefingDeps {
  llm: LlmClient;
  /** Refreshes the RSS feeds; the global build calls it before section 5. */
  refreshFeeds?: (signal: AbortSignal) => Promise<unknown>;
  /** The shared Lark group of the global briefing; null posts nothing. */
  sharedChat: string | null;
}

export type BuildOutcome = 'built' | 'already_ready' | 'keyword_inactive' | 'no_source_run';

type Row = { id: string; sections: BriefingSections; ready_at: Date | null };

const toAd = (a: AdRow): BriefingAd => ({
  adArchiveId: a.adArchiveId,
  pageName: a.pageName,
  caption: a.caption,
  landingDomain: a.landingDomain,
  thumbnailKey: a.thumbnailKey,
  daysActive: a.daysActive,
  trendScore: a.trendScore,
  keyword: a.keyword,
  countries: a.countries,
});

/** Merges one section in unless it is stored already; returns the stored sections. */
async function storeSection(ctx: Ctx, id: string, key: keyof BriefingSections, value: unknown): Promise<BriefingSections> {
  const { rows } = await bounded(ctx.pool, ({ db }) =>
    db.execute<{ sections: BriefingSections }>(sql`
      update briefings set sections = jsonb_build_object(${key}::text, ${JSON.stringify(value)}::jsonb) || sections where id = ${id} returning sections`),
  );
  return rows[0]!.sections;
}

/** The `jobs` in force for `date`: the global briefing and each active keyword a store tracks. */
export async function briefingJobsFor(db: Db, date: string): Promise<BriefingJob[]> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select k.id from keywords k where k.active and exists (select 1 from store_keywords sk where sk.keyword_id = k.id) order by k.created_at, k.id`);
  return [{ date, scope: 'global' }, ...rows.map((r) => ({ date, scope: 'keyword' as const, keywordId: r.id }))];
}

export async function buildBriefing(ctx: Ctx, job: BriefingJob, deps: BriefingDeps, signal: AbortSignal = new AbortController().signal): Promise<BuildOutcome> {
  const s = await bounded(ctx.pool, ({ db }) => loadSettings(db));
  let keywordText: string | null = null;
  if (job.scope === 'keyword') {
    const { rows } = await bounded(ctx.pool, ({ db }) =>
      db.execute<{ text: string }>(sql`
        select text from keywords k where k.id = ${job.keywordId!} and k.active and exists (select 1 from store_keywords sk where sk.keyword_id = k.id)`),
    );
    // A keyword deactivated or untracked before the build makes its job a no-op (plan Step 3).
    if (!rows[0]) return 'keyword_inactive';
    keywordText = rows[0].text;
  }
  const b = await bounded(ctx.pool, async ({ db }) => {
    await db.execute(sql`
      insert into briefings (id, date, scope, keyword_id, created_at) values (${`brf_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`}, ${job.date}, ${job.scope}, ${job.keywordId ?? null}, ${ctx.clock.now()})
      on conflict on constraint briefings_date_scope_key do nothing`);
    const { rows } = await db.execute<Row>(sql`
      select id, sections, ready_at from briefings where date = ${job.date} and scope = ${job.scope} and keyword_id is not distinct from ${job.keywordId ?? null}`);
    return rows[0]!;
  });
  if (b.ready_at) return 'already_ready';

  let sections = b.sections;
  // A rerun keeps the run its first attempt chose, even if a newer one finished since.
  const run = await bounded(ctx.pool, ({ db }) => (sections.sourceRun ? sourceRunById(db, sections.sourceRun.id) : sourceRun(db, ctx.clock.now())));
  if (!run) {
    ctx.log('briefing: no completed scheduled run yet', { key: briefingKey(job) });
    return 'no_source_run';
  }
  const o = { staleAfterDays: s.staleAfterDays, countries: s.countries, keywordId: job.keywordId };
  const compute: Record<'sourceRun' | 'kpi' | 'topAds' | 'risingAds' | 'hotKeywords' | 'risingShops', (db: Db) => Promise<unknown>> = {
    sourceRun: (db) => briefingSourceRun(db, run),
    kpi: (db) => briefingKpi(db, run, job.date),
    topAds: async (db) => (await topTrendingAds(db, run, o)).map(toAd),
    risingAds: async (db) => (await risingNewAds(db, run, o)).map((a) => ({ ...toAd(a), sightings: a.sightings, bestPosition: a.bestPosition })),
    hotKeywords: (db) => hotKeywords(db, run, { keywordId: job.keywordId }),
    risingShops: (db) => risingShops(db, run, { keywordId: job.keywordId }),
  };
  for (const [key, fn] of Object.entries(compute) as [keyof typeof compute, (db: Db) => Promise<unknown>][]) {
    if (key in sections) continue;
    signal.throwIfAborted();
    sections = await storeSection(ctx, b.id, key, await bounded(ctx.pool, ({ db }) => fn(db)));
  }

  if (!('news' in sections && 'suggestions' in sections)) {
    if (job.scope === 'global' && deps.refreshFeeds) await deps.refreshFeeds(signal).catch((e) => ctx.log('feed refresh failed', { error: String(e) }));
    signal.throwIfAborted();
    const input: PromptInput = {
      date: job.date,
      keyword: keywordText,
      kpi: sections.kpi!,
      topAds: sections.topAds!,
      risingAds: sections.risingAds!,
      hotKeywords: sections.hotKeywords!,
      risingShops: sections.risingShops!,
      news: await bounded(ctx.pool, ({ db }) => briefingNews(db, ctx.clock.now())),
      holidays: await bounded(ctx.pool, ({ db }) => upcomingHolidays(db, job.date)),
    };
    const ai = await aiSections(ctx, b.id, job.date, input, s, deps.llm, signal);
    await storeAi(ctx, b.id, input, ai);
  }

  // Ready, and its Lark posts queued in the same transaction, so a crash cannot lose them.
  await bounded(ctx.pool, async ({ db, bossDb }) => {
    const { rows } = await db.execute(sql`update briefings set ready_at = ${ctx.clock.now()} where id = ${b.id} and ready_at is null returning id`);
    if (rows.length === 0) return;
    for (const chat of await chatsOf(db, job, deps.sharedChat)) await sendLarkJob(ctx.boss, bossDb, { briefingId: b.id, chat });
  });
  return 'built';
}

/** The shared group for the global briefing; each store chat whose store tracks the keyword for a keyword briefing. */
async function chatsOf(db: Db, job: BriefingJob, sharedChat: string | null): Promise<string[]> {
  if (job.scope === 'global') return sharedChat ? [sharedChat] : [];
  const { rows } = await db.execute<{ lark_chat_id: string }>(sql`
    select distinct st.lark_chat_id from stores st join store_keywords sk on sk.store_id = st.id
    where sk.keyword_id = ${job.keywordId!} and st.lark_chat_id is not null and st.lark_chat_id <> '' order by 1`);
  return rows.map((r) => r.lark_chat_id);
}

type AiResult = { state: 'ok'; summary: string; suggestions: ReturnType<typeof keepResolved> } | AiMissing;

/**
 * Reserves one call: under the cost lock, refuses past MAX_LLM_CALLS or the daily cap (all briefings of
 * the day), else commits the count and the estimate before the call is made.
 */
async function reserveCall(ctx: Ctx, briefingId: string, date: string, estimate: number, capUsd: number): Promise<'reserved' | 'limit' | 'cap'> {
  return bounded(ctx.pool, async ({ db }) => {
    await db.execute(sql`select pg_advisory_xact_lock(${COST_LOCK})`);
    const { rows } = await db.execute<{ llm_calls: number }>(sql`select llm_calls from briefings where id = ${briefingId} for update`);
    if (rows[0]!.llm_calls >= MAX_LLM_CALLS) return 'limit';
    const { rows: spent } = await db.execute<{ usd: string }>(sql`select coalesce(sum(ai_cost_usd), 0)::text as usd from briefings where date = ${date}`);
    if (!fitsDailyCap(Number(spent[0]!.usd), estimate, capUsd)) return 'cap';
    await db.execute(sql`update briefings set llm_calls = llm_calls + 1, ai_cost_usd = ai_cost_usd + ${estimate} where id = ${briefingId}`);
    return 'reserved';
  });
}

/** One call bounded by the LLM timeout and the job's signal, even if the client ignores the signal. */
function callLlm(llm: LlmClient, req: Omit<Parameters<LlmClient['complete']>[0], 'signal'>, timeoutSeconds: number, jobSignal: AbortSignal): Promise<string> {
  const signal = AbortSignal.any([jobSignal, AbortSignal.timeout(timeoutSeconds * 1000)]);
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('LLM call aborted'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    llm
      .complete({ ...req, signal })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function aiSections(ctx: Ctx, briefingId: string, date: string, input: PromptInput, s: Settings, llm: LlmClient, signal: AbortSignal): Promise<AiResult> {
  const refs = promptRefs(input);
  let fallback: Extract<ReturnType<typeof parseBriefingOutput>, { ok: true }> | null = null;
  let problem: string | undefined;
  let attempted = false;
  for (;;) {
    const prompt = briefingPrompt(input, problem);
    const reserved = await reserveCall(ctx, briefingId, date, estimateCallUsd(s.llmModel, prompt), s.aiDailyCostCapUsd);
    if (reserved !== 'reserved') {
      if (fallback) return { state: 'ok', summary: fallback.summary, suggestions: keepResolved(fallback) };
      // The cap stopped it before any call of this build: skipped; otherwise the calls failed.
      return reserved === 'cap' && !attempted ? { state: 'skipped', reason: 'cost_cap' } : { state: 'failed', reason: 'ai' };
    }
    attempted = true;
    let reply: string;
    try {
      reply = await callLlm(llm, { model: s.llmModel, system: prompt.system, user: prompt.user, maxTokens: BRIEFING_MAX_TOKENS }, s.llmCallTimeoutSeconds, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      ctx.log('briefing: LLM call failed', { briefingId, error: String(e) });
      problem = undefined;
      continue;
    }
    const parsed = parseBriefingOutput(reply, refs);
    if (!parsed.ok) {
      ctx.log('briefing: LLM reply rejected', { briefingId, problem: parsed.problem });
      problem = parsed.problem;
      continue;
    }
    if (parsed.badRefs.length === 0) return { state: 'ok', summary: parsed.summary, suggestions: parsed.suggestions };
    fallback = parsed;
    problem = `${parsed.badRefs.length} gợi ý dùng id không có trong dữ liệu`;
  }
}

/** Sections 5 and 6 and the suggestion rows, in one transaction, only if section 6 is not stored yet. */
async function storeAi(ctx: Ctx, briefingId: string, input: PromptInput, ai: AiResult) {
  const items = input.news.map(({ summary: _summary, ...n }) => n);
  const news = ai.state === 'ok' ? { state: 'ok', summary: ai.summary, items, holidays: input.holidays } : { ...ai, items, holidays: input.holidays };
  const sugg = ai.state === 'ok' ? { state: 'ok', count: ai.suggestions.length } : ai;
  await bounded(ctx.pool, async ({ db }) => {
    const { rows } = await db.execute(sql`
      update briefings set sections = jsonb_build_object('news', ${JSON.stringify(news)}::jsonb, 'suggestions', ${JSON.stringify(sugg)}::jsonb) || sections
      where id = ${briefingId} and not (sections ? 'suggestions') returning id`);
    if (rows.length === 0 || ai.state !== 'ok' || ai.suggestions.length === 0) return;
    const at = ctx.clock.now();
    // created_at keeps the model's order (briefingSuggestions sorts by it).
    await db.insert(suggestionsTable).values(ai.suggestions.map((x, i) => ({ briefingId, kind: x.kind, text: x.text, reason: x.reason, evidence: x.evidence, createdAt: new Date(at.getTime() + i) })));
  });
}

// ---- scheduling ----------------------------------------------------------------------------------------

/** The build time of an Asia/Ho_Chi_Minh date. */
export const buildAt = (date: string, s: Pick<Settings, 'briefingBuildTime'>) => vietnamInstant(date, s.briefingBuildTime);

/** The date whose build time is the next one not yet reached. */
export function nextBuildDate(now: Date, s: Pick<Settings, 'briefingBuildTime'>): string {
  const today = vietnamDate(now);
  return now < buildAt(today, s) ? today : vietnamDate(new Date(buildAt(today, s).getTime() + 86_400_000));
}

/** Sends the given briefings' builds, the global one first, in the caller's transaction; returns the ids (null when already queued). */
export async function sendBuilds(ctx: Ctx, bossDb: BossDb, jobs: BriefingJob[], startAfter: Date, s: Settings): Promise<(string | null)[]> {
  const ids: (string | null)[] = [];
  for (const j of [...jobs].sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'global' ? -1 : 1))) ids.push(await sendBriefingJob(ctx.boss, bossDb, j, startAfter, s));
  return ids;
}

/**
 * The scheduler's briefing step (plan Step 3): sends the builds of the next build time not yet reached
 * (null for those already queued), and re-sends, cancel and send in one transaction, any queued build of
 * that day or today whose start no longer matches the build time.
 */
export async function scheduleBriefings(ctx: Ctx, s: Settings, now: Date) {
  const pool = { executeSql: (t: string, v?: unknown[]) => ctx.pool.query(t, v) };
  let resent = 0;
  for (const date of new Set([vietnamDate(now), nextBuildDate(now, s)])) {
    const want = buildAt(date, s);
    const { rows } = await pool.executeSql(
      `select id, data, start_after as "startAfter" from pgboss.job where name = $1 and state = 'created' and singleton_key like $2`,
      [BRIEFING, `${date}:%`],
    );
    for (const job of rows as { id: string; data: BriefingJob; startAfter: Date }[]) {
      const at = new Date(job.startAfter);
      // A build time moved later, or earlier but still ahead: start at the new time; moved into the past: start now.
      const target = want > now ? want : at > now ? now : null;
      if (!target || at.getTime() === target.getTime()) continue;
      await withTx(ctx.pool, async ({ bossDb }) => {
        await ctx.boss.cancel(BRIEFING, job.id, { db: bossDb });
        await sendBriefingJob(ctx.boss, bossDb, job.data, target, s);
      });
      resent += 1;
    }
  }
  const date = nextBuildDate(now, s);
  const jobs = await briefingJobsFor(ctx.db, date);
  const ids = await withTx(ctx.pool, ({ bossDb }) => sendBuilds(ctx, bossDb, jobs, buildAt(date, s), s));
  return { briefingsSent: ids.filter(Boolean).length, briefingsResent: resent };
}

/** Crash recovery's last step: once today's build time has passed, today's briefings without `ready_at` are built again now. */
export async function resendUnfinished(ctx: Ctx, s: Settings, now: Date): Promise<number> {
  const today = vietnamDate(now);
  if (now < buildAt(today, s)) return 0;
  const { rows } = await ctx.db.execute<{ scope: 'global' | 'keyword'; keyword_id: string | null }>(sql`
    select scope, keyword_id from briefings where date = ${today} and ready_at is null`);
  const jobs = rows.map((r): BriefingJob => (r.scope === 'global' ? { date: today, scope: 'global' } : { date: today, scope: 'keyword', keywordId: r.keyword_id! }));
  const ids = await withTx(ctx.pool, ({ bossDb }) => sendBuilds(ctx, bossDb, jobs, now, s));
  return ids.filter(Boolean).length;
}
