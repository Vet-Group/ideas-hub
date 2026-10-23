import { type BriefingAd, type BriefingRisingAd } from '@ideas-hub/core';
import Link from 'next/link';
import { Thumb } from '@/components/ads/thumb';
import { SaveButton, type SaveTarget } from '@/components/save/save-button';
import { t } from '@/lib/strings.vi';
import { thumbUrl } from '@/lib/thumb-url';

/**
 * Ad rows of briefing sections 1–2 (spec §6): thumbnail, page · keyword, domain · country · days, score
 * and "Lưu". Each row is one stretched link that opens the ad sheet, with "Lưu" a separate button above
 * it; a save from the row or the sheet records `via = briefing`.
 */
export function AdRows({
  ads,
  adHref,
  stores,
  saved,
}: {
  ads: (BriefingAd | BriefingRisingAd)[];
  adHref: (id: string) => string;
  stores: SaveTarget[];
  /** ad_archive_ids already saved. */
  saved: string[];
}) {
  if (ads.length === 0) return <p className="text-fg-2 text-sm">{t.briefing.empty}</p>;
  return (
    <ul className="divide-line grid divide-y">
      {ads.map((a, i) => (
        <li key={a.adArchiveId} className="relative flex min-h-11 items-center gap-3 py-2">
          <Thumb src={a.thumbnailKey ? thumbUrl(a.thumbnailKey) : null} alt="" priority={i < 4} className="rounded-card size-12 shrink-0" />
          <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
            <Link href={adHref(a.adArchiveId)} scroll={false} className="truncate rounded-sm font-medium outline-none after:absolute after:inset-0 focus:ring-[3px] focus:ring-ring/50">
              {a.caption || a.pageName || a.adArchiveId}
            </Link>
            <span className="text-fg-2 truncate text-xs">{[a.pageName, a.keyword].filter(Boolean).join(' · ')}</span>
            <span className="text-fg-2 truncate text-xs">
              {[a.landingDomain, a.countries.join(', '), a.daysActive === null ? null : t.ads.days(a.daysActive), 'sightings' in a ? t.briefing.sightings(a.sightings) : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <span className="font-mono text-xs" title={t.ads.score}>
            {a.trendScore ?? t.common.none}
          </span>
          <div className="relative z-10">
            <SaveButton
              source={{ kind: 'ad', adArchiveId: a.adArchiveId, via: 'briefing', keyword: a.keyword ?? undefined }}
              stores={stores}
              title={a.caption || a.pageName || a.adArchiveId}
              saved={saved.includes(a.adArchiveId)}
              compact
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
