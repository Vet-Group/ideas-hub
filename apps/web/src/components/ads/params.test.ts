import { describe, expect, it } from 'vitest';
import { adQuery, parseAdFilters } from './params';

describe('ads query params', () => {
  it('keeps the filters, the dedupe toggle and the page in the query, without defaults', () => {
    const f = parseAdFilters({ kw: 'kw_1', country: 'gb', dedupe: '1', sort: 'days', page: '3' });
    expect(f).toMatchObject({ keywordId: 'kw_1', country: 'GB', dedupe: true, sort: 'days', page: 3 });
    expect(adQuery(f)).toBe('?kw=kw_1&country=GB&dedupe=1&sort=days&page=3');
    expect(adQuery({ ...f, page: 4 })).toBe('?kw=kw_1&country=GB&dedupe=1&sort=days&page=4');
    expect(parseAdFilters({ sort: 'trending' }).sort).toBe('trending');
    expect(adQuery(parseAdFilters({}))).toBe('');
  });

  it('reads a missing, zero or invalid page as the first', () => {
    for (const page of [undefined, '0', '-2', 'x']) expect(parseAdFilters({ page }).page).toBe(1);
  });
});
