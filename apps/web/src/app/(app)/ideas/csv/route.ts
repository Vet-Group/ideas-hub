// GET /ideas/csv?store=&status=&tag=&keyword=&assignee=&q= : the ideas list with its filters as CSV
// (spec §4 "Save-idea flow" 7). 404 without `view` on the store, like a missing page.
import { IDEA_STATUSES } from '@ideas-hub/db';
import { type IdeaStatus, ideasCsv, listIdeas } from '@ideas-hub/db/queries';
import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { now } from '@/lib/now';
import { currentUser } from '@/lib/session';

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const opt = (name: string) => p.get(name)?.trim() || undefined;
  const storeId = p.get('store') ?? '';
  const status = opt('status');
  const user = await currentUser();
  const rows =
    user &&
    (await listIdeas(db, user, storeId, {
      status: IDEA_STATUSES.includes(status as IdeaStatus) ? (status as IdeaStatus) : undefined,
      tag: opt('tag'),
      keyword: opt('keyword'),
      assigneeId: opt('assignee'),
      q: opt('q'),
    }));
  if (!rows) return new Response(null, { status: 404 });
  const day = now().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  return new Response(ideasCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ideas-${storeId.replace(/[^A-Za-z0-9_-]/g, '')}-${day}.csv"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
