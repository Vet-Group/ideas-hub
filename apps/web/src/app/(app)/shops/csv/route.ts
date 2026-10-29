// GET /shops/csv?q=&sort= : the shops list with its search and sort as CSV, up to CSV_ROW_CAP shops from page 1
// (AC-A4). 404 signed out; the page needs no more than a session.
import { csvDocument } from '@ideas-hub/core';
import { type NextRequest } from 'next/server';
import { CSV_ROW_CAP, csvResponse } from '@/lib/csv-response';
import { currentUser } from '@/lib/session';
import { loadShops, parseShopParams } from '@/lib/shop-list';

const HEADER = ['domain', 'running_ads', 'new_ads', 'proven', 'keywords', 'first_seen_date', 'last_seen_date'];

export async function GET(request: NextRequest) {
  if (!(await currentUser())) return new Response(null, { status: 404 });
  const { shops, reads } = await loadShops({ ...parseShopParams(Object.fromEntries(request.nextUrl.searchParams)), page: 1 }, CSV_ROW_CAP);
  const lines = shops.map((s) => {
    const r = reads.get(s.landingDomain);
    return [s.landingDomain, String(s.runningAds), String(r?.newAds ?? ''), String(r?.proven ?? ''), String(r?.keywords ?? ''), s.firstSeenDate, s.lastSeenDate];
  });
  return csvResponse('shops', csvDocument([HEADER, ...lines]));
}
