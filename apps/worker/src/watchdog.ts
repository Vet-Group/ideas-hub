// `pnpm watchdog`: one short-lived pass, started every 5 min by the OS timer, never by the worker.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { boot } from './boot';
import { loadSettings } from './context';
import { alertSender, larkConfigFromEnv, larkHttpClient } from './lark';
import { watchdogPass } from './watchdog-pass';

const run = promisify(execFile);
// Windows: the worker's Task Scheduler task (Step 4); Linux: the systemd user unit (Step 8).
const WORKER_TASK = process.env.IDEAS_HUB_WORKER_TASK ?? 'IdeasHub-Worker';

async function restartWorker() {
  if (process.platform === 'win32') {
    await run('schtasks', ['/End', '/TN', WORKER_TASK]).catch(() => {});
    await run('schtasks', ['/Run', '/TN', WORKER_TASK]);
  } else {
    await run('systemctl', ['--user', 'restart', 'ideashub-worker']);
  }
}

const ctx = await boot({ poolSize: 3 });
try {
  const lark = larkConfigFromEnv();
  if (!lark?.adminChat) ctx.log('watchdog: Lark is not configured, Alerts stay unsent on the admin page');
  const s = await loadSettings(ctx.db);
  const result = await watchdogPass(ctx, {
    restartWorker,
    sendAlert: lark?.adminChat ? alertSender(larkHttpClient(lark), lark.adminChat, s.larkSendTimeoutSeconds) : undefined,
    briefings: { sharedChat: lark?.sharedChat ?? null },
  });
  ctx.log('watchdog', result);
} finally {
  await ctx.stop();
}
