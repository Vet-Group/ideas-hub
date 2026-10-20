// The real browser behind `BrowserSession`: system Chrome, a fresh logged-out context per start, one
// tab, in the mode settings name (headed, off-screen or headless).
import { type Browser, type BrowserServer, type LaunchOptions, type Page, type Response, chromium } from 'playwright';
import { isLoginWallUrl } from './detect';
import { EMBEDDED_MARKER } from './parse-embedded';
import { isPaginationRequest } from './parse-graphql';
import { type BrowserSession, type SearchPage, TransientError } from './search';

export type BrowserMode = 'headed' | 'offscreen' | 'headless';

export interface BrowserOptions {
  mode: BrowserMode;
  /** Settings `waitLimitsSeconds.browserStart`, in ms. */
  startTimeoutMs: number;
  /** Settings `waitLimitsSeconds.browserClose`, in ms. */
  closeTimeoutMs: number;
  /** Settings `proxy`; off (null) in phase 1. */
  proxy?: string | null;
  /** Counts a browser close that ran over its limit, after which the browser is killed. */
  onCloseTimeout?: () => void;
}

const OFFSCREEN_ARGS = [
  '--window-position=-32000,-32000',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

export function launchOptions(o: Pick<BrowserOptions, 'mode' | 'startTimeoutMs' | 'proxy'>): LaunchOptions {
  return {
    channel: 'chrome',
    headless: o.mode === 'headless',
    args: o.mode === 'offscreen' ? OFFSCREEN_ARGS : [],
    // Playwright 1.63.0 falls back to 180000 ms without it (playwright-core lib/coreBundle.js).
    timeout: o.startTimeoutMs,
    ...(o.proxy ? { proxy: { server: o.proxy } } : {}),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

async function poll<T>(read: () => Promise<T | null>, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  do {
    const v = await read();
    if (v !== null) return v;
    await sleep(250);
  } while (Date.now() < end);
  return null;
}

export class PlaywrightPage implements SearchPage {
  private pages: string[] = [];
  constructor(private page: Page) {
    page.on('response', (res: Response) => {
      if (!res.url().includes('/api/graphql') || !isPaginationRequest(res.request().postData())) return;
      void res.text().then(
        (t) => this.pages.push(t),
        () => this.pages.push(''),
      );
    });
  }

  async open(url: string, timeoutMs: number) {
    this.pages = [];
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (e) {
      if (/Timeout/i.test(String(e))) throw new TransientError('pageLoad', String(e));
      throw e;
    }
  }

  embeddedData(timeoutMs: number) {
    return poll(async () => {
      let text: string | null;
      try {
        text = await this.page.evaluate(
          (marker) => [...document.querySelectorAll('script')].map((s) => s.textContent ?? '').find((t) => t.includes(marker)) ?? null,
          EMBEDDED_MARKER,
        );
      } catch (e) {
        // Right after load the page navigates once on the client (the URL gains sort_data): an
        // expected redirect, not a transient error (docs/research/2026-10-20-fb-probe.md).
        if (/Execution context was destroyed/.test(String(e))) return null;
        throw e;
      }
      // A script still streaming in reads as truncated JSON (seen in the headless probe): poll again, and
      // at the limit it counts as embedded data that did not arrive (transient), not as a parse error.
      return text !== null && parsesAsJson(text) ? text : null;
    }, timeoutMs);
  }

  async loginWall() {
    return isLoginWallUrl(this.page.url()) || (await this.page.locator('input[name="email"], input[name="pass"]').count()) > 0;
  }

  async scroll(timeoutMs: number) {
    const before = this.pages.length;
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const arrived = await poll(async () => (this.pages.length > before ? true : null), timeoutMs);
    return arrived ? this.pages.splice(before) : null;
  }
}

export class PlaywrightSession implements BrowserSession {
  private server: BrowserServer | null = null;
  private browser: Browser | null = null;
  private current: PlaywrightPage | null = null;
  constructor(private o: BrowserOptions) {}

  /** Starts the browser; at run start a failure here is a run error (spec §1 "Failed run"). */
  async start() {
    // A server rather than launch(), so a browser that does not close in time can be killed. In 1.63.0
    // launchServer() does not stop at `timeout` (playwright.test.ts), so the start limit is raced here too.
    const launching = chromium.launchServer(launchOptions(this.o));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`browser start: Timeout ${this.o.startTimeoutMs}ms exceeded`)), this.o.startTimeoutMs);
    });
    try {
      this.server = await Promise.race([launching, limit]);
    } catch (e) {
      void launching.then((late) => late.kill(), () => {});
      throw e;
    } finally {
      clearTimeout(timer);
    }
    this.browser = await chromium.connect(this.server.wsEndpoint(), { timeout: this.o.startTimeoutMs });
    const context = await this.browser.newContext({ locale: 'en-US' });
    this.current = new PlaywrightPage(await context.newPage());
  }

  async page() {
    if (!this.current) await this.restart();
    return this.current!;
  }

  async restart() {
    await this.close();
    try {
      await this.start();
    } catch (e) {
      await this.close();
      throw new TransientError('browserStart', String(e));
    }
  }

  async close() {
    const { browser, server } = this;
    this.browser = null;
    this.server = null;
    this.current = null;
    if (!server) return;
    const outcome = await Promise.race([
      (async () => {
        await browser?.close();
        await server.close();
        return 'closed' as const;
      })().catch(() => 'error' as const),
      sleep(this.o.closeTimeoutMs).then(() => 'timeout' as const),
    ]);
    // Only a close over its limit is a wait-limit hit; a failed close is killed all the same.
    if (outcome === 'timeout') this.o.onCloseTimeout?.();
    if (outcome !== 'closed') await server.kill();
  }
}
