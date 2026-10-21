// The worker process: crash recovery, then the three queues, the scheduler every minute and the idle
// heartbeat timer. briefing.build and lark.send write no heartbeat; they are bounded by their timeouts
// and job.signal. Started by the Task Scheduler wrapper loop on Windows (Step 4), systemd on Linux.
import { QUEUE_POLL_SECONDS } from '@ideas-hub/core';
import { PlaywrightSession } from '@ideas-hub/fb-ad-library/playwright';
import { boot } from './boot';
import { loadSettings } from './context';
import { IdleHeartbeat, writeHeartbeat } from './heartbeat';
import { type BriefingDeps, buildBriefing } from './briefing';
import { larkClientFor, larkConfigFromEnv, larkSend } from './lark';
import { llmFromEnv } from './llm';
import { refreshFeeds } from './news';
import { BRIEFING, type BriefingJob, CRAWL, type CrawlJob, LARK, type LarkJob, createQueues } from './queues';
import { recoverAtStartup } from './recovery';
import { type RunDeps, runCrawl } from './run';
import { schedulerPass } from './schedule';
import { browserMode } from './browser-mode';

const ctx = await boot();
const settings = await loadSettings(ctx.db);
ctx.log('worker starting', await recoverAtStartup(ctx));
await createQueues(ctx.boss, settings);

const runDeps: RunDeps = {
  createSession: (s, onCloseTimeout) =>
    new PlaywrightSession({
      mode: browserMode(),
      startTimeoutMs: s.waitLimitsSeconds.browserStart * 1000,
      closeTimeoutMs: s.waitLimitsSeconds.browserClose * 1000,
      proxy: s.proxy,
      onCloseTimeout,
    }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
  fetch,
};

const idle = new IdleHeartbeat({ wip: () => ctx.boss.getWipData(), clock: ctx.clock, write: () => writeHeartbeat(ctx.db, ctx.clock) });
idle.start();

await ctx.boss.work<CrawlJob>(CRAWL, { localConcurrency: 1, batchSize: 1 }, async ([job]) => {
  // The idle timer stops while a crawl job runs, so a step that hangs stops the heartbeat.
  idle.stop();
  try {
    ctx.log('run', { runId: job!.data.runId, outcome: await runCrawl(ctx, job!.data.runId, runDeps) });
  } finally {
    idle.start();
  }
});

const lark = larkConfigFromEnv();
const briefingDeps: BriefingDeps = {
  llm: llmFromEnv(),
  refreshFeeds: (signal) => refreshFeeds(ctx, { signal }).then((r) => ctx.log('feeds', r)),
  sharedChat: lark?.sharedChat ?? null,
};
await ctx.boss.work<BriefingJob>(BRIEFING, { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: QUEUE_POLL_SECONDS }, async ([job]) => {
  ctx.log('briefing', { data: job!.data, outcome: await buildBriefing(ctx, job!.data, briefingDeps, job!.signal) });
});
const larkClient = lark ? larkClientFor(lark) : null;
await ctx.boss.work<LarkJob>(LARK, { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: QUEUE_POLL_SECONDS }, async ([job]) => {
  // Without the bot app or a webhook nothing can be posted; the watchdog still flags the global briefing (lark_send_failed).
  if (!larkClient) return ctx.log('lark: neither the bot app (LARK_APP_ID, LARK_APP_SECRET) nor LARK_WEBHOOK_URL is set, post skipped', { data: job!.data });
  ctx.log('lark', { data: job!.data, outcome: await larkSend(ctx, job!, { lark: larkClient, appUrl: process.env.APP_URL ?? '' }, job!.signal) });
});

const tick = () => schedulerPass(ctx).then((r) => r.problems.length || ctx.log('scheduler', r), (e) => ctx.log('scheduler error', { error: String(e) }));
// The next pass is timed from the end of the last one, so two passes never overlap.
let scheduler: NodeJS.Timeout | undefined;
let stopping = false;
const loop = async () => {
  await tick();
  if (!stopping) scheduler = setTimeout(() => void loop(), 60_000);
};
await loop();

const shutdown = async () => {
  stopping = true;
  clearTimeout(scheduler);
  idle.stop();
  await ctx.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
