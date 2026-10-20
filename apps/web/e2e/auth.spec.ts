import { expect, test } from '@playwright/test';
import { E2E_PORT } from './fixtures/env';
import { STORES, USERS, e2ePool } from './fixtures/seed';
import { signIn } from './support/session';

test.describe.configure({ mode: 'serial' });

test('admin gives a member save on store A; the member sees store A only and gets 404 elsewhere', async ({ page, browser }) => {
  await signIn(page, USERS.admin.email);
  await page.goto(`/admin/stores/${STORES.a.id}`);
  const add = page.locator('form', { has: page.getByRole('button', { name: 'Thêm thành viên' }) });
  await add.getByLabel('Người dùng').selectOption(USERS.member.id);
  await add.getByLabel('save').check();
  await add.getByRole('button', { name: 'Thêm thành viên' }).click();
  await expect(page.getByRole('cell', { name: /Member E2E/ })).toBeVisible();

  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  await signIn(member, USERS.member.email);
  await member.getByRole('button', { name: /Store/ }).click();
  await expect(member.getByRole('menuitem')).toHaveText([STORES.a.name]);
  for (const path of ['/admin/users', '/admin/settings', `/admin/stores/${STORES.b.id}`, `/ideas?store=${STORES.b.id}`]) {
    const res = await member.goto(path);
    expect(res?.status(), path).toBe(404);
  }
  await ctx.close();
});

test('a link opens its page with 0 actions on a valid session and is kept through sign-in', async ({ page }) => {
  await page.goto('/runs');
  await expect(page).toHaveURL(/\/login\?callbackURL=%2Fruns/);
  await signIn(page, USERS.admin.email, page.url());
  await expect(page).toHaveURL(/\/runs$/);
  // With a valid session the link alone shows the page: no redirect on the way and no click or key press.
  const res = await page.goto('/runs');
  expect(res?.status()).toBe(200);
  expect(res?.request().redirectedFrom()).toBeNull();
  await expect(page).toHaveURL(/\/runs$/);
  await expect(page.getByRole('heading', { name: 'Run log' })).toBeVisible();
});

for (const cb of ['//example.com', '/%09/example.com', 'https://example.com/x', '/..//example.com', '/.//example.com', '/%2e%2e//example.com']) {
  test(`a callback of ${cb} lands on /briefing`, async ({ page }) => {
    await signIn(page, USERS.admin.email, `/login?callbackURL=${encodeURIComponent(cb)}`);
    await expect(page).toHaveURL(/\/briefing$/);
  });
}

test('signing out ends the session and shows the sign-in page', async ({ page }) => {
  await signIn(page, USERS.admin.email);
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/runs');
  await expect(page).toHaveURL(/\/login\?callbackURL=%2Fruns/);
});

test('sign-up is disabled: the auth API refuses it and creates no user', async ({ request }) => {
  const email = 'signup-e2e@test.local';
  const res = await request.post('/api/auth/sign-up/email', {
    data: { email, password: 'a-long-enough-password-1', name: 'Sign-up E2E' },
    headers: { origin: `http://localhost:${E2E_PORT}` },
  });
  expect(res.status()).toBe(400);
  expect(await res.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
  const db = e2ePool();
  try {
    expect((await db.query('select 1 from users where email = $1', [email])).rows).toEqual([]);
  } finally {
    await db.end();
  }
});

test('the sign-in page loads its CSS, JS and fonts without a session', async ({ page }) => {
  const failed: string[] = [];
  const loaded = new Set<string>();
  page.on('response', (r) => {
    const t = r.request().resourceType();
    if (!['stylesheet', 'script', 'font'].includes(t)) return;
    if (r.ok()) loaded.add(t);
    else failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('/login');
  await page.evaluate(() => document.fonts.ready);
  expect(failed).toEqual([]);
  expect([...loaded].sort()).toEqual(['font', 'script', 'stylesheet']);
});

test('/shops/example.com without a session goes to /login', async ({ page }) => {
  await page.goto('/shops/example.com');
  await expect(page).toHaveURL(/\/login\?callbackURL=%2Fshops%2Fexample\.com$/);
});

test('a session moved back 2 days is extended by one full page load: expiresAt 7 days ahead, Max-Age 7 days', async ({ page }) => {
  await signIn(page, USERS.other.email);
  const db = e2ePool();
  try {
    await db.query(`update sessions set updated_at = now() - interval '2 days', expires_at = now() + interval '5 days' where user_id = $1`, [USERS.other.id]);
    const res = await page.goto('/runs');
    const cookie = (await res!.allHeaders())['set-cookie'] ?? '';
    expect(cookie).toMatch(/session_token=[^;]+;.*Max-Age=604800/i);
    const { rows } = await db.query<{ days: number }>(`select extract(epoch from expires_at - now()) / 86400 as days from sessions where user_id = $1`, [USERS.other.id]);
    expect(Number(rows[0]!.days)).toBeGreaterThan(6.99);
  } finally {
    await db.end();
  }
});

test('/_next/image is refused without a session and with a disabled user’s session', async ({ page, request }) => {
  const img = '/_next/image?url=%2Ffavicon.ico&w=64&q=75';
  expect((await request.get(img, { maxRedirects: 0 })).status()).toBe(401);
  await signIn(page, USERS.other.email);
  const db = e2ePool();
  try {
    await db.query(`update users set disabled = true where id = $1`, [USERS.other.id]);
    expect((await page.request.get(img, { maxRedirects: 0 })).status()).toBe(401);
  } finally {
    await db.query(`update users set disabled = false where id = $1`, [USERS.other.id]);
    await db.end();
  }
});
