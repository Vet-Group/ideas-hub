import 'server-only';
import { type AdListItem } from '@ideas-hub/db/queries';
import { thumbUrl } from '@/lib/thumb-url';
import { type AdCardData } from './ad-grid';

/** A card's data, with its thumbnail signed on the server. */
export function toCard(a: AdListItem & { duplicates?: number }, href: string, keyword?: string): AdCardData {
  return {
    adArchiveId: a.adArchiveId,
    href,
    thumbSrc: a.thumbnailKey ? thumbUrl(a.thumbnailKey) : null,
    mediaType: a.mediaType,
    pageName: a.pageName,
    caption: a.caption,
    landingDomain: a.landingDomain,
    keyword: keyword ?? a.keywords[0]?.text ?? null,
    countries: a.countries,
    daysActive: a.daysActive,
    trendScore: a.trendScore,
    status: a.status,
    duplicates: a.duplicates ?? 1,
  };
}
