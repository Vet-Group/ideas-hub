import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, tstz } from './columns';
import { crawlRuns, keywords } from './crawl';

/** Deduplicated by ad_archive_id; seen counts stay when sightings are purged after 180 days. */
export const ads = pgTable(
  'ads',
  {
    adArchiveId: text('ad_archive_id').primaryKey(),
    collationId: text('collation_id'),
    collationCount: integer('collation_count'),
    pageId: text('page_id'),
    pageName: text('page_name'),
    caption: text('caption'),
    title: text('title'),
    link: text('link'),
    landingDomain: text('landing_domain'),
    cta: text('cta'),
    mediaType: text('media_type'),
    /** Pacific dates from the payload. */
    startDate: date('start_date'),
    endDate: date('end_date'),
    isActive: boolean('is_active').notNull().default(true),
    seenRuns: integer('seen_runs').notNull().default(0),
    seenDays: integer('seen_days').notNull().default(0),
    /** Crawl days. */
    firstSeenDate: date('first_seen_date').notNull(),
    lastSeenDate: date('last_seen_date').notNull(),
    thumbnailKey: text('thumbnail_key'),
    /** The parsed ad object, kept so it can be re-parsed; raw HTML is never stored. */
    parsed: jsonb('parsed').notNull(),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Trigram indexes for the Ctrl+K search (pg_trgm, created by the first migration).
    index('ads_caption_trgm').using('gin', t.caption.op('gin_trgm_ops')),
    index('ads_page_name_trgm').using('gin', t.pageName.op('gin_trgm_ops')),
    index('ads_landing_domain_trgm').using('gin', t.landingDomain.op('gin_trgm_ops')),
    index('ads_last_seen_idx').on(t.lastSeenDate),
  ],
);

export const adSightings = pgTable(
  'ad_sightings',
  {
    adArchiveId: text('ad_archive_id')
      .notNull()
      .references(() => ads.adArchiveId, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    keywordId: text('keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    country: text('country').notNull(),
    position: integer('position').notNull(),
    crawlDay: date('crawl_day').notNull(),
    /** The payload's collation_count at this sighting, so a rising variant count shows over time; null before 0010 or when absent. */
    collationCount: integer('collation_count'),
  },
  (t) => [
    primaryKey({ columns: [t.adArchiveId, t.runId, t.keywordId, t.country] }),
    index('ad_sightings_crawl_day_idx').on(t.crawlDay),
    index('ad_sightings_pair_idx').on(t.keywordId, t.country),
  ],
);

export const shops = pgTable('shops', {
  landingDomain: text('landing_domain').primaryKey(),
  pageIds: text('page_ids').array().notNull().default(sql`'{}'::text[]`),
  firstSeenDate: date('first_seen_date').notNull(),
  lastSeenDate: date('last_seen_date').notNull(),
  /** Ads whose status is "running". */
  runningAds: integer('running_ads').notNull().default(0),
});

export const newsFeeds = pgTable('news_feeds', {
  id: id('feed'),
  url: text('url').notNull().unique(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
});

export const newsItems = pgTable(
  'news_items',
  {
    id: id('news'),
    feedId: text('feed_id')
      .notNull()
      .references(() => newsFeeds.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    link: text('link').notNull(),
    publishedAt: tstz('published_at'),
    summary: text('summary'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('news_items_link_key').on(t.feedId, t.link)],
);

export const holidays = pgTable(
  'holidays',
  {
    id: id('hol'),
    date: date('date').notNull(),
    name: text('name').notNull(),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('holidays_date_name_key').on(t.date, t.name)],
);
