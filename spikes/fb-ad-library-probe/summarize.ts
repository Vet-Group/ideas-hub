// Summarises the probe's JSONL as Markdown for docs/research: per run outcomes, timings, waits and
// blocks, then the thumbnail re-fetches.   pnpm summarize --out out
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: { out: { type: 'string', default: 'out' } } });
const dir = args.out!;
const read = (f: string) =>
  readFileSync(join(dir, f), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any

const pct = (xs: number[], p: number) => {
  if (!xs.length) return '–';
  const s = [...xs].sort((a, b) => a - b);
  return String(Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!));
};

console.log('| Run | Mode | Searches | ok | no_results | blocked | network_error | parse_error | skipped | Success | Stopped | Duration |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
const all: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
for (const f of readdirSync(dir).filter((f) => f.startsWith('results-')).sort()) {
  const rows = read(f);
  const searches = rows.filter((r) => r.type === 'search');
  all.push(...searches);
  // A run cut off before its run line (the off-screen run of 2026-10-19, whose process was ended from outside):
  // counts, mode and start come from its search lines.
  const run = rows.find((r) => r.type === 'run') ?? { mode: searches[0]?.mode, startedAt: searches[0]?.startedAt };
  const c = run.counts ?? Object.fromEntries([...new Set(searches.map((s) => s.outcome))].map((o) => [o, searches.filter((s) => s.outcome === o).length]));
  const planned = run.planned ?? searches.length;
  const success = ((c.ok ?? 0) + (c.no_results ?? 0)) / planned;
  console.log(
    `| ${String(run.startedAt ?? f).slice(0, 16)} | ${run.mode ?? '?'} | ${planned} | ${c.ok ?? 0} | ${c.no_results ?? 0} | ${c.blocked ?? 0} | ${c.network_error ?? 0} | ${c.parse_error ?? 0} | ${c.skipped ?? 0} | ${(success * 100).toFixed(1)}% | ${run.stopped ?? (run.type ? 'no' : 'unfinished')} | ${run.durationMs ? `${Math.round(run.durationMs / 60_000)} min` : '–'} |`,
  );
}

const byMode = new Map<string, typeof all>();
for (const s of all) byMode.set(s.mode, [...(byMode.get(s.mode) ?? []), s]);
console.log('\n| Mode | Page load ms p50 / p95 | Embedded wait ms p50 / p95 | Scroll response ms p50 / p95 / max | Search total s p50 / p95 | Pages read p50 | Ads p50 | Stops: end / cap / no_new_ads | 2-page stops with next | Searches with repeated ads | Empty payloads | Attempts > 1 | Errors by kind |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [mode, ss] of byMode) {
  const scrolls = ss.flatMap((s) => s.scrollMs ?? []);
  const stops = (r: string) => ss.filter((s) => s.stopReason === r).length;
  const kinds: Record<string, number> = {};
  for (const e of ss.flatMap((s) => s.errors ?? [])) {
    const k = String(e).split(':')[0]!;
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  console.log(
    `| ${mode} | ${pct(ss.map((s) => s.pageLoadMs).filter(Number.isFinite), 50)} / ${pct(ss.map((s) => s.pageLoadMs).filter(Number.isFinite), 95)} | ${pct(ss.map((s) => s.embeddedMs).filter(Number.isFinite), 50)} / ${pct(ss.map((s) => s.embeddedMs).filter(Number.isFinite), 95)} | ${pct(scrolls, 50)} / ${pct(scrolls, 95)} / ${scrolls.length ? Math.max(...scrolls) : '–'} | ${pct(ss.map((s) => s.totalMs / 1000), 50)} / ${pct(ss.map((s) => s.totalMs / 1000), 95)} | ${pct(ss.map((s) => s.pagesRead), 50)} | ${pct(ss.map((s) => s.adsFound), 50)} | ${stops('end_of_results')} / ${stops('cap')} / ${stops('no_new_ads')} | ${ss.filter((s) => s.stopReason === 'no_new_ads' && s.lastHasNext).length} | ${ss.filter((s) => s.repeatedAds > 0).length} | ${ss.reduce((n, s) => n + (s.emptyPayloads ?? 0), 0)} | ${ss.filter((s) => s.attempts > 1).length} | ${JSON.stringify(kinds)} |`,
  );
}

const blocks = all.filter((s) => s.outcome === 'blocked');
console.log(`\nBlocked searches: ${blocks.length}`, blocks.map((b) => `${b.mode} ${b.keyword}/${b.country}: ${b.reason}`).join('; '));
const timeoutRuns = new Set(all.filter((s) => (s.errors ?? []).length).map((s) => s.runLabel));
const blockRuns = new Set(all.filter((s) => s.outcome === 'blocked' || s.emptyPayloads > 0 || s.blockSigns?.captchaFlag || s.blockSigns?.loginWall).map((s) => s.runLabel));
console.log(`Runs with transient errors: ${timeoutRuns.size}; with block signs: ${blockRuns.size}; with both: ${[...timeoutRuns].filter((r) => blockRuns.has(r)).length}`);
const noHasNext = all.filter((s) => s.outcome === 'ok' && s.embeddedHasNext === undefined).length;
console.log(`ok searches without a has-next signal in the embedded data: ${noHasNext}`);

for (const f of readdirSync(dir).filter((f) => f.startsWith('refetch-')).sort()) {
  const rows = read(f);
  const status: Record<string, number> = {};
  for (const r of rows) status[r.status] = (status[r.status] ?? 0) + 1;
  const expires = rows.map((r) => r.expires).filter(Boolean).sort();
  console.log(`\nRe-fetch ${f}: checked ${rows[0]?.checkedAt}, ${rows.length} URLs, status ${JSON.stringify(status)}, oe expiry ${expires[0]} … ${expires.at(-1)}`);
}
