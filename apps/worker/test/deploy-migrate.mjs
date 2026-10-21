// The deploy tests' `pnpm db:migrate` in the integration case: drizzle's migrator on one migrations folder.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: process.argv[2] });
} finally {
  await pool.end();
}
