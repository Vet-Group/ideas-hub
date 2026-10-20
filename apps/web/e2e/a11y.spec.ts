import { test } from '@playwright/test';
import { STORES, USERS } from './fixtures/seed';
import { expectA11yChecks } from './support/a11y';
import { expectNoSeriousAxe } from './support/axe';
import { freezeClock, signIn } from './support/session';

const ADMIN_PAGES = ['/runs', '/admin/settings', '/admin/users', '/admin/stores', `/admin/stores/${STORES.a.id}`, '/admin/keywords', '/admin/feeds', '/admin/holidays', '/admin/alerts'];

test('sign in passes axe and the a11y checks @phone', async ({ page }) => {
  await freezeClock(page);
  await page.goto('/login');
  await expectNoSeriousAxe(page);
  await expectA11yChecks(page);
});

for (const path of ADMIN_PAGES) {
  test(`${path} passes axe and the a11y checks @phone`, async ({ page }) => {
    await freezeClock(page);
    await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent(path)}`);
    await expectNoSeriousAxe(page);
    await expectA11yChecks(page);
  });
}
