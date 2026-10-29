// The `crawl.run` job (spec §1, plan Step 3): guarded start, planned searches, the search loop with
// backoff and cool-downs, upserts and thumbnails, then one final update with the run's snapshots.
import { RETRY_PER_SLOT, type Settings, type StopReason, createPacer, crawlDay, rotate } from '@ideas-hub/core';
import { type BrowserSession, type SearchResult, type WaitLimitHits, normalizeAd, runSearch } from '@ideas-hub/fb-ad-library';
import { adStatusQuery, shopDomainFilter } from '@ideas-hub/db/queries';
import { type Db, withTx } from '@ideas-hub/db/client';
import { sql } from 'drizzle-orm';
import { type Ctx, loadSettings } from './context';
import { sleepWithBeats, writeHeartbeat } from './heartbeat';
import { type ActivePair, activePairs, closeNotStarted, failRunningRun, insertAlert, markSearchRunning } from './runs';
import { downloadThumbnails } from './thumbnails';
import { missingThumbnails, upsertAds } from './upsert';

export interface RunSession extends BrowserSession {
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface RunDeps {
  createSession(s: Settings, onCloseTimeout: () => void): RunSession;
  sleep(ms: number): Promise<void>;
  random(): number;
  fetch: typeof fetch;
}

export type RunOutcome = 'noop' | 'done' | 'stopped' | 'dropped';

/** A guarded write found the run no longer `running` (the watchdog or recovery closed it). */
class Dropped extends Error {}

interface Planned {
  id: string;
  keywordId: string;
  text: string;
  country: string;
}

async function ensureRunning(db: Db, runId: string) {
  const { rows } = await db.execute(sql`select 1 from crawl_runs where id = ${runId} and status = 'running' for update`);
  if (rows.length === 0) throw new Dropped();
}

export async function runCrawl(ctx: Ctx, runId: string, deps: RunDeps): Promise<RunOutcome> {
  const now = () => ctx.clock.now();
  const startedAt = now();
  // One update from `scheduled` to `running`, only before the deadline and outside a cool-down.
  const { rows: startedRows } = await ctx.db.execute<{ trigger: string; requested_pairs: { keywordId: string; country: string }[] | null; deadline: Date; scheduled_for: Date | null }>(sql`
    update crawl_runs set status = 'running', started_at = ${startedAt}
    where id = ${runId} and status = 'scheduled' and ${startedAt} < deadline
      and not exists (select 1 from crawler_state where blocked_until > ${startedAt})
    returning trigger, requested_pairs, deadline, scheduled_for`);
  const run = startedRows[0];
  if (!run) {
    await closeNotStarted(ctx.db, runId, startedAt);
    return 'noop';
  }

  let session: RunSession | null = null;
  try {
    const s = await loadSettings(ctx.db);
    const deadline = new Date(run.deadline);
    const day = crawlDay(startedAt);
    const beat = () => writeHeartbeat(ctx.db, ctx.clock);
    await beat();

    const searches = await plan(ctx, runId, run, s);
    const counters = { twoPageStopsWithNext: 0, retries: 0, restarts: 0, waitLimitHits: {} as WaitLimitHits };
    const addHits = (h: WaitLimitHits) => {
      for (const [k, v] of Object.entries(h)) counters.waitLimitHits[k as keyof WaitLimitHits] = (counters.waitLimitHits[k as keyof WaitLimitHits] ?? 0) + v;
    };

    session = deps.createSession(s, () => addHits({ browserClose: 1 }));
    try {
      await session.start();
    } catch (e) {
      // A browser that does not start when the run starts is a run error (spec §1 "Failed run").
      await withTx(ctx.pool, (tx) => failRunningRun(tx.db, runId, now(), `browser_start: ${String(e)}`));
      return 'stopped';
    }

    const pacer = createPacer(s, { now: () => now().getTime(), random: deps.random });
    const sleep = (ms: number) => sleepWithBeats(ms, deps.sleep, beat);
    let stop: StopReason | null = null;
    let ran = 0;
    for (const [i, search] of searches.entries()) {
      if (now() >= deadline) break;
      if (!(await markSearchRunning(ctx.pool, runId, search.id, now()))) throw new Dropped();

      const res = await runSearch(search.text, search.country, {
        settings: s,
        session,
        pageDelayMs: pacer.pageDelayMs,
        scrollDelayMs: pacer.scrollDelayMs,
        sleep,
        beat,
        deadlinePassed: () => now() >= deadline,
      });
      ran += 1;
      counters.retries += res.retries;
      counters.restarts += res.browserRestarts;
      addHits(res.waitLimitHits);
      if (res.stopReason === 'no_new_ads' && res.lastHasNext) counters.twoPageStopsWithNext += 1;
      const decision = res.status === 'interrupted' ? null : pacer.record(res.signal);
      const ads = res.ads.map(normalizeAd);

      await withTx(ctx.pool, async ({ db }) => {
        await ensureRunning(db, runId);
        await upsertAds(db, { runId, keywordId: search.keywordId, country: search.country, crawlDay: day }, ads, s.nonShopDomains);
        await writeSearch(db, search.id, res, now());
        const at = now();
        if (res.status === 'blocked') await insertAlert(db, { kind: 'blocked', runId, detail: res.reason, at });
        if (res.status === 'parse_error') await insertAlert(db, { kind: 'parse_error', runId, detail: res.reason, at });
        if (decision?.kind === 'network_cooldown') {
          // The Alert is written in the transaction that increments the counter (one per cool-down).
          const { rows } = await db.execute<{ network_cooldowns: number }>(sql`
            update crawl_runs set network_cooldowns = network_cooldowns + 1 where id = ${runId} returning network_cooldowns`);
          await insertAlert(db, { kind: 'network_error', runId, cooldownSeq: rows[0]!.network_cooldowns, at });
        }
        if (decision?.kind === 'stop') {
          const until = new Date(at.getTime() + s.cooldownHours * 3_600_000);
          await db.execute(sql`update crawler_state set blocked_until = ${until} where id = 1`);
          await db.execute(sql`update crawl_runs set blocked_until = ${until}, block_reason = ${decision.reason} where id = ${runId}`);
          await insertAlert(db, { kind: 'blocked', runId, detail: decision.reason, at });
        }
      });
      await beat();
      if (res.status === 'interrupted') break;
      if (decision?.kind === 'stop') {
        stop = decision.reason;
        break;
      }

      // Thumbnails use the gap before the next search; after the last one, the shortest gap.
      const last = i === searches.length - 1;
      const gap = last ? s.searchGapSeconds.min * 1000 : pacer.searchGapMs();
      const gapStart = now().getTime();
      const thumbs = await downloadThumbnails(await missingThumbnails(ctx.db, ads), Math.min(gap, deadline.getTime() - gapStart), {
        store: ctx.store,
        fetch: deps.fetch,
        now: () => now().getTime(),
        beat,
        perImageMs: s.waitLimitsSeconds.thumbnailDownload * 1000,
      });
      if (thumbs.limitHits) addHits({ thumbnailDownload: thumbs.limitHits });
      for (const t of thumbs.stored) {
        await ctx.db.execute(sql`
          update ads set thumbnail_key = ${t.key} where ad_archive_id = ${t.adArchiveId}
            and exists (select 1 from crawl_runs where id = ${runId} and status = 'running')`);
      }
      if (!last) {
        const pause = decision?.pauseMs ?? 0;
        const rest = gap - (now().getTime() - gapStart) + pause;
        await sleep(Math.min(rest, deadline.getTime() - now().getTime()));
      }
    }

    const status = stop ? 'stopped' : 'done';
    // Closed before the final update, so a close over its limit is counted on the run.
    await session.close().catch(() => {});
    await withTx(ctx.pool, async ({ db }) => {
      await ensureRunning(db, runId);
      await db.execute(sql`update crawl_searches set status = 'skipped' where run_id = ${runId} and status = 'pending'`);
      const statusOf = adStatusQuery(day, s.staleAfterDays, s.countries);
      const { rows } = await db.execute<{ running: number; ok: number }>(sql`
        select (select count(*)::int from (${statusOf}) st where st.status = 'running') as running,
               (select count(*)::int from crawl_searches where run_id = ${runId} and status in ('ok', 'no_results')) as ok`);
      await db.execute(sql`
        update crawl_runs set status = ${status}, finished_at = ${now()},
          two_page_stops_with_next = ${counters.twoPageStopsWithNext}, transient_retries = ${counters.retries},
          browser_restarts = ${counters.restarts}, wait_limit_hits = ${JSON.stringify(counters.waitLimitHits)}::jsonb,
          running_ads = ${rows[0]!.running}, ok_searches = ${rows[0]!.ok}
        where id = ${runId} and status = 'running'`);
      await refreshShops(db, statusOf);
      if (run.trigger === 'schedule' && ran > 0) await writeSnapshots(db, statusOf, day, new Date(run.scheduled_for!), s.nonShopDomains);
    });
    return status;
  } catch (e) {
    if (e instanceof Dropped) return 'dropped';
    // An error outside a search (database, settings, code): the run is stopped with run_failed.
    ctx.log('run failed', { runId, error: String(e) });
    await withTx(ctx.pool, (tx) => failRunningRun(tx.db, runId, now(), String(e))).catch(() => {});
    return 'stopped';
  } finally {
    await session?.close().catch(() => {});
  }
}

/** Recomputes planned_searches from current settings and inserts that many `pending` searches. */
async function plan(
  ctx: Ctx,
  runId: string,
  run: { trigger: string; requested_pairs: { keywordId: string; country: string }[] | null; scheduled_for: Date | null },
  s: Settings,
): Promise<Planned[]> {
  return withTx(ctx.pool, async ({ db }) => {
    await ensureRunning(db, runId);
    const pairs = await activePairs(db, s);
    let chosen: ActivePair[];
    if (run.trigger === 'schedule') {
      const { rows } = await db.execute<{ rotation_cursor: number | null }>(sql`select rotation_cursor from crawler_state where id = 1 for update`);
      // Next-slot retry (AC-C1): failed searches of the last finished scheduled run go first. Only runs that
      // started count (a cool-down slot closed by the watchdog never starts); n = 2 is the run before it.
      const { rows: failed } = await db.execute<{ keyword_id: string; country: string; n: number }>(sql`
        select s.keyword_id, s.country, prev.n::int as n from crawl_searches s
        join (select id, block_reason, row_number() over (order by scheduled_for desc) as n from crawl_runs
              where trigger = 'schedule' and status in ('done', 'stopped') and started_at is not null and scheduled_for < ${run.scheduled_for}
              order by scheduled_for desc limit 2) prev on prev.id = s.run_id
        where s.status in ('blocked', 'network_error') or (prev.n = 1 and s.status = 'skipped' and prev.block_reason is not null)`);
      const keys = (n: number) => new Set(failed.filter((f) => f.n === n).map((f) => `${f.keyword_id}|${f.country}`));
      const [failedKeys, failedBefore] = [keys(1), keys(2)];
      // A pair that also failed in the run before is not retried again, so a failing pair cannot chain forever.
      const retries = pairs
        .filter((p) => failedKeys.has(`${p.keywordId}|${p.country}`) && !failedBefore.has(`${p.keywordId}|${p.country}`))
        .slice(0, Math.min(RETRY_PER_SLOT, s.searchBudget));
      const r = rotate(pairs, s.searchBudget - retries.length, Number(rows[0]?.rotation_cursor ?? 0));
      // A rotation pair already retried keeps its seat empty, so planned <= budget.
      const retried = new Set(retries);
      chosen = [...retries, ...r.pairs.filter((p) => !retried.has(p))];
      await db.execute(sql`update crawler_state set rotation_cursor = ${JSON.stringify(r.nextCursor)}::jsonb where id = 1`);
    } else {
      // The requested pairs still active, capped by the budget; never a full crawl.
      const active = new Map(pairs.map((p) => [`${p.keywordId}|${p.country}`, p]));
      chosen = (run.requested_pairs ?? [])
        .map((p) => active.get(`${p.keywordId}|${p.country}`))
        .filter((p): p is ActivePair => !!p)
        .slice(0, s.searchBudget);
    }
    await db.execute(sql`update crawl_runs set planned_searches = ${chosen.length} where id = ${runId}`);
    const planned: Planned[] = chosen.map((p) => ({ id: `srch_${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`, ...p }));
    for (const p of planned) {
      await db.execute(sql`insert into crawl_searches (id, run_id, keyword_id, country) values (${p.id}, ${runId}, ${p.keywordId}, ${p.country})`);
    }
    return planned;
  });
}

async function writeSearch(db: Db, id: string, r: SearchResult, at: Date) {
  await db.execute(sql`
    update crawl_searches set status = ${r.status}, embedded_count = ${r.embeddedCount}, embedded_has_next = ${r.embeddedHasNext},
      total_count = ${r.totalCount}, ads_found = ${r.ads.length}, pages_read = ${r.pagesRead}, last_has_next = ${r.lastHasNext},
      stop_reason = ${r.status === 'ok' ? r.stopReason : null}, reason = ${r.reason}, finished_at = ${at}
    where id = ${id}`);
}

/** Shop's running ad count (spec §2 "Shop"), refreshed with every run's final update. */
async function refreshShops(db: Db, statusOf: ReturnType<typeof adStatusQuery>) {
  await db.execute(sql`
    update shops set running_ads = coalesce(c.n, 0)
    from shops s2 left join (
      select landing_domain, count(*)::int as n from (${statusOf}) st where st.status = 'running' and landing_domain is not null group by landing_domain
    ) c on c.landing_domain = s2.landing_domain
    where shops.landing_domain = s2.landing_domain and shops.running_ads is distinct from coalesce(c.n, 0)`);
}

/** KeywordDay and ShopDay for the slot (spec §2), in the final run transaction. */
async function writeSnapshots(db: Db, statusOf: ReturnType<typeof adStatusQuery>, day: string, slot: Date, nonShopDomains: readonly string[]) {
  await db.execute(sql`
    insert into keyword_days (keyword_id, crawl_day, slot, running_ads)
    select k.id, ${day}::date, ${slot}, count(distinct st.ad_archive_id)::int
    from keywords k
    left join ad_sightings s on s.keyword_id = k.id
    left join (${statusOf}) st on st.ad_archive_id = s.ad_archive_id and st.status = 'running'
    where k.active group by k.id
    on conflict (keyword_id, crawl_day, slot) do update set running_ads = excluded.running_ads`);
  await db.execute(sql`
    insert into shop_days (landing_domain, crawl_day, slot, running_ads)
    select st.landing_domain, ${day}::date, ${slot}, count(*)::int from (${statusOf}) st
    where st.status = 'running' and st.landing_domain is not null and ${shopDomainFilter(sql`st.landing_domain`, nonShopDomains)} group by st.landing_domain
    on conflict (landing_domain, crawl_day, slot) do update set running_ads = excluded.running_ads`);
}
