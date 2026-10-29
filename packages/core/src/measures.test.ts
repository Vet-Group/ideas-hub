import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import {
  type AdPair,
  type Snapshot,
  adStatus,
  crawlDay,
  daysActive,
  deltaAt,
  durationTier,
  isNonShopDomain,
  isProven,
  isRisingNew,
  marketStage,
  momentumScore,
  pacificDate,
  pacificDateFromUnix,
  titleWords,
  trendScore,
} from './measures';

const unix = (iso: string) => Date.parse(iso) / 1000;

describe('daysActive', () => {
  it('matches the verified examples', () => {
    // Raw payload values are midnight Pacific: 07:00 UTC in PDT, 08:00 UTC in PST.
    const croco = daysActive(pacificDateFromUnix(unix('2025-10-09T07:00:00Z')), pacificDateFromUnix(unix('2025-10-27T07:00:00Z')));
    expect(croco).toBe(19);
  });

  it('counts calendar days across DST (Alibaba.com, 2 Mar PST to 2 Jun PDT)', () => {
    const start = unix('2026-03-02T08:00:00Z');
    const end = unix('2026-06-02T07:00:00Z');
    expect(pacificDateFromUnix(start)).toBe('2026-03-02');
    expect(pacificDateFromUnix(end)).toBe('2026-06-02');
    expect(daysActive(pacificDateFromUnix(start), pacificDateFromUnix(end))).toBe(93);
    // Dividing raw seconds would be one day short.
    expect(Math.floor((end - start) / 86_400) + 1).toBe(92);
  });

  it('counts an active ad up to today (VistaPrint, read on 18 Oct Pacific)', () => {
    const today = pacificDate(new Date('2026-10-19T02:02:00Z'));
    expect(today).toBe('2026-10-18');
    expect(daysActive(pacificDateFromUnix(unix('2026-07-29T07:00:00Z')), today)).toBe(82);
  });

  it('counts an ad that started and stopped on the same day as 1', () => {
    expect(daysActive('2026-10-18', '2026-10-18')).toBe(1);
  });
});

describe('crawlDay', () => {
  it('puts both default runs of 19 Oct (Asia/Ho_Chi_Minh) on one Pacific date', () => {
    expect(crawlDay(new Date('2026-10-18T18:00:00Z'))).toBe('2026-10-18'); // 01:00 VN
    expect(crawlDay(new Date('2026-10-19T06:00:00Z'))).toBe('2026-10-18'); // 13:00 VN = 23:00 PDT
  });

  it('keeps the start date for a run that crosses Pacific midnight, while days_active uses end_date', () => {
    const runStart = new Date('2026-10-19T06:00:00Z'); // 23:00 PDT on 18 Oct
    // An ad read at 00:30 PDT on 19 Oct already carries end_date 19 Oct.
    const endDate = pacificDateFromUnix(unix('2026-10-19T07:00:00Z'));
    expect(crawlDay(runStart)).toBe('2026-10-18');
    expect(endDate).toBe('2026-10-19');
    expect(daysActive('2026-10-15', endDate)).toBe(5);
  });

  it('follows the DST change of 1 Nov 2026', () => {
    expect(crawlDay(new Date('2026-11-01T06:00:00Z'))).toBe('2026-10-31'); // 23:00 PDT
    expect(crawlDay(new Date('2026-11-02T06:00:00Z'))).toBe('2026-11-01'); // 22:00 PST
  });
});

describe('trendScore', () => {
  it('needs 5+ days active and a landing domain', () => {
    expect(trendScore({ daysActive: 5, seenDays: 3, landingDomain: 'shop.example' })).toBe(15);
    expect(trendScore({ daysActive: 4, seenDays: 3, landingDomain: 'shop.example' })).toBeNull();
    expect(trendScore({ daysActive: 30, seenDays: 3, landingDomain: null })).toBeNull();
    expect(trendScore({ daysActive: 30, seenDays: 3, landingDomain: '' })).toBeNull();
  });
});

describe('momentumScore', () => {
  const none = { variantsNow: null, variantsBefore: null, pageLikesNow: null, pageLikesBefore: null, daysActive: 40 };

  it('is 0 without two crawl days of either series', () => {
    expect(momentumScore(none)).toBe(0);
    expect(momentumScore({ ...none, variantsNow: 5, pageLikesNow: 1000 })).toBe(0);
  });

  it('adds 10 per variant gained, page like growth in % and days running capped at 30', () => {
    expect(momentumScore({ ...none, variantsNow: 7, variantsBefore: 4, daysActive: 12 })).toBe(42);
    expect(momentumScore({ ...none, pageLikesNow: 1100, pageLikesBefore: 1000, daysActive: 50 })).toBe(40);
    expect(momentumScore({ variantsNow: 2, variantsBefore: 1, pageLikesNow: 1050, pageLikesBefore: 1000, daysActive: 3 })).toBe(18);
  });

  it('ignores losses, caps like growth at 100% and skips a zero like baseline', () => {
    expect(momentumScore({ ...none, variantsNow: 1, variantsBefore: 4, daysActive: 5 })).toBe(5);
    expect(momentumScore({ ...none, pageLikesNow: 900, pageLikesBefore: 100, daysActive: 0 })).toBe(100);
    expect(momentumScore({ ...none, pageLikesNow: 900, pageLikesBefore: 0 })).toBe(0);
  });
});

