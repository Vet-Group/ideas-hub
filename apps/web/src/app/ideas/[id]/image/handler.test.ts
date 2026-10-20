import { type Viewer } from '@ideas-hub/core';
import { type Db, createDb, createPool } from '@ideas-hub/db/client';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObjectStore } from '@/lib/object-store';
import { handleIdeaImage } from './handler';

const objects = new Map([
  ['ideas/store_A/a.webp', Buffer.from('RIFF\0\0\0\0WEBPa')],
  ['ideas/store_B/b.webp', Buffer.from('RIFF\0\0\0\0WEBPb')],
]);
const store: Pick<ObjectStore, 'getObject'> = {
  async getObject(key) {
    const body = objects.get(key);
    return body ? { body: new Blob([new Uint8Array(body)]).stream(), contentType: 'image/webp', contentLength: body.length } : null;
  },
};
const memberA: Viewer = { userId: 'user_a', role: 'member', memberships: [{ storeId: 'store_A', view: true, save: false, keywords: false }] };

describe.skipIf(!testDatabaseAvailable())('GET /ideas/[id]/image', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    pool = createPool(t.url, 2);
    db = createDb(pool);
    await db.execute(sql`insert into users (id, email, name) values ('user_a', 'a@x.test', 'A')`);
    await db.execute(sql`insert into stores (id, name) values ('store_A', 'A'), ('store_B', 'B')`);
    await db.execute(sql`insert into saved_ideas (id, store_id, source, via, title, image_key, created_by) values
      ('idea_a', 'store_A', 'manual', 'manual', 'a', 'ideas/store_A/a.webp', 'user_a'),
      ('idea_b', 'store_B', 'manual', 'manual', 'b', 'ideas/store_B/b.webp', 'user_a'),
      ('idea_none', 'store_A', 'manual', 'manual', 'link only', null, 'user_a')`);
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it("serves store A's image to a member of A as private WebP", async () => {
    const res = await handleIdeaImage('idea_a', { db, viewer: memberA, store });
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'content-type': 'image/webp',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    });
    expect(Buffer.from(await res.arrayBuffer()).toString('latin1')).toBe('RIFF\0\0\0\0WEBPa');
  });

  it.each([
    ["store B's image", 'idea_b', memberA],
    ['no session', 'idea_a', null],
    ['a missing idea', 'idea_missing', memberA],
    ['an idea without an image', 'idea_none', memberA],
  ])('answers 404 for %s', async (_name, id, viewer) => {
    const res = await handleIdeaImage(id, { db, viewer, store });
    expect([res.status, res.headers.get('x-content-type-options'), res.headers.get('cache-control')]).toEqual([404, 'nosniff', 'private, no-store']);
  });
});
