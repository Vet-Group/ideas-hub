// Step 7 briefing: the Lark link, the KPI row, saves from rows, the ad sheet and suggestions (AC 5), the
// briefing states and the keyword report's AI sections (AC 4).
import { type Page, expect, test } from '@playwright/test';
import { BRIEFINGS, MUG, STORES, SUGGESTIONS, USERS, e2ePool } from './fixtures/seed';
import { Actions } from './support/actions';
import { freezeClock, signIn } from './support/session';

test.beforeEach(async ({ page }) => freezeClock(page));
// Saves made here would change other specs' "last save" stores and dedupe results.
test.afterAll(async () => {
  const pool = e2ePool();
  await pool.query(`delete from saved_ideas where via = 'briefing'`);
  await pool.end();
});

const sql = async <T extends object>(text: string, params: unknown[] = []) => {
  const pool = e2ePool();
  try {
    return (await pool.query<T>(text, params)).rows;
  } finally {
    await pool.end();
  }
};
const savedBy = (ref: string) => sql<{ store_id: string; source: string; via: string }>(`select store_id, source, via from saved_ideas where source_ref = $1 order by store_id`, [ref]);
const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const row = (page: Page, panelName: string, text: string) => panel(page, panelName).getByRole('listitem').filter({ hasText: text });
const kpi = (page: Page, label: string) => page.getByRole('term').filter({ hasText: label }).locator('xpath=following-sibling::dd');
const toast = (page: Page, text: string) => page.locator('[data-sonner-toast]').filter({ hasText: text });

test('a Lark link opens the briefing it names with 0 actions on a valid session; KPI row and source run', async ({ page }) => {
  await signIn(page, USERS.member.email);
  const a = new Actions(page);
  await page.goto('/briefing/2026-10-21');
  await expect(page.getByRole('heading', { name: 'Briefing ngày 21/10' })).toBeVisible();
  expect(a.count).toBe(0);
  await expect(page.getByText('Từ run 01:00 ngày 21/10')).toBeVisible();
  await expect(kpi(page, 'Ads đang chạy')).toContainText('4210');
  await expect(kpi(page, 'Thay đổi')).toContainText('+312 ▲ so với 13/10');
  await expect(kpi(page, 'Search thành công')).toContainText('98.8%');
  await expect(kpi(page, 'Ngày lễ kế tiếp')).toContainText('10 ngày nữa: Halloween');
  // The landing page after sign-in is today's briefing, the same one.
  await page.goto('/briefing');
  // Sidebar badges: the shown briefing's date, and the store's New ideas (store A's seeded one).
  await expect(page.locator('[data-sidebar]').getByRole('link', { name: /^Briefing/ })).toContainText('21/10');
  await expect(row(page, 'Ads trend nhất', 'Best dog mom mug gift 1')).toBeVisible();
  await expect(panel(page, 'Gợi ý từ AI')).toContainText('halloween dog mom shirt');
  await expect(panel(page, 'Tin tức và ngày lễ')).toContainText('Người mua sắm dịp lễ bắt đầu sớm');
});

test('a save from a briefing row takes 1 action with one store and records via briefing', async ({ page }) => {
  await signIn(page, USERS.saver.email);
  const a = new Actions(page);
  await a.click(row(page, 'Ads trend nhất', 'Best dog mom mug gift 2').getByRole('button', { name: 'Lưu' }));
  await expect(toast(page, 'Đã lưu vào Store A')).toBeVisible();
  expect(a.count).toBe(1);
  expect(await savedBy('e2e_mug_2')).toEqual([{ store_id: STORES.a.id, source: 'ad', via: 'briefing' }]);
});

test('a save from the ad sheet of a briefing row records via briefing', async ({ page }) => {
  await signIn(page, USERS.saver.email);
  await row(page, 'Ads mới đang lên', 'Best dog mom mug gift 4').getByRole('link').click();
  await expect(page).toHaveURL(/\/briefing\?ad=e2e_mug_4$/);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Best dog mom mug gift 4')).toBeVisible();
  const a = new Actions(page);
  await a.click(sheet.getByRole('button', { name: 'Lưu' }));
  await expect(toast(page, 'Đã lưu vào Store A')).toBeVisible();
  expect(a.count).toBe(1);
  expect(await savedBy('e2e_mug_4')).toEqual([{ store_id: STORES.a.id, source: 'ad', via: 'briefing' }]);
});

