// The stored shape of `briefings.sections` (spec §3, plan Step 7): one key per section, written as each
// section is built, so a rerun keeps what is stored and spends no AI cost twice. Sections 1–4 and the KPI
// row are snapshots of the source run's data; sections 5 and 6 come from one LLM call, or carry the state
// that replaced them. Shared by the worker's `briefing.build` and the web briefing page.
import { type Delta } from '../measures';

/** The run a briefing is built from (spec §3 "last completed scheduled run"). */
export interface BriefingSourceRun {
  id: string;
  /** ISO timestamp of the slot; the page shows it in Asia/Ho_Chi_Minh ("Từ run 01:00 ngày 19/10"). */
  scheduledFor: string;
  runningAds: number;
  okSearches: number;
  plannedSearches: number;
}

export interface BriefingKpi {
  runningAds: number;
  /** Against the `running_ads` of the same slot 7 crawl days earlier, baseline per spec §3. */
  delta: Delta | null;
  /** `ok_searches` ÷ `planned_searches`, 0–1; null when nothing was planned. */
  okRate: number | null;
  nextHoliday: { date: string; name: string; days: number } | null;
}

/** An ad in sections 1–2, as at build time; the thumbnail key is signed when the page renders. */
export interface BriefingAd {
  adArchiveId: string;
  pageName: string | null;
  caption: string | null;
  landingDomain: string | null;
  thumbnailKey: string | null;
  daysActive: number | null;
  trendScore: number | null;
  /** Keyword text of the ad's best (lowest position) sighting in the source run; for a keyword briefing, that keyword. */
  keyword: string | null;
  /** Distinct countries of its sightings in the source run, sorted. */
  countries: string[];
}

export interface BriefingRisingAd extends BriefingAd {
  sightings: number;
  bestPosition: number | null;
}

export interface BriefingCount {
  /** Keyword id (section 3) or landing domain (section 4). */
  key: string;
  label: string;
  runningAds: number;
  delta: Delta | null;
}

export interface BriefingNewsItem {
  id: string;
  title: string;
  link: string;
  publishedAt: string | null;
  feed: string;
}

export interface BriefingHoliday {
  date: string;
  name: string;
  /** Days from the briefing date. */
  days: number;
}

/** An AI section that was not generated: over the daily cap, or after 2 failed LLM calls. */
export type AiMissing = { state: 'skipped'; reason: 'cost_cap' } | { state: 'failed'; reason: 'ai' };

export type NewsSection =
  | { state: 'ok'; summary: string; items: BriefingNewsItem[]; holidays: BriefingHoliday[] }
  | (AiMissing & { items: BriefingNewsItem[]; holidays: BriefingHoliday[] });

/** Section 6's items are rows of `suggestions` (they need ids to be saved); this holds only the state. */
export type SuggestionsSection = { state: 'ok'; count: number } | AiMissing;

export interface BriefingSections {
  sourceRun?: BriefingSourceRun;
  kpi?: BriefingKpi;
  topAds?: BriefingAd[];
  risingAds?: BriefingRisingAd[];
  hotKeywords?: BriefingCount[];
  risingShops?: BriefingCount[];
  news?: NewsSection;
  suggestions?: SuggestionsSection;
}

/** The section keys in build order; a briefing is complete when all are stored. */
export const SECTION_KEYS = ['sourceRun', 'kpi', 'topAds', 'risingAds', 'hotKeywords', 'risingShops', 'news', 'suggestions'] as const satisfies readonly (keyof BriefingSections)[];
