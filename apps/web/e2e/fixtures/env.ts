// The e2e app runs on its own port and database, never the dev ones (3300 and `ideashub`). E2E_PORT,
// E2E_DB and E2E_BUCKET move a local run off a preview server that already uses the defaults.
export const E2E_PORT = Number(process.env.E2E_PORT || 3310);
export const E2E_DB = process.env.E2E_DB || 'ih_e2e';
if (!/^[a-z_][a-z0-9_]*$/.test(E2E_DB)) throw new Error(`E2E_DB is not a plain identifier: ${E2E_DB}`);
/** Its own MinIO bucket, so e2e thumbnails and uploads never mix with the dev ones. */
export const E2E_BUCKET = process.env.E2E_BUCKET || 'ideas-hub-e2e';
/** The server's frozen "now" (Asia/Ho_Chi_Minh 2026-10-21 08:30); the browser clock is set to the same. */
export const E2E_FIXED_NOW = '2026-10-21T01:30:00.000Z';

function baseUrl(): URL {
  try {
    process.loadEnvFile(new URL('../../../../.env', import.meta.url));
  } catch {
    // CI sets DATABASE_URL.
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return new URL(process.env.DATABASE_URL);
}

export function adminDatabaseUrl(): string {
  return baseUrl().toString();
}

export function e2eDatabaseUrl(): string {
  const u = baseUrl();
  u.pathname = `/${E2E_DB}`;
  return u.toString();
}
