'use client';

import { type AdStatus } from '@ideas-hub/core';
import Link from 'next/link';
import { type KeyboardEvent, useRef } from 'react';
import { SaveButton, type SaveHandle, type SaveTarget } from '@/components/save/save-button';
import { AdStatusChip } from '@/components/states/ad-status-chip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';
import { adLibraryUrl } from './ad-library-url';
import { Thumb } from './thumb';

export interface AdCardData {
  adArchiveId: string;
  href: string;
  thumbSrc: string | null;
  mediaType: string | null;
  pageName: string | null;
  caption: string | null;
  landingDomain: string | null;
  keyword: string | null;
  countries: string[];
  daysActive: number | null;
  trendScore: number | null;
  status: AdStatus;
  /** Near-duplicate creatives grouped under this card ("Gộp mẫu trùng"); 1 when not grouped. */
  duplicates: number;
}


/**
 * The card grid (spec §6 "Core interactions"): each card is one link that covers it, with "Lưu" and the
 * status chip above the link, never inside it. Arrow keys move between cards; while a card has focus `S`
 * saves and `O` opens the Ad Library link. Typing in the filter rail never reaches these keys: they are
 * handled on the card links only.
 */
export function AdGrid({ ads, selectedId, saveStores, via = 'ads' }: { ads: AdCardData[]; selectedId: string | null; saveStores: SaveTarget[]; via?: 'ads' | 'briefing' }) {
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const saves = useRef<(SaveHandle | null)[]>([]);

  const move = (from: number, key: string) => {
    const els = links.current;
    const here = els[from]?.getBoundingClientRect();
    if (!here) return from;
    if (key === 'ArrowRight') return Math.min(from + 1, ads.length - 1);
    if (key === 'ArrowLeft') return Math.max(from - 1, 0);
    // Up and down: the nearest card in the next or previous row, by column position.
    const dir = key === 'ArrowDown' ? 1 : -1;
    let best = from;
    let bestDist = Infinity;
    els.forEach((el, i) => {
      const r = el?.getBoundingClientRect();
      if (!r || (dir > 0 ? r.top <= here.top + 1 : r.top >= here.top - 1)) return;
      const d = Math.abs(r.top - here.top) * 10_000 + Math.abs(r.left - here.left);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  const onKey = (i: number) => (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      links.current[move(i, e.key)]?.focus();
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      saves.current[i]?.trigger();
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      window.open(adLibraryUrl(ads[i]!.adArchiveId), '_blank', 'noopener,noreferrer');
    }
  };

  if (ads.length === 0) return <p className="text-fg-2">{t.ads.empty}</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 min-[821px]:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]" aria-describedby="ads-key-help">
      {ads.map((a, i) => (
        <li
          key={a.adArchiveId}
          className={cn(
            'bg-surface border-line rounded-card relative flex flex-col overflow-hidden border',
            a.adArchiveId === selectedId && 'border-ink',
          )}
        >
          <Thumb src={a.thumbSrc} mediaType={a.mediaType} alt="" priority={i < 8} />
          <div className="grid gap-1 p-2 text-sm">
            <Link
              ref={(el) => {
                links.current[i] = el;
              }}
              href={a.href}
              scroll={false}
              aria-current={a.adArchiveId === selectedId ? 'true' : undefined}
              onKeyDown={onKey(i)}
              className="line-clamp-2 rounded-sm font-medium outline-none after:absolute after:inset-0 focus:ring-[3px] focus:ring-ring/50"
            >
              {a.caption || a.pageName || a.adArchiveId}
            </Link>
            <p className="text-fg-2 truncate text-xs">
              {[a.pageName, a.keyword].filter(Boolean).join(' · ')}
            </p>
            <p className="text-fg-2 truncate text-xs">
              {[a.landingDomain, a.countries.join(', '), a.daysActive === null ? null : t.ads.days(a.daysActive)].filter(Boolean).join(' · ')}
            </p>
            {a.duplicates > 1 ? <p className="text-fg-2 text-xs">{t.ads.duplicates(a.duplicates)}</p> : null}
            <div className="mt-1 flex items-center justify-between gap-2">
              <AdStatusChip status={a.status} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="relative z-10 min-h-6 rounded-sm text-xs">
                    <span className="text-fg-2">{t.ads.score}</span> <span className="font-mono">{a.trendScore ?? t.common.none}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{t.ads.scoreHelp}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          {/* Above the stretched link: a separate control, not nested in it. */}
          <div className="absolute top-2 right-2 z-10">
            <SaveButton
              ref={(h) => {
                saves.current[i] = h;
              }}
              compact
              source={{ kind: 'ad', adArchiveId: a.adArchiveId, via, keyword: a.keyword ?? undefined }}
              stores={saveStores}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
