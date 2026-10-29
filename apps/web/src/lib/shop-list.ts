import 'server-only';
import { SHOP_SORTS, type ShopSort, listShops, shopReads } from '@ideas-hub/db/queries';
import { db } from './db';
import { loadSettings, statusOptions } from './settings';

export interface ShopParams {
  sort: ShopSort;
  q: string | undefined;
  page: number;
}

/** The `/shops` query string; the page and its CSV export read it the same way. */
export function parseShopParams(p: { sort?: string; q?: string; page?: string }): ShopParams {
  return {
    sort: SHOP_SORTS.includes(p.sort as ShopSort) ? (p.sort as ShopSort) : 'running_ads',
    q: p.q?.trim() || undefined,
    page: p.page && /^\d+$/.test(p.page) ? Math.max(1, Number(p.page)) : 1,
  };
}

/** One page of shops with the market read of those shops only (one query; spec §6 "Market read"). */
export async function loadShops(params: ShopParams, limit?: number) {
  const settings = await loadSettings();
  const { items: shops, total } = await listShops(db, { ...params, limit, nonShopDomains: settings.nonShopDomains });
  const reads = await shopReads(db, await statusOptions(settings), shops.map((s) => s.landingDomain));
  return { shops, total, reads };
}
