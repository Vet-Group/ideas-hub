import { defineConfig, devices } from '@playwright/test';
import { E2E_BUCKET, E2E_FIXED_NOW, E2E_PORT, e2eDatabaseUrl } from './e2e/fixtures/env';

// UX test harness (plan Step 5), reused by Steps 6 and 7: a built app on its own port and database,
// desktop (1440) and phone (390) projects, screenshots compared within 1% with animations off.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Approved baselines only (e2e/support/screens.ts); a run never writes one.
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}-{projectName}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    channel: 'chrome',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome', viewport: { width: 390, height: 844 } }, grep: /@phone/ },
  ],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --port ${E2E_PORT}`,
    port: E2E_PORT,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      APP_URL: `http://localhost:${E2E_PORT}`,
      IDEAS_HUB_FIXED_NOW: E2E_FIXED_NOW,
      // A test-only secret when the environment has none (CI); never a real one.
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'e2e-only-secret-not-for-real-use-0123456789',
      THUMB_URL_SECRET: 'e2e-only-thumb-secret-not-for-real-use-0123',
      S3_BUCKET: E2E_BUCKET,
    },
  },
});
