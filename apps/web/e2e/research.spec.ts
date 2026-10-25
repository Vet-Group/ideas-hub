// Step 6 research views: the ads grid and pane, saves, thumbnails, the keyword report and Run now.
import { type Page, expect, test } from '@playwright/test';
import sharp from 'sharp';
import { MUG, NON_SHOP_DOMAIN, STORES, USERS, e2ePool } from './fixtures/seed';
import { Actions } from './support/actions';
import { freezeClock, signIn } from './support/session';

test.beforeEach(async ({ page }) => freezeClock(page));

const card = (page: Page, caption: string) => page.getByRole('listitem').filter({ has: page.getByRole('link', { name: caption, exact: true }) });
const ideaRows = async (adId: string) => {
  const pool = e2ePool();
  try {
    return (await pool.query<{ id: string; store_id: string; via: string }>(`select id, store_id, via from saved_ideas where source_ref = $1 order by store_id`, [adId])).rows;
  } finally {
    await pool.end();
  }
};

test('opening an ad’s detail takes 1 action, and a direct link opens the pane', async ({ page }) => {
  await signIn(page, USERS.admin.email, '/login?callbackURL=%2Fads');
  const a = new Actions(page);
  await a.click(page.getByRole('link', { name: 'Best dog mom mug gift 3', exact: true }));
  await expect(page).toHaveURL(/\/ads\/e2e_mug_3$/);
  const pane = page.getByRole('complementary').getByRole('article', { name: 'Chi tiết ad' });
  await expect(pane.getByRole('heading', { name: 'Dog Mom Shop' })).toBeVisible();
  expect(a.count).toBe(1);
  await page.goto('/ads/e2e_mug_4');
  await expect(page.getByRole('complementary').getByText('Best dog mom mug gift 4')).toBeVisible();
});

test('a save with one store takes 1 action, without "Thêm store khác"; "Hoàn tác" removes the idea', async ({ page }) => {
  await signIn(page, USERS.saver.email, '/login?callbackURL=%2Fads');
  const a = new Actions(page);
  await a.click(card(page, 'Best dog mom mug gift 1').getByRole('button', { name: 'Lưu' }));
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Đã lưu vào Store A' });
  await expect(toast).toBeVisible();
  expect(a.count).toBe(1);
  await expect(toast.getByRole('button', { name: 'Thêm store khác' })).toHaveCount(0);
  expect(await ideaRows('e2e_mug_1')).toEqual([expect.objectContaining({ store_id: STORES.a.id, via: 'ads' })]);
  await toast.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Đã hoàn tác' })).toBeVisible();
  expect(await ideaRows('e2e_mug_1')).toEqual([]);
});

test('with several stores a save takes 2 actions (Lưu, Enter); results per store; undo keeps what the store had', async ({ page }) => {
  // The admin's last save created an idea in store B only (seed), so B is pre-checked.
  await signIn(page, USERS.admin.email, '/login?callbackURL=%2Fads');
  const a = new Actions(page);
  await a.click(card(page, 'Best dog mom mug gift 2').getByRole('button', { name: 'Lưu' }));
  await expect(page.getByRole('checkbox', { name: 'Store B' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Store A' })).not.toBeChecked();
  await a.press('Enter');
  await expect(page.getByRole('dialog').getByText('Đã lưu')).toBeVisible();
  expect(a.count).toBe(2);
  // The second save's toast names both stores; this one names B only.
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Đã lưu vào Store B', hasNotText: 'Store A' });
  await expect(toast.getByRole('button', { name: 'Thêm store khác' })).toBeVisible();
  const [b] = await ideaRows('e2e_mug_2');

  // Saved again with both stores: A is created, B already has it ("Đã có sẵn · Mở").
  await page.keyboard.press('Escape');
  await card(page, 'Best dog mom mug gift 2').getByRole('button', { name: 'Lưu' }).click();
  await page.getByRole('checkbox', { name: 'Store A' }).check();
  await page.getByRole('button', { name: 'Lưu', exact: true }).last().click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Đã có sẵn · Mở' })).toBeVisible();
  // Undo of this second save deletes only A's new idea, never B's.
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Store A' }).getByRole('button', { name: 'Hoàn tác' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Đã hoàn tác' })).toBeVisible();
  expect(await ideaRows('e2e_mug_2')).toEqual([expect.objectContaining({ id: b!.id, store_id: STORES.b.id })]);

  // After an undo, a link to the undone idea is a 404.
  await toast.getByRole('button', { name: 'Hoàn tác' }).click();
  await expect.poll(() => ideaRows('e2e_mug_2')).toEqual([]);
  const res = await page.goto(`/ideas/${b!.id}`);
  expect(res?.status()).toBe(404);
});

