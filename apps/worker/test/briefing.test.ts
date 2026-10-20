import { type BriefingSections, estimateCallUsd, briefingPrompt } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { briefingKpi, sourceRunById } from '@ideas-hub/db/queries';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bounded } from '../src/bounded';
import { type BriefingDeps, buildBriefing } from '../src/briefing';
import { larkHttpClient, larkSend } from '../src/lark';
import { LARK, type LarkJob } from '../src/queues';
import { BUILD, SHARED_CHAT, resetBriefings, seedBriefingData } from './briefing-data';
import { type LlmStep, fakeLark, fakeLlm } from './fakes';
import { type Harness, all, harness, one, setSettings } from './helpers';

const GLOBAL = { date: '2026-10-21', scope: 'global' } as const;
const KW0 = { date: '2026-10-21', scope: 'keyword', keywordId: 'kw_0' } as const;

describe.skipIf(!testDatabaseAvailable())('briefing.build', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness('2026-10-18T18:00:00Z');
    await seedBriefingData(h);
  }, 120_000);
  afterAll(() => h?.close());
  beforeEach(() => resetBriefings(h));

  const deps = (script: (n: number) => LlmStep, over: Partial<BriefingDeps> = {}) => {
    const llm = fakeLlm(script);
    return { llm, deps: { llm: llm.client, sharedChat: SHARED_CHAT, ...over } satisfies BriefingDeps };
  };
  const row = (scope = 'global', keywordId: string | null = null) =>
    one<{ id: string; sections: BriefingSections; llm_calls: number; ai_cost_usd: string; ready_at: Date | null }>(
      h,
      sql`select id, sections, llm_calls, ai_cost_usd, ready_at from briefings where date = '2026-10-21' and scope = ${scope} and keyword_id is not distinct from ${keywordId}`,
    );
  const larkJobs = () => all<{ data: LarkJob }>(h, sql`select data from pgboss.job where name = ${LARK} order by created_on`);

  describe('with the fake Lark group', () => {
    let lark: Awaited<ReturnType<typeof fakeLark>>;
    beforeAll(async () => {
      lark = await fakeLark();
    });
    afterAll(() => lark?.close());

    it('a briefing for the last run renders 6 sections and posts to the test Lark group', async () => {
      const { llm, deps: d } = deps(() => 'valid');
      expect(await buildBriefing(h, GLOBAL, d)).toBe('built');
      const b = await row();
      expect(Object.keys(b.sections).sort()).toEqual(['hotKeywords', 'kpi', 'news', 'risingAds', 'risingShops', 'sourceRun', 'suggestions', 'topAds']);
      expect(b.sections.sourceRun).toMatchObject({ id: 'run_2026-10-21', okSearches: 6, plannedSearches: 6 });
      expect(b.sections.topAds!.length).toBeGreaterThan(0);
      expect(b.sections.topAds!.find((a) => a.adArchiveId === 'k0-0')).toMatchObject({ keyword: 'k0', countries: ['GB', 'US'] });
      expect(b.sections.risingAds!.length).toBeGreaterThan(0);
      expect(b.sections.hotKeywords!.map((k) => k.label)).toEqual(['k0', 'k1', 'k2']);
      expect(b.sections.risingShops![0]!.key).toBe('rising.com');
      expect(b.sections.news).toMatchObject({ state: 'ok', summary: 'Tóm tắt tin tức và ngày lễ.', items: [{ id: 'news_1', feed: 'news.example.test' }] });
      expect(b.sections.news!.holidays[0]).toEqual({ date: '2026-10-31', name: 'Halloween', days: 10 });
      expect(b.sections.suggestions).toEqual({ state: 'ok', count: 5 });
      expect(await all(h, sql`select kind, evidence from suggestions where briefing_id = ${b.id} order by created_at`)).toHaveLength(5);
      expect(b.llm_calls).toBe(1);
      expect(Number(b.ai_cost_usd)).toBe(estimateCallUsd('claude-sonnet-5-5', { system: llm.calls[0]!.system, user: llm.calls[0]!.user }));
      expect(b.ready_at).not.toBeNull();
      expect(llm.calls[0]).toMatchObject({ model: 'claude-sonnet-5-5', maxTokens: 4000 });

      const jobs = await larkJobs();
      expect(jobs.map((j) => j.data)).toEqual([{ briefingId: b.id, chat: SHARED_CHAT }]);
      const ctl = new AbortController();
      expect(await larkSend(h, { data: jobs[0]!.data, retryCount: 0 }, { lark: larkHttpClient(lark.config), appUrl: 'http://app.test' }, ctl.signal)).toBe('posted');
      expect(lark.messages).toHaveLength(1);
      const text = lark.messages[0]!.text;
      expect(text).toContain('Briefing Ideas Hub ngày 21/10');
      expect(text).toContain('3 điểm chính:');
      expect(text.match(/^• /gm)).toHaveLength(3);
      expect(text).toContain('Top 5 quảng cáo:');
      expect(text).toContain('Tóm tắt: Tóm tắt tin tức và ngày lễ.');
      expect(text).toContain('Xem chi tiết: http://app.test/briefing/2026-10-21');
      expect(await one(h, sql`select message_id from lark_messages where briefing_id = ${b.id}`)).toEqual({ message_id: 'om_1' });
    });
  });

  it('two failed calls give a ready briefing with sections 1–4 and "failed: AI" for 5 and 6', async () => {
    const { llm, deps: d } = deps(() => 'invalid');
    expect(await buildBriefing(h, GLOBAL, d)).toBe('built');
    const b = await row();
    expect(llm.calls).toHaveLength(2);
    expect(b.llm_calls).toBe(2);
    expect(b.ready_at).not.toBeNull();
    expect(b.sections.topAds!.length).toBeGreaterThan(0);
    expect(b.sections.news).toMatchObject({ state: 'failed', reason: 'ai', items: [{ id: 'news_1' }] });
    expect(b.sections.suggestions).toEqual({ state: 'failed', reason: 'ai' });
    expect(await all(h, sql`select 1 from suggestions`)).toEqual([]);
    // The retry tells the model what was wrong.
    expect(llm.calls[1]!.user).toContain('Lần trả lời trước không hợp lệ');
  });

  it('a timed-out call counts as a failed attempt and is retried once', async () => {
    await setSettings(h, { llmCallTimeoutSeconds: 0.3 });
    const { llm, deps: d } = deps((n) => (n === 1 ? 'hang' : 'valid'));
    const started = Date.now();
    expect(await buildBriefing(h, GLOBAL, d)).toBe('built');
    expect(Date.now() - started).toBeLessThan(5000);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0]!.signal.aborted).toBe(true);
    const b = await row();
    expect(b.llm_calls).toBe(2);
    expect(b.sections.suggestions).toEqual({ state: 'ok', count: 5 });
  });

  it('evidence refs not in the prompt: one retry, then the invalid suggestions are dropped', async () => {
    const { llm, deps: d } = deps(() => 'bad_refs');
    await buildBriefing(h, GLOBAL, d);
    expect(llm.calls).toHaveLength(2);
    const b = await row();
    expect(b.sections.suggestions).toEqual({ state: 'ok', count: 3 });
    const ev = await all<{ evidence: { ads: string[] } }>(h, sql`select evidence from suggestions where briefing_id = ${b.id}`);
    expect(ev.flatMap((e) => e.evidence.ads)).not.toContain('ad_not_sent');
  });

  it('over the daily cap: no call, sections 5 and 6 "skipped: cost cap", the briefing still ready', async () => {
    await setSettings(h, { aiDailyCostCapUsd: 0.0001 });
    const { llm, deps: d } = deps(() => 'valid');
    expect(await buildBriefing(h, GLOBAL, d)).toBe('built');
    const b = await row();
    expect(llm.calls).toHaveLength(0);
    expect(b.sections.news).toMatchObject({ state: 'skipped', reason: 'cost_cap' });
    expect(b.sections.suggestions).toEqual({ state: 'skipped', reason: 'cost_cap' });
    expect(b.ready_at).not.toBeNull();
  });

  it('the cap is checked before the retry too, across all briefings of the day', async () => {
    const { llm, deps: d } = deps(() => 'valid');
    await buildBriefing(h, GLOBAL, d);
    const spent = Number((await row()).ai_cost_usd);
    // Room for one more call today: the keyword briefing's first call fails and its retry is refused.
    const prompt = briefingPrompt({ date: '2026-10-21', keyword: 'k0', kpi: { runningAds: 0, delta: null, okRate: null, nextHoliday: null }, topAds: [], risingAds: [], hotKeywords: [], risingShops: [], news: [], holidays: [] });
    await setSettings(h, { aiDailyCostCapUsd: spent + estimateCallUsd('claude-sonnet-5-5', prompt) * 1.5 });
    const kw = deps(() => 'invalid');
    await buildBriefing(h, KW0, kw.deps);
    expect(kw.llm.calls).toHaveLength(1);
    const b = await row('keyword', 'kw_0');
    expect(b.llm_calls).toBe(1);
    expect(b.sections.suggestions).toEqual({ state: 'failed', reason: 'ai' });
    const { rows } = await h.pool.query(`select sum(ai_cost_usd)::float as usd from briefings where date = '2026-10-21'`);
    expect(rows[0].usd).toBeLessThanOrEqual(spent + estimateCallUsd('claude-sonnet-5-5', prompt) * 1.5);
    expect(llm.calls).toHaveLength(1);
  });

  it('a crash during an LLM call still counts it; the rerun makes at most one more call', async () => {
    const ctl = new AbortController();
    const first = deps(() => 'hang_until_abort');
    const build = buildBriefing(h, GLOBAL, first.deps, ctl.signal);
    await expect.poll(() => first.llm.calls.length).toBe(1);
    ctl.abort(new Error('worker died'));
    await expect(build).rejects.toThrow('worker died');
    const cut = await row();
    expect(cut.llm_calls).toBe(1);
    expect(Number(cut.ai_cost_usd)).toBeGreaterThan(0);
    expect(cut.ready_at).toBeNull();

    const rerun = deps(() => 'invalid');
    expect(await buildBriefing(h, GLOBAL, rerun.deps)).toBe('built');
    expect(rerun.llm.calls).toHaveLength(1);
    expect((await row()).llm_calls).toBe(2);
    // A third run of the same briefing makes none.
    await h.db.execute(sql`update briefings set ready_at = null, sections = sections - 'news' - 'suggestions'`);
    const third = deps(() => 'valid');
    await buildBriefing(h, GLOBAL, third.deps);
    expect(third.llm.calls).toHaveLength(0);
    expect((await row()).sections.suggestions).toEqual({ state: 'failed', reason: 'ai' });
  });

  it('a build cut by a restart after its AI sections were stored finishes without a second AI charge; stored sections are kept', async () => {
    const { deps: d } = deps(() => 'valid');
    await buildBriefing(h, GLOBAL, d);
    const before = await row();
    await h.db.execute(sql`update briefings set ready_at = null, sections = jsonb_set(sections, '{topAds}', '[]'::jsonb) - 'risingShops'`);
    const again = deps(() => 'valid');
    expect(await buildBriefing(h, GLOBAL, again.deps)).toBe('built');
    const after = await row();
    expect(again.llm.calls).toHaveLength(0);
    expect(after.llm_calls).toBe(before.llm_calls);
    expect(after.ai_cost_usd).toBe(before.ai_cost_usd);
    expect(after.sections.topAds).toEqual([]);
    expect(after.sections.risingShops).toEqual(before.sections.risingShops);
    expect(after.ready_at).not.toBeNull();
    expect(await all(h, sql`select 1 from suggestions`)).toHaveLength(5);
    // A ready briefing is left alone.
    expect(await buildBriefing(h, GLOBAL, again.deps)).toBe('already_ready');
  });

  it('a keyword briefing has the same sections filtered to its keyword and is queued for the chats of the stores that track it', async () => {
    const { llm, deps: d } = deps(() => 'valid');
    expect(await buildBriefing(h, KW0, d)).toBe('built');
    const b = await row('keyword', 'kw_0');
    expect(b.sections.hotKeywords!.map((k) => k.key)).toEqual(['kw_0']);
    expect(b.sections.topAds!.every((a) => a.keyword === 'k0')).toBe(true);
    expect(b.sections.risingShops!.map((s) => s.key)).toEqual(['rising.com']);
    expect(llm.calls[0]!.user).toContain('từ khóa "k0"');
    expect((await larkJobs()).map((j) => j.data.chat)).toEqual(['oc_storeA']);
    // kw_2's store has no Lark chat; a keyword no store tracks gets no briefing.
    await buildBriefing(h, { date: '2026-10-21', scope: 'keyword', keywordId: 'kw_2' }, d);
    expect(await larkJobs()).toHaveLength(1);
    await h.db.execute(sql`delete from store_keywords where keyword_id = 'kw_1'`);
    try {
      expect(await buildBriefing(h, { date: '2026-10-21', scope: 'keyword', keywordId: 'kw_1' }, d)).toBe('keyword_inactive');
    } finally {
      await h.db.execute(sql`insert into store_keywords (store_id, keyword_id) values ('store_A', 'kw_1')`);
    }
  });

  it('refreshes the feeds before section 5 of the global briefing only', async () => {
    let refreshed = 0;
    const { deps: d } = deps(() => 'valid', { refreshFeeds: async () => void (refreshed += 1) });
    await buildBriefing(h, GLOBAL, d);
    await buildBriefing(h, KW0, d);
    expect(refreshed).toBe(1);
  });

  describe('KPI row', () => {
    it('shows the run’s running_ads, its change against the same slot, ok ÷ planned and the next US holiday', async () => {
      const run = (await sourceRunById(h.db, 'run_2026-10-21'))!;
      const kpi = await briefingKpi(h.db, run, '2026-10-21');
      expect(kpi).toMatchObject({ okRate: 1, nextHoliday: { date: '2026-10-31', name: 'Halloween', days: 10 } });
      expect(kpi.delta).toMatchObject({ baselineDay: '2026-10-18', partial: true });
      expect(kpi.delta!.change).toBe(kpi.runningAds - (await one<{ running_ads: number }>(h, sql`select running_ads from crawl_runs where id = 'run_2026-10-19'`)).running_ads);
    });

    it('the baseline skips a run of that slot that wrote no keyword_days', async () => {
      const saved = await all(h, sql`select keyword_id, crawl_day::text, slot, running_ads from keyword_days where slot = (select scheduled_for from crawl_runs where id = 'run_2026-10-19')`);
      await h.db.execute(sql`delete from keyword_days where slot = (select scheduled_for from crawl_runs where id = 'run_2026-10-19')`);
      try {
        const kpi = await briefingKpi(h.db, (await sourceRunById(h.db, 'run_2026-10-21'))!, '2026-10-21');
        expect(kpi.delta).toMatchObject({ baselineDay: '2026-10-19', partial: true });
      } finally {
        for (const r of saved as { keyword_id: string; crawl_day: string; slot: Date; running_ads: number }[]) {
          await h.db.execute(sql`insert into keyword_days (keyword_id, crawl_day, slot, running_ads) values (${r.keyword_id}, ${r.crawl_day}, ${r.slot}, ${r.running_ads})`);
        }
      }
    });
  });

  it('runs its queries under a 60 s statement_timeout', async () => {
    expect((await bounded(h.pool, (tx) => tx.client.query('show statement_timeout'))).rows).toEqual([{ statement_timeout: '1min' }]);
  });

  it('starts from the build time: before any completed run it does nothing', async () => {
    h.clock.t = Date.parse('2026-10-18T00:00:00Z');
    const { llm, deps: d } = deps(() => 'valid');
    expect(await buildBriefing(h, { date: '2026-10-18', scope: 'global' }, d)).toBe('no_source_run');
    expect(llm.calls).toHaveLength(0);
    expect(BUILD.toISOString()).toBe('2026-10-20T23:30:00.000Z');
  });
});
