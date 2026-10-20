import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ObjectStore } from '@/lib/object-store';
import { thumbUrl } from '@/lib/thumb-url';

const objects = new Map([
  ['thumbs/1_a.jpg', Buffer.from('\xff\xd8\xffjpeg', 'latin1')],
  ['thumbs/2_b.webp', Buffer.from('RIFF\0\0\0\0WEBPb', 'latin1')],
]);
let minioDown = false;
vi.mock('@/lib/object-store', () => ({
  objectStore: {
    async getObject(key) {
      if (minioDown) throw new Error('connect ECONNREFUSED');
      const body = objects.get(key);
      // Stored metadata says PNG: the route must not pass it on.
      return body ? { body: new Blob([new Uint8Array(body)]).stream(), contentType: 'image/png', contentLength: body.length } : null;
    },
  } satisfies Pick<ObjectStore, 'getObject'>,
}));

const { GET } = await import('./route');
const get = (sig: string, key: string) => GET(new Request(`http://localhost:3300/thumbs/${sig}/${key}`), { params: Promise.resolve({ sig, key }) });
const signed = (key: string) => {
  const [, , sig] = thumbUrl(key).split('/');
  return get(sig!, key);
};

describe('GET /thumbs/[sig]/[key]', () => {
  beforeAll(() => {
    process.env.THUMB_URL_SECRET = 'test-only-secret';
  });

  it.each([
    ['1_a.jpg', 'image/jpeg', '\xff\xd8\xffjpeg'],
    ['2_b.webp', 'image/webp', 'RIFF\0\0\0\0WEBPb'],
  ])('serves %s with its type from the extension, nosniff, a length and a cache for good', async (key, type, body) => {
    const res = await signed(key);
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toEqual({
      'content-type': type,
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': String(body.length),
    });
    expect(Buffer.from(await res.arrayBuffer()).toString('latin1')).toBe(body);
  });

  it('answers a bare 404 with nosniff and no cache header for a bad signature, a missing object or MinIO down', async () => {
    const [, , sig] = thumbUrl('1_a.jpg').split('/');
    const responses = [await get(sig!, '2_b.webp'), await signed('3_missing.jpg')];
    minioDown = true;
    responses.push(await signed('1_a.jpg'));
    minioDown = false;
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(Object.fromEntries(res.headers)).toEqual({ 'x-content-type-options': 'nosniff' });
      expect(await res.text()).toBe('');
    }
  });
});