test('S typed in a filter field saves nothing; S on a focused card saves', async ({ page }) => {
  await signIn(page, USERS.saver.email, '/login?callbackURL=%2Fads');
  await page.getByLabel('Domain').click();
  await page.keyboard.press('s');
  await page.waitForTimeout(500);
  expect(await ideaRows('e2e_mug_3')).toEqual([]);
  await page.getByRole('link', { name: 'Best dog mom mug gift 3', exact: true }).focus();
  await page.keyboard.press('s');
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Đã lưu vào Store A' })).toBeVisible();
  expect(await ideaRows('e2e_mug_3')).toHaveLength(1);
  // Arrow keys move the focus between cards.
  await page.keyboard.press('ArrowRight');
  const focused = page.locator('a[href^="/ads/"]:focus');
  await expect(focused).toHaveCount(1);
  await expect(focused).not.toHaveAttribute('href', '/ads/e2e_mug_3');
});

test('Ctrl+K finds an ad by part of its caption, page name or domain', async ({ page }) => {
  await signIn(page, USERS.admin.email);
  for (const q of ['mug gift 5', 'Dog Mom Sh', 'dogmom.exa']) {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('Tìm ads, shop, keyword, màn hình…').fill(q);
    await expect(page.locator('[cmdk-group]').filter({ hasText: 'Ads' }).locator('[cmdk-item]').first()).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('thumbnails: next/image with a session, refused without; signed URL checks; sizes; the missing tile', async ({ page, browser }) => {
  await signIn(page, USERS.admin.email, '/login?callbackURL=%2Fads');
  const img = card(page, 'Best dog mom mug gift 1').locator('img');
  await expect(img).toHaveJSProperty('complete', true);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const src = (await img.getAttribute('src'))!;
  expect(new URL(src, page.url()).pathname).toBe('/_next/image');
  const thumb = new URL(src, page.url()).searchParams.get('url')!;
  expect(thumb).toMatch(/^\/thumbs\//);

  for (const [w, maxBytes] of [
    [320, 40_000],
    [640, 90_000],
  ] as const) {
    const r = await page.request.get(`/_next/image?url=${encodeURIComponent(thumb)}&w=${w}&q=75`, { headers: { accept: 'image/webp,image/*' } });
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toBe('image/webp');
    const body = await r.body();
    expect(body.length).toBeLessThanOrEqual(maxBytes);
    expect((await sharp(body).metadata()).width).toBeLessThanOrEqual(w);
  }
  const anon = await browser.newContext();
  expect((await anon.request.get(`/_next/image?url=${encodeURIComponent(thumb)}&w=320&q=75`)).status()).toBe(401);
  // /thumbs itself needs no session but a valid signature on that exact key.
  expect((await anon.request.get(thumb)).status()).toBe(200);
  const [, sig, key] = thumb.split('/').slice(1);
  for (const bad of [`/thumbs/${'0'.repeat(64)}/${key}`, `/thumbs/${sig!.slice(0, 40)}/${key}`, `/thumbs/${sig}/e2e_mug_2_image.jpg`, `/thumbs/${sig}/..%2F${key}`, `/thumbs/${sig}/a%2F${key}`]) {
    expect((await anon.request.get(bad)).status(), bad).toBe(404);
  }
  await anon.close();

  // A key without an object: the "Chưa có ảnh" tile, never a broken image.
  await expect(card(page, 'Best dog mom mug gift 6').getByText('Chưa có ảnh')).toBeVisible();
});

test('the ad status chips, with their tooltips', async ({ page }) => {
  await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent('/ads?status=all&domain=dogmom')}`);
  await expect(card(page, 'Best dog mom mug gift 1').getByRole('button', { name: 'Đang chạy' })).toBeVisible();
  const outOfTop = card(page, 'Old dog mom mug').getByRole('button', { name: 'Ngoài top' });
  await outOfTop.hover();
  await expect(page.getByRole('tooltip')).toContainText('giới hạn 100 ads');
});

test('the keyword report: chart with a gap and the table toggle, "Less than 7 days", and "No data yet"', async ({ page }) => {
  await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent(`/keywords/${MUG.keywordId}`)}`);
  await expect(page.getByText('Từ run 01:00 ngày 21/10')).toBeVisible();
  await expect(page.getByText('17 +8 ▲ từ 17/10 (chưa đủ 7 ngày dữ liệu)')).toBeVisible();
  await expect(page.locator('.recharts-line')).toHaveCount(2);
  await page.getByRole('button', { name: 'Bảng' }).click();
  // 19/10 has the 01:00 snapshot only (18:00 UTC on 18/10): the 13:00 cell is a gap.
  await expect(page.getByRole('row', { name: /19\/10/ })).toContainText('12');
  await expect(page.getByRole('row', { name: /19\/10/ })).toContainText('—');
  // A run that starts after midnight for the previous day's slot plots on the slot's date: 01:00 of 21/10.
  await expect(page.getByRole('row', { name: /21\/10/ })).toContainText('17');
  await page.goto(`/keywords/${MUG.keywordId}/2026-10-01`);
  await expect(page.getByText('Chưa có run nào xong. Run kế tiếp: 13:00')).toBeVisible();
});

// dog mom mug: 6 running ads on one shop, 2 started on 19/10 (within 7 days of the crawl day 20/10), none
// proven (20 days, 1 country, no variants), all images. 2 / 6 new is over 15%: "Mới nổi".
test('keywords read as markets: stage filter, market columns, phone cards; the report has the market read @phone', async ({ page }, info) => {
  await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent('/keywords')}`);
  const stages = page.getByRole('navigation', { name: 'Lọc theo giai đoạn' });
  await expect(stages.getByRole('link')).toHaveText(['Tất cả · 3', 'Mới nổi · 1', 'Có mẫu thắng · 0', 'Bình thường · 0']);
  await stages.getByRole('link', { name: 'Mới nổi · 1' }).click();
  await expect(page).toHaveURL(/\/keywords\?stage=rising$/);
  await expect(stages.getByRole('link', { name: 'Mới nổi · 1' })).toHaveAttribute('aria-current', 'page');
  if (info.project.name === 'phone') {
    const item = page.getByRole('listitem').filter({ hasText: 'dog mom mug' });
    await expect(item).toContainText('17 ads đang chạy · ads mới 7 ngày 33% · đã chứng minh 0% · 1 shop');
    await expect(page.getByRole('table')).toBeHidden();
  } else {
    const cells = page.getByRole('row', { name: /dog mom mug/ }).getByRole('cell');
    await expect(cells.nth(1)).toHaveText('Mới nổi');
    await expect(cells.nth(2)).toHaveText('17');
    await expect(cells.nth(3)).toHaveText('33% (2)');
    await expect(cells.nth(4)).toHaveText('0% (0)');
    await expect(cells.nth(5)).toHaveText('1');
    await expect(cells.nth(6)).toHaveText('100%');
    await expect(page.getByRole('row')).toHaveCount(2);
    // Without running ads to read, a keyword has no stage: a dash, in no stage filter.
    await page.getByRole('navigation', { name: 'Lọc theo giai đoạn' }).getByRole('link', { name: 'Tất cả · 3' }).click();
    await expect(page.getByRole('row', { name: /nurse shirt/ }).getByRole('cell').nth(1)).toHaveText('—');
    await stages.getByRole('link', { name: 'Mới nổi · 1' }).click();
    await expect(page).toHaveURL(/\/keywords\?stage=rising$/);
    // A market sort keeps the stage filter.
    await page.getByRole('link', { name: 'Đã chứng minh' }).click();
    await expect(page).toHaveURL(/\/keywords\?stage=rising&sort=proven$/);
  }
  await page.goto(`/keywords/${MUG.keywordId}`);
  const market = page.getByRole('region', { name: 'Đọc thị trường' });
  await expect(market.getByRole('button', { name: 'Mới nổi' })).toBeVisible();
  await expect(market.locator('dd')).toHaveText(['2 7 ngày trước đó: 0', '0 0% số ads', '1 Top 3 shop chạy 100% số ads', '0% 0 trên 6 ads']);
});

test('Run now: disabled with its reason for a running run, a cool-down and the margin; hidden without `keywords`', async ({ page, browser }) => {
  const pool = e2ePool();
  const path = `/keywords/${MUG.keywordId}`;
  await signIn(page, USERS.kw.email, `/login?callbackURL=${encodeURIComponent(path)}`);
  const button = page.getByRole('button', { name: 'Run now' });
  await expect(button).toBeEnabled();
  // The admin settings test may already have saved `runTimes`; both rows are put back as they were.
  const saved = await pool.query<{ value: unknown }>(`select value from settings where key = 'runTimes'`);
  const { rows: [state] } = await pool.query<{ blocked_until: Date | null }>(`select blocked_until from crawler_state where id = 1`);
  try {
    await pool.query(
      `insert into crawl_runs (id, source, trigger, triggered_by, status, planned_searches, deadline, started_at, requested_pairs)
       values ('run_e2e_running', 'fb_ad_library', 'manual', $1, 'running', 2, now() + interval '1 hour', now(), '[]'::jsonb)`,
      [USERS.admin.id],
    );
    await page.reload();
    await expect(button).toBeDisabled();
    await expect(page.getByText('Đang có run khác')).toBeVisible();
    await pool.query(`delete from crawl_runs where id = 'run_e2e_running'`);

    await pool.query(`update crawler_state set blocked_until = '2026-10-21T07:20:00Z' where id = 1`);
    await page.reload();
    await expect(button).toBeDisabled();
    await expect(page.getByText('Crawler đang nghỉ đến 14:20')).toBeVisible();
    await pool.query(`update crawler_state set blocked_until = $1 where id = 1`, [state!.blocked_until]);

    // The fixed clock is 08:30; a next slot at 08:45 puts it inside the 25 min margin.
    await pool.query(`insert into settings (key, value) values ('runTimes', '["01:00", "08:45"]'::jsonb) on conflict (key) do update set value = excluded.value`);
    await page.reload();
    await expect(button).toBeDisabled();
    await expect(page.getByText('Không còn đủ thời gian trước ca 08:45')).toBeVisible();
  } finally {
    await pool.query(`delete from crawl_runs where id = 'run_e2e_running'`);
    if (saved.rows[0]) await pool.query(`update settings set value = $1::jsonb where key = 'runTimes'`, [JSON.stringify(saved.rows[0].value)]);
    else await pool.query(`delete from settings where key = 'runTimes'`);
    await pool.query(`update crawler_state set blocked_until = $1 where id = 1`, [state!.blocked_until]);
    await pool.end();
  }
  const ctx = await browser.newContext();
  const saver = await ctx.newPage();
  await signIn(saver, USERS.saver.email, `/login?callbackURL=${encodeURIComponent(path)}`);
  await expect(saver.getByRole('heading', { name: MUG.keyword })).toBeVisible();
  await expect(saver.getByRole('button', { name: 'Run now' })).toHaveCount(0);
  await ctx.close();
});

test('the ads header shows shown / total, and a page link keeps the filters', async ({ page }) => {
  await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent('/ads?domain=dogmom&page=2')}`);
  await expect(page.getByText('0 / 6 ads')).toBeVisible();
  await page.getByRole('navigation', { name: 'Phân trang' }).getByRole('link', { name: 'Trang trước' }).click();
  await expect(page).toHaveURL(/\/ads\?domain=dogmom$/);
  await expect(page.getByText('6 / 6 ads')).toBeVisible();
  // "Gộp mẫu trùng" lands in the query with the other filters.
  await page.getByRole('checkbox', { name: 'Gộp mẫu trùng' }).click();
  await page.getByRole('button', { name: 'Lọc' }).click();
  await expect(page).toHaveURL(/domain=dogmom.*dedupe=1/);
  await expect(page.getByRole('checkbox', { name: 'Gộp mẫu trùng' })).toBeChecked();
});

