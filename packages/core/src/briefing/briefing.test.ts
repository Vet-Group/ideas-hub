import { describe, expect, it } from 'vitest';
import { BRIEFING_MAX_TOKENS, UNKNOWN_MODEL_PRICE, estimateCallUsd, fitsDailyCap } from './cost';
import { type PromptInput, briefingPrompt, promptRefs } from './prompt';
import { keepResolved, parseBriefingOutput } from './schema';

const ad = (id: string) => ({ adArchiveId: id, pageName: `Page ${id}`, caption: `caption ${id}`, landingDomain: `${id}.com`, thumbnailKey: null, daysActive: 9, trendScore: 18, keyword: 'k0', countries: ['US'] });
const input: PromptInput = {
  date: '2026-10-21',
  keyword: null,
  kpi: { runningAds: 30, delta: null, okRate: 1, nextHoliday: { date: '2026-10-31', name: 'Halloween', days: 10 } },
  topAds: [ad('a1'), ad('a2')],
  risingAds: [{ ...ad('a3'), sightings: 2, bestPosition: 1 }],
  hotKeywords: [{ key: 'kw_0', label: 'k0', runningAds: 20, delta: { change: 5, baselineDay: '2026-10-14', partial: false } }],
  risingShops: [],
  news: [{ id: 'news_1', title: 'Holiday shopping starts early', link: 'https://example.test/1', publishedAt: null, feed: 'example.test', summary: 'Retail note' }],
  holidays: [{ date: '2026-10-31', name: 'Halloween', days: 10 }],
};
const refs = promptRefs(input);
const sug = (ads: string[], news: string[] = []) => ({ kind: 'idea', text: 'Áo Halloween giáo viên', reason: 'Nhiều quảng cáo đang chạy', evidence: { ads, news } });
const reply = (suggestions: unknown[], summary = 'Tóm tắt.') => JSON.stringify({ summary, suggestions });

describe('briefing prompt', () => {
  it('is Vietnamese, carries the ids of the ads and news sent, and names the keyword of a keyword briefing', () => {
    const p = briefingPrompt(input);
    expect(p.system).toContain('Chỉ trả về đúng một đối tượng JSON');
    expect(p.user).toContain('"id":"a1"');
    expect(p.user).toContain('"id":"news_1"');
    expect(briefingPrompt({ ...input, keyword: 'teacher shirt' }).user).toContain('từ khóa "teacher shirt"');
    expect(briefingPrompt(input, 'bad refs').user).toContain('Lần trả lời trước không hợp lệ (bad refs)');
    expect([...refs.ads]).toEqual(['a1', 'a2', 'a3']);
    expect([...refs.news]).toEqual(['news_1']);
  });
});

describe('briefing output', () => {
  it('accepts 5–10 suggestions whose refs were in the input, in or out of a Markdown fence', () => {
    const five = Array.from({ length: 5 }, () => sug(['a1'], ['news_1']));
    expect(parseBriefingOutput(reply(five), refs)).toMatchObject({ ok: true, badRefs: [] });
    expect(parseBriefingOutput('```json\n' + reply(five) + '\n```', refs)).toMatchObject({ ok: true });
  });

  it('rejects bad JSON, fewer than 5 or more than 10 suggestions, an empty evidence list and an unknown kind', () => {
    expect(parseBriefingOutput('not json', refs)).toMatchObject({ ok: false });
    expect(parseBriefingOutput('{"summary": "x", ', refs)).toMatchObject({ ok: false });
    expect(parseBriefingOutput(reply(Array.from({ length: 4 }, () => sug(['a1']))), refs)).toMatchObject({ ok: false });
    expect(parseBriefingOutput(reply(Array.from({ length: 11 }, () => sug(['a1']))), refs)).toMatchObject({ ok: false });
    expect(parseBriefingOutput(reply(Array.from({ length: 5 }, () => sug([])), 'x'), refs)).toMatchObject({ ok: false });
    expect(parseBriefingOutput(reply(Array.from({ length: 5 }, () => ({ ...sug(['a1']), kind: 'shop' }))), refs)).toMatchObject({ ok: false });
  });

  it('flags suggestions citing ids that were not sent, and drops only those', () => {
    const list = [sug(['a1']), sug(['zz']), sug(['a2'], ['news_9']), sug(['a3']), sug([], ['news_1'])];
    const p = parseBriefingOutput(reply(list), refs);
    if (!p.ok) throw new Error(p.problem);
    expect(p.badRefs).toEqual([1, 2]);
    expect(keepResolved(p).map((s) => s.evidence)).toEqual([list[0]!.evidence, list[3]!.evidence, list[4]!.evidence]);
  });
});

describe('cost estimate', () => {
  const prompt = { system: 'x'.repeat(3000), user: 'y'.repeat(27_000) };
  it('prices the prompt at 3 characters a token plus the full max_tokens, rounded up to 4 decimals', () => {
    // 10k input tokens × $2 + 4000 output tokens × $10, per million (Sonnet 5.5 list price, checked 2026-10-21).
    expect(estimateCallUsd('claude-sonnet-5-5', prompt)).toBe(0.06);
    // 10k × $1 + 4000 × $5 (Haiku 4.5).
    expect(estimateCallUsd('claude-haiku-4-5', prompt)).toBe(0.03);
    // 10k × $0.10 + 4000 × $0.50 (gpt-6-luna, OpenAI Standard tier, checked 2026-10-22), and gpt-6.1-sol.
    expect(estimateCallUsd('gpt-6-luna', prompt)).toBe(0.003);
    expect(estimateCallUsd('gpt-6.1-sol', prompt)).toBe(0.06);
    expect(estimateCallUsd('claude-sonnet-5-5', { system: 'a', user: '' }, 1)).toBe(0.0001);
    expect(estimateCallUsd('some-new-model', prompt)).toBe((10_000 * UNKNOWN_MODEL_PRICE.input + BRIEFING_MAX_TOKENS * UNKNOWN_MODEL_PRICE.output) / 1e6);
  });

  it('allows a call that reaches the cap exactly and refuses one over it', () => {
    expect(fitsDailyCap(2.91, 0.09, 3)).toBe(true);
    expect(fitsDailyCap(2.9101, 0.09, 3)).toBe(false);
    expect(fitsDailyCap(0, 0.09, 0)).toBe(false);
  });
});
