import { type BrowserMode } from '@ideas-hub/fb-ad-library/playwright';

const MODES: readonly BrowserMode[] = ['headed', 'offscreen', 'headless'];
// The Step 1 probe's choice (docs/research/2026-10-20-fb-probe.md); IDEAS_HUB_BROWSER_MODE overrides it.
export const DEFAULT_BROWSER_MODE: BrowserMode = 'offscreen';

export function browserMode(env: string | undefined = process.env.IDEAS_HUB_BROWSER_MODE): BrowserMode {
  if (!env) return DEFAULT_BROWSER_MODE;
  if (!MODES.includes(env as BrowserMode)) throw new Error(`IDEAS_HUB_BROWSER_MODE must be one of ${MODES.join(', ')}`);
  return env as BrowserMode;
}