describe('isProven', () => {
  it('needs 6+ variants, or 30+ days in 3+ countries', () => {
    expect(isProven({ variants: 6, daysActive: 2, countries: 1 })).toBe(true);
    expect(isProven({ variants: 5, daysActive: 30, countries: 3 })).toBe(true);
    expect(isProven({ variants: 5, daysActive: 29, countries: 4 })).toBe(false);
    expect(isProven({ variants: null, daysActive: 90, countries: 2 })).toBe(false);
    expect(isProven({ variants: null, daysActive: null, countries: 4 })).toBe(false);
  });
});

describe('marketStage', () => {
  it('is rising from 15% new ads, else proven from 35% proven ads, else steady', () => {
    expect(marketStage({ ads: 100, newAds: 15, proven: 60 })).toBe('rising');
    expect(marketStage({ ads: 100, newAds: 14, proven: 35 })).toBe('proven');
    expect(marketStage({ ads: 100, newAds: 14, proven: 34 })).toBe('steady');
    expect(marketStage({ ads: 0, newAds: 0, proven: 0 })).toBe('steady');
  });
});

describe('titleWords', () => {
  it('lower-cases a title into single-spaced words, dropping digits, punctuation and emoji', () => {
    expect(titleWords('  Sea-Glass ORNAMENT, 2026 🎄 for Mom’s tree ')).toBe('sea glass ornament for mom s tree');
    expect(titleWords('Áo thun  Bố')).toBe('áo thun bố');
    expect(titleWords('!!')).toBe('');
  });
});

describe('isNonShopDomain', () => {
  const list = DEFAULT_SETTINGS.nonShopDomains;
  it('matches trackers, app stores and marketplaces with their subdomains and any amazon.* TLD', () => {
    for (const d of ['ad.doubleclick.net', 'play.google.com', 'itunes.apple.com', 'apps.apple.com', 'a.co', 'amazon.com', 'amazon.co.uk', 'smile.amazon.de', 'temu.com', 'l.facebook.com']) {
      expect(isNonShopDomain(d, list), d).toBe(true);
    }
  });

  it('keeps real shops, including names that only contain an entry', () => {
    for (const d of ['dogmom.example', 'teeshop.com', 'notamazon.com', 'google.com', 'temu.com.shop.example', 'ba.co']) {
      expect(isNonShopDomain(d, list), d).toBe(false);
    }
    expect(isNonShopDomain('play.google.com', [])).toBe(false);
  });
});

