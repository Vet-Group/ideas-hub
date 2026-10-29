import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { stores, users } from './accounts';
import { createdAt, id, oneOf, tstz } from './columns';

export const IDEA_SOURCES = ['ad', 'suggestion', 'manual'] as const;
export const IDEA_VIA = ['briefing', 'ads', 'manual'] as const;
export const IDEA_STATUSES = ['new', 'picked', 'done', 'dropped'] as const;

/** Per-store data: one row per store for a save to several stores. */
export const savedIdeas = pgTable(
  'saved_ideas',
  {
    id: id('idea'),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    source: text('source', { enum: IDEA_SOURCES }).notNull(),
    /** ad_archive_id, suggestion id or pasted link; null for an image-only manual idea (not deduplicated). */
    sourceRef: text('source_ref'),
    via: text('via', { enum: IDEA_VIA }).notNull(),
    /** Thumbnail key, caption, link, keyword and trend score at save time; never a signed URL. */
    snapshot: jsonb('snapshot').notNull().default({}),
    /** Uploaded image, manual ideas only. */
    imageKey: text('image_key'),
    title: text('title').notNull(),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    status: text('status', { enum: IDEA_STATUSES }).notNull().default('new'),
    assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    /** First time the idea was picked (or done); kept when it moves back. */
    pickedAt: tstz('picked_at'),
    /** When it became done; cleared when it leaves done. */
    doneAt: tstz('done_at'),
  },
  (t) => [
    uniqueIndex('saved_ideas_source_key').on(t.storeId, t.source, t.sourceRef),
    index('saved_ideas_store_status_idx').on(t.storeId, t.status),
    check('saved_ideas_source_check', oneOf(t.source, IDEA_SOURCES)),
    check('saved_ideas_via_check', oneOf(t.via, IDEA_VIA)),
    check('saved_ideas_status_check', oneOf(t.status, IDEA_STATUSES)),
    check('saved_ideas_image_check', sql`${t.imageKey} is null or ${t.source} = 'manual'`),
  ],
);
