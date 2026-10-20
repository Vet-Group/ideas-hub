import { describe, expect, it } from 'vitest';
import { mayRunNow } from './run-now-rules';

const member = (ticks: { view?: boolean; save?: boolean; keywords?: boolean }) => ({
  userId: 'u',
  role: 'member' as const,
  memberships: [{ storeId: 'A', view: false, save: false, keywords: false, ...ticks }],
});

describe('mayRunNow', () => {
  it('allows admins and members with `keywords` on a store that tracks the keyword', () => {
    expect(mayRunNow({ userId: 'a', role: 'admin', memberships: [] }, { trackedBy: [] })).toBe(true);
    expect(mayRunNow(member({ keywords: true }), { trackedBy: ['A'] })).toBe(true);
  });

  it('refuses members without `keywords`, or whose store does not track it', () => {
    expect(mayRunNow(member({ view: true, save: true }), { trackedBy: ['A'] })).toBe(false);
    expect(mayRunNow(member({ keywords: true }), { trackedBy: ['B'] })).toBe(false);
  });
});
