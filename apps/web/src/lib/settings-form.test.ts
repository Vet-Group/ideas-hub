import { DEFAULT_SETTINGS } from '@ideas-hub/core';
import { describe, expect, it } from 'vitest';
import { FIELDS, fieldValue, parseSettingsForm } from './settings-form';

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

  it('returns the cross-field problems of validateSettings', () => {
    expect(parseSettingsForm(form({ runTimes: '01:00, 03:00' })).problems).toContain('slots_too_close');
  });
});
