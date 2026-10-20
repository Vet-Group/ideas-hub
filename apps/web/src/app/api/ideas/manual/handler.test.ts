import { crc32 } from 'node:zlib';
import { type Viewer } from '@ideas-hub/core';
import { type Db, createDb, createPool } from '@ideas-hub/db/client';
import { undoSave } from '@ideas-hub/db/queries';
import { createTestDatabase, testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ObjectStore } from '@/lib/object-store';
import { t } from '@/lib/strings.vi';
import { type ManualIdeaDeps, handleManualIdea } from './handler';

const APP = 'http://localhost:3300';
const MiB = 1024 * 1024;
const tick = (storeId: string, view: boolean, save: boolean) => ({ storeId, view, save, keywords: false });
const member: Viewer = { userId: 'user_m', role: 'member', memberships: [tick('store_A', false, true), tick('store_B', false, true), tick('store_C', true, false)] };
const admin: Viewer = { userId: 'user_admin', role: 'admin', memberships: [] };

/** In-memory ObjectStore; `failPutAfter` makes the n-th put throw. */
function memoryStore() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  let puts = 0;
  const store = {
    objects,
    failPutAfter: Infinity,
    async putObject(key: string, body: Uint8Array, contentType: string) {
      if (++puts > store.failPutAfter) throw new Error('injected put failure');
      objects.set(key, { body: Buffer.from(body), contentType });
    },
    async deleteObjects(keys: readonly string[]) {
      for (const k of keys) objects.delete(k);
    },
  } satisfies Pick<ObjectStore, 'putObject' | 'deleteObjects'> & Record<string, unknown>;
  return store;
}

type Part = [name: string, value: string | Blob, filename?: string];

/** Bytes a streamed body has handed out so far. */
let streamed = 0;

