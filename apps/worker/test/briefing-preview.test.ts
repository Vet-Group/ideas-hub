import { vietnamInstant } from '@ideas-hub/core';
import { testDatabaseAvailable } from '@ideas-hub/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPreview } from '../../../scripts/briefing-preview';
import { runCrawl } from '../src/run';
import { type Harness, fakeSite, harness, insertRun, runDeps, seedKeywords, setSettings } from './helpers';

describe.skipIf(!testDatabaseAvailable())('scripts/briefing-preview.ts', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness('2026-10-18T18:00:00Z');
    await seedKeywords(h, 2);
    await setSettings(h, { countries: ['US'] });
    // Three mornings of the 01:00 slot, each with more ads for k0.
    for (const [i, day] of ['2026-10-19', '2026-10-20', '2026-10-21'].entries()) {
      const slot = vietnamInstant(day, '01:00');
      h.clock.t = slot.getTime();
      const id = await insertRun(h, { scheduledFor: slot, deadline: new Date(slot.getTime() + 4 * 3_600_000) });
      const site = fakeSite((q) => ({ kind: 'ok', ids: Array.from({ length: q === 'k0' ? 2 + i * 2 : 1 }, (_, n) => `${q}-${n}`), domain: (id) => (id.startsWith('k0') ? 'rising.com' : 'flat.com') }));
      await runCrawl(h, id, runDeps(h, site));
    }
    // One ad active long enough for a trend score.
    await h.db.execute(sql`update ads set start_date = '2026-09-01' where ad_archive_id = 'k0-0'`);
  }, 120_000);
  afterAll(() => h?.close());

  it('renders sections 1–4 from the last completed scheduled run, with partial baselines labelled', async () => {
    const md = await renderPreview(h.db, h.clock.now());
    expect(md).toContain('## 1. Top trending ads');
    expect(md).toMatch(/\[k0-0\]\(https:\/\/www\.facebook\.com\/ads\/library\/\?id=k0-0\)/);
    expect(md).toContain('## 2. Rising new ads');
    expect(md).toContain('| k0 | 6 | +4 since 2026-10-18 (less than 7 days of data) |');
    expect(md).toContain('| k1 | 1 | 0 since 2026-10-18 (less than 7 days of data) |');
    expect(md).toContain('| rising.com | 6 | +4 since 2026-10-18 (less than 7 days of data) |');
  });

  it('says so when no scheduled run has completed', async () => {
    expect(await renderPreview(h.db, new Date('2026-10-01T00:00:00Z'))).toContain('No completed scheduled run yet.');
  });
});
