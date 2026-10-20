// pnpm briefing:build [--date YYYY-MM-DD] [--fake-llm] [--feeds]: builds that day's briefings (the global
// one, then each active store-tracked keyword) in this process, as briefing.build would, without the
// queue or Lark posts. --fake-llm answers from cannedLlm, so no LLM is called; --feeds refreshes the RSS
// feeds first (a network fetch of every enabled feed).
import { parseArgs } from 'node:util';
import { vietnamDate } from '@ideas-hub/core';
import { boot } from './boot';
import { briefingJobsFor, buildBriefing } from './briefing';
import { cannedLlm, llmFromEnv } from './llm';
import { refreshFeeds } from './news';

const { values } = parseArgs({ options: { date: { type: 'string' }, 'fake-llm': { type: 'boolean', default: false }, feeds: { type: 'boolean', default: false } } });
const ctx = await boot({ poolSize: 2 });
try {
  const date = values.date ?? vietnamDate(new Date());
  const deps = {
    llm: values['fake-llm'] ? cannedLlm : llmFromEnv(),
    refreshFeeds: values.feeds ? (signal: AbortSignal) => refreshFeeds(ctx, { signal }).then((r) => console.log('feeds', r)) : undefined,
    sharedChat: null,
  };
  for (const job of await briefingJobsFor(ctx.db, date)) console.log(job.scope, job.keywordId ?? '', await buildBriefing(ctx, job, deps));
} finally {
  await ctx.stop();
}
