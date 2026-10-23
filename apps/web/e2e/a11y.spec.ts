import { test } from '@playwright/test';
import { IDEAS, MUG, STORES, USERS } from './fixtures/seed';
import { expectA11yChecks } from './support/a11y';
import { expectNoSeriousAxe } from './support/axe';
import { freezeClock, signIn } from './support/session';

const ADMIN_PAGES = ['/runs', '/admin/settings', '/admin/users', '/admin/stores', `/admin/stores/${STORES.a.id}`, '/admin/keywords', '/admin/feeds', '/admin/holidays', '/admin/alerts'];
// Step 6 research and ideas pages.
const RESEARCH_PAGES = [
  '/ads',
  '/ads/e2e_mug_1',
  '/shops',
  `/shops/${MUG.domain}`,
  '/keywords',
  `/keywords/${MUG.keywordId}`,
  `/keywords/${MUG.keywordId}/2026-10-20`,
  `/ideas?store=${STORES.a.id}&view=table`,
  `/ideas?store=${STORES.a.id}&view=board`,
  `/ideas/${IDEAS.fresh}`,
  // Step 7 briefing, with the ad sheet open and with the AI sections failed.
  '/briefing',
  '/briefing?ad=e2e_mug_1',
  '/briefing/2026-10-20',
  // Phase 3 API tokens.
  '/account/tokens',
];

test('sign in passes axe and the a11y checks @phone', async ({ page }) => {
  await freezeClock(page);
  await page.goto('/login');
  await expectNoSeriousAxe(page);
  await expectA11yChecks(page);
});

for (const path of [...ADMIN_PAGES, ...RESEARCH_PAGES]) {
  test(`${path} passes axe and the a11y checks @phone`, async ({ page }) => {
    await freezeClock(page);
    await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent(path)}`);
    await expectNoSeriousAxe(page);
    await expectA11yChecks(page);
  });
}
