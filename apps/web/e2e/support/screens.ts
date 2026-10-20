// Screenshot baselines gate a step only after the owner approves them (plan Step 5). Until
// e2e/__screenshots__/APPROVED exists, a screenshot is written to e2e/__screenshots__/pending/<platform>/
// for review and attached to the report, and nothing is compared; afterwards toHaveScreenshot compares
// within 1% (playwright.config.ts).
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Locator, type Page, type TestInfo, expect } from '@playwright/test';

const DIR = fileURLToPath(new URL('../__screenshots__/', import.meta.url));
export const baselinesApproved = () => existsSync(join(DIR, 'APPROVED'));

export async function expectScreen(target: Page | Locator, name: string, info: TestInfo, opts: { fullPage?: boolean } = {}) {
  if (baselinesApproved()) {
    await expect(target).toHaveScreenshot(`${name}.png`, opts);
    return;
  }
  const dir = join(DIR, 'pending', process.platform);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}-${info.project.name}.png`);
  const shot = 'goto' in target ? await target.screenshot({ ...opts, animations: 'disabled', path }) : await target.screenshot({ animations: 'disabled', path });
  await info.attach(`${name}-pending-approval`, { body: shot, contentType: 'image/png' });
}
