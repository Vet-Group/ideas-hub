import { type SettingKey } from '@ideas-hub/core';
import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { users } from './accounts';
import { tstz } from './columns';

/** One row per setting; keys and defaults are DEFAULT_SETTINGS in packages/core. */
export const settings = pgTable('settings', {
  key: text('key').$type<SettingKey>().primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
});
