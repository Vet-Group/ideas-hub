import { can, isNonShopDomain, storeScope } from '@ideas-hub/core';
import { daySeries, followedShops, getShop, listAds, savedRefs, shopProductPages, shopReads } from '@ideas-hub/db/queries';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdGridWithPane } from '@/components/ads/ad-pane';
import { toCard } from '@/components/ads/cards';
import { adQuery } from '@/components/ads/params';
import { Tile } from '@/components/briefing/kpi-row';
import { TrendChart } from '@/components/charts/trend-chart';
import { Sub, pct } from '@/components/market-read';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { ddmm } from '@/lib/format';
import { loadSettings, statusOptions } from '@/lib/settings';
import { saveTargets, userStores } from '@/lib/store';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { toggleShopFollow } from '../actions';

/** A shop: its chart from ShopDay and its running ads; staff with `save` on the selected store follow it there. */
export default async function ShopPage({ params }: { params: Promise<{ domain: string }> }) {
  const user = await requireUser();
  const domain = decodeURIComponent((await params).domain);
  const [shop, settings] = await Promise.all([getShop(db, domain), loadSettings()]);
  if (!shop || isNonShopDomain(domain, settings.nonShopDomains)) notFound();
  const o = await statusOptions(settings);
  const [series, ads, stores, read, mine, pages] = await Promise.all([
    daySeries(db, 'shop', domain),
    // Grouped like "Gộp mẫu trùng": one shop runs the same creative many times.
    listAds(db, o, { domain, dedupe: true }),
    saveTargets(user),
    shopReads(db, o, [domain]).then((r) => r.get(domain)),
    userStores(user),
    shopProductPages(db, o, domain),
  ]);
  const store = mine.stores.find((s) => s.id === mine.selectedId);
  const followed = store && can(user, store.id, 'save') ? (await followedShops(db, user, store.id)).includes(domain) : null;
  const m = t.keywords.market;
  const own = ads.items.filter((a) => a.landingDomain === domain);
  const saved = await savedRefs(db, storeScope(user), 'ad', own.map((a) => a.adArchiveId));
  return (
    <>
      <PageHeader title={domain}>
        <span className="text-fg-2 text-sm">
          {t.shops.runningAds}: <span className="font-mono">{shop.runningAds}</span>
        </span>
        {store && followed !== null ? (
          <form action={toggleShopFollow}>
            <input type="hidden" name="storeId" value={store.id} />
            <input type="hidden" name="domain" value={domain} />
            <input type="hidden" name="follow" value={followed ? '0' : '1'} />
            <Button type="submit" size="sm" variant={followed ? 'outline' : 'default'}>
              {followed ? t.shops.unfollow(store.name) : t.shops.follow(store.name)}
            </Button>
          </form>
        ) : null}
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
            <Tile label={t.shops.keywords}>
              {read.keywords}
              <Sub>{t.shops.keywordsSub}</Sub>
            </Tile>
          </dl>
        ) : null}
        <TrendChart points={series} />
        {pages.length > 0 ? (
          <section className="grid gap-2" aria-label={t.shops.productPages}>
            <h2 className="font-semibold">{t.shops.productPages}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.shops.productPage}</TableHead>
                  <TableHead className="text-right">{t.shops.productAds}</TableHead>
                  <TableHead className="text-right">{t.shops.productRunning}</TableHead>
                  <TableHead>{t.shops.firstSeen}</TableHead>
                  <TableHead>{t.shops.lastSeen}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.map((p) => (
                  <TableRow key={p.url}>
                    <TableCell className="max-w-96 break-all">{p.url}</TableCell>
                    <TableCell className="text-right font-mono">{p.ads}</TableCell>
                    <TableCell className="text-right font-mono">{p.running}</TableCell>
                    <TableCell>{ddmm(p.firstSeenDate)}</TableCell>
                    <TableCell>{ddmm(p.lastSeenDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">{t.shops.ads}</h2>
          <Link href={`/ads${adQuery({ domain, dedupe: true })}`} className="text-sm underline underline-offset-2">
            {t.shops.openInAds}
          </Link>
        </div>
        <AdGridWithPane ads={own.map((a) => toCard(a, `/ads/${encodeURIComponent(a.adArchiveId)}`))} saveStores={stores} saved={saved} />
      </div>
    </>
  );
}
