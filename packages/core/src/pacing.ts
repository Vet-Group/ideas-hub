// Delays and backoff of a crawl run (spec §1 "Schedule and limits"). Pure: the clock and the random
// source are injected and the caller does the waiting, so tests need no real sleeps.
import { type Settings } from './settings';

export type PacingSettings = Pick<
  Settings,
  'searchGapSeconds' | 'pageDelayMs' | 'scrollDelayMs' | 'backoff' | 'networkCooldown'
>;

/** Resistance signal of one search, kept apart from its status. */
export type Signal = 'ok' | 'neutral' | 'blocked' | 'captcha' | 'network';

export type StopReason = 'captcha' | 'block_streak' | 'blocked_searches';

export type Decision =
  | { kind: 'continue'; pauseMs: number }
  | { kind: 'network_cooldown'; pauseMs: number }
  | { kind: 'stop'; reason: StopReason };

export interface PacingDeps {
  /** Wall clock in ms. */
  now: () => number;
  /** Uniform in [0, 1), like Math.random. */
  random: () => number;
}

export function createPacer(settings: PacingSettings, deps: PacingDeps) {
  const { backoff, networkCooldown } = settings;
  let blockStreak = 0;
  let lastBlockedAt: number | null = null;
  let blockedSearches = 0;
  let networkStreak = 0;

  const between = (range: { min: number; max: number }) =>
    range.min + deps.random() * (range.max - range.min);

  function record(signal: Signal): Decision {
    const now = deps.now();
    if (signal !== 'network') networkStreak = 0;
    // Wall time counts as quiet time whatever the reason, a network cool-down included.
    if (lastBlockedAt !== null && now - lastBlockedAt >= backoff.quietMinutes * 60_000) blockStreak = 0;

    switch (signal) {
      case 'ok':
        blockStreak = 0;
        return { kind: 'continue', pauseMs: 0 };
      case 'neutral':
        return { kind: 'continue', pauseMs: 0 };
      case 'captcha':
        return { kind: 'stop', reason: 'captcha' };
      case 'network':
        networkStreak += 1;
        if (networkStreak < networkCooldown.streak) return { kind: 'continue', pauseMs: 0 };
        networkStreak = 0;
        return { kind: 'network_cooldown', pauseMs: networkCooldown.minutes * 60_000 };
      case 'blocked': {
        blockStreak += 1;
        blockedSearches += 1;
        lastBlockedAt = now;
        if (blockStreak >= backoff.stopBlockStreak) return { kind: 'stop', reason: 'block_streak' };
        if (blockedSearches >= backoff.stopBlockedSearches) return { kind: 'stop', reason: 'blocked_searches' };
        const jitter = 1 + (deps.random() * 2 - 1) * backoff.jitter;
        return { kind: 'continue', pauseMs: backoff.baseSeconds * 1000 * 2 ** (blockStreak - 1) * jitter };
      }
    }
  }

  return {
    record,
    /** Random gap before the next search. */
    searchGapMs: () => between(settings.searchGapSeconds) * 1000,
    /** Random delay after the search page loads. */
    pageDelayMs: () => between(settings.pageDelayMs),
    /** Random delay before each scroll. */
    scrollDelayMs: () => between(settings.scrollDelayMs),
    get blockStreak() {
      return blockStreak;
    },
    get networkStreak() {
      return networkStreak;
    },
  };
}

export type Pacer = ReturnType<typeof createPacer>;
