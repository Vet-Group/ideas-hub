// Step 1 block-rate probe (throwaway, deleted after Step 4's crawler ADR). Plain Playwright, system
// Chrome, a fresh logged-out profile per browser start, the spec's delays, backoff and limits. Writes one
// JSONL line per search plus one per run, the image URLs of each run for the expiry re-fetch, and the
// parser fixtures for Step 3. One probe at a time (out/probe.lock); a block stop writes
// out/blocked-until.txt and every later run waits out that 6 h cool-down first.
//
//   pnpm probe --modes headed,offscreen,headless --out out --fixtures fixtures
//   pnpm probe --modes offscreen --skip 29 --out out   (resume a run cut short: skips the first 29 pairs)
//   pnpm probe --refetch out/urls-<run>.jsonl --out out
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_SETTINGS, type Signal, createPacer } from '@ideas-hub/core';
import { type Browser, type Page, type Response, chromium } from 'playwright';

type Mode = 'headless' | 'offscreen' | 'headed';
type Outcome = 'ok' | 'no_results' | 'blocked' | 'network_error' | 'parse_error';

const S = DEFAULT_SETTINGS;
const W = S.waitLimitsSeconds;
// The plan's 10-keyword sample, all from packages/db/seed/seed-keywords.json.
const SAMPLE_KEYWORDS = [
  'custom t-shirt',
  'funny t-shirt',
  'personalized hoodie',
  'dog mom shirt',
  'teacher shirt',
  'nurse shirt',
  'personalized mug',
  'custom tumbler',
  'personalized ornament',
  'christmas gift shirt',
].join(',');
// A nonsense query, searched once per process, gives the "no results" fixture and marker.
const NO_RESULTS_QUERY = 'qzxvjk wplmrt tee';