test('without an ad open the grid has 3+ columns at 1440 px; the score is labelled; one dash per empty value', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the 1440 px grid');
  await signIn(page, USERS.admin.email, '/login?callbackURL=%2Fads');
  await expect(page.getByRole('main').getByRole('complementary')).toHaveCount(0);
  const lefts = await page.getByRole('listitem').filter({ has: page.locator('a[href^="/ads/"]') }).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBeGreaterThanOrEqual(3);

  const score = card(page, 'Best dog mom mug gift 3').getByRole('button', { name: 'Điểm 100' });
  await score.hover();
  await expect(page.getByRole('tooltip')).toContainText('số ngày chạy × số ngày thấy');
  // No dates and no score: the empty days are left out, the score shows the one dash.
  const empty = card(page, '50% off teacher shirt');
  await expect(empty.getByRole('button', { name: 'Điểm —' })).toBeVisible();
  expect(((await empty.innerText()).match(/[—–-]/g) ?? []).length).toBe(1);
});

test('the detail pane stays below the sticky header while the page scrolls', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the pane is a sheet on phones');
  await signIn(page, USERS.admin.email, '/login?callbackURL=%2Fads%2Fe2e_mug_3');
  const pane = page.getByRole('main').getByRole('complementary').locator('> div');
  await expect(pane.getByRole('article', { name: 'Chi tiết ad' })).toBeVisible();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  const header = (await page.locator('header').first().boundingBox())!;
  const box = (await pane.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('thumbnails of different ads look different', async ({ page }) => {
  await signIn(page, USERS.admin.email, '/login?callbackURL=%2Fads');
  const means: number[][] = [];
  for (const caption of ['Best dog mom mug gift 1', 'Best dog mom mug gift 2', 'Best dog mom mug gift 3']) {
    const src = (await card(page, caption).locator('img').getAttribute('src'))!;
    const r = await page.request.get(new URL(src, page.url()).toString());
    expect(r.status()).toBe(200);
    means.push((await sharp(await r.body()).stats()).channels.slice(0, 3).map((c) => c.mean));
  }
  // Every pair differs by more than 30 levels in at least one channel.
  for (let i = 0; i < means.length; i++) {
    for (let j = i + 1; j < means.length; j++) {
      expect(Math.max(...means[i]!.map((m, c) => Math.abs(m - means[j]![c]!)))).toBeGreaterThan(30);
    }
  }
});

test('shops: total shown, non-shop domains left out, the domain looks like a link, the count clears the date', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the table layout at 1440 px');
  await signIn(page, USERS.admin.email, '/login?callbackURL=%2Fshops');
  await expect(page.getByText('1 / 1 shop')).toBeVisible();
  await expect(page.getByRole('link', { name: NON_SHOP_DOMAIN })).toHaveCount(0);
  const link = page.getByRole('link', { name: MUG.domain });
  expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('underline');
  const row = page.getByRole('row', { name: new RegExp(MUG.domain) });
  const count = row.getByRole('cell').nth(1);
  expect(await count.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight))).toBeGreaterThanOrEqual(24);
  // The gap between the count's text and the date's text, measured on the text itself.
  const textBox = (cell: typeof count) =>
    cell.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const b = r.getBoundingClientRect();
      return { left: b.left, right: b.right };
    });
  const [countText, dateText] = [await textBox(count), await textBox(row.getByRole('cell').nth(2))];
  expect(dateText.left - countText.right).toBeGreaterThanOrEqual(24);
  expect((await page.getByRole('columnheader', { name: /Domain/ }).boundingBox())!.width).toBeGreaterThanOrEqual(224);
});

