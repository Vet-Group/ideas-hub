// Real Chrome (the system channel, as in production): skipped where none is installed.
import { type Page, chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { PlaywrightPage, PlaywrightSession, launchOptions } from '../src/playwright';

const hasChrome = await chromium
  .launch({ channel: 'chrome', headless: true })
  .then(async (b) => (await b.close(), true))
  .catch(() => false);

describe.skipIf(!hasChrome)('PlaywrightSession', () => {
  it('the browser start limit reaches Playwright as `timeout`, so a launch over it fails at that limit', async () => {
    await expect(chromium.launch(launchOptions({ mode: 'headless', startTimeoutMs: 1 }))).rejects.toThrow(/Timeout 1ms exceeded/);
  });

  it('a session whose browser does not start within the limit fails at the limit', async () => {
    const s = new PlaywrightSession({ mode: 'headless', startTimeoutMs: 1, closeTimeoutMs: 15_000 });
    await expect(s.start()).rejects.toThrow(/Timeout 1ms exceeded/);
    await expect(s.restart()).rejects.toMatchObject({ name: 'TransientError', kind: 'browserStart' });
  });

  it('a browser that does not close within its limit is killed and the hit counted', async () => {
    let hits = 0;
    const s = new PlaywrightSession({ mode: 'headless', startTimeoutMs: 60_000, closeTimeoutMs: 0, onCloseTimeout: () => void (hits += 1) });
    await s.start();
    const server = (s as unknown as { server: { process(): { exitCode: number | null; signalCode: string | null } } }).server;
    const proc = server.process();
    await s.close();
    expect(hits).toBe(1);
    await new Promise((r) => setTimeout(r, 500));
    // On Linux the killed browser exits by signal (exitCode null, signalCode SIGKILL); on Windows with a code.
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
  }, 60_000);
});

describe('PlaywrightPage embedded data', () => {
  // A stand-in for the Playwright Page: `evaluate` answers from a script, one step per poll.
  const pageOf = (steps: (string | Error)[]) => {
    let n = 0;
    const evaluate = async () => {
      const step = steps[Math.min(n++, steps.length - 1)]!;
      if (step instanceof Error) throw step;
      return step;
    };
    return { page: new PlaywrightPage({ on: () => {}, evaluate } as unknown as Page), calls: () => n };
  };
  const destroyed = new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
  const json = JSON.stringify({ data: { ad_library_main: {} } });

  it('polls again after "Execution context was destroyed" (the client-side redirect) and returns the JSON', async () => {
    const p = pageOf([destroyed, destroyed, json]);
    expect(await p.page.embeddedData(5_000)).toBe(json);
    expect(p.calls()).toBe(3);
  });

  it('a script still streaming in is polled until it parses; at the limit it is null, not a parse error', async () => {
    expect(await pageOf(['{"data":', json]).page.embeddedData(5_000)).toBe(json);
    expect(await pageOf(['{"data":']).page.embeddedData(300)).toBeNull();
  });

  it('any other evaluate error is thrown', async () => {
    await expect(pageOf([new Error('Target crashed')]).page.embeddedData(5_000)).rejects.toThrow('Target crashed');
  });
});