const { values: args } = parseArgs({
  options: {
    modes: { type: 'string', default: 'headless' },
    keywords: { type: 'string', default: SAMPLE_KEYWORDS },
    countries: { type: 'string', default: 'US,GB,CA,AU' },
    out: { type: 'string', default: 'out' },
    fixtures: { type: 'string' },
    refetch: { type: 'string' },
    skip: { type: 'string', default: '0' },
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pacerDeps = { now: Date.now, random: Math.random };
mkdirSync(args.out!, { recursive: true });

class Transient extends Error {
  constructor(public kind: 'page_load' | 'embedded_data' | 'scroll_response' | 'browser_start' | 'other', message: string) {
    super(message);
  }
}

function isTransient(e: unknown): e is Error {
  if (e instanceof Transient) return true;
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /TimeoutError|Timeout \d+ms exceeded|net::ERR_|has been closed|Execution context was destroyed|Navigation|Target crashed/i.test(m);
}

// ---- payload parsing -------------------------------------------------------------------------

interface Connection {
  count?: number;
  edges: { node?: { collated_results?: Ad[] } }[];
  page_info?: { has_next_page?: boolean; end_cursor?: string };
}
interface Ad {
  ad_archive_id: string;
  snapshot?: {
    images?: { resized_image_url?: string }[];
    videos?: { video_preview_image_url?: string }[];
    cards?: { resized_image_url?: string; video_preview_image_url?: string }[];
  };
}

function find(o: unknown, key: string): Record<string, unknown> | null {
  if (!o || typeof o !== 'object') return null;
  if (key in o) return o as Record<string, unknown>;
  for (const v of Object.values(o)) {
    const hit = find(v, key);
    if (hit) return hit;
  }
  return null;
}

function parseJson(text: string): unknown {
  return JSON.parse(text.replace(/^for \(;;\);/, ''));
}

function readConnection(root: unknown) {
  const holder = find(root, 'search_results_connection');
  if (!holder) return null;
  const conn = holder.search_results_connection as Connection;
  const ads = (conn.edges ?? []).flatMap((e) => e.node?.collated_results ?? []).filter((a) => a?.ad_archive_id);
  const captcha = find(root, 'xfb_ad_library_is_captcha_required')?.xfb_ad_library_is_captcha_required === true;
  return { count: conn.count, hasNext: conn.page_info?.has_next_page, ads, captcha };
}

function imageUrls(ad: Ad): string[] {
  const s = ad.snapshot ?? {};
  return [
    ...(s.images ?? []).map((i) => i.resized_image_url),
    ...(s.videos ?? []).map((v) => v.video_preview_image_url),
    ...(s.cards ?? []).flatMap((c) => [c.resized_image_url, c.video_preview_image_url]),
  ].filter((u): u is string => !!u);
}

/** Fixtures without the prefetch list (signed profile-picture URLs nothing parses). */
function anonymise(text: string): string {
  const root = parseJson(text) as Record<string, unknown>;
  const strip = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    if ('extensions' in o) delete (o as Record<string, unknown>).extensions;
    Object.values(o).forEach(strip);
  };
  strip(root);
  return JSON.stringify(root, null, 1);
}

// ---- browser -----------------------------------------------------------------------------------

function launchOptions(mode: Mode) {
  const hidden = [
    '--window-position=-32000,-32000',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ];
  return {
    channel: 'chrome',
    headless: mode === 'headless',
    args: mode === 'offscreen' ? hidden : [],
    // Playwright 1.63.0 falls back to 180000 ms without it (plan Step 3).
    timeout: W.browserStart * 1000,
  };
}

class Session {
  browser: Browser | null = null;
  page: Page | null = null;
  restarts = 0;
  closeTimeouts = 0;
  constructor(private mode: Mode) {}

  async start() {
    this.browser = await chromium.launch(launchOptions(this.mode));
    this.page = await (await this.browser.newContext({ locale: 'en-US' })).newPage();
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    this.page = null;
    if (!b) return;
    const closed = await Promise.race([b.close().then(() => true), sleep(W.browserClose * 1000).then(() => false)]);
    // shortcut: a Browser from launch() exposes no process to kill; the hit is counted and the probe moves on.
    if (!closed) this.closeTimeouts += 1;
  }

  async restart() {
    await this.close();
    this.restarts += 1;
    try {
      await this.start();
    } catch (e) {
      throw new Transient('browser_start', String(e));
    }
  }
}

// ---- one search --------------------------------------------------------------------------------

interface AttemptResult {
  outcome: Outcome;
  signal: Signal;
  reason?: string;
  embeddedCount?: number;
  embeddedHasNext?: boolean;
  totalCount?: number;
  pagesRead: number;
  adsFound: number;
  lastHasNext?: boolean;
  stopReason?: 'end_of_results' | 'cap' | 'no_new_ads';
  emptyPayloads: number;
  repeatedAds: number;
  pageLoadMs?: number;
  embeddedMs?: number;
  scrollMs: number[];
  blockSigns: { captchaFlag: boolean; loginWall: boolean; url: string };
  urls: { ad: string; url: string }[];
  raw: { embedded?: string; pages: string[] };
}

const searchUrl = (q: string, country: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}` +
  `&is_targeted_country=false&media_type=all&q=${encodeURIComponent(q)}&search_type=keyword_unordered`;

async function waitFor(check: () => Promise<boolean> | boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(250);
  }
  return false;
}

async function attempt(page: Page, q: string, country: string, pacer: ReturnType<typeof createPacer>): Promise<AttemptResult> {
  const pages: string[] = [];
  const onResponse = async (res: Response) => {
    if (!res.url().includes('/api/graphql')) return;
    const name = new URLSearchParams(res.request().postData() ?? '').get('fb_api_req_friendly_name');
    if (name !== 'AdLibrarySearchPaginationQuery') return;
    pages.push(await res.text().catch(() => ''));
  };
  page.on('response', onResponse);
  const r: AttemptResult = {
    outcome: 'ok',
    signal: 'ok',
    pagesRead: 0,
    adsFound: 0,
    emptyPayloads: 0,
    repeatedAds: 0,
    scrollMs: [],
    blockSigns: { captchaFlag: false, loginWall: false, url: '' },
    urls: [],
    raw: { pages: [] },
  };
  const blocked = (reason: string, signal: Signal = 'blocked') => Object.assign(r, { outcome: 'blocked', signal, reason });
  try {
    const t0 = Date.now();
    try {
      await page.goto(searchUrl(q, country), { waitUntil: 'domcontentloaded', timeout: W.pageLoad * 1000 });
    } catch (e) {
      if (/Timeout/i.test(String(e))) throw new Transient('page_load', String(e));
      throw e;
    }
    r.pageLoadMs = Date.now() - t0;
    r.blockSigns.url = page.url();
    const wall = async () =>
      /\/login|\/checkpoint/.test(page.url()) || (await page.locator('input[name="email"], input[name="pass"]').count()) > 0;

    let embedded: string | undefined;
    const t1 = Date.now();
    const arrived = await waitFor(async () => {
      try {
        embedded = await page.evaluate(
          () => [...document.querySelectorAll('script')].map((s) => s.textContent ?? '').find((t) => t.includes('search_results_connection')),
        );
      } catch (e) {
        // After load the page navigates once on the client (the URL gains sort_data); keep waiting.
        if (/Execution context was destroyed/.test(String(e))) return false;
        throw e;
      }
      return !!embedded;
    }, W.embeddedData * 1000);
    r.embeddedMs = Date.now() - t1;
    r.blockSigns.loginWall = await wall();
    if (r.blockSigns.loginWall) return blocked('login_wall', 'captcha');
    if (!arrived || !embedded) throw new Transient('embedded_data', 'embedded data did not arrive');
    r.raw.embedded = embedded;

    let conn: ReturnType<typeof readConnection>;
    try {
      conn = readConnection(parseJson(embedded));
    } catch (e) {
      return Object.assign(r, { outcome: 'parse_error', signal: 'neutral', reason: `embedded: ${String(e).slice(0, 200)}` });
    }
    if (!conn) return Object.assign(r, { outcome: 'parse_error', signal: 'neutral', reason: 'no search_results_connection' });
    r.blockSigns.captchaFlag = conn.captcha;
    if (conn.captcha) return blocked('captcha', 'captcha');
    r.totalCount = conn.count;
    r.embeddedCount = conn.ads.length;
    if (conn.ads.length === 0) {
      if (conn.count === 0) return Object.assign(r, { outcome: 'no_results', signal: 'neutral', lastHasNext: false, embeddedHasNext: false });
      return blocked('empty_embedded');
    }

    const seen = new Set<string>();
    const add = (ads: Ad[]) => {
      let fresh = 0;
      for (const ad of ads) {
        if (seen.has(ad.ad_archive_id)) {
          r.repeatedAds += 1;
          continue;
        }
        if (seen.size >= S.adsPerSearchCap) break;
        seen.add(ad.ad_archive_id);
        fresh += 1;
        r.urls.push(...imageUrls(ad).map((url) => ({ ad: ad.ad_archive_id, url })));
      }
      return fresh;
    };
    add(conn.ads);
    let hasNext = conn.hasNext ?? (conn.count ?? 0) > seen.size;
    r.embeddedHasNext = hasNext;
    await sleep(pacer.pageDelayMs());

    let emptyInRow = 0;
    let noNewInRow = 0;
    for (;;) {
      if (!hasNext) {
        r.stopReason = 'end_of_results';
        break;
      }
      if (seen.size >= S.adsPerSearchCap) {
        r.stopReason = 'cap';
        break;
      }
      await sleep(pacer.scrollDelayMs());
      const before = pages.length;
      const t2 = Date.now();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      if (!(await waitFor(() => pages.length > before, W.scrollResponse * 1000))) {
        throw new Transient('scroll_response', 'no pagination response');
      }
      r.scrollMs.push(Date.now() - t2);
      // A scroll can bring more than one page; read all of them.
      for (const body of pages.splice(before)) {
        r.raw.pages.push(body);
        r.pagesRead += 1;
        let pc: ReturnType<typeof readConnection>;
        try {
          pc = readConnection(parseJson(body));
        } catch {
          pc = null;
        }
        if (!pc || pc.ads.length === 0) {
          // Empty payloads go to block detection only, never to the 2-page rule.
          r.emptyPayloads += 1;
          emptyInRow += 1;
          if (emptyInRow >= S.blockEmptyPayloadsInRow) {
            r.adsFound = seen.size;
            return blocked('empty_payloads');
          }
          continue;
        }
        emptyInRow = 0;
        if (pc.hasNext !== undefined) hasNext = pc.hasNext;
        noNewInRow = add(pc.ads) === 0 ? noNewInRow + 1 : 0;
      }
      if (noNewInRow >= S.noNewAdsPagesToStop) {
        r.stopReason = 'no_new_ads';
        break;
      }
    }
    r.adsFound = seen.size;
    r.lastHasNext = hasNext;
    // Until Step 1 decides, a 2-page stop with a next page left is neutral (spec §1 "Backoff").
    if (r.stopReason === 'no_new_ads' && hasNext) r.signal = 'neutral';
    return r;
  } finally {
    page.off('response', onResponse);
  }
}

// ---- runs --------------------------------------------------------------------------------------

async function runMode(mode: Mode, pairs: [string, string][], runLabel: string) {
  const resultsFile = join(args.out!, `results-${runLabel}.jsonl`);
  const urlsFile = join(args.out!, `urls-${runLabel}.jsonl`);
  const pacer = createPacer(S, pacerDeps);
  const session = new Session(mode);
  const runStart = Date.now();
  const deadline = runStart + S.runDeadlineMinutes * 60_000;
  const counts: Record<string, number> = {};
  let stop: string | null = null;
  let retries = 0;
  let pauseTotal = 0;
  let networkCooldowns = 0;
  let twoPageStopsWithNext = 0;
  const waitHits: Record<string, number> = {};
  let fixturesSaved = !args.fixtures;

  try {
    await session.start();
  } catch (e) {
    appendFileSync(resultsFile, JSON.stringify({ type: 'run', runLabel, mode, error: `browser_start: ${String(e)}` }) + '\n');
    return { stopped: 'run_failed' };
  }

  for (let i = 0; i < pairs.length; i++) {
    const [keyword, country] = pairs[i]!;
    if (stop || Date.now() >= deadline) {
      counts.skipped = (counts.skipped ?? 0) + 1;
      continue;
    }
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const errors: string[] = [];
    const retryWaitsMs: number[] = [];
    let result: AttemptResult | null = null;
    for (let a = 1; a <= S.attemptsPerSearch; a++) {
      try {
        if (!session.page) await session.restart();
        result = await attempt(session.page!, keyword, country, pacer);
        break;
      } catch (e) {
        if (!isTransient(e)) {
          result = {
            outcome: 'parse_error',
            signal: 'neutral',
            reason: String(e).slice(0, 300),
            pagesRead: 0,
            adsFound: 0,
            emptyPayloads: 0,
            repeatedAds: 0,
            scrollMs: [],
            blockSigns: { captchaFlag: false, loginWall: false, url: '' },
            urls: [],
            raw: { pages: [] },
          };
          break;
        }
        const kind = e instanceof Transient ? e.kind : 'other';
        waitHits[kind] = (waitHits[kind] ?? 0) + 1;
        errors.push(`${kind}: ${e.message.slice(0, 200)}`);
        if (a === S.attemptsPerSearch) break;
        const wait = S.retryDelaysSeconds[a - 1]! * 1000;
        retryWaitsMs.push(wait);
        retries += 1;
        await sleep(wait);
        await session.restart().catch((err) => errors.push(`restart: ${String(err).slice(0, 200)}`));
      }
    }
    const outcome: Outcome = result?.outcome ?? 'network_error';
    const signal: Signal = result?.signal ?? 'network';
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    if (result?.stopReason === 'no_new_ads' && result.lastHasNext) twoPageStopsWithNext += 1;

    const decision = pacer.record(signal);
    let pauseMs = 0;
    if (decision.kind === 'stop') stop = decision.reason;
    else pauseMs = decision.pauseMs;
    if (decision.kind === 'network_cooldown') networkCooldowns += 1;
    pauseTotal += pauseMs;

    const { raw, urls, ...rest } = result ?? ({} as AttemptResult);
    appendFileSync(
      resultsFile,
      JSON.stringify({
        type: 'search', runLabel, mode, keyword, country, startedAt, ...rest, outcome, signal,
        attempts: errors.length + (result ? 1 : 0), retryWaitsMs, errors, totalMs: Date.now() - t0,
        backoff: decision, blockStreak: pacer.blockStreak, networkStreak: pacer.networkStreak,
      }) + '\n',
    );
    for (const u of urls ?? []) {
      const oe = /[?&]oe=([0-9A-Fa-f]+)/.exec(u.url)?.[1];
      appendFileSync(urlsFile, JSON.stringify({ ...u, expires: oe ? new Date(parseInt(oe, 16) * 1000).toISOString() : null }) + '\n');
    }
    if (!fixturesSaved && outcome === 'ok' && raw?.embedded && raw.pages.length >= 2) {
      mkdirSync(args.fixtures!, { recursive: true });
      writeFileSync(join(args.fixtures!, 'embedded.json'), anonymise(raw.embedded));
      writeFileSync(join(args.fixtures!, 'pagination-1.json'), anonymise(raw.pages[0]!));
      writeFileSync(join(args.fixtures!, 'pagination-2.json'), anonymise(raw.pages[1]!));
      fixturesSaved = true;
    }
    if (args.fixtures && outcome === 'no_results' && raw?.embedded) {
      writeFileSync(join(args.fixtures, 'no-results.json'), anonymise(raw.embedded));
    }
    if (!stop && i < pairs.length - 1) await sleep(pacer.searchGapMs() + pauseMs);
  }
  await session.close();
  appendFileSync(
    resultsFile,
    JSON.stringify({
      type: 'run', runLabel, mode, startedAt: new Date(runStart).toISOString(), durationMs: Date.now() - runStart,
      planned: pairs.length, counts, stopped: stop, retries, browserRestarts: session.restarts, browserCloseTimeouts: session.closeTimeouts, waitHits,
      pauseTotalMs: pauseTotal, networkCooldowns, twoPageStopsWithNext,
    }) + '\n',
  );
  return { stopped: stop };
}

async function refetch(file: string) {
  const out = join(args.out!, file.replace(/^.*urls-/, 'refetch-').replace(/\.jsonl$/, `-${Date.now()}.jsonl`));
  const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { ad: string; url: string; expires: string | null });
  for (const row of rows) {
    let status = 0;
    let type: string;
    try {
      const res = await fetch(row.url, { signal: AbortSignal.timeout(W.thumbnailDownload * 1000) });
      status = res.status;
      type = res.headers.get('content-type') ?? '';
      await res.arrayBuffer();
    } catch (e) {
      type = String(e).slice(0, 100);
    }
    appendFileSync(out, JSON.stringify({ ...row, checkedAt: new Date().toISOString(), status, type }) + '\n');
    await sleep(200);
  }
  console.log('refetch written to', out);
}

const lockFile = join(args.out!, 'probe.lock');
const blockedFile = join(args.out!, 'blocked-until.txt');

function holdsLock(): boolean {
  if (existsSync(lockFile)) {
    const pid = Number(readFileSync(lockFile, 'utf8'));
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      // A stale lock from a probe that died.
    }
  }
  writeFileSync(lockFile, String(process.pid));
  return true;
}

if (args.refetch) {
  // Re-fetches read only CDN images and drive no browser, so they never wait for the lock.
  await refetch(args.refetch);
} else if (!holdsLock()) {
  appendFileSync(join(args.out!, 'skipped.jsonl'), JSON.stringify({ at: new Date().toISOString(), reason: 'another probe holds the lock', args }) + '\n');
  console.log('another probe is running; exiting');
} else {
  try {
    {
      const keywords = args.keywords!.split(',').map((k) => k.trim());
      const countries = args.countries!.split(',');
      const skip = Number(args.skip);
      const pairs: [string, string][] = keywords.flatMap((k) => countries.map((c): [string, string] => [k, c])).slice(skip);
      const modes = args.modes!.split(',') as Mode[];
      for (const [i, mode] of modes.entries()) {
        const blockedUntil = existsSync(blockedFile) ? Date.parse(readFileSync(blockedFile, 'utf8')) : 0;
        if (blockedUntil > Date.now()) {
          console.log('cool-down until', new Date(blockedUntil).toISOString());
          await sleep(blockedUntil - Date.now());
        }
        const runLabel = `${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}`;
        const list: [string, string][] = i === 0 && skip === 0 ? [...pairs, [NO_RESULTS_QUERY, countries[0]!]] : pairs;
        console.log(`run ${runLabel}: ${list.length} searches`);
        const { stopped } = await runMode(mode, list, runLabel);
        console.log(`run ${runLabel} ended`, stopped ?? 'normally');
        if (stopped && stopped !== 'run_failed') {
          writeFileSync(blockedFile, new Date(Date.now() + S.cooldownHours * 3_600_000).toISOString());
        }
      }
    }
  } finally {
    rmSync(lockFile, { force: true });
  }
}
