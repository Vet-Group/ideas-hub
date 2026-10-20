// Step 6 ideas: status changes in the table and on the board, drag and keyboard moves, view-only members,
// store scope and the manual idea.
import { readFile } from 'node:fs/promises';
import { type Locator, type Page, expect, test } from '@playwright/test';
import { E2E_PORT } from './fixtures/env';
import { IDEAS, STORES, USERS, e2ePool } from './fixtures/seed';
import { Actions } from './support/actions';
import { freezeClock, signIn } from './support/session';

test.beforeEach(async ({ page }) => freezeClock(page));

const ideasUrl = (view: 'table' | 'board', status = 'new') => `/ideas?store=${STORES.a.id}&view=${view}&status=${status}`;
const statusOf = async (id: string) => {
  const pool = e2ePool();
  try {
    return (await pool.query<{ status: string }>(`select status from saved_ideas where id = $1`, [id])).rows[0]?.status;
  } finally {
    await pool.end();
  }
};
const setStatus = async (id: string, status: string) => {
  const pool = e2ePool();
  await pool.query(`update saved_ideas set status = $2 where id = $1`, [id, status]);
  await pool.end();
};
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** One drag is one action: press, move in steps past dnd-kit's 4 px activation, release. */
async function drag(page: Page, a: Actions, from: Locator, to: Locator) {
  a.count += 1;
  const f = (await from.boundingBox())!;
  const t = (await to.boundingBox())!;
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2 + 10, f.y + f.height / 2, { steps: 3 });
  await page.mouse.move(t.x + t.width / 2, t.y + 40, { steps: 10 });
  await page.mouse.up();
}

test('changing a status from its menu takes 2 actions in the table and on the board', async ({ page }) => {
  await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent(ideasUrl('table'))}`);
  const a = new Actions(page);
  await a.click(page.getByRole('button', { name: 'Đổi trạng thái: Mug with paw print' }));
  await a.click(page.getByRole('menuitemradio', { name: 'Picked' }));
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Đã chuyển sang Picked' })).toBeVisible();
  expect(a.count).toBe(2);
  expect(await statusOf(IDEAS.fresh)).toBe('picked');

  await page.goto(ideasUrl('board'));
  const b = new Actions(page);
  await b.click(column(page, 'Picked').getByRole('button', { name: 'Đổi trạng thái: Mug with paw print' }));
  await b.click(page.getByRole('menuitemradio', { name: 'Dropped' }));
  await expect(column(page, 'Dropped').getByText('Mug with paw print')).toBeVisible();
  expect(b.count).toBe(2);
  expect(await statusOf(IDEAS.fresh)).toBe('dropped');
  await setStatus(IDEAS.fresh, 'new');
});

test('a drag to another column takes 1 action', async ({ page }) => {
  await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent(ideasUrl('board'))}`);
  const a = new Actions(page);
  await drag(page, a, column(page, 'Picked').getByRole('button', { name: 'Dog mom tumbler', exact: true }), column(page, 'Done'));
  await expect(column(page, 'Done').getByText('Dog mom tumbler')).toBeVisible();
  expect(a.count).toBe(1);
  await expect.poll(() => statusOf(IDEAS.picked)).toBe('done');
  await setStatus(IDEAS.picked, 'picked');
});

