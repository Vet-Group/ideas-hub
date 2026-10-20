// A disposable database per test file: created from DATABASE_URL, migrated, dropped afterwards.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export function testDatabaseAvailable(): boolean {
  try {
    process.loadEnvFile(new URL('../../../.env', import.meta.url));
  } catch {
    // CI sets DATABASE_URL.
  }
  return !!process.env.DATABASE_URL;
}

export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  testDatabaseAvailable();
  const base = new URL(process.env.DATABASE_URL!);
  const name = `ih_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await pool.end();
  return {
    url: url.toString(),
    drop: async () => {
      const c = new pg.Client({ connectionString: base.toString() });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}
