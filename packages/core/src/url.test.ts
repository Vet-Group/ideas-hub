import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from './url';

describe('canonicalizeUrl', () => {
  it('strips utm_* and click ids, whatever their case', () => {
    expect(canonicalizeUrl('https://shop.example/products/mug?utm_source=fb&UTM_Campaign=x&fbclid=1&gclid=2&ttclid=3&msclkid=4')).toBe(
      'https://shop.example/products/mug',
    );
  });

  it('keeps other parameters, sorted', () => {
    expect(canonicalizeUrl('https://shop.example/p?variant=2&utm_medium=cpc&color=red')).toBe('https://shop.example/p?color=red&variant=2');
  });

  it('lower-cases the host, drops the fragment and the trailing slash', () => {
    expect(canonicalizeUrl('https://Shop.Example/Products/Mug/#reviews')).toBe('https://shop.example/Products/Mug');
    expect(canonicalizeUrl('https://shop.example/')).toBe('https://shop.example');
  });

  it('gives the same result for links that differ only by tracking', () => {
    const a = canonicalizeUrl('https://shop.example/p/?fbclid=abc&utm_source=fb');
    expect(a).toBe(canonicalizeUrl('https://SHOP.example/p#top'));
  });

  it('returns null for something that is not an absolute URL', () => {
    expect(canonicalizeUrl('')).toBeNull();
    expect(canonicalizeUrl('not a url')).toBeNull();
    expect(canonicalizeUrl('/products/mug')).toBeNull();
  });
});
