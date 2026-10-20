// Screenshots (plan Step 5): sign in at 1440 and 390 px, and the Loading, No permission and Crawler
// attention states, with the seed data and the frozen clock; compared once the owner approves the
// baselines (support/screens.ts).
import { expect, test } from '@playwright/test';
import { USERS } from './fixtures/seed';
import { expectScreen } from './support/screens';
import { freezeClock, signIn } from './support/session';

test.beforeEach(async ({ page }) => freezeClock(page));

test('sign in @phone', async ({ page }, info) => {
  await page.goto('/login');
  await page.evaluate(() => document.fonts.ready);
  await expectScreen(page, 'sign-in', info, { fullPage: true });
});

test('No permission: a member on an admin page gets the 404 page', async ({ page }, info) => {
  await signIn(page, USERS.other.email);
  const res = await page.goto('/admin/settings');
  expect(res?.status()).toBe(404);
  await expectScreen(page, 'no-permission', info, { fullPage: true });
});

test('Crawler attention: the bar for an admin while an Alert is open', async ({ page }, info) => {
  await signIn(page, USERS.admin.email, '/login?callbackURL=%2Fruns');
  await expect(page.getByRole('status').filter({ hasText: 'alert chưa xử lý' })).toBeVisible();
  await expectScreen(page, 'crawler-attention', info, { fullPage: true });
});

test('Loading: the route skeleton', async ({ page }, info) => {
  // Prefetches go through and the navigation's own request is held, so loading.tsx stays on screen. The
  // click waits for the prefetches: without the prefetched loading state Next waits for the page instead.
  await page.route(/\/runs\?_rsc=/, (route) => (route.request().headers()['next-router-prefetch'] ? route.continue() : undefined));
  const prefetched = page.waitForResponse((r) => {
    const h = r.request().headers();
    return r.url().includes('/runs?_rsc=') && !!h['next-router-prefetch'] && !!h['next-router-state-tree'];
  });
  await signIn(page, USERS.admin.email);
  await prefetched;
  await page.getByRole('link', { name: 'Run log' }).click();
  await expect(page.locator('[aria-busy=true]')).toBeVisible();
  await expectScreen(page.locator('[aria-busy=true]'), 'loading', info);
});

// Step 6: the research and ideas screens at both widths, and their states.
for (const [name, path] of [
  ['ads-pane', '/ads/e2e_mug_1'],
  ['keyword-report', '/keywords/kw_e2e_mug'],
  ['ideas-table', '/ideas?store=store_e2e_a&view=table'],
  ['ideas-board', '/ideas?store=store_e2e_a&view=board'],
] as const) {
  test(`${name} @phone`, async ({ page }, info) => {
    await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent(path)}`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await expectScreen(page, name, info, { fullPage: true });
  });
}

test('Step 6 states: missing thumbnail, out of top, less than 7 days, no data yet', async ({ page }, info) => {
  await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent('/ads?status=all&domain=dogmom')}`);
  await expectScreen(page.getByRole('listitem').filter({ hasText: 'Best dog mom mug gift 6' }), 'state-missing-thumb', info);
  await expectScreen(page.getByRole('listitem').filter({ hasText: 'Old dog mom mug' }), 'state-out-of-top', info);
  await page.goto('/keywords/kw_e2e_mug');
  await expectScreen(page.getByText('17 +8 ▲ từ 17/10 (chưa đủ 7 ngày dữ liệu)'), 'state-less-than-7-days', info);
  await page.goto('/keywords/kw_e2e_mug/2026-10-01');
  await expectScreen(page.getByRole('main'), 'state-no-data', info);
});
