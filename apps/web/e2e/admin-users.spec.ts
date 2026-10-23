// The admin users page shows staff adoption of the briefing (AC 6 counting); members get a 404 (auth.spec.ts).
import { expect, test } from '@playwright/test';
import { STORES, USERS, e2ePool } from './fixtures/seed';
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
