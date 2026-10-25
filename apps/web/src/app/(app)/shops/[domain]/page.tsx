import { isNonShopDomain, storeScope } from '@ideas-hub/core';
import { daySeries, getShop, listAds, savedRefs, shopReads } from '@ideas-hub/db/queries';
import { notFound } from 'next/navigation';
import { AdGrid } from '@/components/ads/ad-grid';
import { toCard } from '@/components/ads/cards';
import { Tile } from '@/components/briefing/kpi-row';
import { TrendChart } from '@/components/charts/trend-chart';
import { Sub, pct } from '@/components/market-read';
import { PageHeader } from '@/components/page-header';
import { db } from '@/lib/db';
import { loadSettings, statusOptions } from '@/lib/settings';
import { saveTargets } from '@/lib/store';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';

/** A shop: its chart from ShopDay and its running ads. */
export default async function ShopPage({ params }: { params: Promise<{ domain: string }> }) {
  const user = await requireUser();
  const domain = decodeURIComponent((await params).domain);
  const [shop, settings] = await Promise.all([getShop(db, domain), loadSettings()]);
  if (!shop || isNonShopDomain(domain, settings.nonShopDomains)) notFound();
  const o = await statusOptions(settings);
  const [series, ads, stores, read] = await Promise.all([
    daySeries(db, 'shop', domain),
    listAds(db, o, { domain }),
    saveTargets(user),
    shopReads(db, o, [domain]).then((r) => r.get(domain)),
  ]);
  const m = t.keywords.market;
  const own = ads.items.filter((a) => a.landingDomain === domain);
  const saved = await savedRefs(db, storeScope(user), 'ad', own.map((a) => a.adArchiveId));
  return (
    <>
      <PageHeader title={domain}>
        <span className="text-fg-2 text-sm">
          {t.shops.runningAds}: <span className="font-mono">{shop.runningAds}</span>
        </span>
      </PageHeader>
      <div className="grid gap-4">
        {read ? (
          <dl className="grid grid-cols-3 gap-3" aria-label={m.title}>
            <Tile label={m.newAds}>
              {read.newAds}
              <Sub>{m.ofAds(pct(read.newAds, read.ads))}</Sub>
            </Tile>
            <Tile label={m.proven}>
              {read.proven}
              <Sub>{m.ofAds(pct(read.proven, read.ads))}</Sub>
            </Tile>
            <Tile label={t.shops.keywords}>{read.keywords}</Tile>
          </dl>
        ) : null}
        <TrendChart points={series} />
        <h2 className="font-semibold">{t.shops.ads}</h2>
        <AdGrid
          ads={own.map((a) => toCard(a, `/ads/${encodeURIComponent(a.adArchiveId)}`))}
          selectedId={null}
          saveStores={stores}
          saved={saved}
        />
      </div>
    </>
  );
}