/** A multipart POST; `stream` sends the body as a ReadableStream without Content-Length, 64 KB per read. */
async function post(parts: Part[], opts: { headers?: Record<string, string>; contentLength?: boolean; stream?: boolean } = {}) {
  const form = new FormData();
  for (const [name, value, filename] of parts) {
    if (typeof value === 'string') form.append(name, value);
    else form.append(name, value, filename);
  }
  const encoded = new Request(`${APP}/api/ideas/manual`, { method: 'POST', body: form });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = { 'content-type': encoded.headers.get('content-type')!, origin: APP, ...opts.headers };
  if (opts.contentLength) headers['content-length'] = String(bytes.length);
  streamed = 0;
  const body = opts.stream
    ? new ReadableStream<Uint8Array>(
        {
          pull(c) {
            if (streamed >= bytes.length) return c.close();
            c.enqueue(bytes.slice(streamed, streamed + 64 * 1024));
            streamed += 64 * 1024;
          },
        },
        { highWaterMark: 0 },
      )
    : bytes;
  return new Request(`${APP}/api/ideas/manual`, { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
}

const jpegFile = (buf: Buffer, name = 'photo.jpg') => new File([new Uint8Array(buf)], name, { type: 'image/jpeg' });

/** A real noise JPEG, padded after its EOI marker up to `bytes` (decoders stop at EOI). */
async function jpegOfSize(bytes: number): Promise<Buffer> {
  const img = await sharp({ create: { width: 2100, height: 1600, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
    .jpeg({ quality: 100 })
    .toBuffer();
  if (img.length > bytes) throw new Error(`fixture is ${img.length} bytes, over ${bytes}`);
  return Buffer.concat([img, Buffer.alloc(bytes - img.length)]);
}

/** A tiny PNG whose IHDR declares width × height; only the header is valid. */
function pngDeclaring(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(16)), chunk('IEND', Buffer.alloc(0))]);
}

describe.skipIf(!testDatabaseAvailable())('POST /api/ideas/manual', () => {
  let drop: () => Promise<void>;
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  let store: ReturnType<typeof memoryStore>;
  const at = new Date('2026-10-20T01:00:00Z');
  const deps = (viewer: Viewer | null = member): ManualIdeaDeps => ({ db, viewer, store, appUrl: APP, now: () => at });
  const rows = async () => Number((await db.execute<{ n: string }>(sql`select count(*) n from saved_ideas`)).rows[0]!.n);
  const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
  let small: Buffer;

  beforeAll(async () => {
    const tdb = await createTestDatabase();
    drop = tdb.drop;
    pool = createPool(tdb.url, 2);
    db = createDb(pool);
    await db.execute(sql`insert into users (id, email, name, role) values ('user_m', 'm@x.test', 'M', 'member'), ('user_admin', 'a@x.test', 'Admin', 'admin')`);
    await db.execute(sql`insert into stores (id, name) values ('store_A', 'A'), ('store_B', 'B'), ('store_C', 'C')`);
    await db.execute(sql`insert into store_members (store_id, user_id, can_view, can_save) values
      ('store_A', 'user_m', false, true), ('store_B', 'user_m', false, true), ('store_C', 'user_m', true, false)`);
    small = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#cc3333' } }).jpeg().toBuffer();
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });
  beforeEach(() => {
    store = memoryStore();
  });

  it('accepts a 4.9 MB JPEG and stores one WebP at most 640 px wide', async () => {
    const buf = await jpegOfSize(Math.floor(4.9 * MiB));
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['image', jpegFile(buf)]], { contentLength: true }), deps());
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { storeId: string; created: boolean }[] };
    expect(results).toMatchObject([{ storeId: 'store_A', created: true }]);
    const [key, obj] = [...store.objects][0]!;
    expect(key).toMatch(/^ideas\/store_A\/[A-Za-z0-9_-]{21}\.webp$/);
    expect(obj.contentType).toBe('image/webp');
    const meta = await sharp(obj.body).metadata();
    expect([meta.format, meta.width]).toEqual(['webp', 640]);
  });

  it.each<[string, { contentLength?: boolean; stream?: boolean }]>([
    ['with Content-Length', { contentLength: true }],
    ['streamed without Content-Length', { stream: true }],
  ])('refuses a 6 MB file %s with "Ảnh lớn hơn 5 MB"', async (_name, opts) => {
    const req = await post([['storeIds', 'store_A'], ['image', jpegFile(await jpegOfSize(6 * MiB))]], opts);
    if (opts.stream) expect(req.headers.get('content-length')).toBeNull();
    const res = await handleManualIdea(req, deps());
    expect(res.status).toBe(413);
    expect(await errorOf(res)).toBe('Ảnh lớn hơn 5 MB');
    expect(store.objects.size).toBe(0);
    // The byte counter stops reading once past 5 MB + 64 KB, before the end of the 6 MB body.
    if (opts.stream) expect(streamed).toBeLessThan(6 * MiB);
  });

  it('refuses by Content-Length before reading the body', async () => {
    let pulled = false;
    // highWaterMark 0: the stream pulls only when someone reads it.
    const body = new ReadableStream({ pull: () => void (pulled = true) }, { highWaterMark: 0 });
    const req = new Request(`${APP}/api/ideas/manual`, {
      method: 'POST',
      body,
      duplex: 'half',
      headers: { origin: APP, 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(6 * MiB) },
    } as RequestInit);
    const res = await handleManualIdea(req, deps());
    expect([res.status, await errorOf(res), pulled]).toEqual([413, t.upload.tooLarge, false]);
  });

  it('refuses a file part over 5 MB inside a body under the limit', async () => {
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['image', jpegFile(await jpegOfSize(5 * MiB + 1024))]]), deps());
    expect([res.status, await errorOf(res)]).toEqual([413, 'Ảnh lớn hơn 5 MB']);
  });

  it.each([
    ['an SVG', new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'x.svg', { type: 'image/svg+xml' })],
    ['a GIF named .jpg', new File([Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')], 'x.jpg', { type: 'image/jpeg' })],
    ['text named .png', new File(['hello'], 'x.png', { type: 'image/png' })],
  ])('refuses %s by its magic bytes', async (_name, file) => {
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['image', file]]), deps());
    expect([res.status, await errorOf(res)]).toEqual([415, 'Chỉ nhận ảnh JPEG, PNG hoặc WebP']);
    expect(store.objects.size).toBe(0);
  });

  it('refuses a JPEG that cannot be decoded', async () => {
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['image', jpegFile(small.subarray(0, 40))]]), deps());
    expect([res.status, await errorOf(res)]).toEqual([422, 'Không đọc được ảnh này']);
  });

  it('stores a JPEG with EXIF orientation 6 upright', async () => {
    // 200×100, red on the left and blue on the right; orientation 6 shows it turned 90° clockwise.
    const red = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const src = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#0000ff' } })
      .composite([{ input: red, left: 0, top: 0 }])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(src).metadata()).orientation).toBe(6);
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['image', jpegFile(src)]]), deps());
    expect(res.status).toBe(200);
    const [obj] = [...store.objects.values()];
    const { data, info } = await sharp(obj!.body).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([100, 200]);
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(px(50, 20)[0]).toBeGreaterThan(200); // top: red
    expect(px(50, 180)[2]).toBeGreaterThan(200); // bottom: blue
  });

  it('passes a 48 MP image within 5 MB', async () => {
    const big = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#3366aa' } }).jpeg().toBuffer();
    expect(big.length).toBeLessThanOrEqual(5 * MiB);
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['image', jpegFile(big)]]), deps());
    expect(res.status).toBe(200);
    expect((await sharp([...store.objects.values()][0]!.body).metadata()).width).toBe(640);
  });

  it('refuses a small PNG declaring more than 50 megapixels', async () => {
    const png = pngDeclaring(10_000, 10_000);
    expect(png.length).toBeLessThan(100);
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['image', new File([new Uint8Array(png)], 'x.png', { type: 'image/png' })]]), deps());
    expect([res.status, await errorOf(res)]).toEqual([413, 'Ảnh quá lớn (trên 50 megapixel)']);
  });

  it('answers 403 to a cross-origin POST and accepts Sec-Fetch-Site same-origin', async () => {
    const parts: Part[] = [['storeIds', 'store_A'], ['link', 'https://example.com/cross']];
    const before = await rows();
    const crossOrigin: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, { origin: 'http://localhost:3301' }];
    for (const headers of crossOrigin) {
      const res = await handleManualIdea(await post(parts, { headers }), deps());
      expect(res.status).toBe(403);
    }
    expect(await rows()).toBe(before);
    const ok = await handleManualIdea(await post(parts, { headers: { origin: 'null', 'sec-fetch-site': 'same-origin' } }), deps());
    expect(ok.status).toBe(200);
  });

  it('answers 401 without a session and stores no object and no row', async () => {
    const before = await rows();
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['image', jpegFile(small)]]), deps(null));
    expect(res.status).toBe(401);
    expect([store.objects.size, await rows()]).toEqual([0, before]);
  });

  it('answers 403 and stores nothing when one chosen store lacks save', async () => {
    const before = await rows();
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['storeIds', 'store_C'], ['image', jpegFile(small)]]), deps());
    expect([res.status, await errorOf(res)]).toEqual([403, t.upload.forbidden]);
    expect([store.objects.size, await rows()]).toEqual([0, before]);
  });

  it('leaves no object when a step fails after the objects are written', async () => {
    const before = await rows();
    // An admin may pick any store; the missing one fails the insert after both objects are written.
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['storeIds', 'store_missing'], ['image', jpegFile(small)]]), deps(admin));
    expect(res.status).toBe(500);
    expect([store.objects.size, await rows()]).toEqual([0, before]);
    store.failPutAfter = 1;
    const res2 = await handleManualIdea(await post([['storeIds', 'store_A'], ['storeIds', 'store_B'], ['image', jpegFile(small)]]), deps());
    expect(res2.status).toBe(500);
    expect([store.objects.size, await rows()]).toEqual([0, before]);
  });

  it('stores two objects for two stores, and undo deletes both', async () => {
    const res = await handleManualIdea(await post([['storeIds', 'store_A'], ['storeIds', 'store_B'], ['image', jpegFile(small)]]), deps());
    const { results } = (await res.json()) as { results: { storeId: string; ideaId: string; created: boolean }[] };
    expect(results.map((r) => r.created)).toEqual([true, true]);
    expect([...store.objects.keys()].map((k) => k.split('/')[1]).sort()).toEqual(['store_A', 'store_B']);
    const undone = await undoSave(db, member, results.map((r) => r.ideaId), new Date(at.getTime() + 5000));
    expect(undone.ok).toBe(true);
    if (undone.ok) await store.deleteObjects(undone.imageKeys);
    expect(store.objects.size).toBe(0);
  });

  it('keeps the link as source_ref and title, dedupes it, and drops the unused image copy', async () => {
    const parts: Part[] = [['storeIds', 'store_B'], ['link', 'https://example.com/dup'], ['image', jpegFile(small)]];
    const first = (await (await handleManualIdea(await post(parts), deps())).json()) as { results: { ideaId: string; created: boolean }[] };
    const second = (await (await handleManualIdea(await post(parts), deps())).json()) as { results: { ideaId: string; created: boolean }[] };
    expect(second.results).toEqual([{ storeId: 'store_B', ideaId: first.results[0]!.ideaId, created: false }]);
    expect(store.objects.size).toBe(1);
    const { rows: r } = await db.execute<{ title: string; source_ref: string; snapshot: { link: string } }>(
      sql`select title, source_ref, snapshot from saved_ideas where id = ${first.results[0]!.ideaId}`,
    );
    expect(r[0]).toEqual({ title: 'https://example.com/dup', source_ref: 'https://example.com/dup', snapshot: { link: 'https://example.com/dup' } });
  });

  it('needs a link or an image, a valid http(s) link and at least one store', async () => {
    const cases: [Part[], number, string][] = [
      [[['storeIds', 'store_A']], 400, t.upload.needLinkOrImage],
      [[['storeIds', 'store_A'], ['link', 'javascript:alert(1)']], 400, t.upload.badLink],
      [[['link', 'https://example.com/x']], 400, t.upload.needStore],
      [[['storeIds', '../store_A'], ['link', 'https://example.com/x']], 403, t.upload.forbidden],
    ];
    for (const [parts, status, error] of cases) {
      const res = await handleManualIdea(await post(parts), deps(admin));
      expect([res.status, await errorOf(res)]).toEqual([status, error]);
    }
  });
});
