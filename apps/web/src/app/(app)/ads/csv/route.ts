// GET /ads/csv?<the /ads filters> : the ads grid's filters and sort as CSV, up to CSV_ROW_CAP ads from page 1
// (AC-A4). 404 signed out; the page needs no more than a session.
import { csvDocument } from '@ideas-hub/core';
import { listAds } from '@ideas-hub/db/queries';
import { type NextRequest } from 'next/server';
import { parseAdFilters } from '@/components/ads/params';
import { CSV_ROW_CAP, csvResponse } from '@/lib/csv-response';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { statusOptions } from '@/lib/settings';

const HEADER = ['ad_archive_id', 'page_name', 'caption', 'title', 'landing_domain', 'link', 'media_type', 'status', 'start_date', 'first_seen_date', 'last_seen_date', 'days_active', 'trend_score', 'variants', 'proven', 'keywords', 'countries'];

export async function GET(request: NextRequest) {
  if (!(await currentUser())) return new Response(null, { status: 404 });
  const f = { ...parseAdFilters(Object.fromEntries(request.nextUrl.searchParams)), page: 1, limit: CSV_ROW_CAP };
  const { items } = await listAds(db, await statusOptions(), f);
  const lines = items.map((a) => [
    a.adArchiveId,
    a.pageName ?? '',
    a.caption ?? '',
    a.title ?? '',
    a.landingDomain ?? '',
    a.link ?? '',
    a.mediaType ?? '',
    a.status,
    a.startDate ?? '',
    a.firstSeenDate,
    a.lastSeenDate,
    String(a.daysActive ?? ''),
    String(a.trendScore ?? ''),
    String(a.variants ?? ''),
    a.proven ? '1' : '0',
    a.keywords.map((k) => k.text).join('; '),
    a.countries.join('; '),
  ]);
  return csvResponse('ads', csvDocument([HEADER, ...lines]));
}
