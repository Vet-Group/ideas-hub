// GET /api/health (phase 2 plan Step 2a): the deploy's health check and the tunnel's probe. 200 after a
// `select 1`, 503 otherwise; no data in the body. proxy.ts lets it through without a session.
import { type Db } from '@ideas-hub/db/client';
import { sql } from 'drizzle-orm';

const noStore = { 'cache-control': 'no-store' };

export async function handleHealth(db: Pick<Db, 'execute'>): Promise<Response> {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: noStore });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: noStore });
  }
}
