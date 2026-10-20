import 'server-only';
import { PgBoss } from 'pg-boss';
import { databaseUrl } from '@ideas-hub/db/client';

// The web app only sends jobs (Run now): no maintenance, schedules or migrations, which the worker owns.
const g = globalThis as unknown as { ihBoss?: Promise<PgBoss> };

export function boss(): Promise<PgBoss> {
  g.ihBoss ??= (async () => {
    const b = new PgBoss({ connectionString: databaseUrl(), max: 2, supervise: false, schedule: false, migrate: false });
    b.on('error', (e) => console.error('pg-boss', e));
    await b.start();
    return b;
  })();
  return g.ihBoss;
}
