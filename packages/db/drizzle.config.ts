import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env: DATABASE_URL comes from the environment (CI).
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
