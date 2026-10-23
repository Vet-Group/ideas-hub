import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { aHash, hamming, textKey } from './analyze.mjs';

const image = (fill) => sharp({ create: { width: 32, height: 32, channels: 3, background: '#000' } }).composite([{ input: { create: { width: 16, height: 32, channels: 3, background: fill } }, left: 0, top: 0 }]).png().toBuffer();

describe('matching', () => {
  it('compares the first 120 characters, lowercased with whitespace collapsed', () => {
    expect(textKey('  Perfect   Gift\nFor GRANDMAS ')).toBe('perfect gift for grandmas');
    expect(textKey('a'.repeat(130))).toHaveLength(120);
    expect(textKey(null)).toBe('');
  });

  it('gives near images a small Hamming distance and different ones a large one', async () => {
    const left = await aHash(await image('#fff'));
    const leftJpeg = await aHash(await sharp(await image('#fff')).jpeg({ quality: 40 }).toBuffer());
    const flipped = await aHash(await sharp(await image('#fff')).flop().png().toBuffer());
    expect(hamming(left, leftJpeg)).toBeLessThanOrEqual(6);
    expect(hamming(left, flipped)).toBeGreaterThan(6);
    expect(hamming(5n, 6n)).toBe(2);
  });
});
