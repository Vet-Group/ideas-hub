import { describe, expect, it } from 'vitest';
import { AD_ANGLES, angleMix, anglePrompt, parseAngles, perAdUsd } from './angles';

const ads = [
  { adArchiveId: 'a1', pageName: 'Page 1', caption: 'Tired of boring mugs?', title: 'Funny Teacher Mug' },
  { adArchiveId: 'a2', pageName: null, caption: null, title: null },
];
const ids = new Set(['a1', 'a2']);

describe('angle tagging', () => {
  it('the prompt is Vietnamese, lists every angle and carries the ids of the ads sent', () => {
    const p = anglePrompt(ads);
    expect(p.system).toContain('Chỉ trả về đúng một đối tượng JSON');
    for (const a of AD_ANGLES) expect(p.system).toContain(`"${a}"`);
    expect(p.user).toContain('"id":"a1"');
    expect(p.user).toContain('"id":"a2"');
  });

  it('parses a fenced reply; ids not sent are ignored and ads left out stay untagged', () => {
    const reply = '```json\n{"angles":[{"id":"a1","angle":"pain"},{"id":"zz","angle":"proof"}]}\n```';
    const r = parseAngles(reply, ids);
    expect(r).toEqual({ ok: true, angles: new Map([['a1', 'pain']]) });
  });

  it('rejects an unknown angle, invalid JSON and a reply without JSON', () => {
    expect(parseAngles('{"angles":[{"id":"a1","angle":"fear"}]}', ids)).toMatchObject({ ok: false });
    expect(parseAngles('{"angles":[', ids)).toMatchObject({ ok: false });
    expect(parseAngles('no idea', ids)).toEqual({ ok: false, problem: 'no JSON object in the reply' });
  });

  it('the mix leaves out "unclear" and gives whole percents, largest first', () => {
    expect(angleMix(['pain', 'pain', 'proof', 'unclear', 'desire'])).toEqual({
      tagged: 4,
      rows: [
        { angle: 'pain', ads: 2, pct: 50 },
        { angle: 'desire', ads: 1, pct: 25 },
        { angle: 'proof', ads: 1, pct: 25 },
      ],
    });
    expect(angleMix(['unclear'])).toEqual({ tagged: 0, rows: [] });
  });

  it('splits a call estimate over its ads, rounded up to 4 decimals, so the rows sum to at least the estimate', () => {
    expect(perAdUsd(0.0101, 25)).toBe(0.0005);
    expect(perAdUsd(0.0125, 25)).toBe(0.0005);
    expect(perAdUsd(0.0126, 25) * 25).toBeGreaterThanOrEqual(0.0126);
  });
});
