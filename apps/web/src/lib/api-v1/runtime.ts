// The real dependencies of the /api/v1 route files; tests call the handlers with their own.
import { db } from '@/lib/db';
import { now } from '@/lib/now';
import { objectStore } from '@/lib/object-store';
import { type V1Deps } from './pipeline';
import { createRateLimiter } from './rate-limit';

// One limiter per server process; dev reloads keep it on globalThis, as the pool does.
const g = globalThis as unknown as { ihApiLimiter?: ReturnType<typeof createRateLimiter> };

export const deps: V1Deps = {
  db,
  now,
  limiter: (g.ihApiLimiter ??= createRateLimiter()),
  objects: objectStore,
  // Never the request: no header, URL or query reaches the log. A Drizzle error's own message carries its
  // query parameters, so the underlying cause is logged instead.
  logError(requestId, e) {
    const root = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    console.error(`api/v1 ${requestId}`, root instanceof Error ? root.stack : 'unknown error');
  },
};
