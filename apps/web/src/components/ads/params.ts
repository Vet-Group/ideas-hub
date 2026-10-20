// The ads grid's filters and sort live in the URL query, so a pasted link shows the same view (spec §6).
import { type AdStatus } from '@ideas-hub/core';
import { AD_SORTS, type AdFilters, type AdSort } from '@ideas-hub/db/queries';

export type SearchParams = Record<string, string | string[] | undefined>;

const STATUSES = ['running', 'out_of_top', 'stopped_or_unknown', 'all'] as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

export function parseAdFilters(p: SearchParams): AdFilters {
  const status = one(p.status);
  const sort = one(p.sort);
  return {
    status: STATUSES.includes(status as never) ? (status as AdStatus | 'all') : 'running',
    keywordId: one(p.kw),
    country: one(p.country)?.toUpperCase(),
    minDays: num(one(p.days)),
    minScore: num(one(p.score)),
    domain: one(p.domain),
    sort: AD_SORTS.includes(sort as AdSort) ? (sort as AdSort) : 'score',
  };
}

/** The query string of a filter set, without defaults, for links that keep the view. */
export function adQuery(f: AdFilters): string {
  const q = new URLSearchParams();
  if (f.status && f.status !== 'running') q.set('status', f.status);
  if (f.keywordId) q.set('kw', f.keywordId);
  if (f.country) q.set('country', f.country);
  if (f.minDays !== undefined) q.set('days', String(f.minDays));
  if (f.minScore !== undefined) q.set('score', String(f.minScore));
  if (f.domain) q.set('domain', f.domain);
  if (f.sort && f.sort !== 'score') q.set('sort', f.sort);
  const s = q.toString();
  return s ? `?${s}` : '';
}
