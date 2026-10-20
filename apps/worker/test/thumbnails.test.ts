import { describe, expect, it } from 'vitest';
import { THUMB_KEY, downloadThumbnails, toStoredImage } from '../src/thumbnails';
import { FakeClock, images } from './helpers';

describe('thumbnails', () => {
  it('names keys from the magic bytes: JPEG .jpg, WebP .webp, PNG re-encoded to .webp', async () => {
    const img = await images();
    expect((await toStoredImage('1', 'image', img.jpg)).key).toBe('1_image.jpg');
    expect((await toStoredImage('2', 'video', img.webp)).key).toBe('2_video.webp');
    const png = await toStoredImage('3', 'image', img.png);
    expect(png).toMatchObject({ key: '3_image.webp', contentType: 'image/webp' });
    expect(png.body.subarray(8, 12).toString()).toBe('WEBP');
    for (const k of ['1_image.jpg', '2_video.webp', '3_image.webp']) expect(THUMB_KEY.test(k)).toBe(true);
  });

  it('stops at the total for the search, leaves the rest missing and beats between downloads', async () => {
    const clock = new FakeClock(0);
    const img = await images();
    let beats = 0;
    const put: string[] = [];
    // Each download takes 8 s of the 20 s gap.
    const fetchSlow = (async () => {
      clock.advance(8000);
      return new Response(new Uint8Array(img.jpg));
    }) as unknown as typeof fetch;
    const jobs = ['a', 'b', 'c', 'd'].map((id) => ({ adArchiveId: id, url: `https://cdn/${id}`, kind: 'image' as const }));
    const r = await downloadThumbnails(jobs, 20_000, {
      store: { put: async (k) => void put.push(k) },
      fetch: fetchSlow,
      now: () => clock.t,
      beat: async () => void (beats += 1),
      perImageMs: 15_000,
    });
    expect(r.stored.map((s) => s.adArchiveId)).toEqual(['a', 'b', 'c']);
    expect(r.skipped).toBe(1);
    expect(beats).toBe(3);
    expect(clock.t).toBe(24_000);
  });
});
