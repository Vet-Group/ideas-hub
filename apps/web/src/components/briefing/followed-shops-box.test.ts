import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type CurrentUser } from '@/lib/session';

const q = vi.hoisted(() => ({ followedShops: vi.fn(), followedShopAds: vi.fn() }));
const deps = vi.hoisted(() => ({ userStores: undefined as undefined | (() => Promise<unknown>), statusOptions: undefined as undefined | (() => Promise<unknown>) }));
const selected = vi.hoisted(() => ({ id: 'store_A' as string | null }));
vi.mock('server-only', () => ({}));
vi.mock('@ideas-hub/db/queries', () => q);
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/session', () => ({}));
const options = { today: '2026-10-20', staleAfterDays: 3, countries: [] };
const ownStores = async () => ({ stores: [{ id: 'store_A', name: 'Store A' }], selectedId: selected.id });
vi.mock('@/lib/settings', () => ({ statusOptions: () => (deps.statusOptions ?? (async () => options))() }));
vi.mock('@/lib/store', () => ({ userStores: () => (deps.userStores ?? ownStores)() }));

const { FollowedShopsBox } = await import('./followed-shops-box');

const user = { userId: 'u', role: 'member', name: 'u', email: 'u@t.local', memberships: [{ storeId: 'store_A', view: true, save: true, keywords: false }] } as unknown as CurrentUser;
const ad = (id: string) => ({ adArchiveId: id, caption: `Caption ${id}`, pageName: 'Page', landingDomain: 'dogmom.example' });
const render = async () => {
  const el = await FollowedShopsBox({ user });
  return el ? renderToStaticMarkup(el) : '';
};

describe('FollowedShopsBox', () => {
  beforeEach(() => {
    selected.id = 'store_A';
    deps.userStores = undefined;
    deps.statusOptions = undefined;
    q.followedShops.mockResolvedValue(['dogmom.example']);
    q.followedShopAds.mockResolvedValue({ items: [ad('e2e_mug_1'), ad('e2e mug/2')], total: 2 });
  });

  it('renders nothing when a query rejects, so the briefing never breaks', async () => {
    q.followedShops.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await render()).toBe('');
    q.followedShops.mockResolvedValue(['dogmom.example']);
    q.followedShopAds.mockRejectedValue(new Error('db down'));
    expect(await render()).toBe('');
  });

  it('renders nothing when the store or settings read rejects, without starting the shop reads', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    q.followedShops.mockClear();
    deps.userStores = async () => Promise.reject(new Error('cookies'));
    expect(await render()).toBe('');
    deps.userStores = undefined;
    deps.statusOptions = async () => Promise.reject(new Error('db down'));
    expect(await render()).toBe('');
    expect(q.followedShops).not.toHaveBeenCalled();
  });

  it('renders nothing when the store follows no shop (or the viewer lacks view) or no store is selected', async () => {
    q.followedShops.mockResolvedValue([]);
    q.followedShopAds.mockResolvedValue({ items: [], total: 0 });
    expect(await render()).toBe('');
    selected.id = null;
    expect(await render()).toBe('');
  });

  it('links ads to /ads/[id], never the briefing sheet, so a save there is not via briefing', async () => {
    const html = await render();
    expect(html).toContain('Shop Store A đang theo dõi');
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/shops/dogmom.example', '/ads/e2e_mug_1', '/ads/e2e%20mug%2F2', '/shops?followed=1']);
    expect(html).not.toContain('?ad=');
    expect(q.followedShopAds).toHaveBeenCalledWith({}, expect.objectContaining({ today: '2026-10-20' }), user, 'store_A', undefined, 5);
  });

  it('shows at most 10 followed shop links', async () => {
    q.followedShops.mockResolvedValue(Array.from({ length: 12 }, (_, i) => `shop${i}.example`));
    const hrefs = [...(await render()).matchAll(/href="\/shops\/([^"]*)"/g)];
    expect(hrefs).toHaveLength(10);
  });

  it('says so when the followed shops have no new ads', async () => {
    q.followedShopAds.mockResolvedValue({ items: [], total: 0 });
    expect(await render()).toContain('Các shop này chưa có ads mới trong 7 ngày.');
  });
});
