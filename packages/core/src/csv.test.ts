import { describe, expect, it } from 'vitest';
import { csvCell, csvDocument } from './csv';

describe('csvCell', () => {
  it('leaves plain text alone', () => {
    expect(csvCell('mug')).toBe('mug');
    expect(csvCell('')).toBe('');
  });

  it('quotes commas, quotes and line breaks, doubling quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('keeps %j from running as a formula', (v) => {
    expect(csvCell(v).replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('guards a formula cell that also needs quotes', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe('csvDocument', () => {
  it('starts with a BOM, joins lines with CRLF and ends with one', () => {
    expect(csvDocument([['a', 'b,c'], ['1', '2']])).toBe('\uFEFFa,"b,c"\r\n1,2\r\n');
  });
});
