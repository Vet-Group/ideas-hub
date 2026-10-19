import { ROLES } from '@ideas-hub/core';
import { boolean, check, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id, oneOf, tstz } from './columns';

// Field names follow better-auth's user model (emailVerified, image, createdAt, updatedAt), so Step 5
// maps its adapter onto this table; its session, account and verification tables come with Step 5.
export const users = pgTable(
  'users',
  {
    id: id('user'),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ROLES }).notNull().default('member'),
    disabled: boolean('disabled').notNull().default(false),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`), check('users_role_check', oneOf(t.role, ROLES))],
);

export const stores = pgTable('stores', {
  id: id('store'),
  name: text('name').notNull(),
  // Cross-app keys for phase 2 (README "Boundaries").
  erpStoreCode: text('erp_store_code'),
  podStudioStoreId: text('pod_studio_store_id'),
  larkChatId: text('lark_chat_id'),
  createdAt: createdAt(),
});

/** Per-store ticks; `save` and `keywords` imply `view` (packages/core access.ts). */
export const storeMembers = pgTable(
  'store_members',
  {
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    canView: boolean('can_view').notNull().default(false),
    canSave: boolean('can_save').notNull().default(false),
    canKeywords: boolean('can_keywords').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.userId] })],
);
