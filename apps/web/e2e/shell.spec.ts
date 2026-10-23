import { expect, test } from '@playwright/test';
import { USERS, e2ePool } from './fixtures/seed';
import { contrast, expectShortMotion } from './support/a11y';
import { signIn } from './support/session';

test.describe.configure({ mode: 'serial' });

test('a toast does not move under prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, USERS.admin.email);
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Lưu cài đặt' }).click();
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toBeVisible();
  const motion = await toast.evaluate((el) => {
    const longest = (v: string) => Math.max(...v.split(',').map((x) => parseFloat(x)));
    const cs = getComputedStyle(el);
    return { transition: longest(cs.transitionDuration), animation: longest(cs.animationDuration) };
  });
  // The global reduced-motion rule leaves 0.01 ms; sonner's own leaves none.
  expect(motion.transition).toBeLessThanOrEqual(0.00001);
  expect(motion.animation).toBeLessThanOrEqual(0.00001);
});

test('Geist is the body font and is loaded', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-geist-sans').trim();
    // Only Geist itself: the variable also names next/font's local() fallback, which is absent on Linux.
    const geist = family.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');
    // fonts.check() is also true when no face of that family exists at all, so look for a loaded face.
    const faces = [...document.fonts].filter((f) => f.family.replace(/^['"]|['"]$/g, '') === geist);
    return { family, body: getComputedStyle(document.body).fontFamily, loaded: faces.some((f) => f.status === 'loaded') };
  });
  // The custom property keeps its source quotes; the computed font-family normalizes them.
  const first = (v: string) => v.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');
  expect(r.family).not.toBe('');
  expect(first(r.body)).toBe(first(r.family));
  expect(r.loaded).toBe(true);
});

