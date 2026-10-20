import { DEFAULT_SETTINGS } from '@ideas-hub/core';
import { describe, expect, it } from 'vitest';
import { FIELDS, fieldValue, parseSettingsForm } from './settings-form';
import { t } from './strings.vi';

/** The form as the page renders it from the defaults, with some fields overridden. */
function form(over: Record<string, string> = {}) {
  const values: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = DEFAULT_SETTINGS[f.key] as unknown;
    if (f.parts) for (const p of f.parts) values[`${f.key}.${p}`] = fieldValue(v, p);
    else values[f.key] = fieldValue(v);
  }
  Object.assign(values, over);
  return (name: string) => values[name] ?? null;
}

describe('settings form', () => {
  it('has a field for every setting', () => {
    expect(FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('round-trips the defaults without a problem', () => {
    const r = parseSettingsForm(form());
    expect(r.fieldErrors).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('reads lists, nulls and nested numbers', () => {
    const r = parseSettingsForm(form({ countries: 'us, gb', 'searchGapSeconds.min': '30', proxy: 'http://127.0.0.1:9999', llmModel: 'm' }));
    expect(r.settings.countries).toEqual(['US', 'GB']);
    expect(r.settings.searchGapSeconds).toEqual({ min: 30, max: 60 });
    expect(r.settings.proxy).toBe('http://127.0.0.1:9999');
    expect(r.settings.browserProfile).toBeNull();
  });

  it('rejects bad numbers, times and countries before the cross-field checks', () => {
    const r = parseSettingsForm(form({ searchBudget: 'abc', runTimes: '1:00, 13:00', countries: 'USA' }));
    expect(r.fieldErrors.map((e) => e.key).sort()).toEqual(['countries', 'runTimes', 'searchBudget']);
    expect(r.problems).toEqual([]);
  });

  it('lowercases the non-shop domains, accepts an empty list and rejects what is not a domain pattern', () => {
    expect(parseSettingsForm(form({ nonShopDomains: 'Play.Google.com, AMAZON.*' })).settings.nonShopDomains).toEqual(['play.google.com', 'amazon.*']);
    expect(parseSettingsForm(form({ nonShopDomains: '' })).fieldErrors).toEqual([]);
    expect(parseSettingsForm(form({ nonShopDomains: 'https://temu.com/x' })).fieldErrors).toEqual([{ key: 'nonShopDomains', code: 'list' }]);
  });

  it('requires an LLM model', () => {
    expect(parseSettingsForm(form({ llmModel: '  ' })).fieldErrors).toEqual([{ key: 'llmModel', code: 'required' }]);
  });

  it('requires positive integers for counts, top-level and nested', () => {
    const r = parseSettingsForm(form({ searchBudget: '0', attemptsPerSearch: '2.5', 'backoff.stopBlockStreak': '0', 'networkCooldown.streak': '1.5', maxKeywords: '1' }));
    expect(r.fieldErrors).toEqual([
      { key: 'searchBudget', code: 'count' },
      { key: 'backoff.stopBlockStreak', code: 'count' },
      { key: 'attemptsPerSearch', code: 'count' },
      { key: 'networkCooldown.streak', code: 'count' },
    ]);
    // Durations stay non-negative numbers, fractions allowed.
    expect(parseSettingsForm(form({ cooldownHours: '0.5', 'backoff.jitter': '0' })).fieldErrors).toEqual([]);
  });

  it('requires min <= max for every range', () => {
    const r = parseSettingsForm(form({ 'searchGapSeconds.min': '61', 'pageDelayMs.max': '399', 'scrollDelayMs.min': '1700' }));
    expect(r.fieldErrors).toEqual([
      { key: 'searchGapSeconds.max', code: 'range' },
      { key: 'pageDelayMs.max', code: 'range' },
    ]);
  });

  it('returns the cross-field problems of validateSettings', () => {
    expect(parseSettingsForm(form({ runTimes: '01:00, 03:00' })).problems).toContain('slots_too_close');
    expect(parseSettingsForm(form({ llmCallTimeoutSeconds: '443' })).problems).toEqual(['feed_refresh_over_job_expiry']);
    expect(parseSettingsForm(form({ briefingReadyTime: '06:40' })).problems).toEqual(['ready_before_build_ends']);
  });

  it('has its own Vietnamese message for each new problem', () => {
    const p = t.admin.settings.problems;
    expect(p.feed_refresh_over_job_expiry).toMatch(/RSS/);
    expect(p.ready_before_build_ends).toMatch(/sẵn sàng/);
    expect(p.feed_refresh_over_job_expiry).not.toBe(p.llm_timeout_over_job_expiry);
  });
});
