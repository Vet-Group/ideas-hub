import { type Page, expect } from '@playwright/test';
import { E2E_FIXED_NOW } from '../fixtures/env';
import { PASSWORD } from '../fixtures/seed';

/** Freezes the browser clock at the server's fixed "now" (the harness's frozen clock). */
export async function freezeClock(page: Page) {
  await page.clock.setFixedTime(new Date(E2E_FIXED_NOW));
}

/** Signs in through the form; lands wherever the app sends the user. */
export async function signIn(page: Page, email: string, path = '/login') {
  await page.goto(path);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