describe('adStatus', () => {
  const today = '2026-10-18';
  const stale = '2026-10-14'; // 4 days ago, more than N = 3
  const pair = (searches: AdPair['searches'], active = true): AdPair => ({ active, searches });

  it('is running when seen within N days', () => {
    expect(adStatus({ lastSeenDate: '2026-10-15', pairs: [pair([{ crawlDay: '2026-10-16', status: 'no_results', lastHasNext: null }])] }, today, 3)).toBe('running');
  });

  it('is stopped or unknown after an end-of-results search ran since last seen', () => {
    expect(adStatus({ lastSeenDate: stale, pairs: [pair([{ crawlDay: '2026-10-16', status: 'no_results', lastHasNext: null }])] }, today, 3)).toBe('stopped_or_unknown');
    expect(adStatus({ lastSeenDate: stale, pairs: [pair([{ crawlDay: '2026-10-16', status: 'ok', lastHasNext: false }])] }, today, 3)).toBe('stopped_or_unknown');
  });

  it('ignores searches that ran on or before last seen', () => {
    expect(adStatus({ lastSeenDate: stale, pairs: [pair([{ crawlDay: stale, status: 'no_results', lastHasNext: null }])] }, today, 3)).toBe('running');
  });

  it('is out of top results when only searches with a next page left ran since (cap or 2-page rule)', () => {
    const pairs = [pair([{ crawlDay: '2026-10-16', status: 'ok', lastHasNext: true }]), pair([{ crawlDay: '2026-10-17', status: 'blocked', lastHasNext: null }])];
    expect(adStatus({ lastSeenDate: stale, pairs }, today, 3)).toBe('out_of_top');
  });

  it('prefers end-of-results over a next page left on another pair', () => {
    const pairs = [pair([{ crawlDay: '2026-10-16', status: 'ok', lastHasNext: true }]), pair([{ crawlDay: '2026-10-17', status: 'no_results', lastHasNext: null }])];
    expect(adStatus({ lastSeenDate: stale, pairs }, today, 3)).toBe('stopped_or_unknown');
  });

  it('stays running when its searches did not run since (rotation) or failed', () => {
    expect(adStatus({ lastSeenDate: stale, pairs: [pair([])] }, today, 3)).toBe('running');
    const failed = pair([
      { crawlDay: '2026-10-16', status: 'blocked', lastHasNext: null },
      { crawlDay: '2026-10-17', status: 'network_error', lastHasNext: null },
      { crawlDay: '2026-10-17', status: 'skipped', lastHasNext: null },
    ]);
    expect(adStatus({ lastSeenDate: stale, pairs: [failed] }, today, 3)).toBe('running');
  });

  it('is stopped or unknown when all its pairs are inactive', () => {
    expect(adStatus({ lastSeenDate: stale, pairs: [pair([], false), pair([], false)] }, today, 3)).toBe('stopped_or_unknown');
    expect(adStatus({ lastSeenDate: stale, pairs: [pair([], false), pair([])] }, today, 3)).toBe('running');
  });

  it('is running again once seen again', () => {
    const pairs = [pair([{ crawlDay: '2026-10-16', status: 'no_results', lastHasNext: null }])];
    expect(adStatus({ lastSeenDate: stale, pairs }, today, 3)).toBe('stopped_or_unknown');
    expect(adStatus({ lastSeenDate: today, pairs }, today, 3)).toBe('running');
  });
});

describe('isRisingNew', () => {
  it('needs first_seen_date and start_date within the last 3 crawl days', () => {
    expect(isRisingNew({ firstSeenDate: '2026-10-17', startDate: '2026-10-16' }, '2026-10-18')).toBe(true);
    expect(isRisingNew({ firstSeenDate: '2026-10-18', startDate: '2026-10-15' }, '2026-10-18')).toBe(false);
    expect(isRisingNew({ firstSeenDate: '2026-10-15', startDate: '2026-10-17' }, '2026-10-18')).toBe(false);
  });

  it('does not count an old ad first seen today under a newly tracked keyword', () => {
    expect(isRisingNew({ firstSeenDate: '2026-10-18', startDate: '2026-01-04' }, '2026-10-18')).toBe(false);
  });
});

describe('deltaAt', () => {
  // The 01:00 VN slot of crawl day D is D 18:00 UTC; the 13:00 VN slot is D+1 06:00 UTC.
  const at01 = (day: string, value: number): Snapshot => ({ crawlDay: day, slot: new Date(`${day}T18:00:00Z`), value });
  const at13 = (day: string, value: number): Snapshot => {
    const slot = new Date(`${day}T06:00:00Z`);
    slot.setUTCDate(slot.getUTCDate() + 1);
    return { crawlDay: day, slot, value };
  };
  const latest = at01('2026-10-18', 50);

  it('uses the snapshot 7 crawl days earlier', () => {
    expect(deltaAt([at01('2026-10-11', 30), at01('2026-10-15', 45), latest], latest)).toEqual({ change: 20, baselineDay: '2026-10-11', partial: false });
  });

  it('falls back to an earlier day when the cutoff day is missing', () => {
    expect(deltaAt([at01('2026-10-10', 25), at01('2026-10-12', 40), latest], latest)).toEqual({ change: 25, baselineDay: '2026-10-10', partial: false });
  });

  it('compares the same slot only', () => {
    const snaps = [at13('2026-10-11', 999), at01('2026-10-13', 44), latest];
    expect(deltaAt(snaps, latest)).toEqual({ change: 6, baselineDay: '2026-10-13', partial: true });
  });

  it('marks a baseline from shorter history as partial', () => {
    expect(deltaAt([at01('2026-10-14', 10), at01('2026-10-16', 20), latest], latest)).toEqual({ change: 40, baselineDay: '2026-10-14', partial: true });
  });

  it('shows no change with fewer than 2 snapshots of the slot', () => {
    expect(deltaAt([latest], latest)).toBeNull();
    expect(deltaAt([at13('2026-10-11', 30), latest], latest)).toBeNull();
  });
});

describe('durationTier', () => {
  it.each([
    [0, 'test'],
    [6, 'test'],
    [7, 'validation'],
    [21, 'validation'],
    [22, 'winner'],
    [179, 'winner'],
    [180, 'evergreen'],
    [400, 'evergreen'],
  ] as const)('%i days is %s', (days, tier) => {
    expect(durationTier(days)).toBe(tier);
  });
});
