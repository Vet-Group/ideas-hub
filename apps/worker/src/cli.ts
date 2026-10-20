// pnpm crawl:run --keywords <k1,k2,…> --countries <US,GB,…> [--wait]
// A `cli` run through the same path as Run now (same limits, deadline and refusals); the worker runs it.
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { boot } from './boot';
import { loadSettings } from './context';
import { requestRun } from './manual';

const { values } = parseArgs({
  options: { keywords: { type: 'string' }, countries: { type: 'string' }, wait: { type: 'boolean', default: false } },
});
if (!values.keywords || !values.countries) {
  console.error('usage: pnpm crawl:run --keywords <k1,k2,…> --countries <US,GB,…> [--wait]');
  process.exit(2);
}
const texts = values.keywords.split(',').map((k) => k.trim()).filter(Boolean);
const countries = values.countries.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);

const ctx = await boot({ poolSize: 2 });
try {
  const { rows } = await ctx.db.execute<{ id: string; text: string }>(sql`
    select id, text from keywords where lower(text) = any(${sql.param(texts.map((t) => t.toLowerCase()))}::text[])`);
  const unknown = texts.filter((t) => !rows.some((r) => r.text.toLowerCase() === t.toLowerCase()));
  if (unknown.length) throw new Error(`unknown keywords: ${unknown.join(', ')} (seed them with pnpm db:seed)`);
  const ids = texts.map((t) => rows.find((r) => r.text.toLowerCase() === t.toLowerCase())!.id);
  const pairs = ids.flatMap((keywordId) => countries.map((country) => ({ keywordId, country })));
  const s = await loadSettings(ctx.db);
  const result = await requestRun(ctx.pool, ctx.boss, s, { trigger: 'cli', pairs, triggeredBy: null, now: new Date() });
  if (!result.ok) {
    const detail = result.blockedUntil ? ` until ${result.blockedUntil.toISOString()}` : result.reason === 'country_not_in_settings' ? ` (settings: ${s.countries.join(', ')})` : '';
    console.error(`refused: ${result.reason}${detail}`);
    process.exitCode = 1;
  } else {
    console.log(`run ${result.runId}: ${pairs.length} pairs requested, deadline ${result.deadline.toISOString()}`);
    if (values.wait) {
      for (;;) {
        await new Promise((r) => setTimeout(r, 15_000));
        const { rows: r } = await ctx.db.execute<{ status: string; planned_searches: number; done: number }>(sql`
          select status, planned_searches, (select count(*)::int from crawl_searches where run_id = ${result.runId} and status not in ('pending', 'running')) as done
          from crawl_runs where id = ${result.runId}`);
        console.log(`${r[0]!.status}: ${r[0]!.done}/${r[0]!.planned_searches} searches`);
        if (!['scheduled', 'running'].includes(r[0]!.status)) break;
      }
    }
  }
} finally {
  await ctx.stop();
}
