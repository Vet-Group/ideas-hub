import { describe, expect, it } from 'vitest';
import { adQuery, parseAdFilters } from './params';

describe('ads query params', () => {
  it('keeps the filters, the dedupe toggle and the page in the query, without defaults', () => {
    const f = parseAdFilters({ kw: 'kw_1', country: 'gb', dedupe: '1', sort: 'days', page: '3' });
    expect(f).toMatchObject({ keywordId: 'kw_1', country: 'GB', dedupe: true, sort: 'days', page: 3 });
    expect(adQuery(f)).toBe('?kw=kw_1&country=GB&dedupe=1&sort=days&page=3');
    expect(adQuery({ ...f, page: 4 })).toBe('?kw=kw_1&country=GB&dedupe=1&sort=days&page=4');
    expect(parseAdFilters({ sort: 'trending' }).sort).toBe('trending');
    expect(parseAdFilters({ sort: 'started' }).sort).toBe('started');
    expect(parseAdFilters({ proven: '1' }).proven).toBe(true);
    expect(adQuery(parseAdFilters({ proven: '1', sort: 'started' }))).toBe('?proven=1&sort=started');
    expect(adQuery(parseAdFilters({ kw: 'kw_1', title: ' sea glass ' }))).toBe('?kw=kw_1&title=sea+glass');
    expect(adQuery(parseAdFilters({}))).toBe('');
  });

  it('keeps the platform and the format in the query, and drops values that are not offered', () => {
    const f = parseAdFilters({ platform: 'instagram', format: 'video' });
    expect(f).toMatchObject({ platform: 'INSTAGRAM', format: 'VIDEO' });
    expect(adQuery(f)).toBe('?platform=INSTAGRAM&format=VIDEO');
    const bad = parseAdFilters({ platform: "x' or 1=1", format: 'GIF' });
    expect(bad.platform).toBeUndefined();
    expect(bad.format).toBeUndefined();
    expect(adQuery(bad)).toBe('');
  });

  it('sorts by trending by default; an explicit sort=score still works and stays in the query', () => {
    expect(parseAdFilters({}).sort).toBe('trending');
    expect(parseAdFilters({ sort: 'nope' }).sort).toBe('trending');
    expect(parseAdFilters({ sort: 'score' }).sort).toBe('score');
    expect(adQuery(parseAdFilters({ sort: 'score' }))).toBe('?sort=score');
    expect(adQuery(parseAdFilters({ sort: 'trending' }))).toBe('');
  });

  it('reads a missing, zero or invalid page as the first', () => {
    for (const page of [undefined, '0', '-2', 'x']) expect(parseAdFilters({ page }).page).toBe(1);
  });
});
