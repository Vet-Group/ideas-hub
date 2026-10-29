// GET /keywords/csv?sort=&stage= : the keywords list with its sort and stage filter as CSV (AC-A4).
// 404 signed out; the page needs no more than a session.
import { csvDocument } from '@ideas-hub/core';
import { type NextRequest } from 'next/server';
import { CSV_ROW_CAP, csvResponse } from '@/lib/csv-response';
import { loadKeywordMarket, parseKeywordParams } from '@/lib/keyword-list';
import { currentUser } from '@/lib/session';

const HEADER = ['keyword', 'origin', 'active', 'stage', 'running_ads', 'ads', 'new_ads', 'proven', 'shops', 'top3_share_pct'];

export async function GET(request: NextRequest) {
  if (!(await currentUser())) return new Response(null, { status: 404 });
  const { sort, stage } = parseKeywordParams(Object.fromEntries(request.nextUrl.searchParams));
  const { rows, reads, stageOf } = await loadKeywordMarket(sort, stage);
  const lines = rows.slice(0, CSV_ROW_CAP).map((k) => {
    const r = reads.get(k.id);
    return [k.text, k.origin, k.active ? '1' : '0', stageOf(k) ?? '', String(k.runningAds ?? ''), String(r?.ads ?? ''), String(r?.newAds ?? ''), String(r?.proven ?? ''), String(r?.shops ?? ''), r && r.top3Share !== null ? String(Math.round(r.top3Share * 100)) : ''];
  });
  return csvResponse('keywords', csvDocument([HEADER, ...lines]));
}
