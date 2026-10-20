// POST /api/ideas/manual (plan Step 6 "Idea images"): a manual idea with a link and/or an image. A route
// handler, not a Server Action (1 MB body cap); proxy.ts leaves it out, so it checks the session itself.
// Dependencies are injected so the tests run it against a disposable database and an in-memory store.
import { type Viewer, can } from '@ideas-hub/core';
import { type Db } from '@ideas-hub/db/client';
import { IdeaAccessError, type SaveResult, saveIdea } from '@ideas-hub/db/queries';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import type { ObjectStore } from '@/lib/object-store';
import { t } from '@/lib/strings.vi';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** The image plus room for the multipart framing and the other fields. */
export const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
/** Longer links would not fit the (store, source, source_ref) btree index. */
const MAX_LINK_CHARS = 2048;

export interface ManualIdeaDeps {
  db: Db;
  viewer: Viewer | null;
  store: Pick<ObjectStore, 'putObject' | 'deleteObjects'>;
  /** The configured public URL (APP_URL), never the request URL: the app runs behind a tunnel. */
  appUrl: string;
  now: () => Date;
}

const fail = (status: number, error: string) => Response.json({ error }, { status });

function isImage(b: Buffer): boolean {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  return b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
}

function isHttpUrl(s: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol);
  } catch {
    return false;
  }
}

/** The body, or null as soon as it passes MAX_BODY_BYTES (a body sent without Content-Length). */
async function readLimited(body: ReadableStream<Uint8Array> | null): Promise<Buffer<ArrayBuffer> | null> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    // Buffer.concat allocates a fresh (non-shared) ArrayBuffer.
    if (done) return Buffer.concat(chunks) as Buffer<ArrayBuffer>;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

const field = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');

export async function handleManualIdea(request: Request, deps: ManualIdeaDeps): Promise<Response> {
  if (request.headers.get('origin') !== new URL(deps.appUrl).origin && request.headers.get('sec-fetch-site') !== 'same-origin') {
    return fail(403, t.upload.crossOrigin);
  }
  const viewer = deps.viewer;
  if (!viewer) return fail(401, t.upload.signIn);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return fail(413, t.upload.tooLarge);
  const body = await readLimited(request.body);
  if (!body) return fail(413, t.upload.tooLarge);

  let form: FormData;
  try {
    // Keeps the request's boundary; parsed only after the size check, with no multipart dependency.
    form = await new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
  } catch {
    return fail(400, t.upload.badForm);
  }
  const storeIds = [...new Set(form.getAll('storeIds').map(field).filter(Boolean))];
  if (storeIds.length === 0) return fail(400, t.upload.needStore);
  // Store ids end up in object keys, so only id characters pass, even for an admin.
  if (!storeIds.every((s) => /^[A-Za-z0-9_-]+$/.test(s) && can(viewer, s, 'save'))) return fail(403, t.upload.forbidden);
  const link = field(form.get('link'));
  const title = field(form.get('title'));
  const entry = form.get('image');
  const file = entry instanceof Blob && entry.size > 0 ? entry : null;
  if (link && (link.length > MAX_LINK_CHARS || !isHttpUrl(link))) return fail(400, t.upload.badLink);
  if (!link && !file) return fail(400, t.upload.needLinkOrImage);

  let webp: Buffer | null = null;
  if (file) {
    if (file.size > MAX_IMAGE_BYTES) return fail(413, t.upload.tooLarge);
    const buf = Buffer.from(await file.arrayBuffer());
    if (!isImage(buf)) return fail(415, t.upload.badType);
    try {
      // limitInputPixels is checked on the header, before decoding: a small file declaring 100 MP never allocates it.
      webp = await sharp(buf, { limitInputPixels: 5e7 })
        .rotate()
        .resize({ width: 640, height: 1920, fit: 'inside', withoutEnlargement: true })
        .webp()
        .toBuffer();
    } catch (e) {
      return /pixel limit/i.test(String(e)) ? fail(413, t.upload.tooManyPixels) : fail(422, t.upload.unreadable);
    }
  }

  const written: string[] = [];
  const imageKeys: Record<string, string> = {};
  try {
    if (webp) {
      for (const storeId of storeIds) {
        // A nanoid, never the file name, outside the thumbnail prefix.
        const key = `ideas/${storeId}/${nanoid()}.webp`;
        written.push(key);
        imageKeys[storeId] = key;
        await deps.store.putObject(key, webp, 'image/webp');
      }
    }
    const results: SaveResult = await saveIdea(
      deps.db,
      viewer,
      storeIds,
      {
        source: 'manual',
        sourceRef: link || null,
        via: 'manual',
        title: title || link || t.upload.imageTitle,
        snapshot: link ? { link } : {},
        imageKeys: webp ? imageKeys : undefined,
      },
      deps.now(),
    );
    // A store that already had this link keeps its idea, so the copy written for it is unused.
    const unused = results.flatMap((r) => (!r.created && imageKeys[r.storeId] ? [imageKeys[r.storeId]!] : []));
    if (unused.length > 0) await deps.store.deleteObjects(unused).catch((e: unknown) => console.error('manual idea: unused image not deleted', e));
    return Response.json({ results });
  } catch (e) {
    if (written.length > 0) await deps.store.deleteObjects(written).catch((err: unknown) => console.error('manual idea: images not deleted', err));
    if (e instanceof IdeaAccessError) return fail(403, t.upload.forbidden);
    console.error('manual idea not saved', e);
    return fail(500, t.upload.failed);
  }
}
