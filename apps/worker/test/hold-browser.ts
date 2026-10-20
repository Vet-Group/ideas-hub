// Starts the production browser session and holds it open, so scripts/windows/check-worker-loop.ps1 can
// check that ending the worker task leaves no Chrome process behind. Opens no page.
import { PlaywrightSession } from '@ideas-hub/fb-ad-library/playwright';

const session = new PlaywrightSession({ mode: 'headless', startTimeoutMs: 60_000, closeTimeoutMs: 15_000 });
await session.start();
console.log('browser started');
await new Promise(() => {});
