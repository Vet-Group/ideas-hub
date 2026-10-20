import { SEARCH_STATUSES } from '@ideas-hub/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { stores, users } from './accounts';
import { createdAt, id, oneOf, tstz } from './columns';

export const KEYWORD_ORIGINS = ['seed', 'store'] as const;
export const RUN_TRIGGERS = ['schedule', 'manual', 'cli'] as const;
export const RUN_STATUSES = ['scheduled', 'running', 'done', 'stopped', 'missed'] as const;
export const STOP_REASONS = ['end_of_results', 'cap', 'no_new_ads'] as const;
export const CLOSE_REASONS = ['not_started'] as const;

/** Keyword text is shared; which store tracks it lives only in store_keywords. */
export const keywords = pgTable(
  'keywords',
  {
    id: id('kw'),
    text: text('text').notNull(),
    origin: text('origin', { enum: KEYWORD_ORIGINS }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('keywords_text_key').on(sql`lower(${t.text})`), check('keywords_origin_check', oneOf(t.origin, KEYWORD_ORIGINS))],
);

export const storeKeywords = pgTable(
  'store_keywords',
  {
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    keywordId: text('keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.keywordId] })],
);

/** Per-wait limit hits of a run (spec §1 "Bounded waits"). */
export type WaitLimitHits = Partial<
  Record<'browserStart' | 'pageLoad' | 'embeddedData' | 'scrollResponse' | 'thumbnailDownload' | 'browserClose', number>
>;

export const crawlRuns = pgTable(
  'crawl_runs',
  {
    id: id('run'),
    source: text('source').notNull(),
    trigger: text('trigger', { enum: RUN_TRIGGERS }).notNull(),
    /** Slot time; scheduled runs only. KeywordDay and ShopDay use it as their slot. */
    scheduledFor: tstz('scheduled_for'),
    /** Admin-only: the user of a manual run. */
    triggeredBy: text('triggered_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: RUN_STATUSES }).notNull().default('scheduled'),
    /** Requested keyword × country pairs; manual and cli rows only. */
    requestedPairs: jsonb('requested_pairs').$type<{ keywordId: string; country: string }[]>(),
    plannedSearches: integer('planned_searches').notNull(),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    /** Stored when the row is inserted, before its job is sent. */
    deadline: tstz('deadline').notNull(),
    /** Id of its crawl.run job in pg-boss. */
    jobId: text('job_id'),
    blockedUntil: tstz('blocked_until'),
    blockReason: text('block_reason'),
    closeReason: text('close_reason', { enum: CLOSE_REASONS }),
    twoPageStopsWithNext: integer('two_page_stops_with_next').notNull().default(0),
    transientRetries: integer('transient_retries').notNull().default(0),
    browserRestarts: integer('browser_restarts').notNull().default(0),
    waitLimitHits: jsonb('wait_limit_hits').$type<WaitLimitHits>().notNull().default({}),
    networkCooldowns: integer('network_cooldowns').notNull().default(0),
    /** Written in the transaction of the run's final update. */
    runningAds: integer('running_ads'),
    okSearches: integer('ok_searches'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('crawl_runs_slot_key').on(t.source, t.scheduledFor).where(sql`${t.trigger} = 'schedule'`),
    uniqueIndex('crawl_runs_one_manual_key')
      .on(t.source)
      .where(sql`${t.trigger} in ('manual', 'cli') and ${t.status} in ('scheduled', 'running')`),
    check('crawl_runs_trigger_check', oneOf(t.trigger, RUN_TRIGGERS)),
    check('crawl_runs_status_check', oneOf(t.status, RUN_STATUSES)),
    check('crawl_runs_close_reason_check', oneOf(t.closeReason, CLOSE_REASONS)),
    check('crawl_runs_slot_check', sql`(${t.trigger} = 'schedule') = (${t.scheduledFor} is not null)`),
    check('crawl_runs_pairs_check', sql`${t.trigger} <> 'schedule' or ${t.requestedPairs} is null`),
  ],
);

export const crawlSearches = pgTable(
  'crawl_searches',
  {
    id: id('srch'),
    runId: text('run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    keywordId: text('keyword_id')
      .notNull()
      .references(() => keywords.id),
    country: text('country').notNull(),
    status: text('status', { enum: SEARCH_STATUSES }).notNull().default('pending'),
    embeddedCount: integer('embedded_count'),
    embeddedHasNext: boolean('embedded_has_next'),
    totalCount: integer('total_count'),
    adsFound: integer('ads_found').notNull().default(0),
    pagesRead: integer('pages_read').notNull().default(0),
    lastHasNext: boolean('last_has_next'),
    stopReason: text('stop_reason', { enum: STOP_REASONS }),
    /** Block reason or error text. */
    reason: text('reason'),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    uniqueIndex('crawl_searches_pair_key').on(t.runId, t.keywordId, t.country),
    // Ad status looks up the searches of an ad's (keyword, country) pairs.
    index('crawl_searches_keyword_country_idx').on(t.keywordId, t.country),
    check('crawl_searches_status_check', oneOf(t.status, SEARCH_STATUSES)),
    check('crawl_searches_stop_reason_check', oneOf(t.stopReason, STOP_REASONS)),
  ],
);

/** One row per change of run times, so a past slot is judged by the run times in force then. */
export const runTimeChanges = pgTable('run_time_changes', {
  id: id('rtc'),
  /** Asia/Ho_Chi_Minh, HH:mm. */
  runTimes: jsonb('run_times').$type<string[]>().notNull(),
  effectiveFrom: tstz('effective_from').notNull(),
  changedBy: text('changed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const keywordDays = pgTable(
  'keyword_days',
  {
    keywordId: text('keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    crawlDay: date('crawl_day').notNull(),
    /** The run's scheduled_for. */
    slot: tstz('slot').notNull(),
    runningAds: integer('running_ads').notNull(),
  },
  (t) => [primaryKey({ columns: [t.keywordId, t.crawlDay, t.slot] })],
);

export const shopDays = pgTable(
  'shop_days',
  {
    landingDomain: text('landing_domain').notNull(),
    crawlDay: date('crawl_day').notNull(),
    slot: tstz('slot').notNull(),
    runningAds: integer('running_ads').notNull(),
  },
  (t) => [primaryKey({ columns: [t.landingDomain, t.crawlDay, t.slot] })],
);

/** A single row (id = 1), created by the first migration. */
export const crawlerState = pgTable(
  'crawler_state',
  {
    id: integer('id').primaryKey().default(1),
    rotationCursor: jsonb('rotation_cursor'),
    blockedUntil: tstz('blocked_until'),
    heartbeatAt: tstz('heartbeat_at'),
  },
  (t) => [check('crawler_state_single_row', sql`${t.id} = 1`)],
);
