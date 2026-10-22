// Payload ad → the columns of `ads` (spec §2 "Ad"). The parsed object itself is kept as JSON.
import { pacificDateFromUnix } from '@ideas-hub/core';
import { type RawAd } from './connection';

export interface NormalizedAd {
  adArchiveId: string;
  collationId: string | null;
  collationCount: number | null;
  pageId: string | null;
  pageName: string | null;
  /** The page's like count when the ad was read. */
  pageLikeCount: number | null;
  caption: string | null;
  title: string | null;
  link: string | null;
  landingDomain: string | null;
  cta: string | null;
  mediaType: string | null;
  /** Pacific dates. */
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  /** The image to download, or the video's preview image; null when the ad has neither. */
  thumbnail: { url: string; kind: 'image' | 'video' } | null;
  parsed: RawAd;
}

// Dynamic creative (DCO, DPA) ads carry catalog templates such as "{{product.brand}}" at the top.
const templated = (s: string | null | undefined) => !s || /\{\{[^}]*\}\}/.test(s);

function firstText(...values: (string | null | undefined)[]): string | null {
  const hit = values.find((v) => !templated(v) && v!.trim() !== '');
  return hit?.trim() ?? null;
}

/** Hostname of the landing link, lowercased and without `www.`; null for Facebook's own links. */
export function landingDomain(link: string | null): string | null {
  if (!link) return null;
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || /(^|\.)(facebook\.com|fb\.me|instagram\.com|messenger\.com)$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function normalizeAd(ad: RawAd): NormalizedAd {
  const s = ad.snapshot ?? {};
  const cards = s.cards ?? [];
  const link = s.link_url ?? cards.find((c) => c.link_url)?.link_url ?? null;
  const image = (s.images ?? []).find((i) => i.resized_image_url)?.resized_image_url ?? cards.find((c) => c.resized_image_url)?.resized_image_url;
  const video =
    (s.videos ?? []).find((v) => v.video_preview_image_url)?.video_preview_image_url ??
    cards.find((c) => c.video_preview_image_url)?.video_preview_image_url;
  return {
    adArchiveId: ad.ad_archive_id,
    collationId: ad.collation_id ?? null,
    collationCount: ad.collation_count ?? null,
    pageId: ad.page_id ?? null,
    pageName: ad.page_name ?? s.page_name ?? null,
    pageLikeCount: Number.isInteger(s.page_like_count) ? s.page_like_count! : null,
    caption: firstText(s.body?.text, ...cards.map((c) => c.body)),
    title: firstText(s.title, ...cards.map((c) => c.title)),
    link,
    landingDomain: landingDomain(link),
    cta: s.cta_text ?? null,
    mediaType: s.display_format ?? null,
    startDate: typeof ad.start_date === 'number' ? pacificDateFromUnix(ad.start_date) : null,
    endDate: typeof ad.end_date === 'number' ? pacificDateFromUnix(ad.end_date) : null,
    isActive: ad.is_active ?? true,
    thumbnail: image ? { url: image, kind: 'image' } : video ? { url: video, kind: 'video' } : null,
    parsed: ad,
  };
}
