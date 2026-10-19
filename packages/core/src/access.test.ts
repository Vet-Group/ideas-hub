import { describe, expect, it } from 'vitest';
import { type Membership, type StoreScope, type Viewer, can, canSeeKeywordAi, inScope, storeScope } from './access';

const ticks = {
  none: { view: false, save: false, keywords: false },
  view: { view: true, save: false, keywords: false },
  save: { view: false, save: true, keywords: false },
  keywords: { view: false, save: false, keywords: true },
} as const;

const member = (t: keyof typeof ticks): Viewer => ({
  userId: 'user_a',
  role: 'member',
  memberships: [{ storeId: 'store_a', ...ticks[t] } satisfies Membership],
});
const admin: Viewer = { userId: 'user_admin', role: 'admin', memberships: [] };

const keywords = {
  seed: { origin: 'seed', trackedBy: [] },
  trackedByA: { origin: 'store', trackedBy: ['store_a'] },
  trackedByB: { origin: 'store', trackedBy: ['store_b'] },
  trackedByAB: { origin: 'store', trackedBy: ['store_a', 'store_b'] },
} as const;

// [viewer, view A, save A, keywords A, view B, AI of: seed, tracked by A, tracked by B only, by A and B]
const table: [string, Viewer, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean][] = [
  ['admin', admin, true, true, true, true, true, true, true, true],
  ['member, no ticks', member('none'), false, false, false, false, true, false, false, false],
  ['member, view', member('view'), true, false, false, false, true, true, false, true],
  ['member, save (implies view)', member('save'), true, true, false, false, true, true, false, true],
  ['member, keywords (implies view)', member('keywords'), true, false, true, false, true, true, false, true],
];

describe('access', () => {
  it.each(table)('%s', (_name, viewer, viewA, saveA, keywordsA, viewB, aiSeed, aiA, aiB, aiAB) => {
    expect(can(viewer, 'store_a', 'view')).toBe(viewA);
    expect(can(viewer, 'store_a', 'save')).toBe(saveA);
    expect(can(viewer, 'store_a', 'keywords')).toBe(keywordsA);
    expect(can(viewer, 'store_b', 'view')).toBe(viewB);
    expect(canSeeKeywordAi(viewer, keywords.seed)).toBe(aiSeed);
    expect(canSeeKeywordAi(viewer, keywords.trackedByA)).toBe(aiA);
    expect(canSeeKeywordAi(viewer, keywords.trackedByB)).toBe(aiB);
    expect(canSeeKeywordAi(viewer, keywords.trackedByAB)).toBe(aiAB);
  });

  it('scopes store queries to the stores a viewer holds the tick on', () => {
    const multi: Viewer = {
      userId: 'user_m',
      role: 'member',
      memberships: [
        { storeId: 'store_a', ...ticks.save },
        { storeId: 'store_b', ...ticks.view },
      ],
    };
    expect(storeScope(multi).storeIds).toEqual(['store_a', 'store_b']);
    expect(storeScope(multi, 'save').storeIds).toEqual(['store_a']);
    expect(inScope(storeScope(multi, 'save'), 'store_b')).toBe(false);
    expect(storeScope(admin, 'save').storeIds).toBe('all');
    expect(inScope(storeScope(admin), 'store_z')).toBe(true);
  });

  it('cannot build a scope without storeScope', () => {
    // @ts-expect-error a plain object is not a StoreScope
    const forged: StoreScope = { permission: 'view', storeIds: 'all' };
    expect(forged).toBeDefined();
  });
});