test('the run log shows the next 2 scheduled runs apart and lists the rest by when they ran, newest first', async ({ page }) => {
  const pool = e2ePool();
  // Created ahead like the scheduler does, after the finished runs: with created_at order they came first.
  const future = [
    ['run_e2e_next1', '2026-10-21T06:00:00Z'],
    ['run_e2e_next2', '2026-10-21T18:00:00Z'],
    ['run_e2e_later', '2026-11-07T06:00:00Z'],
  ];
  try {
    for (const [id, at] of future)
      await pool.query(
        `insert into crawl_runs (id, source, trigger, scheduled_for, status, planned_searches, deadline, created_at) values ($1, 'fb_ad_library', 'schedule', $2, 'scheduled', 160, $2, now())`,
        [id, at],
      );
    await signIn(page, USERS.admin.email, '/login?callbackURL=%2Fruns');
    await expect(page.getByText('Run kế tiếp: 13:00 21-10, 01:00 22-10')).toBeVisible();
    const rows = page.getByRole('row');
    await expect(rows.nth(1)).toContainText('manual');
    await expect(rows.nth(1).getByRole('cell').nth(2)).toHaveText('xong');
    await expect(page.getByRole('cell', { name: 'chờ chạy' })).toHaveCount(0);
  } finally {
    await pool.query(`delete from crawl_runs where id = any($1)`, [future.map(([id]) => id)]);
    await pool.end();
  }
});
