// Phase 3 item 2: store staff with the `keywords` tick manage their store's tracked keywords.
import { expect, test } from '@playwright/test';
import { MUG, USERS, e2ePool } from './fixtures/seed';
import { freezeClock, signIn } from './support/session';

test.beforeEach(async ({ page }) => freezeClock(page));

const NEW = 'e2e framed print';

test('a member with the keywords tick adds, sees and removes a tracked keyword', async ({ page }) => {
  await signIn(page, USERS.kw.email);
  await page.getByRole('link', { name: 'Keyword của store' }).click();
  await expect(page.getByRole('heading', { name: 'Keyword của Store A' })).toBeVisible();
  await expect(page.getByRole('link', { name: MUG.keyword })).toBeVisible();
  const pool = e2ePool();
  try {
    await page.getByLabel('Keyword', { exact: true }).fill(`  ${NEW}  `);
    await page.getByRole('button', { name: 'Thêm keyword' }).click();
    await expect(page.getByRole('link', { name: NEW, exact: true })).toBeVisible();
    await page.getByLabel('Keyword', { exact: true }).fill(NEW.toUpperCase());
    await page.getByRole('button', { name: 'Thêm keyword' }).click();
    await expect(page.getByText('Store này đã theo dõi keyword này.')).toBeVisible();

    await page.getByRole('button', { name: `Bỏ theo dõi ${NEW}` }).click();
    await expect(page.getByRole('link', { name: NEW, exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: MUG.keyword })).toBeVisible();
  } finally {
    await pool.query(`delete from keywords where lower(text) = lower($1)`, [NEW]);
    await pool.end();
  }
});

test.describe('without the keywords tick', () => {
  for (const who of ['viewer', 'saver', 'member'] as const) {
    test(`${who}: no nav entry, and the page is not found`, async ({ page }) => {
      await signIn(page, USERS[who].email);
      await expect(page.getByRole('link', { name: 'Keyword của store' })).toHaveCount(0);
      await page.goto('/store-keywords');
      await expect(page.getByText('Không tìm thấy trang')).toBeVisible();
    });
  }
});
