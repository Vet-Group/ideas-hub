// The admin settings form: one field per Setting (spec §2 "Setting"), shaped by its default value, so a
// new key in DEFAULT_SETTINGS gets a field without UI code. Pure, so it is unit-tested.
import { DEFAULT_SETTINGS, type SettingKey, type Settings, type SettingsProblem, validateSettings } from '@ideas-hub/core';

export type FieldKind = 'number' | 'text' | 'nullable' | 'text-list' | 'number-list' | 'object';

export interface Field {
  key: SettingKey;
  kind: FieldKind;
  /** Sub-keys of an object setting (`searchGapSeconds.min`, …). */
  parts?: string[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_KEYS = new Set<string>(['morningHardStop', 'briefingBuildTime', 'briefingReadyTime']);
const REQUIRED_KEYS = new Set<string>(['llmModel']);
/** Settings that count things (searches, pages, attempts, blocks): positive integers. */
const COUNT_KEYS = new Set<string>([
  'searchBudget',
  'maxKeywords',
  'adsPerSearchCap',
  'noNewAdsPagesToStop',
  'attemptsPerSearch',
  'blockEmptyPayloadsInRow',
  'backoff.stopBlockStreak',
  'backoff.stopBlockedSearches',
  'networkCooldown.streak',
]);

function kindOf(v: unknown): FieldKind {
  if (v === null) return 'nullable';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'text';
  if (Array.isArray(v)) return typeof v[0] === 'number' ? 'number-list' : 'text-list';
  return 'object';
}

export const FIELDS: Field[] = (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).map((key) => {
  const v = DEFAULT_SETTINGS[key] as unknown;
  const kind = kindOf(v);
  return kind === 'object' ? { key, kind, parts: Object.keys(v as object) } : { key, kind };
});

/** The text a field shows for a value. */
export function fieldValue(v: unknown, part?: string): string {
  if (part) return String((v as Record<string, unknown>)[part] ?? '');
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

export type FieldError = { key: string; code: 'number' | 'time' | 'list' | 'required' | 'count' | 'range' };

/** Reads the submitted form into Settings; returns field errors, then the cross-field problems. */
export function parseSettingsForm(
  get: (name: string) => string | null,
): { settings: Settings; fieldErrors: FieldError[]; problems: SettingsProblem[] } {
  const out: Record<string, unknown> = {};
  const fieldErrors: FieldError[] = [];
  const num = (name: string) => {
    const raw = (get(name) ?? '').trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n) || n < 0) fieldErrors.push({ key: name, code: 'number' });
    else if (COUNT_KEYS.has(name) && (!Number.isInteger(n) || n < 1)) fieldErrors.push({ key: name, code: 'count' });
    return n;
  };
  for (const f of FIELDS) {
    const raw = (get(f.key) ?? '').trim();
    switch (f.kind) {
      case 'number':
        out[f.key] = num(f.key);
        break;
      case 'text':
        if (TIME_KEYS.has(f.key) && !HHMM.test(raw)) fieldErrors.push({ key: f.key, code: 'time' });
        if (REQUIRED_KEYS.has(f.key) && raw === '') fieldErrors.push({ key: f.key, code: 'required' });
        out[f.key] = raw;
        break;
      case 'nullable':
        out[f.key] = raw === '' ? null : raw;
        break;
      case 'text-list': {
        const items = raw.split(',').map((x) => x.trim()).filter(Boolean);
        const upper = f.key === 'countries' ? items.map((x) => x.toUpperCase()) : items;
        if (f.key === 'runTimes' && upper.some((x) => !HHMM.test(x))) fieldErrors.push({ key: f.key, code: 'time' });
        if (f.key === 'countries' && (upper.length === 0 || upper.some((x) => !/^[A-Z]{2}$/.test(x)))) fieldErrors.push({ key: f.key, code: 'list' });
        out[f.key] = [...new Set(upper)];
        break;
      }
      case 'number-list': {
        const items = raw.split(',').map((x) => x.trim()).filter(Boolean).map(Number);
        if (items.length === 0 || items.some((n) => !Number.isFinite(n) || n < 0)) fieldErrors.push({ key: f.key, code: 'list' });
        out[f.key] = items;
        break;
      }
      case 'object': {
        const o = Object.fromEntries(f.parts!.map((p) => [p, num(`${f.key}.${p}`)]));
        if ('min' in o && 'max' in o && o.min! > o.max!) fieldErrors.push({ key: `${f.key}.max`, code: 'range' });
        out[f.key] = o;
        break;
      }
    }
  }
  const settings = out as unknown as Settings;
  return { settings, fieldErrors, problems: fieldErrors.length ? [] : validateSettings(settings) };
}
