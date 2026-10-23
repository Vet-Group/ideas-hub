import { describe, expect, it } from 'vitest';
import { keywordText } from './keyword-text';

describe('keywordText', () => {
  it('trims and collapses inner whitespace', () => {
    expect(keywordText.parse('  dog \t mom\n mug  ')).toBe('dog mom mug');
  });
  it.each(['', '   ', 'x'.repeat(101)])('rejects %j', (v) => {
    expect(keywordText.safeParse(v).success).toBe(false);
  });
  it('rejects a missing field', () => {
    expect(keywordText.safeParse(null).success).toBe(false);
  });
});
