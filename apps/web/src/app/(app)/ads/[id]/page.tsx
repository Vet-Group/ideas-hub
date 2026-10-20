import { AdsView } from '@/components/ads/ads-view';
import { type SearchParams } from '@/components/ads/params';

/** A direct link to an ad opens the grid with its pane (spec §6). */
export default async function AdPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  return <AdsView params={await searchParams} selectedId={decodeURIComponent((await params).id)} />;
}
