// pnpm --filter @ideas-hub/web lcp:briefing [base-url]: the briefing's median LCP (spec AC 7, plan Step 8).
// System Chrome at 1440 px signs in, loads /briefing once to warm the caches, then 5 more times in the same
// browser context, and reads each load's largest-contentful-paint. Exits 1 when the median is 2500 ms or
// more. Base URL: the argument or IDEAS_HUB_LCP_URL; the account: IDEAS_HUB_LCP_EMAIL and
// IDEAS_HUB_LCP_PASSWORD (never arguments, so the password stays out of the shell history).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page, chromium } from '@playwright/test';

export const LCP_LIMIT_MS = 2500;
export const LOADS = 5;

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of no values');
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** AC 7: the median must be under the limit, so a median equal to it fails. */
export function lcpVerdict(values: readonly number[], limitMs = LCP_LIMIT_MS) {
  const m = median(values);
  return { median: m, pass: m < limitMs };
}

/** The last LCP candidate of the current navigation, once no new one has come for 1 s (cap 10 s). */
async function measureLcp(page: Page, url: string): Promise<number> {
  await page.goto(url, { waitUntil: 'load' });
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('not signed in: /briefing redirected to /login');
  return page.evaluate<number>(OBSERVE_LCP);
}

// A string, not a function: tsx (esbuild keepNames) wraps named functions in `__name`, which does not
// exist in the page.
const OBSERVE_LCP = `new Promise((done, fail) => {
  let last = -1;
  let quiet;
  const finish = () => {
    observer.disconnect();
    if (last < 0) fail(new Error('no largest-contentful-paint entry'));
    else done(last);
  };
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) last = e.startTime;
    clearTimeout(quiet);
    quiet = setTimeout(finish, 1000);
  });
  observer.observe({ type: 'largest-contentful-paint', buffered: true });
  quiet = setTimeout(finish, 1000);
  setTimeout(finish, 10000);
})`;

async function main() {
  const base = process.argv[2] ?? process.env.IDEAS_HUB_LCP_URL;
  const email = process.env.IDEAS_HUB_LCP_EMAIL;
  const password = process.env.IDEAS_HUB_LCP_PASSWORD;
  if (!base || !email || !password) {
    console.error('usage: IDEAS_HUB_LCP_EMAIL=… IDEAS_HUB_LCP_PASSWORD=… pnpm --filter @ideas-hub/web lcp:briefing <base-url>');
    process.exit(2);
  }
  const briefing = new URL('/briefing', base).toString();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
    const page = await context.newPage();
    await page.goto(new URL('/login', base).toString());
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    const warm = await measureLcp(page, briefing);
    console.log(`warm-up: ${Math.round(warm)} ms (not counted)`);
    const values: number[] = [];
    for (let i = 1; i <= LOADS; i++) {
      const v = await measureLcp(page, briefing);
      values.push(v);
      console.log(`load ${i}: ${Math.round(v)} ms`);
    }
    const { median: m, pass } = lcpVerdict(values);
    console.log(`median LCP: ${Math.round(m)} ms (${pass ? 'PASS' : 'FAIL'}, limit < ${LCP_LIMIT_MS} ms) at ${briefing}`);
    process.exitCode = pass ? 0 : 1;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
