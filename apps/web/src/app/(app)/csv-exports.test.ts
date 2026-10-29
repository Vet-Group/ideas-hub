// The CSV routes of /ads, /shops and /keywords (AC-A4): 404 signed out, the page's filters, the row cap and
// formula cells escaped. The queries are stubbed; their SQL is covered in packages/db.
import { type MarketRead } from '@ideas-hub/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/session', () => ({ currentUser: vi.fn() }));
vi.mock('@/lib/settings', () => ({
  loadSettings: async () => ({ nonShopDomains: ['facebook.com'] }),
  statusOptions: async () => ({ today: '2026-10-21', staleAfterDays: 3, countries: ['US'] }),
}));
const q = vi.hoisted(() => ({ listAds: vi.fn(), listShops: vi.fn(), shopReads: vi.fn(), listKeywords: vi.fn(), marketReads: vi.fn() }));
vi.mock('@ideas-hub/db/queries', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ...q }));

const { currentUser } = await import('@/lib/session');
const ads = await import('./ads/csv/route');
const shops = await import('./shops/csv/route');
const keywords = await import('./keywords/csv/route');

const get = (route: { GET: (r: never) => Promise<Response> }, path: string) => {
  const request = new Request(`http://localhost:3300${path}`) as Request & { nextUrl: URL };
  request.nextUrl = new URL(request.url);
  return route.GET(request as never);
};
// Response.text() drops the BOM; keep it.
const lines = async (res: Response) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer()).split('\r\n');
const read = (r: Partial<MarketRead>): MarketRead => ({ ads: 10, shops: 3, top3Share: 0.456, newAds: 0, newAdsBefore: 0, proven: 0, video: 0, ...r });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentUser).mockResolvedValue({ userId: 'u', name: 'U', email: 'u@x', role: 'member', memberships: [] });
  q.listAds.mockResolvedValue({ items: [], total: 0 });
  q.listShops.mockResolvedValue({ items: [], total: 0 });
  q.shopReads.mockResolvedValue(new Map());
  q.listKeywords.mockResolvedValue([]);
  q.marketReads.mockResolvedValue(new Map());
});

describe.each([
  ['/ads/csv', ads],
  ['/shops/csv', shops],
  ['/keywords/csv', keywords],
])('GET %s', (path, route) => {
  it('answers a bare 404 signed out, before any query', async () => {
    vi.mocked(currentUser).mockResolvedValue(null);
    const res = await get(route, path);
    expect([res.status, await res.text()]).toEqual([404, '']);
    for (const fn of Object.values(q)) expect(fn).not.toHaveBeenCalled();
  });

  it('downloads a CSV with a BOM, the header row, nosniff and no cache', async () => {
    const res = await get(route, path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="${path.split('/')[1]}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const [header, ...rest] = await lines(res);
    expect(header!.startsWith('\uFEFF')).toBe(true);
    expect(rest).toEqual(['']);
  });
});

describe('/ads/csv', () => {
  it('lists with the grid filters from page 1 up to 5,000 ads', async () => {
    await get(ads, '/ads/csv?status=all&kw=kw_1&country=gb&proven=1&sort=days&page=4');
    expect(q.listAds).toHaveBeenCalledWith({}, { today: '2026-10-21', staleAfterDays: 3, countries: ['US'] }, expect.objectContaining({ status: 'all', keywordId: 'kw_1', country: 'GB', proven: true, sort: 'days', page: 1, limit: 5000 }));
  });

  it('writes one row per ad and escapes formula cells', async () => {
    q.listAds.mockResolvedValue({
      total: 1,
      items: [
        {
          adArchiveId: '111', pageName: '=HYPERLINK("http://evil")', caption: 'a, b', title: null, link: null, landingDomain: 'mug.example', mediaType: 'video', thumbnailKey: null,
          startDate: '2026-10-01', endDate: null, firstSeenDate: '2026-10-02', lastSeenDate: '2026-10-20', seenDays: 5, daysActive: 20, trendScore: 3.5, variants: 7, proven: true, status: 'running',
          keywords: [{ id: 'k', text: 'dog mom' }, { id: 'j', text: '+mug' }], countries: ['GB', 'US'], duplicates: 1, momentum: 0,
        },
      ],
    });
    const rows = await lines(await get(ads, '/ads/csv'));
    expect(rows[1]).toBe(`111,"'=HYPERLINK(""http://evil"")","a, b",,mug.example,,video,running,2026-10-01,2026-10-02,2026-10-20,20,3.5,7,1,dog mom; +mug,GB; US`);
  });
});

describe('/shops/csv', () => {
  it('lists the search and sort from page 1 up to 5,000 shops', async () => {
    await get(shops, '/shops/csv?q=mug&sort=domain&page=9');
    expect(q.listShops).toHaveBeenCalledWith({}, { sort: 'domain', q: 'mug', page: 1, limit: 5000, nonShopDomains: ['facebook.com'] });
  });

  it('joins each shop with its market read', async () => {
    q.listShops.mockResolvedValue({
      total: 2,
      items: [
        { landingDomain: 'mug.example', pageCount: 1, firstSeenDate: '2026-09-01', lastSeenDate: '2026-10-20', runningAds: 12 },
        { landingDomain: '=cmd.example', pageCount: 1, firstSeenDate: '2026-09-02', lastSeenDate: '2026-10-19', runningAds: 3 },
      ],
    });
    q.shopReads.mockResolvedValue(new Map([['mug.example', { ads: 12, newAds: 4, proven: 2, keywords: 5 }]]));
    expect(await lines(await get(shops, '/shops/csv'))).toEqual([
      '\uFEFFdomain,running_ads,new_ads,proven,keywords,first_seen_date,last_seen_date',
      'mug.example,12,4,2,5,2026-09-01,2026-10-20',
      "'=cmd.example,3,,,,2026-09-02,2026-10-19",
      '',
    ]);
  });
});

describe('/keywords/csv', () => {
  const rows = [
    { id: 'a', text: 'dog mom', origin: 'seed', active: true, runningAds: 50, trackedBy: [] },
    { id: 'b', text: 'cat dad', origin: 'store', active: false, runningAds: 40, trackedBy: [] },
  ];

  it('applies the stage filter and the market sort of the page', async () => {
    q.listKeywords.mockResolvedValue(rows);
    q.marketReads.mockResolvedValue(new Map([['a', read({ newAds: 0, proven: 0 })], ['b', read({ newAds: 4 })]]));
    const body = await lines(await get(keywords, '/keywords/csv?stage=rising&sort=new_ads'));
    expect(body).toEqual([
      '\uFEFFkeyword,origin,active,stage,running_ads,ads,new_ads,proven,shops,top3_share_pct',
      'cat dad,store,0,rising,40,10,4,0,3,46',
      '',
    ]);
    expect(q.listKeywords).toHaveBeenCalledWith({}, 'running_ads');
  });

  it('leaves the market columns empty for a keyword without running ads', async () => {
    q.listKeywords.mockResolvedValue([{ ...rows[0], text: '-neg', runningAds: null }]);
    expect((await lines(await get(keywords, '/keywords/csv')))[1]).toBe("'-neg,seed,1,,,,,,,");
  });
});
