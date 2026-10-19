import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, text, timestamp } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';

/** Prefixed nanoid primary key (`store_…`, `idea_…`); ids never change. */
export const id = (prefix: string) =>
  text('id')
    .primaryKey()
    .$defaultFn(() => `${prefix}_${nanoid()}`);

/** All timestamps are timestamptz, stored in UTC. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const createdAt = () => tstz('created_at').notNull().defaultNow();

/** Body of a CHECK constraint limiting a text column to a fixed set (text over pg enums: easier to change). */
export const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.join(
    values.map((v) => sql.raw(`'${v}'`)),
    sql`, `,
  )})`;
