// Page-posts engagement probe (docs/plans/spike-page-posts-engagement.md): open each public page logged
// out, scroll at most 3 times, and record each post's reaction, comment and share counts.
//   node probe.mjs <pass-name> <pages-file>     pages-file: one page id per line
// Writes out/<pass-name>.jsonl (one line per page) and stops after 3 blocked pages in a row.
// Runs on the home PC only (plan "Where and how"), with system Chrome.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { extractPosts, extractPostsV1 } from './extract.mjs';

const [pass, pagesFile] = process.argv.slice(2);
const pages = readFileSync(pagesFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
mkdirSync('out', { recursive: true });
const outFile = `out/${pass}.jsonl`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let blockedInRow = 0;
for (const [i, pageId] of pages.entries()) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const bodies = [];
  page.on('response', async (r) => {
    if (!/\/api\/graphql/.test(r.url())) return;
    try {
      bodies.push(await r.text());
    } catch {
      // A body that is gone after navigation is skipped.
    }
  });
  const row = { pass, page_id: pageId, at: new Date().toISOString() };
  try {
    const res = await page.goto(`https://www.facebook.com/${pageId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    row.status = res?.status() ?? null;
    await sleep(6000);
    for (let k = 0; k < 3; k++) {
      await page.mouse.wheel(0, 2500);
      await sleep(4000);
    }
    row.final_url = page.url();
    row.title = await page.title();
    const loaded = (await page.content()) + bodies.join('\n');
    row.posts = extractPosts(loaded);
    // The pass-1 extractor on the same load, so the report can say how far pass 1 is trusted.
    row.posts_v1 = extractPostsV1(loaded);
  } catch (e) {
    row.error = String(e.message ?? e).slice(0, 300);
    row.posts = [];
  }
  // A page with no post read counts as blocked for the stop rule; analyze.mjs separates the two.
  row.blocked = !!row.error || row.status !== 200 || /\/login|checkpoint/.test(row.final_url ?? '') || row.posts.length === 0;
  appendFileSync(outFile, `${JSON.stringify(row)}\n`);
  console.log(`${i + 1}/${pages.length} ${pageId} status=${row.status} posts=${row.posts.length} blocked=${row.blocked}`);
  await ctx.close();
  blockedInRow = row.blocked ? blockedInRow + 1 : 0;
  if (blockedInRow >= 3) {
    appendFileSync(outFile, `${JSON.stringify({ pass, stopped: 'three blocked pages in a row', after: pageId })}\n`);
    break;
  }
  if (i < pages.length - 1) await sleep(60000 + Math.floor(Math.random() * 60000));
}
await browser.close();
