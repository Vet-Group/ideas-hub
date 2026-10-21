// Layout checks behind the screenshot review of 2026-10-21: text that must not be clipped, the ad detail
// rows, and the phone layouts of spec §6 "Phones" (two-column ads grid, "Lưu" pinned in the bottom sheet,
// the ideas table as cards).
import { type Locator, type Page, expect, test } from '@playwright/test';
import { STORES, USERS, resetIdeas } from './fixtures/seed';
import { freezeClock, signIn } from './support/session';

test.beforeEach(async ({ page }) => freezeClock(page));

const open = (page: Page, path: string) => signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent(path)}`);
const box = async (l: Locator) => (await l.boundingBox())!;

test('the chart’s line-end label is not clipped @phone', async ({ page }) => {
  await open(page, '/keywords/kw_e2e_mug');
  const chart = page.locator('.recharts-surface').first();
  const label = chart.locator('text', { hasText: /^Ca 01:00$/ });
  await expect(label).toBeVisible();
  const [c, l] = [await box(chart), await box(label)];
  expect(l.x + l.width).toBeLessThanOrEqual(c.x + c.width);
});

test('the baseline label of hot keywords and rising shops fits its panel @phone', async ({ page }) => {
  await open(page, '/briefing');
  for (const name of ['Keyword nóng', 'Shop đang lên']) {
    const panel = page.getByRole('region', { name, exact: true });
    const label = panel.getByText('từ 17/10 (chưa đủ 7 ngày dữ liệu)');
    await expect(label).toBeVisible();
    const [p, l] = [await box(panel), await box(label)];
    expect(l.x + l.width, name).toBeLessThanOrEqual(p.x + p.width);
  }
});

test('the ad detail lists days running and days seen under their own labels @phone', async ({ page }) => {
  await open(page, '/ads/e2e_mug_1');
  const pane = page.getByRole('article', { name: 'Chi tiết ad' });
  const value = (term: string) => pane.getByRole('term').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
  await expect(value('Số ngày chạy')).toHaveText('2 ngày');
  await expect(value('Số ngày thấy')).toHaveText('3');
});

test('phone: the ads grid has two columns, and the bottom sheet pins "Lưu" and opens no tooltip @phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  await open(page, '/ads/e2e_mug_1');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const save = sheet.getByRole('button', { name: /^Lưu/ });
  await expect(save).toBeInViewport();
  const [s, b] = [await box(sheet), await box(save)];
  expect(s.y + s.height - (b.y + b.height)).toBeLessThan(32);
  await sheet.getByRole('button', { name: 'Đóng' }).click();
  const cards = page.getByRole('list').filter({ has: page.getByRole('link', { name: 'Best dog mom mug gift 6' }) }).getByRole('listitem');
  const [first, second] = [await box(cards.nth(0)), await box(cards.nth(1))];
  expect(second.y).toBe(first.y);
});

test('ideas table: the source is not repeated, and on a phone each idea is a card with its status menu @phone', async ({ page }, info) => {
  await resetIdeas();
  await open(page, `/ideas?store=${STORES.a.id}&view=table`);
  await expect(page.getByText('Thủ công · thủ công')).toHaveCount(0);
  await expect(page.getByText('Thủ công', { exact: true })).toBeVisible();
  if (info.project.name !== 'phone') return;
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đổi trạng thái: Mug with paw print' })).toBeInViewport();
});
