import AxeBuilder from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';

/** Fails on any serious or critical axe violation (AC 7); its color-contrast rule covers the muted text. */
export async function expectNoSeriousAxe(page: Page) {
  // After the sign-in redirect the new route briefly has only an empty <title> until its metadata streams in.
  await expect(page).toHaveTitle(/\S/);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)} (${n.failureSummary ?? ''})`).join(', ')}`)).toEqual([]);
}
