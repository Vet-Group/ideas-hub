// Ad thumbnails from MinIO behind a signed URL (plan Step 6 "Thumbnails"). No session check here:
// `/_next/image` needs a session (proxy.ts) and fetches this route without one.
import { objectStore } from '@/lib/object-store';
import { verifyThumb } from '@/lib/thumb-url';

/** The worker's THUMB_PREFIX (apps/worker/src/thumbnails.ts). */
const THUMB_PREFIX = 'thumbs/';

const notFound = () => new Response(null, { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });

export async function GET(_request: Request, { params }: { params: Promise<{ sig: string; key: string }> }) {
  const { sig, key } = await params;
  if (!verifyThumb(sig, key)) return notFound();
  // MinIO down answers 404 too: the card shows "Chưa có ảnh" through onError either way.
  const object = await objectStore.getObject(THUMB_PREFIX + key).catch(() => null);
  if (!object) return notFound();
  const headers = new Headers({
    // From the key's extension (jpg or webp only), never from stored metadata.
    'Content-Type': key.endsWith('.jpg') ? 'image/jpeg' : 'image/webp',
    'X-Content-Type-Options': 'nosniff',
    // The worker writes a key once (only missing thumbnails are retried), so a URL can be cached for good.
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  if (object.contentLength !== undefined) headers.set('Content-Length', String(object.contentLength));
  return new Response(object.body, { headers });
}
