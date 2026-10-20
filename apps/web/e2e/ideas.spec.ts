// Step 6 ideas: status changes in the table and on the board, drag and keyboard moves, view-only members,
// store scope and the manual idea.
import { type Locator, type Page, expect, test } from '@playwright/test';
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
  await handle.focus();
  const a = new Actions(page);
  await a.press('Space');
  await a.press('ArrowLeft');
  await a.press('ArrowLeft');
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
    headers: { origin: 'http://localhost:3310' },
    multipart: { storeIds: STORES.a.id, image: { name: 'big.jpg', mimeType: 'image/jpeg', buffer: big } },
  });
  expect(r.status()).toBe(413);
  expect((await r.json()).error).toBe('Ảnh lớn hơn 5 MB');
});
