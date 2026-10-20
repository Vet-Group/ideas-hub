import { ROLES } from '@ideas-hub/core';
import { boolean, check, index, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id, oneOf, tstz } from './columns';

// Field names follow better-auth's models (apps/web/src/lib/auth.ts maps its adapter onto these
// tables); the admin plugin's `banned` is `disabled` here.
export const users = pgTable(
  'users',
  {
    id: id('user'),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ROLES }).notNull().default('member'),
    disabled: boolean('disabled').notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: tstz('ban_expires'),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`), check('users_role_check', oneOf(t.role, ROLES))],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id('sess'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    impersonatedBy: text('impersonated_by'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id('acct'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tstz('access_token_expires_at'),
    refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: id('verif'),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
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
