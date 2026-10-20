// Real Chrome (the system channel, as in production): skipped where none is installed.
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { PlaywrightSession, launchOptions } from '../src/playwright';

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
    const server = (s as unknown as { server: { process(): { pid?: number; exitCode: number | null; killed: boolean } } }).server;
    const proc = server.process();
    await s.close();
    expect(hits).toBe(1);
    await new Promise((r) => setTimeout(r, 500));
    expect(proc.exitCode !== null || proc.killed).toBe(true);
  }, 60_000);
});