test('a default Button is ink, and a Sheet, its overlay, a Tooltip and a toast have a background', async ({ page }) => {
  await page.goto('/login');
  expect(await page.getByRole('button', { name: 'Đăng nhập' }).evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(28, 25, 23)');

  await signIn(page, USERS.admin.email);
  const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const transparent = ['rgba(0, 0, 0, 0)', 'transparent'];

  // Tooltip: a nav item of the collapsed sidebar.
  await page.getByRole('button', { name: 'Thu gọn thanh bên' }).click();
  await page.getByRole('link', { name: 'Run log' }).hover();
  await expect(page.locator('[data-slot=tooltip-content]')).toBeVisible();
  expect(transparent).not.toContain(await bg('[data-slot=tooltip-content]'));
  await page.getByRole('button', { name: 'Mở rộng thanh bên' }).click();

  // Toast: saving the settings.
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Lưu cài đặt' }).click();
  await expect(page.locator('[data-sonner-toast]')).toBeVisible();
  expect(transparent).not.toContain(await bg('[data-sonner-toast]'));
  await expectShortMotion(page);

  // Sheet: the phone tab bar's "Khác".
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/runs');
  await page.getByRole('button', { name: 'Khác' }).click();
  await expect(page.locator('[data-slot=sheet-content]')).toBeVisible();
  expect(transparent).not.toContain(await bg('[data-slot=sheet-content]'));
  expect(transparent).not.toContain(await bg('[data-slot=sheet-overlay]'));
  await expectShortMotion(page);
});

test('the collapsed sidebar survives a reload, and sidebar text passes contrast on its hover color', async ({ page }) => {
  await signIn(page, USERS.admin.email);
  await page.getByRole('button', { name: 'Thu gọn thanh bên' }).click();
  await page.reload();
  await expect(page.locator('aside[data-sidebar]')).toHaveAttribute('data-collapsed', 'true');
  await page.getByRole('button', { name: 'Mở rộng thanh bên' }).click();
  const [fg, hover, muted] = await page.evaluate(() => {
    const v = (n: string) => {
      const probe = document.createElement('div');
      probe.style.color = `var(${n})`;
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    return [v('--ih-sidebar-fg'), v('--ih-sidebar-hover-bg'), v('--ih-sidebar-fg-muted')];
  });
  expect(contrast(fg!, hover!)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(muted!, hover!)).toBeGreaterThanOrEqual(4.5);
});

test('Ctrl+K treats % and _ as plain characters, ranks the closer match first, and shows a member no admin screen', async ({ page, browser }) => {
  await signIn(page, USERS.admin.email);
  const search = async (p: typeof page, q: string) => {
    await p.keyboard.press('Control+k');
    const input = p.getByPlaceholder('Tìm ads, shop, keyword, màn hình…');
    await input.fill(q);
    await expect(p.locator('[cmdk-list]')).not.toContainText('Gõ ít nhất 3 ký tự');
    await p.waitForTimeout(400);
    const items = await p.locator('[cmdk-group]').evaluateAll((groups) =>
      groups.map((g) => ({ heading: g.querySelector('[cmdk-group-heading]')?.textContent, items: [...g.querySelectorAll('[cmdk-item]')].map((i) => i.textContent) })),
    );
    await p.keyboard.press('Escape');
    return items;
  };
  const pct = await search(page, '50%');
  expect(pct.find((g) => g.heading === 'Ads')?.items).toEqual([expect.stringContaining('50% off teacher shirt')]);
  const under = await search(page, 'e_s');
  expect(under.find((g) => g.heading === 'Ads')?.items).toEqual([expect.stringContaining('nurse_shirt bundle')]);
  const ranked = await search(page, 'teacher shirt');
  expect(ranked.find((g) => g.heading === 'Ads')?.items[0]).toContain('teacher shirt');
  expect(ranked.find((g) => g.heading === 'Ads')?.items[0]).not.toContain('50');
  const adminScreens = await search(page, 'cài');
  expect(adminScreens.find((g) => g.heading === 'Màn hình')?.items).toEqual(['Cài đặt']);

  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  await signIn(member, USERS.other.email);
  const memberScreens = await search(member, 'cài');
  expect(memberScreens.find((g) => g.heading === 'Màn hình')).toBeUndefined();
  await ctx.close();
});

test('Ctrl+K finds saved ideas only in the stores the user may view, and opens the idea', async ({ page, browser }) => {
  const ideaGroup = async (p: typeof page, q: string) => {
    await p.keyboard.press('Control+k');
    await p.getByPlaceholder('Tìm ads, shop, keyword, màn hình…').fill(q);
    await expect(p.locator('[cmdk-list]')).not.toContainText('Gõ ít nhất 3 ký tự');
    await p.waitForTimeout(400);
    return p.locator('[cmdk-group]').filter({ has: p.locator('[cmdk-group-heading]', { hasText: 'Ý tưởng' }) });
  };
  await signIn(page, USERS.admin.email);
  const group = await ideaGroup(page, 'tumbler');
  await expect(group.locator('[cmdk-item]')).toHaveText([/Dog mom tumbler/]);
  await group.locator('[cmdk-item]').click();
  await expect(page).toHaveURL(/\/ideas\/idea_e2e_picked$/);

  // "other" may view store B only: it finds B's idea, and nothing of store A.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, USERS.other.email);
  await expect(await ideaGroup(other, 'tumbler')).toHaveCount(0);
  await other.keyboard.press('Escape');
  await expect((await ideaGroup(other, 'Store B only')).locator('[cmdk-item]')).toHaveText([/Store B only idea/]);
  await ctx.close();
});

test('the attention bar is hidden on the Alerts page, and "Đã xử lý" on the last open Alert hides it elsewhere', async ({ page }) => {
  await signIn(page, USERS.admin.email);
  const bar = page.getByRole('status').filter({ hasText: 'alert chưa xử lý' });
  await page.goto('/admin/alerts');
  await expect(page.getByRole('button', { name: 'Đã xử lý', exact: true })).toBeVisible();
  await expect(bar).toHaveCount(0);
  await page.locator('a[href="/runs"]:visible').first().click();
  await expect(bar).toBeVisible();
  await page.goto('/admin/alerts');
  await page.getByRole('button', { name: 'Đã xử lý', exact: true }).click();
  await expect(page.getByText('Đã xử lý lúc')).toBeVisible();
  await page.goto('/runs');
  await expect(bar).toHaveCount(0);
});

test('the Alerts page shows a long detail in full and "Đánh dấu tất cả đã xử lý" resolves every open Alert', async ({ page }) => {
  const detail = `Ideas Hub conductor parked milestone ${'long-detail '.repeat(30)}end-marker`;
  const pool = e2ePool();
  try {
    for (const [id, d] of [['alert_e2e_long', detail], ['alert_e2e_short', 'short detail']]) {
      await pool.query(`insert into alerts (id, kind, detail, dedupe_key) values ($1, 'acceptance_failed', $2, $1)`, [id, d]);
    }
  } finally {
    await pool.end();
  }
  await signIn(page, USERS.admin.email);
  await page.goto('/admin/alerts');
  const cell = page.getByRole('cell', { name: /end-marker$/ });
  await expect(cell).toBeVisible();
  expect(await cell.evaluate((el) => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== 'ellipsis')).toBe(true);
  await page.getByRole('button', { name: 'Đánh dấu tất cả đã xử lý' }).click();
  await expect(page.getByRole('button', { name: 'Đã xử lý', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đánh dấu tất cả đã xử lý' })).toHaveCount(0);
  await expect(page.getByText('Đã xử lý lúc')).toHaveCount(3);
});
