// Default settings (spec §1 "Schedule and limits" and §2 "Setting"). The first migration seeds these
// rows into `settings`, one row per key; packages/db/src/migration.test.ts checks the two agree.
export const DEFAULT_SETTINGS = {
  countries: ['US', 'GB', 'CA', 'AU'],
  // Asia/Ho_Chi_Minh, HH:mm.
  runTimes: ['01:00', '13:00'],
  runDeadlineMinutes: 270,
  morningHardStop: '06:05',
  manualRunMarginMinutes: 25,
  watchdogGraceMinutes: 15,
  searchBudget: 160,
  maxKeywords: 80,
  adsPerSearchCap: 100,
  noNewAdsPagesToStop: 2,
  searchGapSeconds: { min: 20, max: 60 },
  pageDelayMs: { min: 400, max: 1300 },
  scrollDelayMs: { min: 900, max: 1700 },
  backoff: {
    baseSeconds: 45,
    jitter: 0.15,
    quietMinutes: 30,
    stopBlockStreak: 3,
    stopBlockedSearches: 6,
  },
  attemptsPerSearch: 3,
  retryDelaysSeconds: [5, 15],
  networkCooldown: { streak: 3, minutes: 10 },
  waitLimitsSeconds: {
    browserStart: 60,
    pageLoad: 60,
    embeddedData: 15,
    scrollResponse: 15,
    thumbnailDownload: 15,
    browserClose: 15,
  },
  blockEmptyPayloadsInRow: 3,
  cooldownHours: 6,
  staleAfterDays: 3,
  heartbeatThresholdMinutes: 30,
  missedRunGraceMinutes: 15,
  briefingBuildTime: '06:30',
  briefingReadyTime: '07:00',
  briefingJobExpirySeconds: 900,
  llmCallTimeoutSeconds: 120,
  larkSendTimeoutSeconds: 30,
  // Phase 1 runs a fresh logged-out profile without a proxy; the slots stay for configuration.
  browserProfile: null,
  proxy: null,
  aiDailyCostCapUsd: 3,
  llmModel: 'claude-sonnet-5-5',
  // Landing domains that are ad trackers, app stores, marketplaces or link shorteners, never a shop
  // (isNonShopDomain): ads keep them, shops, shop_days and the briefing do not.
  nonShopDomains: [
    'doubleclick.net',
    'googleadservices.com',
    'play.google.com',
    'apps.apple.com',
    'itunes.apple.com',
    'a.co',
    'amzn.to',
    'amazon.*',
    'ebay.*',
    'aliexpress.*',
    'temu.com',
    'shein.com',
    'etsy.com',
    'walmart.com',
    'tiktok.com',
    'l.facebook.com',
    'bit.ly',
    'linktr.ee',
  ],
} as const;

type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends null
      ? string | null
      : T extends readonly (infer U)[]
        ? Widen<U>[]
        : { [K in keyof T]: Widen<T[K]> };

export type Settings = Widen<typeof DEFAULT_SETTINGS>;
export type SettingKey = keyof Settings;