test('a keyboard move takes 2 actions plus the columns crossed: Done back to New is 4', async ({ page }) => {
  await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent(ideasUrl('board'))}`);
  const handle = column(page, 'Done').getByRole('button', { name: 'Funny dog mom shirt', exact: true });
  // dnd-kit mounts its live region after hydration; each key waits for the previous key's announcement,
  // as a screen reader user would, so no press lands before the sensor or the drop rects are ready.
  const live = page.locator('[id^="DndLiveRegion"]');
  await expect(live).toBeAttached();
  await handle.focus();
  const a = new Actions(page);
  await a.press('Space');
  // The pick-up's own "over Done" replaces the start announcement at once.
  await expect(live).toHaveText('Funny dog mom shirt đang ở cột Done.');
  await a.press('ArrowLeft');
  await expect(live).toHaveText('Funny dog mom shirt đang ở cột Picked.');
  await a.press('ArrowLeft');
  await expect(live).toHaveText('Funny dog mom shirt đang ở cột New.');
  await a.press('Space');
  await expect(column(page, 'New').getByText('Funny dog mom shirt')).toBeVisible();
  expect(a.count).toBe(4);
  await expect.poll(() => statusOf(IDEAS.done)).toBe('new');
  await setStatus(IDEAS.done, 'done');
});

test('a view-only member sees no status menu in the table, and no menu and no drag on the board', async ({ page }) => {
  await signIn(page, USERS.viewer.email, `/login?callbackURL=${encodeURIComponent(ideasUrl('table'))}`);
  await expect(page.getByRole('link', { name: 'Mug with paw print' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Đổi trạng thái/ })).toHaveCount(0);
  await page.goto(ideasUrl('board'));
  await expect(column(page, 'New').getByText('Mug with paw print')).toBeVisible();
  await expect(page.getByRole('button', { name: /Đổi trạng thái/ })).toHaveCount(0);
  await expect(page.locator('[aria-roledescription]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ý tưởng mới' })).toHaveCount(0);
});

test('store scope: a member of store A gets 404 for store B’s ideas list and idea', async ({ page }) => {
  await signIn(page, USERS.viewer.email);
  expect((await page.goto(`/ideas?store=${STORES.b.id}`))?.status()).toBe(404);
  expect((await page.goto(`/ideas/${IDEAS.b}`))?.status()).toBe(404);
  expect((await page.goto(`/ideas/${IDEAS.fresh}`))?.status()).toBe(200);
});

test('a manual idea with a link from "Ý tưởng mới"; a 6 MB image is refused with its message', async ({ page }) => {
  await signIn(page, USERS.saver.email, `/login?callbackURL=${encodeURIComponent(ideasUrl('table'))}`);
  await page.getByRole('button', { name: 'Ý tưởng mới' }).click();
  await page.getByLabel('Link').fill('https://example.com/new-manual-idea');
  await page.getByRole('button', { name: 'Lưu ý tưởng' }).click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Đã lưu vào Store A' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'https://example.com/new-manual-idea' })).toBeVisible();

  const big = Buffer.alloc(6 * 1024 * 1024, 0xff);
  const r = await page.request.post('/api/ideas/manual', {
    headers: { origin: `http://localhost:${E2E_PORT}` },
    multipart: { storeIds: STORES.a.id, image: { name: 'big.jpg', mimeType: 'image/jpeg', buffer: big } },
  });
  expect(r.status()).toBe(413);
  expect((await r.json()).error).toBe('Ảnh lớn hơn 5 MB');
});

test('a manual idea from "Ý tưởng mới" is in the store’s CSV export with source and via manual (AC 5)', async ({ page }) => {
  const link = 'https://example.com/csv-manual-idea';
  try {
    await signIn(page, USERS.saver.email, `/login?callbackURL=${encodeURIComponent(ideasUrl('table'))}`);
    await page.getByRole('button', { name: 'Ý tưởng mới' }).click();
    await page.getByLabel('Link').fill(link);
    await page.getByRole('textbox', { name: 'Tiêu đề', exact: true }).fill('Áo "dog mom", làm tay');
    await page.getByRole('button', { name: 'Lưu ý tưởng' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Đã lưu vào Store A' })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Xuất CSV' }).click()]);
    expect(download.suggestedFilename()).toBe(`ideas-${STORES.a.id}-2026-10-21.csv`);
    const lines = (await readFile(await download.path(), 'utf8')).split('\r\n');
    expect(lines[0]).toBe('﻿id,title,status,source,source_ref,via,keyword,link,tags,notes,assignee,created_by,created_at,updated_at');
    const row = lines.filter((l) => l.includes(link));
    expect(row).toHaveLength(1);
    const esc = link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(row[0]).toMatch(new RegExp(`^idea_[^,]+,"Áo ""dog mom"", làm tay",new,manual,${esc},manual,,${esc},,,,Saver E2E,`));
  } finally {
    // The other ideas specs count store A's ideas, so the row goes even on a failure.
    const pool = e2ePool();
    await pool.query(`delete from saved_ideas where source_ref = $1`, [link]);
    await pool.end();
  }
});
