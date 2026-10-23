// The Ideas list: keyword filter options, empty versus no-match states, the phone store select and labels.
import { type Page, expect, test } from '@playwright/test';
import { IDEAS, MUG, STORES, USERS, e2ePool, resetIdeas } from './fixtures/seed';
import { expectA11yChecks } from './support/a11y';
import { expectNoSeriousAxe } from './support/axe';
import { freezeClock, signIn } from './support/session';

test.beforeEach(async ({ page }) => {
  await resetIdeas();
  await freezeClock(page);
});

const open = (page: Page, path: string, email: string = USERS.admin.email) =>
  signIn(page, email, `/login?callbackURL=${encodeURIComponent(path)}`);

test('the keyword filter lists the keywords on the ideas of a store that tracks none, and filters by it', async ({ page }) => {
  // Store B tracks no keyword; its one idea carries the seed keyword in its snapshot.
  await open(page, `/ideas?store=${STORES.b.id}&view=table`);
  const select = page.getByLabel('Keyword', { exact: true });
  await expect(select.locator('option')).toHaveText(['Tất cả', MUG.keyword]);
  await select.selectOption(MUG.keyword);
  await page.getByRole('button', { name: 'Lọc' }).click();
  await expect(page).toHaveURL(/keyword=dog\+mom\+mug/);
  await expect(page.getByRole('link', { name: 'Store B only idea' })).toBeVisible();
});

test('a tab or filter with no match says so and links back; a store without ideas keeps the first-ideas hint @phone', async ({ page }) => {
  const pool = e2ePool();
  await pool.query(`insert into stores (id, name) values ('store_e2e_listempty', 'Store Listempty') on conflict do nothing`);
  await pool.end();
  try {
    await open(page, `/ideas?store=${STORES.a.id}&view=table&status=dropped`);
    await expect(page.getByText('Không có ý tưởng khớp.')).toBeVisible();
    await expect(page.getByText('Chưa có ý tưởng nào.')).toHaveCount(0);
    await expectNoSeriousAxe(page);
    await expectA11yChecks(page);
    await page.getByRole('link', { name: 'Xóa bộ lọc' }).click();
    await expect(page).toHaveURL((u) => u.pathname === '/ideas' && u.search === `?store=${STORES.a.id}&view=table`);
    await expect(page.getByRole('link', { name: 'Mug with paw print' }).filter({ visible: true })).toBeVisible();

    // A filter that matches nothing, on the board.
    await page.goto(`/ideas?store=${STORES.a.id}&view=board&keyword=no-such-keyword`);
    await expect(page.getByText('Không có ý tưởng khớp.')).toBeVisible();
    await expect(page.getByText('Chưa có ý tưởng nào.')).toHaveCount(0);
    await page.getByRole('link', { name: 'Xóa bộ lọc' }).click();
    await expect(page.getByRole('region', { name: 'New', exact: true }).getByText('Mug with paw print')).toBeVisible();

    // No ideas in the store at all, with or without a filter: still the first-ideas hint.
    for (const q of ['', '&keyword=x']) {
      await page.goto(`/ideas?store=store_e2e_listempty&view=table${q}`);
      await expect(page.getByText('Chưa có ý tưởng nào.')).toBeVisible();
      await expect(page.getByText('Không có ý tưởng khớp.')).toHaveCount(0);
    }
  } finally {
    const p = e2ePool();
    await p.query(`delete from stores where id = 'store_e2e_listempty'`);
    await p.end();
  }
});

test('the table shows the Asia/Ho_Chi_Minh day of the last change, also between 00:00 and 06:59 @phone', async ({ page }) => {
  // 2026-10-20 18:30 UTC is 01:30 on 21/10 in Ho Chi Minh City; the UTC date would read 20/10.
  const pool = e2ePool();
  await pool.query(`update saved_ideas set updated_at = '2026-10-20T18:30:00Z' where id = $1`, [IDEAS.fresh]);
  await pool.end();
  await open(page, `/ideas?store=${STORES.a.id}&view=table`);
  const row = page.locator('li, tr').filter({ visible: true }).filter({ hasText: 'Mug with paw print' });
  await expect(row).toContainText('21/10');
  await expect(row).not.toContainText('20/10');
});

test('a board card’s link names where it goes: the idea detail, with the title in its name', async ({ page }) => {
  await open(page, `/ideas?store=${STORES.a.id}&view=board`);
  await expect(page.getByText('Mở nguồn')).toHaveCount(0);
  const link = page.getByRole('link', { name: 'Chi tiết: Mug with paw print' });
  await expect(link).toHaveText('Chi tiết');
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${IDEAS.fresh}$`));
});

test('a phone switches store from the Ideas header; a desktop has the sidebar switcher instead @phone', async ({ page }, info) => {
  await open(page, `/ideas?store=${STORES.a.id}&view=table`);
  const select = page.getByRole('combobox', { name: 'Đổi store' });
  if (info.project.name !== 'phone') {
    await expect(select).toBeHidden();
    return;
  }
  await expect(select).toBeVisible();
  await expect(select).toHaveValue(STORES.a.id);
  await select.selectOption({ label: 'Store B' });
  await expect(page).toHaveURL((u) => u.pathname === '/ideas' && u.searchParams.get('store') === STORES.b.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ý tưởng · Store B');
  await expect(page.getByRole('link', { name: 'Store B only idea' })).toBeVisible();
  // The choice is the selected store for the next visit.
  await page.goto('/ideas');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ý tưởng · Store B');
  await expectNoSeriousAxe(page);
  await expectA11yChecks(page);
});

test('a member of one store has no store select on the Ideas page @phone', async ({ page }) => {
  await open(page, `/ideas?store=${STORES.a.id}&view=table`, USERS.viewer.email);
  await expect(page.getByRole('link', { name: 'Mug with paw print' }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Đổi store' })).toHaveCount(0);
});
