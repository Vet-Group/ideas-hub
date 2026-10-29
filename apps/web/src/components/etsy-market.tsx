import { Suspense } from 'react';
import { Tile } from '@/components/briefing/kpi-row';
import { Sub } from '@/components/market-read';
import { etsyMarket } from '@/lib/etsy';
import { formatTime } from '@/lib/format';
import { t } from '@/lib/strings.vi';

const e = t.keywords.etsy;
const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`;

async function EtsyBody({ keyword, contactEmail }: { keyword: string; contactEmail: string }) {
  const r = await etsyMarket(keyword);
  if (!r) return <p className="text-fg-2 text-sm">{e.unavailable}</p>;
  return (
    <div className="grid gap-3">
      {r.sampled ? (
        <>
          <p className="text-fg-2 text-sm">{e.sample(r.sampled, r.total)}</p>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {/* One tile per currency: prices are never compared across currencies. */}
            {r.priceBands.map((b) => (
              <Tile key={b.currency} label={`${e.priceBand} ${b.currency}`}>
                {b.p25 === b.p75 ? money(b.p25, b.currency) : `${b.p25.toFixed(2)}–${money(b.p75, b.currency)}`}
                <Sub>{e.listingCount(b.listings)}</Sub>
              </Tile>
            ))}
            <Tile label={e.medianFavorers}>{r.medianFavorers ?? t.common.none}</Tile>
          </dl>
          <p className="text-fg-muted text-xs">{e.priceBandHelp}</p>
          {r.topTags.length ? (
            <div className="grid gap-2">
              <h3 className="text-sm font-medium">{e.topTags}</h3>
              <ul className="flex flex-wrap gap-2">
                {r.topTags.map((tag) => (
                  <li key={tag.tag} className="border-line bg-surface rounded-md border px-2 py-1 text-sm">
                    {tag.tag} <span className="text-fg-2 text-xs tabular-nums">{e.listingCount(tag.listings)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">{e.topListings}</h3>
            <ol className="grid gap-1 text-sm">
              {r.listings.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {l.title || l.url}
                  </a>{' '}
                  <span className="text-fg-2 text-xs tabular-nums">
                    {money(l.price, l.currency)} · {e.favorers(l.favorers)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <p className="text-fg-2 text-sm">{e.none}</p>
      )}
      <p className="text-fg-muted text-xs">
        {e.source(formatTime(r.fetchedAt))} {e.contact}:{' '}
        <a href={`mailto:${contactEmail}`} className="underline">
          {contactEmail}
        </a>
        . {e.notice}
      </p>
    </div>
  );
}

/** The keyword report's Etsy section (AC-S2); streamed so a slow Etsy never holds the rest of the report. */
export function EtsyMarketSection({ keyword, contactEmail }: { keyword: string; contactEmail: string }) {
  return (
    <section className="grid gap-2" aria-labelledby="kw-etsy">
      <h2 id="kw-etsy" className="font-semibold">
        {e.title}
      </h2>
      <Suspense fallback={<p className="text-fg-2 text-sm">{t.common.loading}</p>}>
        <EtsyBody keyword={keyword} contactEmail={contactEmail} />
      </Suspense>
    </section>
  );
}
