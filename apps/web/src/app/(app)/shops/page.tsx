import { storeScope } from '@ideas-hub/core';
import { SHOP_PAGE_SIZE, SHOP_SORTS, type ShopRead, type ShopSort, followedShopAds, followedShops, listShops, savedRefs, shopReads } from '@ideas-hub/db/queries';
import Link from 'next/link';
import { AdGridWithPane } from '@/components/ads/ad-pane';
import { toCard } from '@/components/ads/cards';
import { Share } from '@/components/market-read';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { SortHead } from '@/components/sort-head';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { type CurrentUser, requireUser } from '@/lib/session';
import { loadSettings, statusOptions } from '@/lib/settings';
import { saveTargets, userStores } from '@/lib/store';
import { t } from '@/lib/strings.vi';

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const m = t.keywords.market;

function ReadCells({ read }: { read: ShopRead | undefined }) {
  const cell = 'text-right font-mono';
  if (!read) return [0, 1, 2].map((i) => <TableCell key={i} className={cell}>{t.common.none}</TableCell>);
  return (
    <>
      <TableCell className={cell}>
        <Share part={read.newAds} whole={read.ads} />
      </TableCell>
      <TableCell className={cell}>
        <Share part={read.proven} whole={read.ads} />
      </TableCell>
      <TableCell className={cell}>{read.keywords}</TableCell>
    </>
  );
}

function Views({ followed }: { followed: boolean }) {
  return (
    <nav aria-label={t.shops.views} className="mb-4 flex flex-wrap gap-2">
      {[false, true].map((f) => (
        <Button key={String(f)} asChild size="sm" variant={f === followed ? 'default' : 'outline'}>
          <Link href={f ? '/shops?followed=1' : '/shops'} aria-current={f === followed ? 'page' : undefined}>
            {f ? t.shops.followed : t.shops.all}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

/** `/shops?followed=1`: the selected store's followed shops and their ads started in the last 7 days (AC-A6). */
async function FollowedShops({ user }: { user: CurrentUser }) {
  const { stores, selectedId } = await userStores(user);
  const store = stores.find((s) => s.id === selectedId);
  if (!store) {
    return (
      <>
        <PageHeader title={t.shops.followed} />
        <Views followed />
        <p className="text-fg-2">{t.ideaViews.noStore}</p>
      </>
    );
  }
  const o = await statusOptions(await loadSettings());
  const [domains, ads, saveStores] = await Promise.all([followedShops(db, user, store.id), followedShopAds(db, o, user, store.id), saveTargets(user)]);
  const saved = await savedRefs(db, storeScope(user), 'ad', ads.map((a) => a.adArchiveId));
  return (
    <>
      <PageHeader title={t.shops.followedOf(store.name)} />
      <Views followed />
      {domains.length === 0 ? (
        <p className="text-fg-2">{t.shops.followedEmpty}</p>
      ) : (
        <div className="grid gap-4">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {domains.map((d) => (
              <li key={d}>
                <Link href={`/shops/${encodeURIComponent(d)}`} className="text-ink font-medium underline underline-offset-2 hover:decoration-2">
                  {d}
                </Link>
              </li>
            ))}
          </ul>
          <h2 className="font-semibold">{t.shops.followedAds}</h2>
          {ads.length === 0 ? (
            <p className="text-fg-2">{t.shops.followedAdsEmpty}</p>
          ) : (
            // Links to /ads/[id], never ?ad= on the briefing: a save here is via=ads.
            <AdGridWithPane ads={ads.map((a) => toCard(a, `/ads/${encodeURIComponent(a.adArchiveId)}`))} saveStores={saveStores} saved={saved} />
          )}
        </div>
      )}
    </>
  );
}

export default async function ShopsPage({ searchParams }: { searchParams: Promise<{ sort?: string; q?: string; page?: string; followed?: string }> }) {
  const user = await requireUser();
  const p = await searchParams;
  if (p.followed === '1') return <FollowedShops user={user} />;
  const sort: ShopSort = SHOP_SORTS.includes(p.sort as ShopSort) ? (p.sort as ShopSort) : 'running_ads';
  const q = p.q?.trim() || undefined;
  const page = p.page && /^\d+$/.test(p.page) ? Math.max(1, Number(p.page)) : 1;
  const settings = await loadSettings();
  const { items: shops, total } = await listShops(db, { sort, q, page, nonShopDomains: settings.nonShopDomains });
  // The market read of this page's shops only (one query; spec §6 "Market read").
  const reads = await shopReads(db, await statusOptions(settings), shops.map((s) => s.landingDomain));
  const base = q ? `/shops?q=${encodeURIComponent(q)}` : '/shops';
  const pageHref = (n: number) => `/shops?${new URLSearchParams({ ...(q ? { q } : {}), sort, page: String(n) })}`;
  return (
    <>
      <PageHeader title={t.shops.title}>
        <span className="text-fg-2 text-sm">{t.shops.count(shops.length, total)}</span>
        <form action="/shops" method="get" className="flex items-end gap-2">
          <input type="hidden" name="sort" value={sort} />
          <div className="grid gap-1">
            <Label htmlFor="shop-q" className="sr-only">
              {t.shops.search}
            </Label>
            <Input id="shop-q" name="q" defaultValue={q ?? ''} placeholder={t.shops.search} className="w-56" />
          </div>
          <Button type="submit" size="sm" variant="outline">
            {t.ads.apply}
          </Button>
        </form>
      </PageHeader>
      <Views followed={false} />
      {shops.length === 0 ? (
        <p className="text-fg-2">{t.shops.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label={t.shops.domain} sort="domain" current={sort} base={base} className="w-[40%] min-w-56" />
              <SortHead label={t.shops.runningAds} sort="running_ads" current={sort} base={base} className="pr-8 text-right" />
              <TableHead className="text-right">{m.newAds}</TableHead>
              <TableHead className="text-right">{m.proven}</TableHead>
              <TableHead className="text-right">{t.shops.keywords}</TableHead>
              <SortHead label={t.shops.firstSeen} sort="first_seen" current={sort} base={base} />
              <SortHead label={t.shops.lastSeen} sort="last_seen" current={sort} base={base} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shops.map((s) => (
              <TableRow key={s.landingDomain}>
                <TableCell>
                  <Link href={`/shops/${encodeURIComponent(s.landingDomain)}`} className="text-ink font-medium underline underline-offset-2 hover:decoration-2">
                    {s.landingDomain}
                  </Link>
                </TableCell>
                <TableCell className="pr-8 text-right font-mono">{s.runningAds}</TableCell>
                <ReadCells read={reads.get(s.landingDomain)} />
                <TableCell>{ddmm(s.firstSeenDate)}</TableCell>
                <TableCell>{ddmm(s.lastSeenDate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pager page={page} pageCount={Math.ceil(total / SHOP_PAGE_SIZE)} href={pageHref} />
    </>
  );
}
