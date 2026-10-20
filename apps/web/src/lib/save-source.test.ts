import { describe, expect, it } from 'vitest';
import { saveInput, snapshotKeyword } from './save-source';

const ad = { kind: 'ad', adArchiveId: '1234567890', via: 'ads' } as const;

describe('save-source', () => {
  it('accepts an ad or a suggestion with store ids, dropping unknown fields', () => {
    expect(saveInput.parse({ source: { ...ad, keyword: 'cat mom', title: 'x' }, storeIds: ['store_A'] })).toEqual({
      source: { ...ad, keyword: 'cat mom' },
      storeIds: ['store_A'],
    });
    expect(saveInput.parse({ source: { kind: 'suggestion', suggestionId: 'sug_1' }, storeIds: [] })).toEqual({
      source: { kind: 'suggestion', suggestionId: 'sug_1' },
      storeIds: [],
    });
    expect(saveInput.parse({ source: { ...ad, via: 'briefing' }, storeIds: ['s'] }).source).toMatchObject({ via: 'briefing' });
  });

  it('rejects a bad kind, via, id or store list', () => {
    const bad = [
      { source: { ...ad, kind: 'manual' }, storeIds: ['s'] },
      { source: { ...ad, via: 'manual' }, storeIds: ['s'] },
      { source: { ...ad, adArchiveId: '' }, storeIds: ['s'] },
      { source: { ...ad, adArchiveId: 'x'.repeat(101) }, storeIds: ['s'] },
      { source: { ...ad, adArchiveId: 123 }, storeIds: ['s'] },
      { source: { ...ad, keyword: 'k'.repeat(201) }, storeIds: ['s'] },
      { source: { kind: 'suggestion', suggestionId: 'x'.repeat(101) }, storeIds: ['s'] },
      { source: { kind: 'suggestion' }, storeIds: ['s'] },
      { source: ad, storeIds: 'store_A' },
      { source: ad, storeIds: [1] },
      { source: ad, storeIds: Array.from({ length: 51 }, (_, i) => `store_${i}`) },
      { source: null, storeIds: [] },
    ];
    for (const input of bad) expect(saveInput.safeParse(input).success, JSON.stringify(input).slice(0, 80)).toBe(false);
    expect(saveInput.safeParse({ source: ad, storeIds: Array.from({ length: 50 }, (_, i) => `store_${i}`) }).success).toBe(true);
  });

  it('keeps the client keyword only when it is one of the ad’s keywords', () => {
    const keywords = [{ text: 'cat mom' }, { text: 'dog dad' }];
    expect(snapshotKeyword(keywords, 'dog dad')).toBe('dog dad');
    expect(snapshotKeyword(keywords, 'made up')).toBe('cat mom');
    expect(snapshotKeyword(keywords, undefined)).toBe('cat mom');
    expect(snapshotKeyword([], 'made up')).toBeNull();
    expect(snapshotKeyword([], undefined)).toBeNull();
  });
});
