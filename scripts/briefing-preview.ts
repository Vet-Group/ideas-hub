// pnpm briefing:preview [--out file.md]: briefing sections 1–4 from SQL, as Markdown for the owner (plan
// Step 4). Uses the last completed scheduled run, as the 06:30 briefing will.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DEFAULT_SETTINGS, type Delta, type Settings } from '@ideas-hub/core';
import { type Db, createDb, createPool, databaseUrl } from '@ideas-hub/db/client';
import { settings as settingsTable } from '@ideas-hub/db';
import { type CountRow, hotKeywords, risingNewAds, risingShops, sourceRun, topTrendingAds } from '@ideas-hub/db/queries';

const adLink = (id: string) => `https://www.facebook.com/ads/library/?id=${id}`;
const cell = (s: string | null | undefined, n = 60) => (s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, n);

export function deltaLabel(d: Delta | null): string {
  if (!d) return '–';
  const sign = d.change > 0 ? `+${d.change}` : String(d.change);
  return d.partial ? `${sign} since ${d.baselineDay} (less than 7 days of data)` : `${sign} vs ${d.baselineDay}`;
}

const countTable = (title: string, head: string, rows: CountRow[]) =>
  [`## ${title}`, '', `| ${head} | Running ads | Change |`, '|---|---|---|', ...rows.map((r) => `| ${cell(r.label)} | ${r.runningAds} | ${deltaLabel(r.delta)} |`), ''].join('\n');

export async function renderPreview(db: Db, at: Date = new Date()): Promise<string> {
  const stored = await db.select().from(settingsTable);
  const s = { ...(DEFAULT_SETTINGS as unknown as Settings), ...Object.fromEntries(stored.map((r) => [r.key, r.value])) } as Settings;
  const run = await sourceRun(db, at);
  if (!run) return '# Briefing preview\n\nNo completed scheduled run yet.\n';
  const o = { staleAfterDays: s.staleAfterDays, countries: s.countries };
  const [top, rising, keywords, shops] = await Promise.all([topTrendingAds(db, run, o), risingNewAds(db, run, o), hotKeywords(db, run), risingShops(db, run, { nonShopDomains: s.nonShopDomains })]);
  return [
    '# Briefing preview (sections 1–4)',
    '',
    `Source run: ${run.id}, slot ${run.scheduledFor.toISOString()}, crawl day ${run.crawlDay} (Pacific).`,
    '',
    '## 1. Top trending ads',
    '',
    '| Ad | Page | Domain | Days active | Seen days | Score | Caption |',
    '|---|---|---|---|---|---|---|',
    ...top.map((a) => `| [${a.adArchiveId}](${adLink(a.adArchiveId)}) | ${cell(a.pageName, 30)} | ${cell(a.landingDomain, 30)} | ${a.daysActive} | ${a.seenDays} | ${a.trendScore} | ${cell(a.caption)} |`),
    '',
    '## 2. Rising new ads',
    '',
    '| Ad | Page | Domain | Started | Sightings | Best position | Caption |',
    '|---|---|---|---|---|---|---|',
    ...rising.map((a) => `| [${a.adArchiveId}](${adLink(a.adArchiveId)}) | ${cell(a.pageName, 30)} | ${cell(a.landingDomain, 30)} | ${a.startDate} | ${a.sightings} | ${a.bestPosition ?? '–'} | ${cell(a.caption)} |`),
    '',
    countTable('3. Hot keywords', 'Keyword', keywords),
    countTable('4. Rising shops and domains', 'Domain', shops),
  ].join('\n');
}

// Run as a script, not when a test imports renderPreview.
if (/briefing-preview\.ts$/.test(process.argv[1] ?? '')) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const pool = createPool(databaseUrl(), 2);
  try {
    const md = await renderPreview(createDb(pool));
    if (values.out) writeFileSync(values.out, md);
    else console.log(md);
  } finally {
    await pool.end();
  }
}
