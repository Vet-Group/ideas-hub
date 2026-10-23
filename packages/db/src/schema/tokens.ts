import { sql } from 'drizzle-orm';
import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { users } from './accounts';
import { createdAt, id, tstz } from './columns';

export const TOKEN_SCOPES = ['briefings:read', 'ideas:read'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** Personal API tokens (contract `ideas-hub-v1.md` §3): only the SHA-256 hash is stored, never the token. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: id('tok'),
    /** The token acts as this user, checked at every request. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who issued it: the owner, or the admin who created the owner's service account. */
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /** Hex SHA-256 of the whole `ihp_…` token. */
    tokenHash: text('token_hash').notNull().unique(),
    scopes: text('scopes').array().notNull(),
    /** Narrows the owner's stores; null means all of them. */
    storeIds: text('store_ids').array(),
    expiresAt: tstz('expires_at').notNull(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('api_tokens_user_id_idx').on(t.userId),
    check('api_tokens_scopes_check', sql`cardinality(${t.scopes}) > 0 and ${t.scopes} <@ array['briefings:read', 'ideas:read']::text[]`),
    check('api_tokens_expiry_check', sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '365 days'`),
  ],
);
