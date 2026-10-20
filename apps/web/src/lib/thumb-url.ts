// Signed thumbnail URLs (plan Step 6 "Thumbnails"): `/thumbs/<hex HMAC-SHA256 of the key>/<key>`, no
// expiry. The route checks no session (the image optimizer fetches without headers), so the signature
// and the one-segment key pattern are the only gate.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The worker's key pattern (apps/worker/src/thumbnails.ts THUMB_KEY): no `/`, `..` or `%`. */
const THUMB_KEY = /^[A-Za-z0-9_-]+\.(jpg|webp)$/;

function sign(key: string): string {
  const secret = process.env.THUMB_URL_SECRET;
  if (!secret) throw new Error('THUMB_URL_SECRET is not set');
  return createHmac('sha256', secret).update(key).digest('hex');
}

/** A key outside the pattern still gets a URL; the route answers 404 and the card shows "Chưa có ảnh". */
export function thumbUrl(key: string): string {
  return `/thumbs/${sign(key)}/${encodeURIComponent(key)}`;
}

export function verifyThumb(sig: string, key: string): boolean {
  // timingSafeEqual throws on buffers of different lengths, so the length is checked first.
  if (!THUMB_KEY.test(key) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(sign(key), 'hex'));
}
