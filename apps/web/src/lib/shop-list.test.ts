import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({ db: {} }));
const { parseShopParams } = await import('./shop-list');

describe('parseShopParams', () => {
  it('defaults to the most running ads on page 1 and trims the search', () => {
    expect(parseShopParams({})).toEqual({ sort: 'running_ads', q: undefined, page: 1 });
    expect(parseShopParams({ sort: 'domain', q: '  mug ', page: '3' })).toEqual({ sort: 'domain', q: 'mug', page: 3 });
  });

  it('ignores an unknown sort, a blank search and a page that is not a positive number', () => {
    expect(parseShopParams({ sort: 'nope' }).sort).toBe('running_ads');
    expect(parseShopParams({ q: '  ' }).q).toBeUndefined();
    for (const page of ['0', '-2', 'x', '1.5']) expect(parseShopParams({ page }).page).toBe(1);
  });
});