test('with several stores a save from a briefing row or its ad sheet takes 2 actions (Lưu, Enter) and writes one row per store', async ({ page }) => {
  await signIn(page, USERS.admin.email);
  const both = [STORES.a.id, STORES.b.id].sort().map((store_id) => ({ store_id, source: 'ad', via: 'briefing' }));
  const created = page.getByRole('dialog').getByText('Đã lưu', { exact: true });
  try {
    // One save to A and B (B is pre-checked from the seed), so the next saves pre-check both stores.
    await row(page, 'Ads trend nhất', 'Best dog mom mug gift 1').getByRole('button', { name: 'Lưu' }).click();
    await page.getByRole('checkbox', { name: 'Store A' }).check();
    await page.keyboard.press('Enter');
    await expect(created).toHaveCount(2);
    expect(await savedBy('e2e_mug_1')).toEqual(both);
    await page.keyboard.press('Escape');

    const a = new Actions(page);
    await a.click(row(page, 'Ads trend nhất', 'Best dog mom mug gift 3').getByRole('button', { name: 'Lưu' }));
    await expect(page.getByRole('checkbox', { name: 'Store A' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Store B' })).toBeChecked();
    await a.press('Enter');
    await expect(created).toHaveCount(2);
    expect(a.count).toBe(2);
    expect(await savedBy('e2e_mug_3')).toEqual(both);
    await page.keyboard.press('Escape');

    await row(page, 'Ads mới đang lên', 'Best dog mom mug gift 5').getByRole('link').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Best dog mom mug gift 5')).toBeVisible();
    const s = new Actions(page);
    await s.click(sheet.getByRole('button', { name: 'Lưu' }));
    await expect(page.getByRole('checkbox', { name: 'Store A' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Store B' })).toBeChecked();
    await s.press('Enter');
    await expect(created).toHaveCount(2);
    expect(s.count).toBe(2);
    expect(await savedBy('e2e_mug_5')).toEqual(both);
  } finally {
    // Back to the seeded last save (store B only), which the suggestion test below relies on, even on a failure.
    await sql(`delete from saved_ideas where via = 'briefing' and created_by = $1`, [USERS.admin.id]);
  }
});

test('a save from a suggestion takes 1 action with one store; a second save opens the existing idea; CSV has the rows', async ({ page }) => {
  await signIn(page, USERS.saver.email);
  const suggestion = panel(page, 'Gợi ý từ AI').getByRole('listitem').filter({ hasText: 'Cốc "Dog Mom" in tên thú cưng' });
  const a = new Actions(page);
  await a.click(suggestion.getByRole('button', { name: 'Lưu' }));
  await expect(toast(page, 'Đã lưu vào Store A')).toBeVisible();
  expect(a.count).toBe(1);
  expect(await savedBy(SUGGESTIONS.idea)).toEqual([{ store_id: STORES.a.id, source: 'suggestion', via: 'briefing' }]);

  await suggestion.getByRole('button', { name: 'Lưu' }).click();
  const open = toast(page, 'Đã có sẵn').getByRole('button', { name: 'Mở' });
  await expect(open).toBeVisible();
  await open.click();
  await expect(page.getByRole('heading', { name: 'Cốc "Dog Mom" in tên thú cưng' })).toBeVisible();

  const csv = await (await page.request.get(`/ideas/csv?store=${STORES.a.id}`)).text();
  expect(csv).toContain('Cốc ""Dog Mom"" in tên thú cưng');
  expect(csv).toContain('Best dog mom mug gift 2');
});

test('with several stores a save from a suggestion takes 2 actions (Lưu, Enter)', async ({ page }) => {
  await signIn(page, USERS.admin.email);
  const a = new Actions(page);
  await a.click(panel(page, 'Gợi ý từ AI').getByRole('listitem').filter({ hasText: 'halloween dog mom shirt' }).getByRole('button', { name: 'Lưu' }));
  // The admin's last save created an idea in store B only (seed), so B is pre-checked.
  await expect(page.getByRole('checkbox', { name: 'Store B' })).toBeChecked();
  await a.press('Enter');
  await expect(page.getByRole('dialog').getByText('Đã lưu')).toBeVisible();
  expect(a.count).toBe(2);
  expect((await savedBy(SUGGESTIONS.keyword)).map((r) => r.via)).toEqual(['briefing']);
  // Undo, so the admin's last save stays the seeded one for the other specs.
  await toast(page, 'Đã lưu vào').getByRole('button', { name: 'Hoàn tác' }).click();
  await expect.poll(() => savedBy(SUGGESTIONS.keyword)).toEqual([]);
});

test('Briefing late and Before the ready time show the latest ready briefing with their banner', async ({ page }) => {
  await signIn(page, USERS.member.email);
  try {
    await sql(`update briefings set ready_at = null where id = $1`, [BRIEFINGS.today]);
    await page.goto('/briefing');
    // 08:30 is after the 07:00 ready time.
    await expect(page.getByRole('status').filter({ hasText: 'Briefing hôm nay chưa sẵn sàng, đang hiển thị bản 20/10' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Xem lại' })).toHaveAttribute('href', '/briefing');
    await expect(panel(page, 'Gợi ý từ AI')).toContainText('Chưa tạo được phần AI hôm nay');

    await sql(`insert into settings (key, value) values ('briefingReadyTime', '"09:00"'::jsonb) on conflict (key) do update set value = excluded.value`);
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'Đang hiển thị briefing ngày 20/10; bản hôm nay sẽ có trước 09:00' })).toBeVisible();
  } finally {
    await sql(`update briefings set ready_at = '2026-10-20T23:40:00Z' where id = $1`, [BRIEFINGS.today]);
    await sql(`update settings set value = '"07:00"'::jsonb where key = 'briefingReadyTime'`);
  }
});

test('a stored briefing whose thumbnail object was pruned shows the missing-thumbnail tile', async ({ page }) => {
  // Retention (ADR 0007) deletes the object but never rewrites a stored briefing, so its key stays.
  const setKey = (key: string) =>
    sql(`update briefings set sections = jsonb_set(sections, '{topAds,0,thumbnailKey}', to_jsonb($1::text)) where id = $2`, [key, BRIEFINGS.failed]);
  await signIn(page, USERS.member.email);
  try {
    await setKey('e2e_mug_pruned_image.jpg');
    await page.goto('/briefing/2026-10-20');
    const pruned = row(page, 'Ads trend nhất', 'Best dog mom mug gift 1');
    await expect(pruned.getByText('Chưa có ảnh')).toBeVisible();
    await expect(pruned.locator('img')).toHaveCount(0);
    await expect(row(page, 'Ads trend nhất', 'Best dog mom mug gift 2').locator('img')).toHaveJSProperty('complete', true);
  } finally {
    await setKey('e2e_mug_1_image.jpg');
  }
});

test('AI section failed and AI section skipped keep sections 1–4', async ({ page }) => {
  await signIn(page, USERS.member.email, `/login?callbackURL=${encodeURIComponent('/briefing/2026-10-20')}`);
  await expect(panel(page, 'Gợi ý từ AI')).toContainText('Chưa tạo được phần AI hôm nay');
  await expect(panel(page, 'Tin tức và ngày lễ')).toContainText('Chưa tạo được phần AI hôm nay');
  await expect(row(page, 'Ads trend nhất', 'Best dog mom mug gift 1')).toBeVisible();
  await page.goto('/briefing/2026-10-19');
  await expect(panel(page, 'Gợi ý từ AI')).toContainText('Bỏ qua: đã hết hạn mức AI hôm nay');
  await expect(panel(page, 'Keyword nóng')).toContainText(MUG.keyword);
});

test('keyword report AI sections: shown to a member of a tracking store and admins, hidden from others', async ({ page, browser }) => {
  await signIn(page, USERS.viewer.email, `/login?callbackURL=${encodeURIComponent(`/keywords/${MUG.keywordId}`)}`);
  const [{ n } = { n: '0' }] = await sql<{ n: string }>(`select count(*) as n from saved_ideas where store_id = $1 and status = 'new'`, [STORES.a.id]);
  await expect(page.locator('[data-sidebar]').getByRole('link', { name: /^Ý tưởng/ })).toHaveText(`Ý tưởng${n}`);
  await expect(page.getByRole('region', { name: 'Phần AI' })).toContainText('Bộ cốc đôi dog mom và dog dad');
  // The viewer has no `save`: no "Lưu" on the suggestion.
  await expect(page.getByRole('region', { name: 'Phần AI' }).getByRole('button', { name: 'Lưu' })).toHaveCount(0);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await freezeClock(other);
  await signIn(other, USERS.other.email, `/login?callbackURL=${encodeURIComponent(`/keywords/${MUG.keywordId}`)}`);
  await expect(other.getByRole('region', { name: 'Phần AI' })).toContainText('Bạn chưa có quyền xem phần AI của keyword này.');
  await expect(other.getByText('Bộ cốc đôi dog mom và dog dad')).toHaveCount(0);
  // Sections 1–4 stay visible to everyone.
  await expect(other.getByRole('region', { name: 'Ads trend nhất' })).toBeVisible();
  await ctx.close();
});
