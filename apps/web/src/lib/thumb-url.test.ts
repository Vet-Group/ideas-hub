import { beforeAll, describe, expect, it } from 'vitest';
import { thumbUrl, verifyThumb } from './thumb-url';

describe('thumb-url', () => {
  beforeAll(() => {
    process.env.THUMB_URL_SECRET = 'test-only-secret';
  });
  const parts = (url: string) => {
    const [, root, sig, key] = url.split('/');
    expect(root).toBe('thumbs');
    return { sig: sig!, key: decodeURIComponent(key!) };
  };

  it('accepts its own signature', () => {
    const { sig, key } = parts(thumbUrl('123456_image.jpg'));
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe('123456_image.jpg');
    expect(verifyThumb(sig, key)).toBe(true);
    expect(verifyThumb(parts(thumbUrl('a-b_c.webp')).sig, 'a-b_c.webp')).toBe(true);
  });

  it('rejects a wrong, truncated, padded or upper-case signature', () => {
    const { sig, key } = parts(thumbUrl('123456_image.jpg'));
    const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    expect(verifyThumb(flipped, key)).toBe(false);
    expect(verifyThumb(sig.slice(0, 63), key)).toBe(false);
    expect(verifyThumb(sig.slice(0, 32), key)).toBe(false);
    expect(verifyThumb(`${sig}00`, key)).toBe(false);
    expect(verifyThumb(sig.toUpperCase(), key)).toBe(false);
    expect(verifyThumb('', key)).toBe(false);
  });

  it('rejects a valid signature on an altered key', () => {
    const { sig } = parts(thumbUrl('123456_image.jpg'));
    expect(verifyThumb(sig, '123457_image.jpg')).toBe(false);
    expect(verifyThumb(sig, '123456_image.webp')).toBe(false);
  });

  it.each(['../secret.jpg', '..', 'a/b.jpg', 'a%2Fb.jpg', 'a%2fb.jpg', '%2E%2E.jpg', 'x.png', 'x.jpg/', 'x.jpg\n', ''])(
    'rejects the key %j even with its own signature',
    (key) => {
      expect(verifyThumb(parts(thumbUrl(key)).sig, key)).toBe(false);
    },
  );
});
