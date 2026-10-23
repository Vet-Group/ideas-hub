// Phase 3 item 5: a member creates a personal API token on /account/tokens, calls /api/v1 with it (the proxy
// leaves /api/v1 out of the session check), then revokes it.
import { expect, test } from '@playwright/test';
import { STORES, USERS, e2ePool } from './fixtures/seed';
import { freezeClock, signIn } from './support/session';

test('a member creates a token, reads /api/v1 with it and revokes it', async ({ page, request }) => {
  await freezeClock(page);
  await signIn(page, USERS.viewer.email);
  await page.getByRole('link', { name: 'Tài khoản' }).first().click();
  await page.getByRole('link', { name: 'Token API' }).click();
  await expect(page).toHaveURL(/\/account\/tokens$/);
  await expect(page.getByText('Chưa có token nào.')).toBeVisible();

  await page.getByLabel('Tên token').fill('E2E reader');
  await page.getByLabel('Đọc briefing').uncheck();
  await page.getByRole('button', { name: 'Tạo token' }).click();
  const shown = page.getByRole('status').locator('code');
  await expect(shown).toHaveText(/^ihp_[0-9A-Za-z]{40}$/);
  const token = (await shown.textContent())!;

  // The listed row has no secret; a reload no longer shows the token.
  await page.reload();
  await expect(page.getByRole('status')).toHaveCount(0);
  const row = page.getByRole('row', { name: /E2E reader/ });
  await expect(row).toContainText('Đọc ý tưởng');
  await expect(row).toContainText('Đang dùng');
  await expect(row).toContainText('Chưa dùng');
  await expect(page.getByText(token)).toHaveCount(0);

  const bearer = { headers: { authorization: `Bearer ${token}` }, maxRedirects: 0 };
  const me = await request.get('/api/v1/me', bearer);
  expect(me.status()).toBe(200);
  expect((await me.json()).data).toMatchObject({ email: USERS.viewer.email, role: 'member', scopes: ['ideas:read'], stores: [{ id: STORES.a.id }] });
  // Scope: ideas yes, briefings no.
  const ideas = await request.get('/api/v1/ideas?limit=2', bearer);
  expect(ideas.status()).toBe(200);
  expect((await ideas.json()).data.every((i: { store_id: string }) => i.store_id === STORES.a.id)).toBe(true);
  expect((await request.get('/api/v1/briefings/latest', bearer)).status()).toBe(403);
  // Bearer only: no token is an error in the API's shape, not a redirect to /login, and the session cookie does not count.
  const none = await request.get('/api/v1/me', { maxRedirects: 0 });
  expect([none.status(), (await none.json()).error.code]).toEqual([401, 'unauthorized']);
  const cookieOnly = await page.request.get('/api/v1/me', { maxRedirects: 0 });
  expect(cookieOnly.status()).toBe(401);

  await page.reload();
  await expect(row).not.toContainText('Chưa dùng');
  await row.getByRole('button', { name: 'Thu hồi' }).click();
  await expect(row).toContainText('Đã thu hồi');
  expect((await request.get('/api/v1/me', bearer)).status()).toBe(401);

  const db = e2ePool();
  try {
    await db.query(`delete from api_tokens where user_id = $1`, [USERS.viewer.id]);
  } finally {
    await db.end();
  }
});

test('the Tokens page refuses a lifetime over 365 days', async ({ page }) => {
  await freezeClock(page);
  await signIn(page, USERS.viewer.email, '/login?callbackURL=%2Faccount%2Ftokens');
  await page.getByLabel('Tên token').fill('Too long');
  await page.getByLabel('Hết hạn sau (ngày, tối đa 365)').evaluate((el: HTMLInputElement) => {
    el.removeAttribute('max');
    el.value = '400';
  });
  await page.getByRole('button', { name: 'Tạo token' }).click();
  await expect(page.getByText('Số ngày phải từ 1 đến 365.')).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});
