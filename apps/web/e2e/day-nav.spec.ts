// Day navigation on the briefing pages, the invalid-date guard and the empty Ideas page (frozen "today": 2026-10-21).
import { type Page, expect, test } from '@playwright/test';
import { USERS, e2ePool } from './fixtures/seed';
import { expectA11yChecks } from './support/a11y';
import { expectNoSeriousAxe } from './support/axe';
import { freezeClock, signIn } from './support/session';

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
  await signIn(page, USERS.admin.email);
});

const nav = (page: Page) => page.getByRole('navigation', { name: 'Chuyển ngày briefing' });

// The briefing route streams behind its loading skeleton, so Next answers 200 for a notFound() here; the page is the 404 page.
test('impossible or malformed dates show the 404 page, not a server error', async ({ page }) => {
  for (const d of ['2026-13-45', '2026-02-29', '2026-00-10', '0000-01-01', 'not-a-date']) {
    await page.goto(`/briefing/${d}`);
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' }), d).toBeVisible();
    await expect(page.getByText('A server error occurred')).toHaveCount(0);
  }
  await page.goto('/briefing/2028-02-29');
  await expect(page.getByRole('heading', { name: 'Briefing ngày 29/02' })).toBeVisible();
});

test('today has a previous link and no next link', async ({ page }) => {
  for (const path of ['/briefing', '/briefing/2026-10-21']) {
    await page.goto(path);
    await expect(nav(page).getByRole('link', { name: '← Ngày trước' })).toHaveAttribute('href', '/briefing/2026-10-20');
    await expect(nav(page).getByRole('link', { name: 'Ngày sau →' })).toHaveCount(0);
  }
});

test('a past day links both ways and the day before today links next to /briefing', async ({ page }) => {
  await page.goto('/briefing/2026-10-19');
  await expect(nav(page).getByRole('link', { name: '← Ngày trước' })).toHaveAttribute('href', '/briefing/2026-10-18');
  await expect(nav(page).getByRole('link', { name: 'Ngày sau →' })).toHaveAttribute('href', '/briefing/2026-10-20');
  await nav(page).getByRole('link', { name: 'Ngày sau →' }).click();
  await expect(page.getByRole('heading', { name: 'Briefing ngày 20/10' })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Ngày sau →' })).toHaveAttribute('href', '/briefing');
});

test('a day without a briefing shows the empty state with the nav; a future day has no next @phone', async ({ page }) => {
  await page.goto('/briefing/2026-10-18');
  await expect(page.getByText('Không có briefing cho ngày 18/10.')).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Ngày sau →' })).toBeVisible();
  await expectNoSeriousAxe(page);
  await expectA11yChecks(page);
  await page.goto('/briefing/2026-10-30');
  await expect(page.getByText('Không có briefing cho ngày 30/10.')).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Ngày sau →' })).toHaveCount(0);
});

// A store without ideas exists only for these tests: every seeded store has some, and the table also empties by status.
const EMPTY_STORE = 'store_e2e_empty';
test.describe('the empty Ideas page', () => {
  test.beforeAll(async () => {
    const pool = e2ePool();
    await pool.query(`insert into stores (id, name) values ($1, 'Store Empty')`, [EMPTY_STORE]);
    await pool.end();
  });
  test.afterAll(async () => {
    const pool = e2ePool();
    await pool.query(`delete from stores where id = $1`, [EMPTY_STORE]);
    await pool.end();
  });

  for (const view of ['table', 'board']) {
    test(`the ${view} says where ideas come from and links to the briefing and Ads @phone`, async ({ page }) => {
      await page.goto(`/ideas?store=${EMPTY_STORE}&view=${view}`);
      await expect(page.getByText('Chưa có ý tưởng nào.')).toBeVisible();
      await expect(page.getByText('Ý tưởng được lưu từ briefing hằng ngày hoặc từ trang Ads.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Mở briefing' })).toHaveAttribute('href', '/briefing');
      await expect(page.getByRole('link', { name: 'Xem Ads' })).toHaveAttribute('href', '/ads');
      await expectNoSeriousAxe(page);
      await expectA11yChecks(page);
    });
  }
});
