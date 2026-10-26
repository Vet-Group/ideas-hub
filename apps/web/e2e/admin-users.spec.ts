// The admin users page shows staff adoption of the briefing (AC 6 counting); members get a 404 (auth.spec.ts).
import { type Page, expect, test } from '@playwright/test';
import { hashPassword } from 'better-auth/crypto';
import { PASSWORD, STORES, USERS, e2ePool } from './fixtures/seed';
import { freezeClock, signIn } from './support/session';

test.beforeEach(async ({ page }) => freezeClock(page));

test('the admin sees last activity, briefing saves per member and n/10 per store', async ({ page }) => {
  const pool = e2ePool();
  try {
    // One briefing save by the member to store A after the pilot start, one by the admin (not counted).
    for (const [id, by] of [['idea_e2e_adopt_m', USERS.member.id], ['idea_e2e_adopt_a', USERS.admin.id]]) {
      await pool.query(
        `insert into saved_ideas (id, store_id, source, source_ref, via, title, created_by, created_at)
         values ($1, $2, 'manual', $1, 'briefing', 'Adoption', $3, '2026-10-30T01:00:00Z')`,
        [id, STORES.a.id, by],
      );
    }
    await signIn(page, USERS.admin.email);
    await page.goto('/admin/users');
    await expect(page.getByRole('columnheader', { name: 'Hoạt động gần nhất (ước tính)' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Member E2E/ }).getByRole('cell').nth(5)).toHaveText('1');
    await expect(page.getByRole('row', { name: /Admin E2E/ }).getByRole('cell').nth(5)).toHaveText('—');
    await expect(page.getByRole('row', { name: /Admin E2E/ }).getByRole('cell').nth(4)).not.toHaveText('Chưa đăng nhập');
    await expect(page.getByRole('row', { name: /^Store A/ })).toContainText('1/10');
    await expect(page.getByRole('row', { name: /^Store B/ })).toContainText('0/10');
    await expect(page.getByRole('row', { name: /^Tổng/ })).toContainText('1/30');
  } finally {
    await pool.query(`delete from saved_ideas where id like 'idea_e2e_adopt_%'`);
    await pool.end();
  }
});

const login = async (page: Page, email: string, password: string) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
};

test('the admin changes a member sign-in email and password; the old ones stop working', async ({ page, browser }) => {
  const pool = e2ePool();
  const id = 'user_e2e_login_edit';
  try {
    await pool.query(`insert into users (id, email, name, role) values ($1, 'old-login@e2e.test', 'Login Edit E2E', 'member')`, [id]);
    await pool.query(`insert into accounts (id, user_id, account_id, provider_id, password) values ($1, $2, $2, 'credential', $3)`, [`acct_${id}`, id, await hashPassword(PASSWORD)]);
    await signIn(page, USERS.admin.email);
    await page.goto('/admin/users');
    const row = page.getByRole('row', { name: /Login Edit E2E/ });
    await row.getByText('Sửa đăng nhập').click();
    await row.getByLabel('Email').fill('new-login@e2e.test');
    await row.getByLabel('Mật khẩu mới (để trống nếu giữ nguyên)').fill('new-login-pass-1');
    await row.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.getByRole('row', { name: /Login Edit E2E/ }).getByRole('cell').nth(1)).toHaveText('new-login@e2e.test');

    const other = await browser.newPage();
    await login(other, 'old-login@e2e.test', PASSWORD);
    await expect(other).toHaveURL(/\/login/);
    await login(other, 'new-login@e2e.test', 'new-login-pass-1');
    await expect(other).not.toHaveURL(/\/login/);
    await other.close();
  } finally {
    await pool.query(`delete from users where id = $1`, [id]);
    await pool.end();
  }
});
