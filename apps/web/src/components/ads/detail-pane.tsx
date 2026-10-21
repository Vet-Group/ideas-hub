import { type AdSighting, type AdListItem } from '@ideas-hub/db/queries';
import { ExternalLink } from 'lucide-react';
import { SaveButton, type SaveTarget } from '@/components/save/save-button';
import { AdStatusChip } from '@/components/states/ad-status-chip';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/strings.vi';
import { thumbUrl } from '@/lib/thumb-url';
import { adLibraryUrl } from './ad-library-url';
import { Thumb } from './thumb';

const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : t.common.none);

/** The ad detail: shown in the sticky 360 px pane, or in a sheet below 1280 px. */
export function DetailPane({ ad, saveStores, via = 'ads' }: { ad: AdListItem & { cta: string | null; sightings: AdSighting[] }; saveStores: SaveTarget[]; via?: 'ads' | 'briefing' }) {
  const rows: [string, string][] = [
    [t.ads.started, ddmm(ad.startDate)],
    [t.ads.daysActive, t.ads.days(ad.daysActive)],
    [t.ads.seenDays, String(ad.seenDays)],
    [t.ads.score, ad.trendScore === null ? t.common.none : String(ad.trendScore)],
    [t.ads.firstSeen, ddmm(ad.firstSeenDate)],
    [t.ads.lastSeen, ddmm(ad.lastSeenDate)],
  ];
  const save = <SaveButton source={{ kind: 'ad', adArchiveId: ad.adArchiveId, via, keyword: ad.keywords[0]?.text }} stores={saveStores} />;
  return (
    <article className="grid gap-3" aria-label={t.ads.detail}>
      <Thumb src={ad.thumbnailKey ? thumbUrl(ad.thumbnailKey) : null} mediaType={ad.mediaType} alt={ad.caption ?? ''} className="rounded-card" />
      <div className="flex items-center justify-between gap-2">
        <AdStatusChip status={ad.status} />
        <div className="group-data-[pane=bottom]:hidden">{save}</div>
      </div>
      <h2 className="font-semibold">{ad.pageName ?? ad.adArchiveId}</h2>
      {ad.caption ? <p className="text-sm whitespace-pre-line">{ad.caption}</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-2">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
        <dt className="text-fg-2">{t.ads.shop}</dt>
        <dd>{ad.landingDomain ?? t.common.none}</dd>
        <dt className="text-fg-2">{t.ads.keyword}</dt>
        <dd>{ad.keywords.map((k) => k.text).join(', ') || t.common.none}</dd>
        <dt className="text-fg-2">{t.ads.country}</dt>
        <dd>{ad.countries.join(', ') || t.common.none}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={adLibraryUrl(ad.adArchiveId)} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden />
            {t.ads.openLibrary}
          </a>
        </Button>
        {ad.link ? (
          <Button asChild size="sm" variant="ghost">
            <a href={ad.link} target="_blank" rel="noopener noreferrer nofollow">
              {t.ads.openLanding}
            </a>
          </Button>
        ) : null}
      </div>
      {ad.sightings.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">{t.ads.sightings}</summary>
          <ul className="text-fg-2 mt-2 grid gap-1 text-xs">
            {ad.sightings.map((s) => (
              <li key={`${s.keyword}-${s.country}-${s.crawlDay}`}>
                {ddmm(s.crawlDay)} · {s.keyword} · {s.country} · {t.ads.position} {s.position}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {/* In the phone's bottom sheet "Lưu" stays pinned at the bottom (spec §6 "Phones"). */}
      <div className="bg-surface border-line sticky -bottom-4 -mx-4 -mb-4 hidden justify-end border-t px-4 py-2 group-data-[pane=bottom]:flex">{save}</div>
    </article>
  );
}
