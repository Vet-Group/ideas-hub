import { createDb, createPool, databaseUrl } from '@ideas-hub/db/client';

// One pool per server process; dev reloads keep it on globalThis.
const g = globalThis as unknown as { ihPool?: ReturnType<typeof createPool> };
export const pool = (g.ihPool ??= createPool(databaseUrl()));
export const db = createDb(pool);
