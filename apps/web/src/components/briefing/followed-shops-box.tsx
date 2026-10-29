import { followedShopAds, followedShops } from '@ideas-hub/db/queries';
import Link from 'next/link';
import { db } from '@/lib/db';
import { type CurrentUser } from '@/lib/session';
import { statusOptions } from '@/lib/settings';
import { userStores } from '@/lib/store';
import { t } from '@/lib/strings.vi';

const SHOWN_ADS = 5;
const SHOWN_DOMAINS = 10;
const link = 'text-ink rounded-sm font-medium underline underline-offset-2 hover:decoration-2';

/**
 * The selected store's followed shops and their newest ads (AC-A6), read at render time and never from
 * `briefings.sections`. Ads link to /ads/[id], not the briefing's `?ad=` sheet, so a save there is
 * `via = ads`, never `via = briefing`. Hidden when the store follows no shop, the viewer lacks `view`
 * (the queries return nothing) or any read fails.
 */
export async function FollowedShopsBox({ user }: { user: CurrentUser }) {
  let data;
  try {
    const { stores, selectedId } = await userStores(user);
    const store = stores.find((s) => s.id === selectedId);
    if (!store) return null;
    const o = await statusOptions();
    const [domains, { items: ads }] = await Promise.all([followedShops(db, user, store.id), followedShopAds(db, o, user, store.id, undefined, SHOWN_ADS)]);
    if (domains.length === 0) return null;
    data = { store, domains, ads };
  } catch (e) {
    console.error('briefing: followed shops box hidden', e);
    return null;
  }
  const { store, domains, ads } = data;
  return (
    <section aria-labelledby="b-followed" className="bg-surface border-line rounded-card grid content-start gap-2 border p-3">
      <h2 id="b-followed" className="scroll-mt-4 font-semibold">
        {t.shops.followedOf(store.name)}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {domains.slice(0, SHOWN_DOMAINS).map((d) => (
          <li key={d}>
            <Link href={`/shops/${encodeURIComponent(d)}`} className={link}>
              {d}
            </Link>
          </li>
        ))}
      </ul>
      {ads.length === 0 ? (
        <p className="text-fg-2 text-sm">{t.shops.followedAdsEmpty}</p>
      ) : (
        <ul className="divide-line grid divide-y text-sm">
          {ads.map((a) => (
            <li key={a.adArchiveId} className="grid min-h-11 content-center gap-0.5 py-2">
              <Link href={`/ads/${encodeURIComponent(a.adArchiveId)}`} className="truncate rounded-sm font-medium">
                {a.caption || a.pageName || a.adArchiveId}
              </Link>
              <span className="text-fg-2 truncate text-xs">{a.landingDomain}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/shops?followed=1" className={`${link} text-sm`}>
        {t.briefing.followedAll}
      </Link>
    </section>
  );
}
