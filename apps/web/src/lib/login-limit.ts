// Failed sign-ins per client IP and per email. better-auth 1.7.7 rate-limits only requests through its
// HTTP handler (dist/api/index.mjs, router onRequest → onRequestRateLimit); the sign-in server action calls
// auth.api.signInEmail directly, which skips that limiter, so the action applies this one.
export const MAX_FAILURES = 10;
export const WINDOW_MS = 10 * 60_000;

// shortcut: in-memory per server process; move it to the database if the web app ever runs more than one process.
const entries = new Map<string, { count: number; resetAt: number }>();

function live(key: string, now: number) {
  const e = entries.get(key);
  if (e && e.resetAt > now) return e;
  entries.delete(key);
  return undefined;
}

/** True when any key has MAX_FAILURES failures in its current window. */
export function tooManyFailures(keys: string[], now = Date.now()): boolean {
  return keys.some((k) => (live(k, now)?.count ?? 0) >= MAX_FAILURES);
}

export function recordFailure(keys: string[], now = Date.now()) {
  if (entries.size > 10_000) for (const k of [...entries.keys()]) live(k, now);
  for (const k of keys) {
    const e = live(k, now) ?? { count: 0, resetAt: now + WINDOW_MS };
    e.count += 1;
    entries.set(k, e);
  }
}

export function clearFailures(keys: string[]) {
  for (const k of keys) entries.delete(k);
}
