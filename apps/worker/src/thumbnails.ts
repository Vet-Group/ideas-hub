// Thumbnail downloads during the gap before the next search (spec §1 "Bounded waits", §2): 15 s per
// image, all of a search's images within that gap; what is not downloaded is retried at the next sighting.
import sharp from 'sharp';
import { type ObjectStore } from './context';

export const THUMB_PREFIX = 'thumbs/';
/** The pattern `/thumbs/[sig]/[key]` accepts (plan Step 6). */
export const THUMB_KEY = /^[A-Za-z0-9_-]+\.(jpg|webp)$/;

export interface ThumbJob {
  adArchiveId: string;
  url: string;
  kind: 'image' | 'video';
}

export function sniff(buf: Buffer): 'jpg' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** The stored key and bytes: JPEG and WebP as they are, anything else re-encoded to WebP. */
export async function toStoredImage(adArchiveId: string, kind: 'image' | 'video', buf: Buffer): Promise<{ key: string; body: Buffer; contentType: string }> {
  const ext = sniff(buf);
  const base = `${adArchiveId.replace(/[^A-Za-z0-9_-]/g, '')}_${kind}`;
  if (ext === 'jpg') return { key: `${base}.jpg`, body: buf, contentType: 'image/jpeg' };
  if (ext === 'webp') return { key: `${base}.webp`, body: buf, contentType: 'image/webp' };
  return { key: `${base}.webp`, body: await sharp(buf, { limitInputPixels: 5e7 }).webp().toBuffer(), contentType: 'image/webp' };
}

export interface DownloadDeps {
  store: Pick<ObjectStore, 'put'>;
  fetch: typeof fetch;
  now: () => number;
  /** Heartbeat between downloads. */
  beat: () => Promise<void>;
  perImageMs: number;
}

export interface DownloadResult {
  stored: { adArchiveId: string; key: string }[];
  /** Images left missing because the total ran out, retried at the next sighting. */
  skipped: number;
  /** Per-image limit hits, counted on the run as `thumbnailDownload`. */
  limitHits: number;
  failed: number;
}

/** Downloads until `totalMs` is used up; never throws. */
export async function downloadThumbnails(jobs: readonly ThumbJob[], totalMs: number, deps: DownloadDeps): Promise<DownloadResult> {
  const end = deps.now() + Math.max(0, totalMs);
  const r: DownloadResult = { stored: [], skipped: 0, limitHits: 0, failed: 0 };
  for (const [i, job] of jobs.entries()) {
    const left = end - deps.now();
    if (left <= 0) {
      r.skipped = jobs.length - i;
      break;
    }
    const limit = Math.min(deps.perImageMs, left);
    try {
      const res = await deps.fetch(job.url, { signal: AbortSignal.timeout(limit) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const img = await toStoredImage(job.adArchiveId, job.kind, Buffer.from(await res.arrayBuffer()));
      await deps.store.put(THUMB_PREFIX + img.key, img.body, img.contentType);
      r.stored.push({ adArchiveId: job.adArchiveId, key: img.key });
    } catch (e) {
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        if (limit === deps.perImageMs) r.limitHits += 1;
        else r.skipped += 1;
      } else r.failed += 1;
    }
    await deps.beat();
  }
  return r;
}
