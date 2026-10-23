// Fixed-window limits for /api/v1 (contract §3 "Rate limits"): per token and per install. One web process on
// one machine, so counters in memory are enough; they reset on restart.
export interface RateState {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window of the reported counter ends. */
  resetSeconds: number;
}

interface Window {
  start: number;
  count: number;
}

export interface RateLimiter {
  /** Counts one request for `tokenId`; with null (no valid token) only reports the install's state. */
  take(tokenId: string | null, nowMs: number): RateState;
}

export function createRateLimiter({ perToken = 60, perInstall = 600, windowMs = 60_000 } = {}): RateLimiter {
  const tokens = new Map<string, Window>();
  const install: Window = { start: 0, count: 0 };

  const fresh = (w: Window, nowMs: number) => {
    if (nowMs - w.start >= windowMs) {
      w.start = nowMs;
      w.count = 0;
    }
    return w;
  };
  const state = (w: Window, limit: number, nowMs: number, allowed: boolean): RateState => ({
    allowed,
    limit,
    remaining: Math.max(0, limit - w.count),
    resetSeconds: Math.max(1, Math.ceil((w.start + windowMs - nowMs) / 1000)),
  });

  return {
    take(tokenId, nowMs) {
      fresh(install, nowMs);
      if (tokens.size > 1000) for (const [k, w] of tokens) if (nowMs - w.start >= windowMs) tokens.delete(k);
      if (tokenId === null) return state(install, perInstall, nowMs, true);
      let own = tokens.get(tokenId);
      if (!own) tokens.set(tokenId, (own = { start: nowMs, count: 0 }));
      fresh(own, nowMs);
      if (own.count >= perToken) return state(own, perToken, nowMs, false);
      if (install.count >= perInstall) return state(install, perInstall, nowMs, false);
      own.count++;
      install.count++;
      // Report the bucket that runs out first; the token's on a tie.
      return perToken - own.count <= perInstall - install.count ? state(own, perToken, nowMs, true) : state(install, perInstall, nowMs, true);
    },
  };
}
